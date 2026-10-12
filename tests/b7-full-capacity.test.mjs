import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { runBackgroundWorkerCore } from '../lib/commercial-intelligence/background-worker-core.ts'
import { dispatchResearchTick, kickResearch, parseDepth, shouldContinue, WORKER_ROUTE } from '../lib/commercial-intelligence/kick-research.ts'
import { RESEARCH_HARD_LIMITS } from '../lib/commercial-intelligence/research-limits.ts'
import { resolveWorkerConfig } from '../lib/commercial-intelligence/worker-config.ts'
import { describeIntelligence, summarizeRun } from '../lib/intelligence/run-progress.ts'

const read = (file) => readFileSync(file, 'utf8')
const NOW = Date.parse('2026-10-12T10:00:00Z')

// ---------------------------------------------------------------------------------------------------------------------------
// A stand-in for the database claim. It hands out each job once, never lets more than `limitInFlight` run at the same time
// across every tick sharing it (the per-customer concurrency the real claim enforces), and lets a test stop it early (budget).
// ---------------------------------------------------------------------------------------------------------------------------
function fakeDatabase(total, { limitInFlight = 2, budgetJobs = Infinity } = {}) {
  const pending = Array.from({ length: total }, (_, i) => ({ id: `q${i}`, lead_id: `lead${i}`, status: 'pending', retry_count: 0, max_retries: 1, claim_token: null }))
  const state = { claimedTimes: new Map(), completed: [], inFlight: 0, maxInFlight: 0, started: 0, recoverCalls: 0, staleSeen: [] }
  return {
    state,
    pendingCount: () => pending.length,
    dependencies(overrides = {}) {
      return {
        recover: async (_client, stale) => { state.recoverCalls += 1; state.staleSeen.push(stale); return { resetCount: 0, failedCount: 0 } },
        claim: async (_client, limit) => {
          const room = Math.max(0, limitInFlight - state.inFlight)
          const allowed = Math.max(0, Math.min(limit, room, budgetJobs - state.started))
          const taken = pending.splice(0, allowed)
          for (const item of taken) {
            state.claimedTimes.set(item.id, (state.claimedTimes.get(item.id) ?? 0) + 1)
            state.inFlight += 1
            state.started += 1
            state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
          }
          return taken.map((item) => ({ ...item, claim_token: `token-${item.id}` }))
        },
        enrich: async (leadId) => {
          await new Promise((resolve) => setImmediate(resolve))
          return { success: true, ci_enrichment_status: 'completed', website_snapshot: { x: 1 }, business_signals: { y: 1 }, commercial_profile: { summary: `profile for ${leadId}` }, ci_last_error: null, ci_cost_estimate: 0.00035 }
        },
        complete: async (_client, item) => { state.inFlight -= 1; state.completed.push(item.id); return { ok: true, nextStatus: 'enrichment_completed' } },
        ...overrides,
      }
    },
  }
}
const tickOptions = { researchEnabled: true, batchSize: 2, concurrency: 2, maxRounds: 25, tickBudgetMs: 240_000, staleTimeoutSeconds: 180 }

// ----------------------------------------------------------------------------------------------------------------------- capacity
for (const size of [10, 25, 50]) {
  test(`${size} eligible businesses: one tick processes all of them, two at a time, each exactly once`, async () => {
    const db = fakeDatabase(size)
    const result = await runBackgroundWorkerCore({}, db.dependencies(), tickOptions)
    assert.equal(result.completed, size)
    assert.equal(db.state.completed.length, size)
    assert.equal(new Set(db.state.completed).size, size) // no job twice
    assert.ok([...db.state.claimedTimes.values()].every((n) => n === 1))
    assert.ok(db.state.maxInFlight <= 2, `at most two at once, saw ${db.state.maxInFlight}`)
    assert.equal(db.pendingCount(), 0)
  })
}

test('the default tick can carry a full 50-profile search: 25 rounds of 2', () => {
  const config = resolveWorkerConfig({})
  assert.equal(config.batchSize * config.maxRounds, 50)
  assert.equal(config.staleTimeoutSeconds, 180)
  assert.equal(RESEARCH_HARD_LIMITS.maxRounds, 30)
  assert.equal(resolveWorkerConfig({ CI_WORKER_ROUNDS: '9999' }).maxRounds, 30) // configuration can lower it, never exceed the ceiling
})

// -------------------------------------------------------------------------------------------------------------- continuation
test('a chain of ticks finishes a job set larger than one tick, within the bounded depth, with no job twice', async () => {
  const db = fakeDatabase(120) // far more than one tick
  let depth = 0
  let ticks = 0
  for (;;) {
    ticks += 1
    const result = await runBackgroundWorkerCore({}, db.dependencies(), tickOptions)
    if (!shouldContinue({ depth, moreWork: result.moreWork })) break
    depth += 1
  }
  assert.equal(db.state.completed.length, 120)
  assert.equal(new Set(db.state.completed).size, 120)
  assert.ok(ticks <= 1 + RESEARCH_HARD_LIMITS.maxContinuations)
  assert.equal(ticks, 3) // 50 + 50 + 20, then the third tick sees nothing left and ends the chain
})

test('the chain is bounded: it can never run past the maximum depth, whatever the tick reports', () => {
  assert.equal(RESEARCH_HARD_LIMITS.maxContinuations, 6)
  assert.equal(shouldContinue({ depth: 0, moreWork: true }), true)
  assert.equal(shouldContinue({ depth: 5, moreWork: true }), true)
  assert.equal(shouldContinue({ depth: 6, moreWork: true }), false) // the seventh tick (depth 6) ends the chain
  assert.equal(shouldContinue({ depth: 100, moreWork: true }), false)
  assert.equal(shouldContinue({ depth: 0, moreWork: false }), false) // nothing left: stop early
  assert.equal(shouldContinue({ depth: 0, moreWork: true, disabled: true }), false) // switched off: stop
  // a hostile or garbled depth can neither extend the chain nor go negative
  for (const value of ['abc', '-3', '1.5', '', null, undefined, '999']) assert.ok(parseDepth(value) >= 0 && parseDepth(value) <= 6)
  assert.equal(parseDepth('999'), 6)
  assert.equal(parseDepth('3'), 3)
  // a full chain's capacity covers the largest search with a wide margin
  assert.ok((1 + RESEARCH_HARD_LIMITS.maxContinuations) * 50 >= 50)
})

// --------------------------------------------------------------------------------------------------------------- safety cases
test('budget exhaustion: when the claim stops handing out work, the tick ends the chain and nothing is forced', async () => {
  const db = fakeDatabase(50, { budgetJobs: 17 }) // the database refuses to claim after 17 jobs
  const result = await runBackgroundWorkerCore({}, db.dependencies(), tickOptions)
  assert.equal(result.completed, 17)
  assert.equal(result.moreWork, false) // an empty claim means "nothing eligible now": no follow-up tick
  assert.equal(shouldContinue({ depth: 0, moreWork: result.moreWork }), false)
  assert.equal(db.pendingCount(), 33) // left queued and untouched
})

test('worker interruption: a job that cannot finish is failed through the same fenced completion, never lost or repeated', async () => {
  const db = fakeDatabase(6)
  let calls = 0
  const result = await runBackgroundWorkerCore({}, db.dependencies({
    enrich: async (leadId) => {
      calls += 1
      if (leadId === 'lead2') throw new Error('worker interrupted')
      return { success: true, ci_enrichment_status: 'completed', website_snapshot: {}, business_signals: {}, commercial_profile: { summary: 's' }, ci_last_error: null, ci_cost_estimate: 0.0003 }
    },
    complete: async (_client, item, _s, _g, _p, success, error) => { db.state.inFlight -= 1; db.state.completed.push(`${item.id}:${success ? 'ok' : error}`); return { ok: true, nextStatus: success ? 'enrichment_completed' : 'enrichment_failed' } },
  }), tickOptions)
  assert.equal(calls, 6)
  assert.equal(result.completed, 5)
  assert.equal(result.failed, 1)
  assert.ok(db.state.completed.includes('q2:worker interrupted'))
  assert.equal(new Set(db.state.completed.map((entry) => entry.split(':')[0])).size, 6)
})

test('recovery of interrupted work runs at the start of every tick, before anything is claimed, with the short stale window', async () => {
  const order = []
  const db = fakeDatabase(2)
  await runBackgroundWorkerCore({}, db.dependencies({
    recover: async (_c, stale) => { order.push(`recover:${stale}`); return { resetCount: 0, failedCount: 0 } },
    claim: async () => { order.push('claim'); return [] },
  }), tickOptions)
  assert.deepEqual(order, ['recover:180', 'claim'])
})

test('duplicate worker invocations: overlapping ticks never process a job twice and never exceed two at once', async () => {
  const db = fakeDatabase(50)
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => runBackgroundWorkerCore({}, db.dependencies(), tickOptions)))
  assert.equal(a.completed + b.completed + c.completed, 50)
  assert.equal(db.state.completed.length, 50)
  assert.equal(new Set(db.state.completed).size, 50)
  assert.ok([...db.state.claimedTimes.values()].every((n) => n === 1))
  assert.ok(db.state.maxInFlight <= 2, `at most two at once across all ticks, saw ${db.state.maxInFlight}`)
})

test('with research switched off a tick does nothing at all: no recovery, no claim, no continuation', async () => {
  const db = fakeDatabase(10)
  const result = await runBackgroundWorkerCore({}, db.dependencies(), { ...tickOptions, researchEnabled: false })
  assert.equal(result.disabled, true)
  assert.equal(result.moreWork, false)
  assert.equal(db.state.recoverCalls, 0)
  assert.equal(db.state.started, 0)
})

// ------------------------------------------------------------------------------------------------- dispatch (acknowledged)
test('a tick is dispatched in async mode and counts only when the route acknowledges it with 202', async () => {
  const calls = []
  const accept = async (url, init) => { calls.push([url, init.headers.authorization]); return { status: 202 } }
  assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, depth: 2, fetcher: accept }), true)
  assert.deepEqual(calls, [[`https://x.test${WORKER_ROUTE}?async=1&depth=2`, 'Bearer s']])
  assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, fetcher: async () => ({ status: 200 }) }), false)
  assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, fetcher: async () => { throw new Error('network') } }), false)
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher: accept }), { accepted: true })
})

test('nothing is dispatched while research is off, without the secret, or without an origin', async () => {
  let n = 0
  const fetcher = async () => { n += 1; return { status: 202 } }
  assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: false, fetcher }), false)
  assert.equal(await dispatchResearchTick('https://x.test', { secret: '', enabled: true, fetcher }), false)
  assert.equal(await dispatchResearchTick('', { secret: 's', enabled: true, fetcher }), false)
  assert.equal(n, 0)
})

test('the worker route acknowledges at once, runs the tick after the response, and chains one link deeper only within the cap', () => {
  const route = read('app/api/internal/cron/commercial-intelligence/route.ts')
  assert.match(route, /isCommercialIntelligenceCronAuthorized\(request\)/) // the secret comes first
  assert.ok(route.indexOf('isCommercialIntelligenceCronAuthorized') < route.indexOf("searchParams.get('async')"))
  assert.ok(route.indexOf('isResearchEnabled()') < route.indexOf("searchParams.get('async')")) // the kill switch before any work
  assert.match(route, /after\(async \(\) => \{/)
  assert.match(route, /\{ status: 202 \}/)
  assert.match(route, /shouldContinue\(\{ depth, moreWork: result\.moreWork/)
  assert.match(route, /dispatchResearchTick\(origin, \{ depth: depth \+ 1 \}\)/)
  assert.match(route, /export const maxDuration = 300/)
  assert.match(read('app/api/scrape/route.ts'), /kickResearch\(origin\)/)
})

// ---------------------------------------------------------------------------------------------------------- customer progress
const rows = (counts) => Object.entries(counts).flatMap(([state, n]) => Array.from({ length: n }, (_, i) => ({ lead_id: `${state}${i}`, state })))
const stage = (counts, breakdown, running = true) => describeIntelligence(summarizeRun(rows(counts), NOW), running, breakdown)

for (const size of [10, 25, 50]) {
  test(`${size} eligible businesses: progress shows generated, processing, queued and never "complete" while any is queued`, () => {
    const midway = stage({ ready: Math.floor(size / 5), researching: 2, queued: size - Math.floor(size / 5) - 2 })
    assert.equal(midway.phase, 'researching')
    assert.equal(midway.detail, `${Math.floor(size / 5)} generated of ${size} eligible · 2 processing · ${size - Math.floor(size / 5) - 2} queued`)
    assert.ok(midway.progress < 1)
    const oneLeft = stage({ ready: size - 1, queued: 1 })
    assert.notEqual(oneLeft.phase, 'complete')
    assert.ok(oneLeft.progress < 1)
    assert.equal(stage({ ready: size }).phase, 'complete')
  })
}

test('fewer saved than requested, and missing websites, are reported accurately and never promised', () => {
  // 50 requested, 32 saved, 4 of those have no website: 28 eligible.
  const counts = { ready: 10, researching: 2, queued: 14, failed: 2, unavailable: 4 }
  const running = stage(counts, { noWebsite: 4, overLimit: 0 })
  assert.equal(running.detail, '10 generated of 28 eligible · 2 processing · 14 queued · 2 unsuccessful · 4 with no website')
  assert.ok(!/of 50|of 32/.test(running.detail)) // neither the requested nor the saved total is promised
  const done = stage({ ready: 24, failed: 2, unavailable: 4 }, { noWebsite: 4, overLimit: 0 })
  assert.equal(done.phase, 'complete')
  assert.equal(done.headline, '24 business profiles generated')
  assert.equal(done.detail, '2 research attempts unsuccessful · 4 with no website')
})

test('no eligible business at all (none has a website) completes honestly instead of promising anything', () => {
  const none = stage({ unavailable: 5 }, { noWebsite: 5, overLimit: 0 })
  assert.equal(none.phase, 'complete')
  assert.equal(none.headline, '0 business profiles generated')
  assert.equal(none.detail, '5 with no website')
})

// --------------------------------------------------------------------------------------------- isolation, history, authorization
const sql = read('supabase/applied-records/20261016_ci_phase1_run_scoped.sql')
const claimSql = sql.slice(sql.indexOf('FUNCTION public.claim_ci_run_items'), sql.indexOf('FUNCTION public.complete_ci_run_item'))
const authorizeSql = sql.slice(sql.indexOf('FUNCTION public.authorize_ci_research_run'), sql.indexOf('FUNCTION public.claim_ci_run_items'))

test('owner isolation and the allow-list are enforced by the database claim, on every tick', () => {
  assert.match(claimSql, /ru\.user_id = q\.user_id/) // a job is claimed only through its own customer's run
  assert.match(claimSql, /v_ctl\.allow_all_customers OR ru\.user_id = ANY \(v_ctl\.allowed_user_ids\)/)
  assert.match(claimSql, /ci_research_run_leads rl WHERE rl\.run_id = q\.run_id AND rl\.lead_id = q\.lead_id AND rl\.user_id = q\.user_id/)
  assert.match(claimSql, /v_active >= v_ctl\.per_user_concurrency/) // two at a time per customer, counted across overlapping ticks
  assert.match(claimSql, /PERFORM pg_advisory_xact_lock\(hashtextextended\('ci_budget', 0\)\)/) // claims and reservations are serialised
  assert.match(claimSql, /FOR UPDATE SKIP LOCKED/) // a job is handed to one tick only
})

test('historical jobs can never be claimed: only jobs that belong to an authorized run are candidates', () => {
  assert.match(claimSql, /q\.run_id IS NOT NULL/)
  assert.match(claimSql, /ru\.status = 'active'/)
  assert.match(claimSql, /ru\.expires_at > now\(\)/)
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.claim_ci_queue_items_worker\(integer\) FROM service_role/) // the old broad claim is gone
})

test('budgets are checked before work is claimed, and a repeated reservation is refused', () => {
  assert.match(claimSql, /v_ctl\.enabled/) // the database kill switch
  assert.match(claimSql, /v_profile \+ v_ctl\.per_job_reserve_usd > v_ctl\.per_profile_ceiling_usd/)
  assert.match(claimSql, /v_run_used \+ v_ctl\.per_job_reserve_usd > v_run\.budget_limit_usd/)
  assert.match(claimSql, /v_user_used \+ v_ctl\.per_job_reserve_usd > v_run\.customer_month_limit_usd/)
  assert.match(claimSql, /v_global \+ v_ctl\.per_job_reserve_usd > v_ctl\.global_monthly_limit_usd/)
  assert.match(claimSql, /ON CONFLICT \(queue_id, attempt\) DO NOTHING/)
})

test('authorization: once per run, exactly the businesses the save receipt confirms, never more than were saved', () => {
  assert.match(authorizeSql, /v_receipt\.result->'outcomes'/)
  assert.match(authorizeSql, /s\.o->>'status' = 'saved'/)
  assert.match(authorizeSql, /l\.user_id = p_user_id/)
  assert.match(authorizeSql, /v_all_site_ids\[1:v_ctl\.max_leads_per_run\]/) // the cap is one operator setting, never above the saved set
  assert.match(authorizeSql, /already/) // idempotent: a second call returns the existing authorization
  // the application never raises the cap or the limits: they stay operator settings
  for (const file of ['lib/commercial-intelligence/run-authorization.ts', 'app/api/scrape/route.ts']) assert.ok(!/max_leads_per_run\s*[:=]\s*\d/.test(read(file)), file)
})

test('this change touches no discovery provider limit, query strategy, credit pricing or deduplication', () => {
  const shared = read('lib/scraper/run-scraper-shared.ts')
  assert.match(shared, /const MAX_SERPER_QUERIES = 2/)
  assert.match(shared, /const MAX_GOOGLE_CALLS = 1/)
  for (const file of ['lib/scraper/save-discover-results.ts', 'lib/usage/usage.ts']) assert.ok(!/RESEARCH_HARD_LIMITS|dispatchResearchTick/.test(read(file)), file)
})

// ======================================================================================================= recovery and reliability
import { isSafeDispatchOrigin } from '../lib/commercial-intelligence/kick-research.ts'

function scripted(statuses) {
  const calls = []
  let i = 0
  const fetcher = async () => {
    const next = statuses[Math.min(i, statuses.length - 1)]
    i += 1
    calls.push(next)
    if (next === 'error') throw new Error('network')
    return { status: next }
  }
  return { fetcher, calls }
}
const noWait = async () => {}

test('a lost continuation request is retried only for transient failures, at most three times', async () => {
  const transient = scripted([503, 202])
  assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, fetcher: transient.fetcher, sleep: noWait }), true)
  assert.equal(transient.calls.length, 2)
  const network = scripted(['error', 'error', 202])
  assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, fetcher: network.fetcher, sleep: noWait }), true)
  assert.equal(network.calls.length, 3)
  for (const status of [503, 429, 'error']) {
    const always = scripted([status])
    assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, fetcher: always.fetcher, sleep: noWait }), false)
    assert.equal(always.calls.length, 3, `${status}: never more than three attempts`)
  }
})

test('a refusal retrying cannot fix ends at once: wrong secret, research off, wrong route', async () => {
  for (const status of [401, 200, 404, 403]) {
    const refused = scripted([status])
    assert.equal(await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, fetcher: refused.fetcher, sleep: noWait }), false)
    assert.equal(refused.calls.length, 1, `${status}: one attempt`)
  }
})

test('the secret is sent only to an https origin (or localhost while developing)', async () => {
  assert.equal(isSafeDispatchOrigin('https://alpa.mindrasolutions.com'), true)
  assert.equal(isSafeDispatchOrigin('http://localhost:3000'), true)
  for (const origin of ['http://alpa.mindrasolutions.com', 'http://evil.test', 'ftp://x.test', 'not a url', '']) assert.equal(isSafeDispatchOrigin(origin), false, origin)
  const sent = scripted([202])
  assert.equal(await dispatchResearchTick('http://evil.test', { secret: 's', enabled: true, fetcher: sent.fetcher, sleep: noWait }), false)
  assert.equal(sent.calls.length, 0)
})

test('a lost chain strands nothing permanently: a later tick finishes the rest, each job exactly once', async () => {
  const db = fakeDatabase(30)
  // The first tick is cut short (10 jobs); its hand-over to the next tick is lost.
  const first = await runBackgroundWorkerCore({}, db.dependencies(), { ...tickOptions, maxRounds: 5 })
  assert.equal(first.completed, 10)
  assert.equal(first.moreWork, true)
  let lostDispatch = await dispatchResearchTick('https://x.test', { secret: 's', enabled: true, fetcher: scripted([503]).fetcher, sleep: noWait })
  assert.equal(lostDispatch, false)
  assert.equal(db.pendingCount(), 20) // queued and untouched while nothing runs
  // Any later tick (a new search, the daily backstop, an operator) picks the rest up.
  const later = await runBackgroundWorkerCore({}, db.dependencies(), tickOptions)
  assert.equal(later.completed, 20)
  assert.equal(db.state.completed.length, 30)
  assert.equal(new Set(db.state.completed).size, 30)
  assert.ok([...db.state.claimedTimes.values()].every((n) => n === 1))
})

test('interrupted claims are recovered by the next tick, and the recovered work is bounded by the same claim rules', async () => {
  // Tick 1 dies after claiming two jobs (they stay "processing"). The next tick's recovery fails them (one attempt) and the
  // tick goes on with the rest. Recovery itself never claims, reserves or starts anything.
  const db = fakeDatabase(8)
  const stranded = []
  const dying = db.dependencies({
    enrich: async () => { throw new Error('process killed') },
    complete: async () => { throw new Error('process killed before the result was recorded') },
  })
  await runBackgroundWorkerCore({}, dying, { ...tickOptions, maxRounds: 1 })
  assert.equal(db.state.started, 2)
  stranded.push(...db.state.claimedTimes.keys())
  let recovered = 0
  const next = db.dependencies({
    recover: async (_c, stale) => { assert.equal(stale, 180); recovered = stranded.length; db.state.inFlight = 0; return { resetCount: 0, failedCount: recovered } },
  })
  const result = await runBackgroundWorkerCore({}, next, tickOptions)
  assert.equal(recovered, 2)
  assert.equal(result.permanentlyFailedDuringRecovery, 2)
  assert.equal(result.completed, 6)
  assert.ok(db.state.maxInFlight <= 2)
})

test('recovery can only touch authorized-run jobs: it never activates a legacy job, claims, or reserves budget', () => {
  const recoverSql = sql.slice(sql.indexOf('FUNCTION public.recover_ci_run_items'), sql.indexOf('FUNCTION public.cancel_ci_research_run'))
  assert.equal((recoverSql.match(/run_id IS NOT NULL AND status = 'processing'/g) ?? []).length, 2) // both the fail and the return-to-queue statements
  assert.ok(!/INSERT INTO public\.ci_research_charges/.test(recoverSql)) // recovery reserves nothing
  assert.ok(!/status = 'pending'[^;]*run_id IS NULL/.test(recoverSql))
  assert.match(recoverSql, /retry_count \+ 1 >= max_retries/) // out of attempts: failed, never silently re-run
  assert.match(recoverSql, /greatest\(p_timeout_seconds, 60\)/) // never reclaims a job that could still be running
  // And a tick, recovery included, is still refused when research is off.
  assert.match(read('lib/commercial-intelligence/background-worker-core.ts'), /if \(!\(options\.researchEnabled \?\? isResearchEnabled\(\)\)\)[\s\S]{0,200}return \{ ok: true, disabled: true, moreWork: false/)
})

test('the synchronous (operator or cron) call never chains: only the acknowledged async mode can hand over', () => {
  const route = read('app/api/internal/cron/commercial-intelligence/route.ts')
  const syncBranch = route.slice(route.indexOf('try {\n    const result'))
  assert.ok(!/dispatchResearchTick|after\(/.test(syncBranch))
  assert.equal((route.match(/dispatchResearchTick\(/g) ?? []).length, 1)
})

// ======================================================================================================= recovery cron
test('the daily recovery backstop is configured exactly: one cron, the existing worker route in async mode, once a day', () => {
  const config = JSON.parse(read('vercel.json'))
  assert.deepEqual(Object.keys(config), ['crons'])
  assert.equal(config.crons.length, 1)
  assert.deepEqual(config.crons[0], { path: `${WORKER_ROUTE}?async=1`, schedule: '0 9 * * *' })
  // Hobby allows one run a day: the schedule has a fixed hour and wildcards for the rest, so it cannot be more frequent.
  assert.match(config.crons[0].schedule, /^\d{1,2} \d{1,2} \* \* \*$/)
})

test('the backstop reaches the same guarded route: secret first, kill switch, then the run-scoped claim', () => {
  const route = read('app/api/internal/cron/commercial-intelligence/route.ts')
  assert.ok(route.indexOf('isCommercialIntelligenceCronAuthorized(request)') < route.indexOf('isResearchEnabled()'))
  assert.match(read('lib/commercial-intelligence/cron-auth.ts'), /Bearer \$\{secret\}/) // Vercel sends this header when CRON_SECRET is set
  assert.match(route, /export const maxDuration = 300/)
})
