// B2 Phase 1 — run-scoped Business Intelligence: database behaviour.
//
// These tests need a DISPOSABLE local Postgres 17 (ALPA_TEST_DB_URL, loopback only; the runner refuses anything
// else and anything that looks like Supabase). They build throwaway databases from the production-faithful fixture,
// then the REAL applied records in order (B1.1 queue integrity, Phase 0 lockdown, atomic Discover save) and finally the
// Phase 1 proposal, and drop them afterwards. Discover runs are saved through the real save_discover_results function,
// so every authorization starts from a genuine save receipt. No network, no AI, no paid service.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const DB_URL = process.env.ALPA_TEST_DB_URL
const dbReady = (() => {
  if (!DB_URL) return false
  const url = new URL(DB_URL)
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || /supabase/i.test(DB_URL)) {
    throw new Error(`ALPA_TEST_DB_URL must be a loopback database, refusing ${url.hostname}`)
  }
  return true
})()
const opts = { skip: dbReady ? false : 'set ALPA_TEST_DB_URL to a disposable local Postgres to run' }

const FILES = {
  baseline: path.join(ROOT, 'tests/sql/ci-queue-baseline.sql'),
  b11: path.join(ROOT, 'supabase/applied-records/20261012_ci_queue_integrity.sql'),
  lockdown: path.join(ROOT, 'supabase/applied-records/20261015_ci_phase0_lockdown.sql'),
  atomic: path.join(ROOT, 'supabase/applied-records/20261014_discover_atomic_saves.sql'),
  phase1: path.join(ROOT, 'supabase/proposed/20261016_ci_phase1_run_scoped.sql'),
  disable: path.join(ROOT, 'supabase/proposed/20261016_ci_phase1_run_scoped_disable.sql'),
  teardown: path.join(ROOT, 'supabase/proposed/20261016_ci_phase1_run_scoped_teardown_unused.sql'),
}
// Production's column defaults and the tables the atomic save needs (the queue fixture omits them); test-only.
const FIXTURE = `
ALTER TABLE public.leads ALTER COLUMN ci_retry_count SET DEFAULT 0;
ALTER TABLE public.leads ALTER COLUMN ci_cost_estimate SET DEFAULT 0;
ALTER TABLE public.leads ALTER COLUMN ci_model_versions SET DEFAULT '{"profile": "v1", "signals": "v1", "snapshot": "v1"}'::jsonb;
ALTER TABLE public.leads ADD COLUMN email text, ADD COLUMN phone text, ADD COLUMN city text, ADD COLUMN industry text,
  ADD COLUMN status text, ADD COLUMN source text, ADD COLUMN email_confidence text, ADD COLUMN email_source text,
  ADD COLUMN is_generic_email boolean, ADD COLUMN cost_estimate numeric, ADD COLUMN last_activity_at timestamptz;
CREATE TABLE public.usage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, leads_used integer NOT NULL DEFAULT 0,
  leads_limit integer NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL);
`

const PSQL = process.env.PSQL || (fs.existsSync('/opt/homebrew/opt/libpq/bin/psql') ? '/opt/homebrew/opt/libpq/bin/psql' : 'psql')
const conn = dbReady ? new URL(DB_URL) : null
const env = () => ({ ...process.env, PGPASSWORD: decodeURIComponent(conn.password) })
const baseArgs = (database) => ['-X', '-q', '-t', '-A', '-h', conn.hostname, '-p', conn.port || '5432', '-U', decodeURIComponent(conn.username), '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', database]
function sql(database, text, extra = []) {
  try {
    return execFileSync(PSQL, [...baseArgs(database), ...extra], { input: text, env: env(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    throw Object.assign(new Error(String(error.stderr || error.message).trim()), { stderr: String(error.stderr || '') })
  }
}
const sqlAsync = (database, text) => new Promise((resolve, reject) => {
  const child = spawn(PSQL, baseArgs(database), { env: env() })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { err += chunk })
  child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim()))))
  child.stdin.end(text)
})
const attempt = (database, text) => {
  try { return { ok: true, out: sql(database, text), err: '' } } catch (error) { return { ok: false, out: '', err: error.message } }
}

const A = 'aaaaaaaa-0000-0000-0000-00000000000a'
const B = 'bbbbbbbb-0000-0000-0000-00000000000b'
const asUser = (id) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false), set_config('request.jwt.claim.role','authenticated',false) \\g /dev/null\n`
const asService = `SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false) \\g /dev/null\n`
const asAnon = `SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false) \\g /dev/null\n`
const svc = (db, text) => sql(db, `${asService}${text}`)
const PROFILE = `'{"summary":"A factual profile of the business.","industry":"x"}'::jsonb`
const OK = { snapshot: `'{"s":1}'::jsonb`, signals: `'{"g":1}'::jsonb` }
const RUN = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const SETUP = `
INSERT INTO auth.users(id) VALUES ('${A}'), ('${B}');
UPDATE public.ci_research_controls SET enabled = true, per_job_reserve_usd = 0.002, per_profile_ceiling_usd = 0.006, per_run_cap_usd = 1,
  per_lead_monthly_usd = 0.01, global_monthly_limit_usd = 5, per_user_concurrency = 4, max_attempts = 2, run_ttl_hours = 24,
  max_leads_per_run = 100, allow_all_customers = true;
`

const created = []
let templateReady = false
function ensureTemplate() {
  if (templateReady) return
  const name = 'p1t'
  sql('postgres', `DROP DATABASE IF EXISTS ${name}`)
  sql('postgres', `CREATE DATABASE ${name}`)
  sql(name, fs.readFileSync(FILES.baseline, 'utf8'))
  sql(name, FIXTURE)
  for (const file of [FILES.b11, FILES.lockdown, FILES.atomic, FILES.phase1]) sql(name, fs.readFileSync(file, 'utf8'), ['-1'])
  templateReady = true
}
let counter = 0
function freshDb() {
  ensureTemplate()
  const name = `p1_${process.pid}_${++counter}`
  sql('postgres', `CREATE DATABASE ${name} TEMPLATE p1t`)
  created.push(name)
  sql(name, SETUP)
  return name
}
after(() => {
  if (!dbReady) return
  for (const name of [...created, 'p1t']) {
    try { sql('postgres', `DROP DATABASE IF EXISTS ${name}`) } catch {}
  }
})

/** A Discover save through the real atomic function: `n` items, the last `invalid` of them with no contact at all. */
function saveRun(db, { user = A, run, n = 25, invalid = 2, noWebsite = 0, limit = 500, prefix = 'Biz' } = {}) {
  const items = Array.from({ length: n }, (_, i) => {
    const hasContact = i < n - invalid
    const hasWebsite = i >= noWebsite
    return {
      company_name: `${prefix} ${user.slice(0, 2)} ${i + 1}`, city: 'London', industry: 'Consultant', source: 'serper',
      email: hasContact && i % 2 === 0 ? `hello${i}@${prefix.toLowerCase()}${i}.example` : null,
      phone: hasContact ? `020 7946 ${String(1000 + i)}` : null,
      website: hasWebsite ? `https://www.${prefix.toLowerCase()}${i}.example` : null,
    }
  })
  const saved = svc(db, `SELECT jsonb_pretty('{}'::jsonb) \\g /dev/null\nSELECT (save_discover_results('${run}','${user}',${limit},true,'${JSON.stringify(items).replace(/'/g, "''")}'::jsonb)->'outcomes')::text`)
  return JSON.parse(saved)
}
const authorize = (db, run, user = A, limit = 500) => JSON.parse(svc(db, `SELECT authorize_ci_research_run('${run}','${user}',${limit})::text`))
const queueFor = (db, run) => sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE run_id='${run}'`)
const claim = (db, limit = 5) => svc(db, `SELECT id || '|' || lead_id || '|' || user_id || '|' || run_id || '|' || retry_count || '|' || claim_token FROM claim_ci_run_items(${limit}) ORDER BY id`).split('\n').filter(Boolean).map((line) => {
  const [id, lead, user, run, retry, token] = line.split('|')
  return { id, lead, user, run, retry: Number(retry), token }
})
const complete = (db, job, { success = true, profile = PROFILE, cost = 0.0005, error = 'NULL', snapshot = OK.snapshot, signals = OK.signals } = {}) =>
  svc(db, `SELECT success || ':' || message FROM complete_ci_run_item('${job.id}','${job.lead}','${job.token}',${success ? snapshot : 'NULL'},${success ? signals : 'NULL'},${success ? profile : 'NULL'},${success},${error},${cost})`)
const usage = (db) => sql(db, `SELECT coalesce(string_agg(user_id::text || '=' || leads_used || '/' || leads_limit, ',' ORDER BY user_id),'none') FROM usage`)
const fingerprint = (db, where = 'run_id IS NULL') => sql(db, `SELECT coalesce(md5(string_agg(q::text, '|' ORDER BY q.id)),'empty') || ':' || count(*) FROM commercial_intelligence_queue q WHERE ${where}`)
const progress = (db, run, user = A) => sql(db, `${asUser(user)} SELECT state || '=' || count(*) FROM get_ci_run_progress('${run}') GROUP BY state ORDER BY state`).split('\n').filter(Boolean).join(',')
const charges = (db) => sql(db, `SELECT count(*) || '|' || coalesce(sum(reserved_usd),0) || '|' || coalesce(sum(coalesce(actual_usd,0)),0) FROM ci_research_charges`)

// ---------------------------------------------------------------------------------------------
// 1-3. Authorization from the save receipt
// ---------------------------------------------------------------------------------------------

test('a 25-business request that saves 23 authorizes exactly those 23 (not 25, not anything else)', opts, () => {
  const db = freshDb()
  const run = RUN(1)
  const outcomes = saveRun(db, { run, n: 25, invalid: 2 })
  assert.equal(outcomes.filter((o) => o.status === 'saved').length, 23)
  assert.equal(outcomes.filter((o) => o.status === 'invalid').length, 2)
  const result = authorize(db, run)
  assert.equal(result.already, false)
  assert.equal(result.saved, 23)
  assert.equal(result.queued, 23)
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_run_leads WHERE run_id='${run}'`), '23')
  assert.equal(queueFor(db, run), '23')
  // the saved ids are the receipt's, and none of the 2 unsaved businesses has any trace
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_run_leads rl WHERE run_id='${run}' AND lead_id NOT IN (SELECT id FROM leads WHERE user_id='${A}')`), '0')
  assert.equal(sql(db, `SELECT count(*) FROM leads WHERE user_id='${A}'`), '23')
  // run jobs never use the broad flag
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE worker_eligible`), '0')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE run_id='${run}' AND status='pending' AND retry_count=0 AND max_retries=2`), '23')
})

test('authorizing the same run again (or at the same moment) creates no second record and no duplicate job', opts, async () => {
  const db = freshDb()
  const run = RUN(2)
  saveRun(db, { run, n: 10, invalid: 0 })
  const first = authorize(db, run)
  const second = authorize(db, run)
  assert.equal(second.already, true)
  assert.equal(second.queued, first.queued)
  assert.equal(queueFor(db, run), '10')
  const racing = RUN(3)
  saveRun(db, { run: racing, n: 6, invalid: 0, prefix: 'Racer' })
  const results = await Promise.allSettled([1, 2, 3].map(() => sqlAsync(db, `${asService}SELECT authorize_ci_research_run('${racing}','${A}',500)::text`)))
  assert.ok(results.every((r) => r.status === 'fulfilled'))
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_runs WHERE run_id='${racing}'`), '1')
  assert.equal(queueFor(db, racing), '6')
  assert.equal(results.filter((r) => JSON.parse(r.value).already === false).length, 1, 'exactly one call did the work')
})

test('only a confirmed save for that customer can be authorized; another customer\'s run is refused', opts, () => {
  const db = freshDb()
  const run = RUN(4)
  saveRun(db, { run, n: 5, invalid: 0 })
  assert.ok(!attempt(db, `${asService}SELECT authorize_ci_research_run('${RUN(99)}','${A}',500)`).ok, 'no receipt: refused')
  const stolen = attempt(db, `${asService}SELECT authorize_ci_research_run('${run}','${B}',500)`)
  assert.ok(!stolen.ok && /No confirmed save/.test(stolen.err), stolen.err)
  authorize(db, run)
  assert.ok(!attempt(db, `${asService}SELECT authorize_ci_research_run('${run}','${B}',500)`).ok, 'an authorized run cannot be taken over either')
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_runs WHERE user_id='${B}'`), '0')
})

test('a receipt that lists another customer\'s lead cannot pull that lead into the run; unsaved outcomes are ignored', opts, () => {
  const db = freshDb()
  const run = RUN(5)
  saveRun(db, { run, user: B, n: 3, invalid: 0, prefix: 'Bees' })
  const bLead = sql(db, `SELECT id FROM leads WHERE user_id='${B}' LIMIT 1`)
  // a forged/crafted receipt for A's run that names B's lead as saved and a duplicate outcome with an id
  const forged = RUN(6)
  sql(db, `INSERT INTO discover_save_receipts(run_id,user_id,request_hash,result) VALUES ('${forged}','${A}','x',
    jsonb_build_object('outcomes', jsonb_build_array(jsonb_build_object('index',0,'status','saved','id','${bLead}'),
      jsonb_build_object('index',1,'status','duplicate','id','${bLead}'))))`)
  const result = authorize(db, forged, A)
  assert.equal(result.saved, 0)
  assert.equal(result.queued, 0)
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE lead_id='${bLead}'`), '0')
})

test('leads without a website are recorded but never queued; an existing active job is never adopted', opts, () => {
  const db = freshDb()
  const run = RUN(7)
  saveRun(db, { run, n: 8, invalid: 0, noWebsite: 3 })
  const result = authorize(db, run)
  assert.deepEqual([result.saved, result.queued], [8, 5])
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_run_leads WHERE run_id='${run}' AND initial_state='unavailable_no_website'`), '3')
  assert.equal(progress(db, run), 'queued=5,unavailable=3')
  // a lead that already has an active (legacy) job keeps it untouched
  const run2 = RUN(8)
  saveRun(db, { run: run2, n: 2, invalid: 0, prefix: 'Legacy' })
  const lead = sql(db, `SELECT id FROM leads WHERE company_name LIKE 'Legacy%' ORDER BY company_name LIMIT 1`)
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${lead}','${A}')`)
  const before = fingerprint(db)
  const result2 = authorize(db, run2)
  assert.deepEqual([result2.saved, result2.queued], [2, 1])
  assert.equal(sql(db, `SELECT initial_state FROM ci_research_run_leads WHERE run_id='${run2}' AND lead_id='${lead}'`), 'skipped_existing')
  assert.equal(fingerprint(db), before, 'the existing job was not modified or adopted')
})

// ---------------------------------------------------------------------------------------------
// 4. Historical jobs and cross-account isolation
// ---------------------------------------------------------------------------------------------

test('historical and preview jobs stay untouched and unclaimable, whatever else is authorized', opts, () => {
  const db = freshDb()
  // legacy: customer-filed pending rows (the 146-style backlog) and owner-preview worker rows
  saveRun(db, { run: RUN(10), n: 4, invalid: 0, prefix: 'Old' })
  const legacyLeads = sql(db, `SELECT id FROM leads ORDER BY company_name`).split('\n')
  for (const id of legacyLeads.slice(0, 3)) sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${id}','${A}')`)
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) VALUES ('${legacyLeads[3]}','${A}',true)`)
  sql(db, `UPDATE commercial_intelligence_queue SET created_at = now() - interval '3 days'`)
  const before = fingerprint(db)
  assert.equal(before.split(':')[1], '4')

  const run = RUN(11)
  saveRun(db, { run, n: 6, invalid: 0, prefix: 'New' })
  authorize(db, run)
  const claimedIds = new Set()
  for (let round = 0; round < 6; round += 1) for (const job of claim(db, 20)) { claimedIds.add(job.lead); complete(db, job) }
  assert.equal(claimedIds.size, 6, 'only the new run was claimed')
  const legacyIds = new Set(sql(db, `SELECT lead_id FROM commercial_intelligence_queue WHERE run_id IS NULL`).split('\n'))
  for (const lead of claimedIds) assert.ok(!legacyIds.has(lead), 'a legacy lead was claimed')
  assert.equal(fingerprint(db), before, 'every historical row is byte-for-byte unchanged')
  // the old FIFO claim is gone for the service role, and the generic worker reset ignores run jobs
  assert.ok(!attempt(db, `${asService}SELECT * FROM claim_ci_queue_items_worker(20)`).ok)
  assert.equal(sql(db, `SELECT has_function_privilege('service_role','claim_ci_queue_items_worker(integer)','EXECUTE')`), 'f')
})

test('another customer\'s run cannot be processed through this run\'s authorization', opts, () => {
  const db = freshDb()
  const runA = RUN(12)
  const runB = RUN(13)
  saveRun(db, { run: runA, user: A, n: 4, invalid: 0, prefix: 'Aaa' })
  saveRun(db, { run: runB, user: B, n: 3, invalid: 0, prefix: 'Bbb' })
  authorize(db, runA, A)
  // a rogue queue row: B's lead filed under A's run (e.g. by a bug): it is not in the run's lead set and not claimable
  const bLead = sql(db, `SELECT id FROM leads WHERE user_id='${B}' LIMIT 1`)
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,run_id) VALUES ('${bLead}','${B}','${runA}')`)
  const jobs = claim(db, 20)
  assert.equal(jobs.length, 4)
  assert.ok(jobs.every((job) => job.user === A && job.run === runA))
  assert.ok(!jobs.some((job) => job.lead === bLead))
  // B's own run is not authorized, so nothing of B's is claimable
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE user_id='${B}' AND status='processing'`), '0')
  // wrong lead / wrong token cannot complete someone else's job
  assert.equal(svc(db, `SELECT success || ':' || message FROM complete_ci_run_item('${jobs[0].id}','${bLead}','${jobs[0].token}',${OK.snapshot},${OK.signals},${PROFILE},true,NULL,0)`), 'false:claim_lost')
  assert.equal(svc(db, `SELECT success || ':' || message FROM complete_ci_run_item('${jobs[0].id}','${jobs[0].lead}','ffffffff-ffff-ffff-ffff-ffffffffffff',${OK.snapshot},${OK.signals},${PROFILE},true,NULL,0)`), 'false:claim_lost')
  // customers see only their own run's progress
  authorize(db, runB, B)
  assert.equal(progress(db, runA, B), '')
  assert.equal(progress(db, runB, A), '')
  assert.match(progress(db, runA, A), /researching=4/)
})

test('customers and anon cannot run, change or read any of the research machinery', opts, () => {
  const db = freshDb()
  const run = RUN(14)
  saveRun(db, { run, n: 3, invalid: 0 })
  authorize(db, run)
  const calls = [
    `authorize_ci_research_run('${run}','${A}',500)`, 'claim_ci_run_items(5)', `recover_ci_run_items(600)`, `cancel_ci_research_run('${run}','${A}')`,
    `set_ci_research_enabled(true,'me')`, 'get_ci_research_status()',
    `complete_ci_run_item('${RUN(1)}','${RUN(1)}','${RUN(1)}',NULL,NULL,NULL,false,NULL,0)`,
  ]
  for (const call of calls) {
    for (const role of [asUser(A), asAnon]) assert.ok(!attempt(db, `${role}SELECT * FROM ${call}`).ok, `${call} must be refused`)
  }
  // writes and reads on the tables
  for (const statement of [
    `INSERT INTO ci_research_runs(run_id,user_id,saved_count,budget_limit_usd,customer_month_limit_usd,max_attempts,expires_at) VALUES ('${RUN(50)}','${A}',1,1,1,2,now())`,
    `UPDATE ci_research_runs SET status='cancelled'`, `DELETE FROM ci_research_runs`, `UPDATE ci_research_controls SET enabled = true`,
    `SELECT * FROM ci_research_controls`, `SELECT * FROM ci_research_charges`, `INSERT INTO ci_research_run_leads(run_id,lead_id,user_id,initial_state) VALUES ('${run}','${RUN(2)}','${A}','queued')`,
  ]) assert.ok(!attempt(db, `${asUser(A)}${statement}`).ok, statement)
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM ci_research_runs`), '1', 'a customer reads their own run')
  assert.equal(sql(db, `${asUser(B)} SELECT count(*) FROM ci_research_runs`), '0', 'and nobody else\'s')
})

// ---------------------------------------------------------------------------------------------
// 5-8. Switches, budgets, in-flight work
// ---------------------------------------------------------------------------------------------

test('research cannot start while the database switch is off or a budget is not configured (fail closed)', opts, () => {
  const db = freshDb()
  const run = RUN(20)
  saveRun(db, { run, n: 5, invalid: 0 })
  authorize(db, run)
  sql(db, `UPDATE ci_research_controls SET enabled = false`)
  assert.deepEqual(claim(db, 20), [])
  sql(db, `UPDATE ci_research_controls SET enabled = true, global_monthly_limit_usd = NULL`)
  assert.deepEqual(claim(db, 20), [], 'a missing global limit fails closed')
  sql(db, `UPDATE ci_research_controls SET global_monthly_limit_usd = 5, per_job_reserve_usd = NULL`)
  assert.deepEqual(claim(db, 20), [])
  sql(db, `UPDATE ci_research_controls SET per_job_reserve_usd = 0.002, per_lead_monthly_usd = NULL`)
  const fresh = RUN(21)
  saveRun(db, { run: fresh, n: 2, invalid: 0, prefix: 'Fresh' })
  const refused = attempt(db, `${asService}SELECT authorize_ci_research_run('${fresh}','${A}',500)`)
  assert.ok(!refused.ok && /budgets are not configured/.test(refused.err), refused.err)
  assert.equal(charges(db), '0|0|0', 'nothing was reserved')
})

test('the operator kill switch stops new claims at once; in-flight work finishes; nothing is deleted', opts, () => {
  const db = freshDb()
  const run = RUN(22)
  saveRun(db, { run, n: 8, invalid: 0 })
  authorize(db, run)
  const inFlight = claim(db, 3)
  assert.equal(inFlight.length, 3)
  assert.equal(JSON.parse(svc(db, `SELECT set_ci_research_enabled(false,'ops@example.com')::text`)).enabled, false)
  assert.deepEqual(claim(db, 20), [], 'no new claim after the switch is off')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE run_id='${run}'`), '8', 'no job deleted')
  for (const job of inFlight) assert.equal(complete(db, job), 'true:enrichment_completed')
  assert.equal(progress(db, run), 'queued=5,ready=3')
  assert.equal(sql(db, `SELECT count(*) FROM leads WHERE commercial_profile IS NOT NULL`), '3', 'completed profiles are preserved')
  // switching back on resumes exactly where it left off
  svc(db, `SELECT set_ci_research_enabled(true,'ops@example.com')`)
  assert.equal(claim(db, 20).length, 4, 'resumes, within the per-customer concurrency of 4')
  assert.equal(sql(db, `SELECT string_agg(action || ':' || operator, ',' ORDER BY id) FROM ci_research_control_log`), 'disable:ops@example.com,enable:ops@example.com')
  assert.ok(!attempt(db, `${asService}SELECT set_ci_research_enabled(true,'  ')`).ok, 'an operator name is required')
  assert.equal(JSON.parse(svc(db, `SELECT get_ci_research_status()::text`)).processing_jobs, 4)
})

test('budgets: the run, the profile, the customer and the whole system each stop excess processing', opts, () => {
  // per run
  let db = freshDb()
  let run = RUN(23)
  saveRun(db, { run, n: 5, invalid: 0 })
  sql(db, `UPDATE ci_research_controls SET per_run_cap_usd = 0.005`)
  authorize(db, run)
  assert.equal(claim(db, 20).length, 2, 'the run budget (0.005) fits two reservations of 0.002')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE last_error='run_budget_exhausted'`), '3', 'the rest of the run is closed as budget-exhausted, visibly')
  assert.equal(progress(db, run), 'failed=3,researching=2')

  // per profile: bounded retries
  db = freshDb()
  run = RUN(24)
  saveRun(db, { run, n: 1, invalid: 0 })
  sql(db, `UPDATE ci_research_controls SET max_attempts = 3, per_profile_ceiling_usd = 0.005`)
  authorize(db, run)
  for (const attemptNumber of [1, 2]) {
    sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`)
    const [job] = claim(db, 5)
    assert.equal(complete(db, job, { success: false, error: `'site down'`, cost: 0.002 }), 'true:retry_pending', `attempt ${attemptNumber}`)
  }
  sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`)
  assert.deepEqual(claim(db, 5), [], 'a third attempt would exceed the profile ceiling')
  assert.equal(sql(db, `SELECT status || '|' || last_error FROM commercial_intelligence_queue`), 'failed|profile_budget_exhausted')

  // per customer per month: waits instead of failing
  db = freshDb()
  run = RUN(25)
  saveRun(db, { run, n: 4, invalid: 0 })
  sql(db, `UPDATE ci_research_controls SET per_lead_monthly_usd = 0.001`)
  authorize(db, run, A, 2) // plan limit 2 x 0.001 = 0.002
  assert.equal(claim(db, 20).length, 1)
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE status='pending'`), '3', 'the rest wait; they are not failed')

  // global
  db = freshDb()
  saveRun(db, { run: RUN(26), user: A, n: 3, invalid: 0, prefix: 'Ga' })
  saveRun(db, { run: RUN(27), user: B, n: 3, invalid: 0, prefix: 'Gb' })
  sql(db, `UPDATE ci_research_controls SET global_monthly_limit_usd = 0.004`)
  authorize(db, RUN(26), A)
  authorize(db, RUN(27), B)
  assert.equal(claim(db, 20).length, 2, 'the global limit stops everyone')
  assert.equal(claim(db, 20).length, 0)
})

test('reservations are never duplicated; completion settles the actual cost; reconciliation is explicit', opts, () => {
  const db = freshDb()
  const run = RUN(28)
  saveRun(db, { run, n: 3, invalid: 0 })
  authorize(db, run)
  const jobs = claim(db, 3)
  assert.equal(charges(db), '3|0.006000|0')
  assert.ok(!attempt(db, `INSERT INTO ci_research_charges(queue_id,attempt,run_id,user_id,reserved_usd) VALUES ('${jobs[0].id}',0,'${run}','${A}',0.002)`).ok, 'one reservation per job and attempt')
  assert.equal(complete(db, jobs[0], { cost: 0.0007 }), 'true:enrichment_completed')
  assert.equal(complete(db, jobs[0], { cost: 0.0007 }), 'false:claim_lost', 'a duplicate completion settles nothing twice')
  assert.equal(sql(db, `SELECT state || ':' || actual_usd FROM ci_research_charges WHERE queue_id='${jobs[0].id}'`), 'settled:0.000700')
  // an absurd reported cost is capped at ten times the reservation
  assert.equal(complete(db, jobs[1], { cost: 999 }), 'true:enrichment_completed')
  assert.equal(sql(db, `SELECT actual_usd FROM ci_research_charges WHERE queue_id='${jobs[1].id}'`), '0.020000')
})

test('timeouts and stale claims: an interrupted attempt is billed at its reservation, retried, then failed; a late completion changes nothing', opts, () => {
  const db = freshDb()
  const run = RUN(29)
  saveRun(db, { run, n: 2, invalid: 0 })
  authorize(db, run)
  const [first] = claim(db, 1)
  sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '2 hours' WHERE id='${first.id}'`)
  assert.equal(svc(db, `SELECT reset_count || ',' || failed_count || ',' || settled_count FROM recover_ci_run_items(600)`), '1,0,1')
  assert.equal(sql(db, `SELECT status || '|' || retry_count FROM commercial_intelligence_queue WHERE id='${first.id}'`), 'pending|1')
  assert.equal(sql(db, `SELECT state || ':' || actual_usd FROM ci_research_charges WHERE queue_id='${first.id}' AND attempt=0`), 'settled:0.002000')
  assert.equal(complete(db, first), 'false:claim_lost', 'the zombie of attempt 0 cannot complete')
  assert.equal(sql(db, `SELECT count(*) FROM leads WHERE commercial_profile IS NOT NULL`), '0')
  // second interruption exhausts the attempts
  sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`)
  const again = claim(db, 5).find((job) => job.id === first.id)
  assert.equal(again.retry, 1)
  sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '2 hours' WHERE id='${first.id}'`)
  assert.equal(svc(db, `SELECT reset_count || ',' || failed_count FROM recover_ci_run_items(600)`), '0,1')
  assert.equal(progress(db, run), 'failed=1,researching=1')
  // recovery works even when the switch is off (nothing new is started)
  svc(db, `SELECT set_ci_research_enabled(false,'ops')`)
  assert.equal(svc(db, `SELECT reset_count FROM recover_ci_run_items(600)`), '0')
})

test('one failing profile never blocks the others, and a success without a usable profile is a failure', opts, () => {
  const db = freshDb()
  const run = RUN(30)
  saveRun(db, { run, n: 4, invalid: 0 })
  authorize(db, run)
  const jobs = claim(db, 4)
  assert.equal(complete(db, jobs[0], { success: false, error: `'blocked by robots'` }), 'true:retry_pending')
  assert.equal(complete(db, jobs[1], { profile: `'{"summary":""}'::jsonb` }), 'true:retry_pending', 'an empty summary is not a profile')
  assert.equal(complete(db, jobs[2]), 'true:enrichment_completed')
  assert.equal(complete(db, jobs[3]), 'true:enrichment_completed')
  assert.equal(progress(db, run), 'ready=2,retry_pending=2')
  for (const round of [1]) {
    sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`)
    for (const job of claim(db, 5)) assert.equal(complete(db, job, { success: false, error: `'still down'` }), 'true:enrichment_failed', `retry ${round}`)
  }
  assert.equal(progress(db, run), 'failed=2,ready=2', 'the failures are visible and the ready profiles remain')
})

// ---------------------------------------------------------------------------------------------
// Fairness, concurrency, expiry, cancellation
// ---------------------------------------------------------------------------------------------

test('processing is fair across customers and concurrency per customer is capped', opts, () => {
  const db = freshDb()
  saveRun(db, { run: RUN(31), user: A, n: 12, invalid: 0, prefix: 'Big' })
  saveRun(db, { run: RUN(32), user: B, n: 2, invalid: 0, prefix: 'Small' })
  authorize(db, RUN(31), A)
  authorize(db, RUN(32), B)
  const jobs = claim(db, 4)
  assert.equal(jobs.filter((job) => job.user === B).length, 2, 'the small customer is served in the first round')
  assert.equal(jobs.filter((job) => job.user === A).length, 2)
  sql(db, `UPDATE ci_research_controls SET per_user_concurrency = 2`)
  assert.equal(claim(db, 10).filter((job) => job.user === A).length, 0, 'A already has two running: capped')
  for (const job of jobs.filter((entry) => entry.user === A)) complete(db, job)
  assert.equal(claim(db, 10).length, 2, 'two slots free up for A')
})

test('concurrent claimers never receive the same job or reserve twice', opts, async () => {
  const db = freshDb()
  saveRun(db, { run: RUN(33), n: 10, invalid: 0 })
  authorize(db, RUN(33))
  const results = await Promise.all([1, 2, 3, 4].map(() => sqlAsync(db, `${asService}SELECT id FROM claim_ci_run_items(10)`)))
  const ids = results.flatMap((text) => text.split('\n').filter(Boolean))
  assert.equal(new Set(ids).size, ids.length, 'no job claimed twice')
  assert.equal(ids.length, 4, 'bounded by the per-customer concurrency (4)')
  assert.equal(charges(db).split('|')[0], String(ids.length))
})

test('an expired run, and a cancelled run, are no longer claimed; cancelling closes only what has not started', opts, () => {
  const db = freshDb()
  const expired = RUN(34)
  const cancelled = RUN(35)
  saveRun(db, { run: expired, n: 3, invalid: 0, prefix: 'Exp' })
  saveRun(db, { run: cancelled, n: 5, invalid: 0, prefix: 'Can' })
  authorize(db, expired)
  authorize(db, cancelled)
  sql(db, `UPDATE ci_research_runs SET expires_at = now() - interval '1 minute' WHERE run_id='${expired}'`)
  const started = claim(db, 2)
  assert.ok(started.every((job) => job.run === cancelled))
  assert.ok(!attempt(db, `${asService}SELECT cancel_ci_research_run('${cancelled}','${B}')`).ok, 'another customer cannot cancel it')
  assert.equal(JSON.parse(svc(db, `SELECT cancel_ci_research_run('${cancelled}','${A}')::text`)).closed, 3)
  assert.equal(JSON.parse(svc(db, `SELECT cancel_ci_research_run('${cancelled}','${A}')::text`)).closed, 0, 'idempotent')
  assert.deepEqual(claim(db, 20), [])
  assert.equal(progress(db, cancelled), 'cancelled=3,researching=2')
  // a running job finishes and keeps its profile
  assert.equal(complete(db, started[0]), 'true:enrichment_completed')
  assert.equal(progress(db, cancelled), 'cancelled=3,ready=1,researching=1')
})

// ---------------------------------------------------------------------------------------------
// 11-14. Progress and accounting
// ---------------------------------------------------------------------------------------------

test('progress is derived from the database alone, survives a fresh session, and matches the real states', opts, () => {
  const db = freshDb()
  const run = RUN(36)
  saveRun(db, { run, n: 9, invalid: 0, noWebsite: 1 })
  authorize(db, run)
  const jobs = claim(db, 4)
  complete(db, jobs[0])
  complete(db, jobs[1], { success: false, error: `'x'` }) // retry_pending
  // jobs[2], jobs[3] stay researching
  const expected = 'queued=4,ready=1,researching=2,retry_pending=1,unavailable=1'
  assert.equal(progress(db, run), expected)
  assert.equal(progress(db, run), expected, 'a new connection (a refresh, a returning customer) sees the same state')
  // the counts equal the underlying rows
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE run_id='${run}' AND status='processing'`), '2')
  assert.equal(sql(db, `SELECT count(*) FROM leads l JOIN ci_research_run_leads rl ON rl.lead_id=l.id WHERE rl.run_id='${run}' AND l.commercial_profile->>'summary' IS NOT NULL`), '1')
  // every lead of the run appears exactly once and the profile is readable by its owner
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM get_ci_run_progress('${run}')`), '9')
  assert.equal(sql(db, `${asUser(A)} SELECT commercial_profile->>'summary' FROM leads WHERE id='${jobs[0].lead}'`), 'A factual profile of the business.')
})

test('research never consumes lead allowance: usage is identical after authorization, claims, retries, failures, recovery and cancellation', opts, () => {
  const db = freshDb()
  const run = RUN(37)
  saveRun(db, { run, n: 25, invalid: 2 })
  const afterSave = usage(db)
  assert.match(afterSave, /=23\/500/, 'the atomic save charged the 23 saved leads once')
  authorize(db, run)
  for (const job of claim(db, 4)) complete(db, job, { success: false, error: `'x'` })
  sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`)
  const stale = claim(db, 4)
  sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '2 hours' WHERE status='processing'`)
  svc(db, `SELECT * FROM recover_ci_run_items(600)`)
  for (const job of claim(db, 4)) complete(db, job)
  svc(db, `SELECT cancel_ci_research_run('${run}','${A}')`)
  assert.ok(stale.length > 0)
  assert.equal(usage(db), afterSave)
  assert.equal(sql(db, `SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname ~ 'ci_research|ci_run|authorize_ci') AND prosrc ~* '\\musage\\M|leads_used|save_discover_results'`), '0')
})

// ---------------------------------------------------------------------------------------------
// Owner-only access, the per-run lead cap, audited configuration
// ---------------------------------------------------------------------------------------------

test('research can be restricted to one customer: authorization and claiming both enforce the list (default: nobody)', opts, () => {
  const db = freshDb()
  sql(db, `UPDATE ci_research_controls SET allow_all_customers = false`) // the real default
  saveRun(db, { run: RUN(60), user: A, n: 4, invalid: 0, prefix: 'Own' })
  saveRun(db, { run: RUN(61), user: B, n: 4, invalid: 0, prefix: 'Oth' })
  assert.match(attempt(db, `${asService}SELECT authorize_ci_research_run('${RUN(60)}','${A}',500)`).err, /not enabled for this customer/, 'an empty list authorizes nobody')
  svc(db, `SELECT set_ci_research_access(false, ARRAY['${A}']::uuid[], 'owner-test')`)
  assert.equal(authorize(db, RUN(60), A).queued, 4, 'the owner is authorized')
  const refused = attempt(db, `${asService}SELECT authorize_ci_research_run('${RUN(61)}','${B}',500)`)
  assert.ok(!refused.ok && /not enabled for this customer/.test(refused.err), refused.err)
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_runs WHERE user_id='${B}'`), '0')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE user_id='${B}' AND run_id IS NOT NULL`), '0')
  assert.equal(claim(db, 20).length, 4)
  // removing the owner from the list stops claims for an already-authorized run (defense in depth)
  svc(db, `SELECT set_ci_research_access(false, ARRAY[]::uuid[], 'owner-test')`)
  assert.deepEqual(claim(db, 20), [])
  assert.equal(sql(db, `SELECT string_agg(action, ',' ORDER BY id) FROM ci_research_control_log`), 'set_access,set_access')
  // customers cannot change access or limits
  for (const call of [`set_ci_research_access(true, ARRAY[]::uuid[], 'me')`, `set_ci_research_limits(1,1,1,1,1,1,1,1,1,'me')`]) {
    assert.ok(!attempt(db, `${asUser(A)}SELECT * FROM ${call}`).ok, call)
  }
})

test('a run authorizes at most max_leads_per_run businesses, in the receipt\'s order; the rest are recorded and never queued', opts, () => {
  const db = freshDb()
  const run = RUN(62)
  sql(db, `UPDATE ci_research_controls SET max_leads_per_run = 10, per_run_cap_usd = 0.05`)
  saveRun(db, { run, n: 25, invalid: 2 })
  const result = authorize(db, run)
  assert.deepEqual([result.saved, result.queued], [23, 10])
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_run_leads WHERE run_id='${run}' AND initial_state='skipped_limit'`), '13')
  assert.equal(queueFor(db, run), '10')
  // the first ten saved businesses, in order
  assert.equal(sql(db, `SELECT string_agg(regexp_replace(l.company_name, '^.* ', ''), ',' ORDER BY (regexp_replace(l.company_name, '^.* ', ''))::int) FROM commercial_intelligence_queue q JOIN leads l ON l.id=q.lead_id WHERE q.run_id='${run}'`), '1,2,3,4,5,6,7,8,9,10')
  assert.equal(progress(db, run), 'queued=10,unavailable=13')
  assert.equal(sql(db, `SELECT budget_limit_usd FROM ci_research_runs WHERE run_id='${run}'`), '0.050000', 'the run budget is min(cap, jobs x ceiling) = min(0.05, 0.06)')
  assert.equal(usage(db).match(/=(\d+)\//)[1], '23', 'all 23 saved leads were charged by the save, none by research')
})

test('limits are configured in one audited call that requires every value', opts, () => {
  const db = freshDb()
  sql(db, `UPDATE ci_research_controls SET per_run_cap_usd = NULL`)
  const refused = attempt(db, `${asService}SELECT set_ci_research_limits(0.002,0.006,NULL,0.001,0.25,10,2,2,24,'owner')`)
  assert.ok(!refused.ok && /Every limit must be given/.test(refused.err))
  svc(db, `SELECT set_ci_research_limits(0.002,0.006,0.05,0.001,0.25,10,2,2,24,'owner-test')`)
  const status = JSON.parse(svc(db, `SELECT get_ci_research_status()::text`))
  assert.equal(status.budgets_configured, true)
  assert.deepEqual([status.limits.max_leads_per_run, status.limits.per_run_cap_usd, status.limits.global_monthly_limit_usd, status.limits.per_user_concurrency], [10, 0.05, 0.25, 2])
  assert.equal(sql(db, `SELECT action || ':' || (detail->>'max_leads_per_run') FROM ci_research_control_log`), 'set_limits:10')
  assert.ok(!attempt(db, `${asService}SELECT set_ci_research_limits(0,0.006,0.05,0.001,0.25,10,2,2,24,'x')`).ok, 'a zero reservation violates the table check')
})

// ---------------------------------------------------------------------------------------------
// Undo without destroying: disable keeps every record; teardown refuses once anything exists
// ---------------------------------------------------------------------------------------------

test('the migration is idempotent; disabling after live use stops everything and keeps every record', opts, () => {
  const db = freshDb()
  const run = RUN(40)
  saveRun(db, { run, n: 6, invalid: 0 })
  sql(db, fs.readFileSync(FILES.phase1, 'utf8'), ['-1']) // re-applying changes nothing
  authorize(db, run)
  const jobs = claim(db, 2)
  complete(db, jobs[0])
  const snapshot = () => sql(db, `SELECT (SELECT count(*) FROM ci_research_runs) || '|' || (SELECT count(*) FROM ci_research_run_leads) || '|' || (SELECT count(*) FROM ci_research_charges) || '|' || (SELECT coalesce(sum(coalesce(actual_usd,reserved_usd)),0) FROM ci_research_charges) || '|' || (SELECT md5(string_agg(q::text,'|' ORDER BY q.id)) FROM commercial_intelligence_queue q) || '|' || (SELECT md5(string_agg(l::text,'|' ORDER BY l.id)) FROM leads l)`)
  const before = snapshot()
  sql(db, fs.readFileSync(FILES.disable, 'utf8'), ['-1'])
  sql(db, fs.readFileSync(FILES.disable, 'utf8'), ['-1']) // idempotent
  assert.equal(snapshot(), before, 'authorizations, lead sets, spending, queue rows and profiles are untouched')
  assert.equal(sql(db, `SELECT enabled || '|' || allow_all_customers || '|' || cardinality(allowed_user_ids) FROM ci_research_controls`), 'false|false|0')
  assert.deepEqual(claim(db, 20), [], 'nothing can be claimed')
  assert.equal(complete(db, jobs[1]), 'true:enrichment_completed', 'a job that was already running still resolves')
  assert.match(progress(db, run), /ready=2/)
  assert.equal(sql(db, `SELECT count(*) FROM ci_research_control_log WHERE action='disable_all'`), '2')
})

test('teardown removes only an unused install: it refuses while any record exists, and never restores the old FIFO claim', opts, () => {
  const used = freshDb()
  saveRun(used, { run: RUN(41), n: 3, invalid: 0 })
  authorize(used, RUN(41))
  const refused = attempt(used, fs.readFileSync(FILES.teardown, 'utf8'))
  assert.ok(!refused.ok && /Teardown refused/.test(refused.err), refused.err)
  assert.equal(sql(used, `SELECT count(*) FROM ci_research_runs`), '1', 'nothing was dropped')

  const pristine = freshDb()
  sql(pristine, fs.readFileSync(FILES.teardown, 'utf8'), ['-1'])
  assert.equal(sql(pristine, `SELECT to_regclass('public.ci_research_runs') IS NULL AND to_regclass('public.ci_research_controls') IS NULL`), 't')
  assert.equal(sql(pristine, `SELECT count(*) FROM pg_proc WHERE proname IN ('claim_ci_run_items','authorize_ci_research_run','complete_ci_run_item','set_ci_research_access')`), '0')
  assert.equal(sql(pristine, `SELECT has_function_privilege('service_role','claim_ci_queue_items_worker(integer)','EXECUTE')`), 'f', 'the broad claim stays revoked')
})
