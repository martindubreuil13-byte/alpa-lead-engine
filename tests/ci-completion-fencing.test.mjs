// B1.2a — proposed migration supabase/proposed/20261013_ci_completion_integrity.sql.
//
// Static tests always run. The behavioural tests need a DISPOSABLE local Postgres 17 and run only when
// ALPA_TEST_DB_URL points at one (see tests/ci-queue-integrity.test.mjs for how to start one). The runner
// builds its own throwaway databases from the production-faithful fixture plus the B1.1 migration (live in
// production) plus the proposal, and refuses any host that is not loopback or that looks like Supabase.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const B11 = path.join(ROOT, 'supabase/applied-records/20261012_ci_queue_integrity.sql')
const PROPOSAL = path.join(ROOT, 'supabase/proposed/20261013_ci_completion_integrity.sql')
const ROLLBACK = path.join(ROOT, 'supabase/proposed/20261013_ci_completion_integrity_rollback.sql')
const BASELINE = path.join(ROOT, 'tests/sql/ci-queue-baseline.sql')
const read = (file) => fs.readFileSync(file, 'utf8')

const topLevelSql = (text) => text.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")

// ---------------------------------------------------------------------------------------------
// Static tests
// ---------------------------------------------------------------------------------------------

test('the proposal is clearly unapplied, changes no data and only touches the completion functions and one guard trigger', () => {
  const text = read(PROPOSAL)
  assert.match(text, /STATUS: PROPOSED\. NOT APPLIED\./)
  const top = topLevelSql(text)
  for (const forbidden of [/\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bDROP\s+TABLE\b/i, /\bALTER\s+TABLE\b/i, /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w[\w.]*\s+SET\b/i, /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i, /\bCREATE\s+POLICY\b/i, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!forbidden.test(top), `top-level statement matches ${forbidden}`)
  }
  const functions = [...text.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g)].map((match) => match[1]).sort()
  assert.deepEqual(functions, ['complete_ci_enrichment', 'complete_ci_enrichment_worker', 'guard_ci_queue_attempt_monotonic'])
  assert.deepEqual([...text.matchAll(/CREATE TRIGGER (\w+)/g)].map((match) => match[1]), ['trg_guard_ci_queue_attempt_monotonic'])
  assert.match(text, /REVOKE EXECUTE ON FUNCTION public\.guard_ci_queue_attempt_monotonic\(\) FROM PUBLIC, anon, authenticated/)
  assert.match(text, /'attempt_required'/)
  assert.ok(!/p_expected_retry_count IS NULL OR/.test(text), 'the attempt number is not optional')
  assert.ok(!/claim_ci_queue_items|reset_stale_ci_processing|enqueue_private_preview/.test(top), 'claim, reset and enqueue functions are untouched')
  assert.ok(!/GRANT[^;]*\bTO\s+PUBLIC\b/i.test(top))
  assert.match(text, /REVOKE EXECUTE ON FUNCTION public\.complete_ci_enrichment\(uuid, uuid, jsonb, jsonb, jsonb, boolean, text, integer\) FROM PUBLIC, anon/)
  assert.match(read(ROLLBACK), /PROPOSED\. NOT APPLIED\./)
  const proposed = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((name) => /20261013/.test(name))
  assert.deepEqual(proposed, [], 'must not sit in the applied migrations directory')
})

test('the worker completion keeps its claim-token fence and service-role check', () => {
  const text = read(PROPOSAL)
  const worker = text.slice(text.indexOf('complete_ci_enrichment_worker'))
  assert.match(worker, /IF auth\.role\(\) <> 'service_role' THEN/)
  assert.match(worker, /AND q\.claim_token = p_claim_token/)
})

// ---------------------------------------------------------------------------------------------
// Behavioural tests (disposable local Postgres only)
// ---------------------------------------------------------------------------------------------

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
const LEAD_A1 = '11111111-0000-0000-0000-0000000000a1'
const LEAD_B1 = '22222222-0000-0000-0000-0000000000b1'

const asUser = (id) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false), set_config('request.jwt.claim.role','authenticated',false) \\g /dev/null\n`
const asService = `SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false) \\g /dev/null\n`
const asAnon = `SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false) \\g /dev/null\n`

const PROFILE = `'{"summary":"A factual profile of the business.","industry":"x"}'::jsonb`
const OLD_PROFILE = `'{"summary":"The earlier, good profile.","industry":"old"}'::jsonb`
const SEED = `
INSERT INTO auth.users(id) VALUES ('${A}'), ('${B}');
INSERT INTO leads(id, user_id, company_name, ci_enrichment_status, commercial_profile) VALUES
  ('${LEAD_A1}', '${A}', 'A1', 'pending', ${OLD_PROFILE}),
  ('${LEAD_B1}', '${B}', 'B1', 'pending', NULL);
`

const created = []
let ready = false
function ensureTemplates() {
  if (ready) return
  for (const [name, steps] of [['b12t_old', [BASELINE, B11]], ['b12t_new', [BASELINE, B11, PROPOSAL]]]) {
    sql('postgres', `DROP DATABASE IF EXISTS ${name}`)
    sql('postgres', `CREATE DATABASE ${name}`)
    for (const file of steps) sql(name, read(file), file === BASELINE ? [] : ['-1'])
  }
  ready = true
}
let counter = 0
function freshDb(proposal = true) {
  ensureTemplates()
  const name = `b12_${process.pid}_${++counter}`
  sql('postgres', `CREATE DATABASE ${name} TEMPLATE ${proposal ? 'b12t_new' : 'b12t_old'}`)
  created.push(name)
  sql(name, SEED)
  return name
}
after(() => {
  if (!dbReady) return
  for (const name of [...created, 'b12t_old', 'b12t_new']) {
    try { sql('postgres', `DROP DATABASE IF EXISTS ${name}`) } catch {}
  }
})

const leadState = (db, lead = LEAD_A1) => sql(db, `SELECT ci_enrichment_status || '|' || coalesce(commercial_profile->>'summary','NULL') FROM leads WHERE id='${lead}'`)
const queueState = (db) => sql(db, `SELECT status || '|' || retry_count || '|' || coalesce(claim_token::text,'-') FROM commercial_intelligence_queue`)
/** Files a request and claims it as the customer; returns the queue id. */
function claimAsCustomer(db, lead = LEAD_A1, user = A) {
  sql(db, `${asUser(user)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${lead}','${user}')`)
  assert.equal(sql(db, `${asUser(user)} SELECT count(*) FROM claim_ci_queue_items(5)`), '1')
  return sql(db, `SELECT id FROM commercial_intelligence_queue WHERE lead_id='${lead}' ORDER BY created_at DESC LIMIT 1`)
}
/**
 * Completes as the customer. `expected` is the attempt number the run was given by its claim:
 *   undefined -> the row's current retry_count (a run that holds the current attempt)
 *   ', N'     -> exactly N (e.g. a stale run)
 *   null      -> the 7-argument form (a caller that does not know about attempt numbers)
 */
const complete = (id, success, profile, snapshot = `'{"s":1}'::jsonb`, signals = `'{"g":1}'::jsonb`, error = 'NULL', expected = undefined, lead = LEAD_A1, user = A) => {
  const attemptArgument = expected === null ? '' : expected === undefined ? `, (SELECT retry_count FROM commercial_intelligence_queue WHERE id='${id}')` : expected
  return `${asUser(user)} SELECT success || ':' || message FROM complete_ci_enrichment('${id}','${lead}',${snapshot},${signals},${profile},${success},${error}${attemptArgument})`
}

test('customer path: a usable profile completes the job and the lead together', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  assert.equal(sql(db, complete(id, true, PROFILE)), 'true:enrichment_completed')
  assert.equal(queueState(db), 'completed|0|-')
  assert.equal(leadState(db), 'completed|A factual profile of the business.')
})

test('customer path: a "success" without a usable profile is a failure and never overwrites the stored profile', opts, () => {
  for (const [profile, snapshot] of [['NULL', `'{"s":1}'::jsonb`], [`'{"summary":"   "}'::jsonb`, `'{"s":1}'::jsonb`], [`'{"industry":"x"}'::jsonb`, `'{"s":1}'::jsonb`], [`'[]'::jsonb`, `'{"s":1}'::jsonb`]]) {
    const db = freshDb()
    const id = claimAsCustomer(db)
    assert.equal(sql(db, complete(id, true, profile, snapshot)), 'true:retry_pending', `profile ${profile}`)
    assert.equal(queueState(db), 'pending|1|-')
    assert.equal(leadState(db), 'pending|The earlier, good profile.', 'the earlier profile is still there')
    assert.match(sql(db, `SELECT last_error FROM commercial_intelligence_queue`), /usable business profile/)
  }
})

test('customer path: after the last retry a profile-less success ends as failed, never completed', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  sql(db, `UPDATE commercial_intelligence_queue SET retry_count = 2`)
  assert.equal(sql(db, complete(id, true, 'NULL')), 'true:enrichment_failed')
  assert.equal(queueState(db), 'failed|3|-')
  assert.equal(leadState(db), 'failed|The earlier, good profile.')
})

test('customer path: "nothing to research" (all data NULL) completes the job and marks the lead skipped', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  assert.equal(sql(db, complete(id, true, 'NULL', 'NULL', 'NULL')), 'true:enrichment_completed')
  assert.equal(queueState(db), 'completed|0|-')
  assert.equal(leadState(db), 'skipped|The earlier, good profile.')
})

test('customer path: failures keep working as before (retry, then fail) and keep the stored profile', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  assert.equal(sql(db, complete(id, false, 'NULL', 'NULL', 'NULL', `'site down'`)), 'true:retry_pending')
  assert.equal(leadState(db), 'pending|The earlier, good profile.')
  sql(db, `UPDATE commercial_intelligence_queue SET status='processing', retry_count=2, started_at=now()`)
  assert.equal(sql(db, complete(id, false, 'NULL', 'NULL', 'NULL', `'site down'`)), 'true:enrichment_failed')
  assert.equal(leadState(db), 'failed|The earlier, good profile.')
})

test('fencing: a stalled run cannot complete a job that was reset and re-claimed', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db) // run 1 claims at retry_count 0
  sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '1 hour'`)
  assert.equal(sql(db, `${asUser(A)} SELECT reset_count FROM reset_stale_ci_processing(300)`), '1') // run 1 stalled; stale recovery
  assert.equal(queueState(db), 'pending|1|-')
  sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = now() - interval '5 minutes'`)
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(5)`), '1') // run 2 claims at retry_count 1

  // run 1 wakes up and tries to finish with the attempt number it was given
  assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', ', 0')), 'false:claim_lost')
  assert.equal(queueState(db), 'processing|1|-', 'nothing changed')
  assert.equal(leadState(db), 'pending|The earlier, good profile.')

  // run 2 finishes with its own attempt number
  assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', ', 1')), 'true:enrichment_completed')
  assert.equal(leadState(db), 'completed|A factual profile of the business.')

  // a duplicate completion (either attempt number) is harmless
  assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', ', 1')), 'false:claim_lost')
  assert.equal(sql(db, complete(id, false, 'NULL', 'NULL', 'NULL', `'late failure'`, ', 0')), 'false:claim_lost')
  assert.equal(leadState(db), 'completed|A factual profile of the business.')
})

test('fencing is mandatory: a completion that does not name its attempt is refused and changes nothing', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  const before = `${queueState(db)}#${leadState(db)}`
  for (const omitted of [null, ', NULL']) {
    assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', omitted)), 'false:attempt_required')
    assert.equal(sql(db, complete(id, false, 'NULL', 'NULL', 'NULL', `'x'`, omitted)), 'false:attempt_required')
  }
  assert.equal(`${queueState(db)}#${leadState(db)}`, before, 'nothing was read or written')
  assert.equal(sql(db, `SELECT count(*) FROM pg_proc WHERE proname='complete_ci_enrichment' AND pronamespace='public'::regnamespace`), '1', 'one signature: named-argument callers are not ambiguous')
  assert.equal(sql(db, complete(id, true, PROFILE)), 'true:enrichment_completed', 'the correct attempt still completes it')
})

test('fencing: a wrong attempt number in either direction, a negative one and a worker-claimed job are all refused', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db) // attempt 0
  for (const wrong of [', 1', ', 2', ', -1', ', 999']) {
    assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', wrong)), 'false:claim_lost', wrong)
  }
  assert.equal(queueState(db), 'processing|0|-')
  // a job a worker holds is never completable through the customer path, whatever number is sent
  sql(db, `UPDATE commercial_intelligence_queue SET claim_token = gen_random_uuid(), worker_eligible = true`)
  assert.equal(sql(db, complete(id, true, PROFILE)), 'false:claim_lost')
})

test('fencing cannot be used across customers or on someone else\'s job', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', ', 0', LEAD_B1, B)), 'false:claim_lost')
  assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', ', 0', LEAD_A1, B)), 'false:claim_lost')
  assert.equal(queueState(db), 'processing|0|-')
})

test('privileges: the new customer function is not executable by PUBLIC or anon; owner and search_path are unchanged', opts, () => {
  const db = freshDb()
  const fn = 'public.complete_ci_enrichment(uuid,uuid,jsonb,jsonb,jsonb,boolean,text,integer)'
  const acl = sql(db, `SELECT coalesce(proacl::text,'') FROM pg_proc WHERE oid='${fn}'::regprocedure`)
  assert.doesNotMatch(acl, /(^|[{,])=X|anon=/)
  assert.match(acl, /authenticated=X/)
  assert.equal(sql(db, `SELECT pg_get_userbyid(proowner) || '|' || prosecdef || '|' || proconfig::text FROM pg_proc WHERE oid='${fn}'::regprocedure`), 'postgres|true|{"search_path=public, pg_temp"}')
  assert.ok(!attempt(db, `${asAnon} SELECT * FROM complete_ci_enrichment('${LEAD_A1}','${LEAD_A1}',NULL,NULL,NULL,true,NULL)`).ok, 'anon is refused')
  assert.equal(sql(db, `SELECT count(*) FROM pg_proc WHERE proname='complete_ci_enrichment_worker' AND proacl::text ~ '(^|[{,])=X|anon=|authenticated='`), '0', 'worker function stays service_role only')
})

// ---- worker path ----------------------------------------------------------------------------

function workerClaim(db) {
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) VALUES ('${LEAD_A1}','${A}',true)`)
  return sql(db, `${asService} SELECT id || '|' || claim_token FROM claim_ci_queue_items_worker(1)`).split('|')
}
const workerComplete = (id, token, success, profile, snapshot = `'{"s":1}'::jsonb`, signals = `'{"g":1}'::jsonb`, error = 'NULL') =>
  `${asService} SELECT success || ':' || message FROM complete_ci_enrichment_worker('${id}','${LEAD_A1}','${token}',${snapshot},${signals},${profile},${success},${error})`

test('worker path: a usable profile completes; a profile-less success retries and keeps the stored profile', opts, () => {
  const db = freshDb()
  let [id, token] = workerClaim(db)
  assert.equal(sql(db, workerComplete(id, token, true, 'NULL')), 'true:retry_pending')
  assert.equal(leadState(db), 'pending|The earlier, good profile.')
  assert.equal(queueState(db), 'pending|1|-')

  sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = now() - interval '5 minutes'`);
  [id, token] = sql(db, `${asService} SELECT id || '|' || claim_token FROM claim_ci_queue_items_worker(1)`).split('|')
  assert.equal(sql(db, workerComplete(id, token, true, PROFILE)), 'true:enrichment_completed')
  assert.equal(leadState(db), 'completed|A factual profile of the business.')
  assert.equal(queueState(db), 'completed|1|-')
})

test('worker path: skip, stale token, duplicate completion and a customer attempt', opts, () => {
  const db = freshDb()
  const [id, token] = workerClaim(db)
  assert.equal(sql(db, workerComplete(id, 'ffffffff-ffff-ffff-ffff-ffffffffffff', true, PROFILE)), 'false:claim_lost', 'wrong token')
  assert.equal(queueState(db).split('|')[0], 'processing')
  assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM complete_ci_enrichment_worker('${id}','${LEAD_A1}','${token}',NULL,NULL,NULL,true,NULL)`).ok, 'a customer cannot call the worker function')
  assert.equal(sql(db, workerComplete(id, token, true, 'NULL', 'NULL', 'NULL')), 'true:enrichment_completed')
  assert.equal(leadState(db), 'skipped|The earlier, good profile.')
  assert.equal(sql(db, workerComplete(id, token, true, PROFILE)), 'false:claim_lost', 'duplicate completion changes nothing')
  assert.equal(leadState(db), 'skipped|The earlier, good profile.')
})

test('worker path: the maximum number of retries ends in failed and keeps the stored profile', opts, () => {
  const db = freshDb()
  const [id, token] = workerClaim(db)
  sql(db, `UPDATE commercial_intelligence_queue SET retry_count = 2`)
  assert.equal(sql(db, workerComplete(id, token, false, 'NULL', 'NULL', 'NULL', `'site down'`)), 'true:enrichment_failed')
  assert.equal(leadState(db), 'failed|The earlier, good profile.')
  assert.equal(queueState(db), 'failed|3|-')
})

test('worker path: two workers completing the same job at the same moment: exactly one wins', opts, async () => {
  const db = freshDb()
  const [id, token] = workerClaim(db)
  const results = await Promise.all([1, 2].map(() => sqlAsync(db, workerComplete(id, token, true, PROFILE))))
  assert.deepEqual(results.sort(), ['false:claim_lost', 'true:enrichment_completed'])
  assert.equal(leadState(db), 'completed|A factual profile of the business.')
})

test('customer path: two runs completing the same job at the same moment: exactly one wins', opts, async () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  const results = await Promise.all([0, 0].map(() => sqlAsync(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', ', 0'))))
  assert.deepEqual(results.sort(), ['false:claim_lost', 'true:enrichment_completed'])
})

test('stale recovery still fails a job that is out of retries and the lead with it', opts, () => {
  const db = freshDb()
  claimAsCustomer(db)
  sql(db, `UPDATE commercial_intelligence_queue SET retry_count = 2, started_at = now() - interval '1 hour'`)
  assert.equal(sql(db, `${asUser(A)} SELECT reset_count FROM reset_stale_ci_processing(300)`), '0')
  assert.equal(queueState(db), 'failed|3|-')
  assert.match(leadState(db), /^failed\|/)
})

test('B1.1 protections are unchanged by the proposal', opts, () => {
  const db = freshDb()
  const id = claimAsCustomer(db)
  assert.ok(!attempt(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET status='completed'`).ok)
  assert.ok(!attempt(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id,run_id) VALUES ('${LEAD_A1}','${A}',gen_random_uuid())`).ok)
  assert.equal(sql(db, `SELECT count(*) FROM pg_indexes WHERE indexname='idx_ci_queue_unique_active_per_lead'`), '1')
  assert.equal(sql(db, complete(id, true, PROFILE)), 'true:enrichment_completed')
})

// ---- is retry_count guaranteed to change on every legitimate reclaim? -------------------------

test('monotonicity is enforced: a job leaving processing to be retried or failed must count the attempt, for every role', opts, () => {
  for (const role of ['', asService]) {
    const db = freshDb()
    claimAsCustomer(db)
    const stateBefore = queueState(db)
    for (const bad of [
      `UPDATE commercial_intelligence_queue SET status='pending'`,
      `UPDATE commercial_intelligence_queue SET status='failed'`,
      `UPDATE commercial_intelligence_queue SET status='pending', retry_count = 0`,
      `UPDATE commercial_intelligence_queue SET status='failed', retry_count = retry_count - 1`,
      `UPDATE commercial_intelligence_queue SET status='pending', started_at = NULL`,
    ]) {
      const result = attempt(db, `${role}${bad}`)
      assert.equal(result.ok, false, bad)
      assert.ok(result.err.includes('23514'), `${bad}: ${result.err.slice(0, 160)}`)
    }
    assert.equal(queueState(db), stateBefore, 'nothing changed')

    // allowed: counting the attempt, finishing, and unrelated updates
    assert.ok(attempt(db, `${role}UPDATE commercial_intelligence_queue SET last_error = 'note'`).ok)
    assert.ok(attempt(db, `${role}UPDATE commercial_intelligence_queue SET status='pending', retry_count = retry_count + 1`).ok)
    assert.ok(attempt(db, `${role}UPDATE commercial_intelligence_queue SET status='processing'`).ok, 'a claim (pending -> processing) is not constrained')
    assert.ok(attempt(db, `${role}UPDATE commercial_intelligence_queue SET status='completed'`).ok, 'finishing is terminal and not constrained')
  }
})

test('every state the legitimate functions can leave behind passes the monotonicity guard', opts, () => {
  const db = freshDb()
  // customer: fail -> retry -> reset -> retry -> terminal failure
  const id = claimAsCustomer(db)
  assert.equal(sql(db, complete(id, false, 'NULL', 'NULL', 'NULL', `'x'`)), 'true:retry_pending')
  sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`)
  sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(5)`)
  sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '1 hour'`)
  assert.equal(sql(db, `${asUser(A)} SELECT reset_count FROM reset_stale_ci_processing(300)`), '1')
  sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`)
  sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(5)`)
  assert.equal(sql(db, complete(id, false, 'NULL', 'NULL', 'NULL', `'x'`)), 'true:enrichment_failed')
  assert.equal(queueState(db), 'failed|3|-')

  // worker: reset of an exhausted job and of a retryable one
  sql(db, 'TRUNCATE commercial_intelligence_queue')
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) VALUES ('${LEAD_A1}','${A}',true)`)
  sql(db, `${asService} SELECT count(*) FROM claim_ci_queue_items_worker(1)`)
  sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '1 hour'`)
  assert.equal(sql(db, `${asService} SELECT reset_count || ',' || failed_count FROM reset_stale_ci_processing_worker(300)`), '1,0')
  sql(db, `UPDATE commercial_intelligence_queue SET retry_count = 2, status='processing', started_at = now() - interval '1 hour'`)
  assert.equal(sql(db, `${asService} SELECT reset_count || ',' || failed_count FROM reset_stale_ci_processing_worker(300)`), '0,1')
  assert.equal(queueState(db), 'failed|3|-')
})

test('every claim of a job hands out a different attempt number (randomized walk: claims, failures, stalls, resets, zombies)', opts, () => {
  for (const seed of [7, 19, 31, 53]) {
    const db = freshDb()
    let random = seed
    const pick = (n) => { random = (random * 1103515245 + 12345) % 2147483648; return random % n }
    sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}')`)
    const id = sql(db, 'SELECT id FROM commercial_intelligence_queue')
    const handedOut = []
    let held = null
    let zombies = 0
    for (let step = 0; step < 80; step += 1) {
      const [status, retry] = sql(db, `SELECT status || '|' || retry_count FROM commercial_intelligence_queue WHERE id='${id}'`).split('|')
      if (status === 'completed' || status === 'failed') break
      const operation = pick(5)
      if (operation === 0 && status === 'pending') {
        sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = NULL`) // skip the 60 s backoff
        const got = sql(db, `${asUser(A)} SELECT retry_count FROM claim_ci_queue_items(5)`)
        assert.notEqual(got, '', 'a pending job is claimable')
        assert.ok(!handedOut.includes(Number(got)), `attempt ${got} was handed out twice (seed ${seed}, step ${step})`)
        handedOut.push(Number(got))
        held = Number(got)
      } else if (operation === 1 && status === 'processing') {
        assert.match(sql(db, complete(id, false, 'NULL', 'NULL', 'NULL', `'x'`, `, ${held}`)), /^true:(retry_pending|enrichment_failed)$/)
      } else if (operation === 2 && status === 'processing') {
        sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '1 hour'`)
        sql(db, `${asUser(A)} SELECT reset_count FROM reset_stale_ci_processing(300)`)
      } else if (operation === 3 && handedOut.length > 0) {
        const old = handedOut[pick(handedOut.length)]
        if (status === 'processing' && old === Number(retry)) continue // that is the live run, not a zombie
        const before = `${queueState(db)}#${leadState(db)}`
        for (const stale of [complete(id, true, PROFILE, undefined, undefined, 'NULL', `, ${old}`), complete(id, false, 'NULL', 'NULL', 'NULL', `'late'`, `, ${old}`)]) {
          assert.equal(sql(db, stale), 'false:claim_lost', `zombie of attempt ${old} was accepted (seed ${seed}, step ${step})`)
        }
        assert.equal(`${queueState(db)}#${leadState(db)}`, before, 'a zombie changed nothing')
        zombies += 1
      } else if (operation === 4 && status === 'processing') {
        assert.equal(sql(db, complete(id, true, PROFILE, undefined, undefined, 'NULL', `, ${held}`)), 'true:enrichment_completed')
      }
    }
    assert.ok(handedOut.length >= 1, `seed ${seed} exercised at least one claim`)
    assert.ok(new Set(handedOut).size === handedOut.length)
    assert.ok(zombies + handedOut.length > 0)
  }
})

test('a job that failed for good cannot be revived by an old run; a new request is a new job', opts, () => {
  const db = freshDb()
  const first = claimAsCustomer(db)
  sql(db, `UPDATE commercial_intelligence_queue SET retry_count = 2`)
  assert.equal(sql(db, complete(first, false, 'NULL', 'NULL', 'NULL', `'down'`)), 'true:enrichment_failed')

  const second = claimAsCustomer(db) // the customer asks again: a new row, attempt 0
  assert.notEqual(first, second)
  assert.equal(sql(db, `SELECT status || '|' || retry_count FROM commercial_intelligence_queue WHERE id='${second}'`), 'processing|0')
  // the old run wakes up
  assert.equal(sql(db, complete(first, true, PROFILE, undefined, undefined, 'NULL', ', 2')), 'false:claim_lost')
  assert.equal(sql(db, complete(first, true, PROFILE, undefined, undefined, 'NULL', ', 0')), 'false:claim_lost', 'even with the number of the new attempt: a row id is part of the claim')
  assert.equal(sql(db, `SELECT status FROM commercial_intelligence_queue WHERE id='${second}'`), 'processing')
  assert.equal(leadState(db), 'failed|The earlier, good profile.', 'the lead keeps the first job\'s outcome; the stale run changed nothing')
})

test('concurrent claims: two sessions racing for one pending job get it exactly once, with one attempt number', opts, async () => {
  const db = freshDb()
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}')`)
  const results = await Promise.all([1, 2, 3].map(() => sqlAsync(db, `${asUser(A)} SELECT retry_count FROM claim_ci_queue_items(5)`)))
  assert.deepEqual(results.filter((value) => value !== '').sort(), ['0'])
})

test('rollback restores the B1.1 behaviour and the proposal can be applied again', opts, () => {
  const db = freshDb()
  sql(db, read(ROLLBACK), ['-1'])
  assert.equal(sql(db, `SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='complete_ci_enrichment'`), 'p_queue_id uuid, p_lead_id uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb, p_success boolean, p_error_msg text')
  assert.equal(sql(db, `SELECT count(*) FROM pg_trigger WHERE tgname='trg_guard_ci_queue_attempt_monotonic'`), '0')
  const id = claimAsCustomer(db)
  assert.equal(sql(db, complete(id, true, 'NULL', undefined, undefined, 'NULL', null)), 'true:enrichment_completed', 'old behaviour is back')
  assert.equal(leadState(db), 'completed|NULL')
  sql(db, 'TRUNCATE commercial_intelligence_queue')
  sql(db, read(PROPOSAL), ['-1'])
  assert.equal(sql(db, `SELECT count(*) FROM pg_trigger WHERE tgname='trg_guard_ci_queue_attempt_monotonic'`), '1')
  const again = claimAsCustomer(db)
  assert.equal(sql(db, complete(again, true, 'NULL')), 'true:retry_pending')
})
