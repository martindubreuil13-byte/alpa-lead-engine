// The research spend engine, run for real: the production Phase 1 SQL (reservation, claim, settlement, recovery) and the captured
// production completion function, loaded into an in-process Postgres (PGlite) with only table structure stubbed. It validates how
// the PROPOSED pilot limits behave before anyone applies them. Skipped where @electric-sql/pglite is not installed
// (npm i --no-save @electric-sql/pglite@0.2.17 to run it).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { retryVerdict } from '../lib/intelligence/retry-eligibility.ts'

let PGlite = null
try { ({ PGlite } = await import('@electric-sql/pglite')) } catch { /* optional dependency */ }
const skip = PGlite ? false : 'set up @electric-sql/pglite to run the spend engine tests'

const PILOT = { reserve: 0.002, ceiling: 0.004, runCap: 0.05, perLead: 0.001, global: 10, maxLeads: 50, concurrency: 2, attempts: 1, ttl: 48 }

async function engine(limits = PILOT) {
  const db = new PGlite()
  for (const file of ['tests/fixtures/ci/schema-stub.sql', 'tests/fixtures/ci/complete_ci_enrichment_worker.sql', 'supabase/applied-records/20261016_ci_phase1_run_scoped.sql']) {
    await db.exec(fs.readFileSync(file, 'utf8'))
  }
  await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)")
  const q = async (text, params) => (await db.query(text, params)).rows
  const owner = (await q('insert into auth.users default values returning id'))[0].id
  await q('select set_ci_research_enabled(true, $1)', ['test'])
  await q('select set_ci_research_access(false, $1::uuid[], $2)', [[owner], 'test'])
  const setLimits = (l) => q('select set_ci_research_limits($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [l.reserve, l.ceiling, l.runCap, l.perLead, l.global, l.maxLeads, l.concurrency, l.attempts, l.ttl, 'test'])
  await setLimits(limits)

  async function authorize(user, count, planLimit = 120) {
    const runId = (await q('select gen_random_uuid() id'))[0].id
    const leads = []
    for (let i = 0; i < count; i += 1) leads.push((await q("insert into leads (user_id, company_name, website) values ($1, $2, 'https://example.test') returning id", [user, `Biz ${i}`]))[0].id)
    await q('insert into discover_save_receipts (run_id, user_id, result) values ($1, $2, $3)', [runId, user, JSON.stringify({ outcomes: leads.map((id) => ({ id, status: 'saved' })) })])
    const result = (await q('select authorize_ci_research_run($1, $2, $3) r', [runId, user, planLimit]))[0].r
    return { runId, leads, result }
  }
  const claim = (limit = 5) => q('select * from claim_ci_run_items($1)', [limit])
  const complete = (job, ok, cost, error = null) => q('select * from complete_ci_run_item($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    job.id, job.lead_id, job.claim_token, ok ? '{"x":1}' : null, ok ? '{"y":1}' : null, ok ? '{"summary":"A factual summary."}' : null, ok, error, cost,
  ])
  const ledger = (runId) => q('select attempt, reserved_usd::float r, actual_usd::float a, state from ci_research_charges where run_id = $1 order by created_at, attempt', [runId])
  const spend = async (runId) => (await q('select coalesce(sum(coalesce(actual_usd, reserved_usd)),0)::float s from ci_research_charges where run_id = $1', [runId]))[0].s
  return { db, q, owner, setLimits, authorize, claim, complete, ledger, spend }
}

test('the pilot limits: authorization sets the run budget, queues the exact set, and refuses everyone not allow-listed', { skip }, async () => {
  const e = await engine()
  const { runId, result } = await e.authorize(e.owner, 10)
  assert.equal(result.queued, 10)
  assert.equal(Number(result.budget_limit_usd), 0.04, 'min(run cap 0.05, 10 profiles x ceiling 0.004)')
  const stranger = (await e.q('insert into auth.users default values returning id'))[0].id
  await assert.rejects(() => e.authorize(stranger, 3), /not enabled for this customer/)
  assert.equal((await e.q('select count(*)::int n from commercial_intelligence_queue where user_id = $1', [stranger]))[0].n, 0)
  assert.equal((await e.q('select count(*)::int n from commercial_intelligence_queue where run_id = $1', [runId]))[0].n, 10)
})

test('reservation: two at a time per customer, one reservation per attempt, all on the ledger', { skip }, async () => {
  const e = await engine()
  const { runId } = await e.authorize(e.owner, 6)
  const first = await e.claim(5)
  assert.equal(first.length, 2, 'per-customer concurrency is honoured even when five are asked for')
  assert.deepEqual((await e.ledger(runId)).map((row) => [row.r, row.a, row.state]), [[0.002, null, 'reserved'], [0.002, null, 'reserved']])
  assert.equal((await e.claim(5)).length, 0, 'nothing more while two are running')
  assert.equal((await e.ledger(runId)).length, 2, 'a repeated claim reserves nothing new')
})

test('settlement: the actual cost, including an internal repair call, replaces the reservation', { skip }, async () => {
  const e = await engine()
  const { runId } = await e.authorize(e.owner, 2)
  const [a, b] = await e.claim(2)
  await e.complete(a, true, 0.0008) // first call + one repair call, summed by the profile generator
  await e.complete(b, true, 0.0004)
  assert.deepEqual((await e.ledger(runId)).map((row) => [row.a, row.state]), [[0.0008, 'settled'], [0.0004, 'settled']])
  assert.ok(Math.abs((await e.spend(runId)) - 0.0012) < 1e-9)
  assert.equal((await e.q("select count(*)::int n from leads where ci_enrichment_status = 'completed'"))[0].n, 2)
  // a late duplicate completion changes nothing and costs nothing
  const again = await e.complete(a, true, 0.5)
  assert.equal(again[0].message, 'claim_lost')
  assert.ok(Math.abs((await e.spend(runId)) - 0.0012) < 1e-9)
})

test('one attempt, no automatic retry; the customer gets exactly one retry, which is reserved and ledgered like any attempt', { skip }, async () => {
  const e = await engine()
  const { runId } = await e.authorize(e.owner, 1)
  const [job] = await e.claim(1)
  assert.equal(job.max_retries, 1)
  assert.equal((await e.complete(job, false, 0.0004, 'Website request timed out'))[0].message, 'enrichment_failed')
  let row = (await e.q('select status, retry_count, max_retries, last_error from commercial_intelligence_queue where id = $1', [job.id]))[0]
  assert.deepEqual([row.status, row.retry_count, row.max_retries], ['failed', 1, 1], 'ended at once: nothing retries by itself')
  assert.equal((await e.claim(5)).length, 0)

  const context = async () => {
    const r = (await e.q('select status, retry_count, max_retries, last_error, claim_token from commercial_intelligence_queue where id = $1', [job.id]))[0]
    return {
      jobStatus: r.status, lastError: r.last_error, retryCount: r.retry_count, maxRetries: r.max_retries, runMaxAttempts: 1, claimed: r.claim_token !== null,
      runStatus: 'active', runExpiresAt: '2999-01-01T00:00:00Z', allowed: true, perJobReserve: 0.002, profileCeiling: 0.004,
      spent: { profile: await e.spend(runId), run: await e.spend(runId), customerMonth: await e.spend(runId), globalMonth: await e.spend(runId) },
      limits: { run: 0.04, customerMonth: 0.12, globalMonth: 10 },
    }
  }
  const verdict = retryVerdict(await context())
  assert.deepEqual(verdict, { ok: true, grant: true })
  // exactly what requeueFailedItem does when the retry is granted
  await e.q("update commercial_intelligence_queue set status = 'pending', completed_at = null, started_at = null, claim_token = null, last_error = 'Retry requested by customer', last_retry_at = null, max_retries = $2 where id = $1 and status = 'failed' and retry_count = $3", [job.id, 2, 1])
  const [second] = await e.claim(1)
  assert.equal(second.id, job.id)
  assert.deepEqual((await e.ledger(runId)).map((r) => [r.attempt, r.a]), [[0, 0.0004], [1, null]], 'a new reservation for the new attempt; the first stays settled')
  assert.equal((await e.complete(second, false, 0.0004, 'Website request timed out'))[0].message, 'enrichment_failed')
  row = (await e.q('select status, retry_count, max_retries from commercial_intelligence_queue where id = $1', [job.id]))[0]
  assert.deepEqual([row.status, row.retry_count, row.max_retries], ['failed', 2, 2])
  assert.deepEqual(retryVerdict(await context()), { ok: false, reason: 'attempts' }, 'a second manual retry is refused')
  assert.ok(Math.abs((await e.spend(runId)) - 0.0008) < 1e-9, 'both attempts are on the spend')
})

test('the profile ceiling of $0.004 still admits the one retry after an interrupted attempt billed at its reservation', { skip }, async () => {
  const e = await engine()
  const { runId } = await e.authorize(e.owner, 1)
  const [job] = await e.claim(1)
  await e.q("update commercial_intelligence_queue set started_at = now() - interval '10 minutes' where id = $1", [job.id])
  const recovered = (await e.q('select * from recover_ci_run_items(180)'))[0]
  assert.equal(recovered.failed_count, 1)
  assert.equal((await e.ledger(runId))[0].a, 0.002, 'an interrupted attempt is billed at its reservation')
  await e.q("update commercial_intelligence_queue set status = 'pending', completed_at = null, claim_token = null, last_retry_at = null, max_retries = 2 where id = $1", [job.id])
  const [retry] = await e.claim(1)
  assert.ok(retry, '0.002 spent + 0.002 reserved = 0.004, which is not above the ceiling')
})

test('the run cap: a 50-profile run at the observed cost never reaches it; a run that overspends is stopped, not exceeded', { skip }, async () => {
  const e = await engine()
  const { runId, result } = await e.authorize(e.owner, 50, 500)
  assert.equal(Number(result.budget_limit_usd), 0.05)
  for (let guard = 0; guard < 60; guard += 1) {
    const jobs = await e.claim(2)
    if (jobs.length === 0) break
    for (const job of jobs) await e.complete(job, true, 0.0005)
  }
  assert.equal((await e.q("select count(*)::int n from commercial_intelligence_queue where run_id = $1 and status = 'completed'", [runId]))[0].n, 50)
  assert.ok((await e.spend(runId)) < 0.03, `observed-cost run spent ${await e.spend(runId)}`)

  // pathological: every attempt costs its full reservation. The run cap ($0.05) is honoured to the cent.
  const bad = await e.authorize(e.owner, 40, 500)
  for (let guard = 0; guard < 60; guard += 1) {
    const jobs = await e.claim(2)
    if (jobs.length === 0) break
    for (const job of jobs) await e.complete(job, true, 0.002)
  }
  assert.ok((await e.spend(bad.runId)) <= 0.05 + 1e-9, `overspending run stopped at ${await e.spend(bad.runId)}`)
  assert.ok((await e.q("select count(*)::int n from commercial_intelligence_queue where run_id = $1 and last_error = 'run_budget_exhausted'", [bad.runId]))[0].n > 0)
})

test('the global monthly budget stops all claiming; the customer budget waits without failing', { skip }, async () => {
  const e = await engine({ ...PILOT, global: 0.006 })
  const { runId } = await e.authorize(e.owner, 6)
  const claimed = []
  for (let guard = 0; guard < 10; guard += 1) {
    const jobs = await e.claim(2)
    if (!jobs.length) break
    for (const job of jobs) { claimed.push(job); await e.complete(job, true, 0.002) }
  }
  assert.equal(claimed.length, 3, '3 x $0.002 reaches the $0.006 global limit')
  assert.equal((await e.q("select count(*)::int n from commercial_intelligence_queue where run_id = $1 and status = 'pending'", [runId]))[0].n, 3, 'the rest wait, untouched')

  const small = await engine()
  const { runId: freeRun } = await small.authorize(small.owner, 30, 25) // a free-sized plan: 25 x $0.001 = $0.025 for the month
  let done = 0
  for (let guard = 0; guard < 40; guard += 1) {
    const jobs = await small.claim(2)
    if (!jobs.length) break
    for (const job of jobs) { await small.complete(job, true, 0.001); done += 1 }
  }
  assert.ok(done >= 20 && done <= 25, `customer monthly limit held at ${done} profiles`)
  assert.equal((await small.q("select count(*)::int n from commercial_intelligence_queue where run_id = $1 and status = 'failed'", [freeRun]))[0].n, 0, 'waiting is not failing')
})

test('the emergency switch: nothing is claimed while research is off, and nothing is lost', { skip }, async () => {
  const e = await engine()
  const { runId } = await e.authorize(e.owner, 4)
  await e.q('select set_ci_research_enabled(false, $1)', ['test'])
  assert.equal((await e.claim(5)).length, 0)
  assert.equal((await e.q("select count(*)::int n from commercial_intelligence_queue where run_id = $1 and status = 'pending'", [runId]))[0].n, 4)
  await e.q('select set_ci_research_enabled(true, $1)', ['test'])
  assert.equal((await e.claim(5)).length, 2)
})

test('an expired run is never claimed, and reconciliation closes only its unstarted jobs', { skip }, async () => {
  const e = await engine()
  const { runId } = await e.authorize(e.owner, 5)
  const [running] = await e.claim(1)
  await e.q("update ci_research_runs set expires_at = now() - interval '1 hour' where run_id = $1", [runId])
  assert.equal((await e.claim(5)).length, 0, 'the database already refuses expired runs')
  // the reconciliation rule (see lib/commercial-intelligence/run-reconciliation.ts), applied as the service would
  const closed = await e.q("update commercial_intelligence_queue set status = 'failed', completed_at = now(), claim_token = null, last_error = 'run expired' where run_id in (select run_id from ci_research_runs where status = 'active' and expires_at < now()) and status = 'pending' and claim_token is null returning id")
  assert.equal(closed.length, 4)
  const still = (await e.q('select status from commercial_intelligence_queue where id = $1', [running.id]))[0]
  assert.equal(still.status, 'processing', 'the running job is untouched')
  assert.equal((await e.q('select count(*)::int n from ci_research_charges where run_id = $1', [runId]))[0].n, 1, 'spend history is untouched')
})

test('why the re-queue clears the cool-down: without it the retry is not claimable for 60 seconds', { skip }, async () => {
  const e = await engine()
  await e.authorize(e.owner, 1)
  const [job] = await e.claim(1)
  await e.complete(job, false, 0.0004, 'Website request timed out')
  await e.q("update commercial_intelligence_queue set status = 'pending', completed_at = null, claim_token = null, max_retries = 2 where id = $1", [job.id])
  assert.equal((await e.claim(1)).length, 0, 'still cooling down: the worker tick that the retry request starts would find nothing')
  await e.q('update commercial_intelligence_queue set last_retry_at = null where id = $1', [job.id])
  assert.equal((await e.claim(1)).length, 1)
})
