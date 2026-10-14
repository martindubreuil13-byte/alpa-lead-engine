// B1.1 — queue integrity migration.
//
// Static tests always run. The behavioural tests need a DISPOSABLE local Postgres 17 and run only when
// ALPA_TEST_DB_URL points at one, for example:
//
//   docker run -d --name alpa_b11_verify -e POSTGRES_PASSWORD=localtest -p 127.0.0.1:55432:5432 \
//     public.ecr.aws/supabase/postgres:17.6.1.121
//   ALPA_TEST_DB_URL=postgresql://postgres:localtest@127.0.0.1:55432/postgres \
//     node --experimental-strip-types --test tests/ci-queue-integrity.test.mjs
//
// The runner creates and drops its own throwaway databases and REFUSES any host that is not loopback or
// that looks like Supabase. It can never be pointed at production.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const MIGRATION = path.join(ROOT, 'supabase/applied-records/20261012_ci_queue_integrity.sql')
const ROLLBACK = path.join(ROOT, 'supabase/proposed/20261012_ci_queue_integrity_rollback.sql')
const BASELINE = path.join(ROOT, 'tests/sql/ci-queue-baseline.sql')
const read = (file) => fs.readFileSync(file, 'utf8')

// ---------------------------------------------------------------------------------------------
// Static tests (no database)
// ---------------------------------------------------------------------------------------------

/** SQL with string literals, comments and function bodies removed, so only top-level statements remain. */
function topLevelSql(sql) {
  return sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    .replace(/--.*$/gm, '')
    .replace(/'(?:[^']|'')*'/g, "''")
}

test('the migration is a reviewable proposal that changes no data and touches no other object', () => {
  const sql = read(MIGRATION)
  assert.match(sql, /STATUS: PROPOSED\. NOT APPLIED\./)

  const top = topLevelSql(sql)
  for (const forbidden of [/\bDELETE\s+FROM\b/i, /(?:^|;)\s*TRUNCATE\b/i, /\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bUPDATE\s+\w[\w.]*\s+SET\b/i, /\bINSERT\s+INTO\b/i]) {
    assert.ok(!forbidden.test(top), `top-level statement matches ${forbidden}`)
  }
  assert.ok(!/backup_|vault\.|cron\.|pg_net|net\.http/i.test(sql.replace(/--.*$/gm, '')), 'no backup schema, cron, vault or pg_net use')
  assert.ok(!/\bcommercial_intelligence_jobs\b|\bagent_|\boutreach_|\busage\b/i.test(top), 'only the research queue and its functions')
})

test('the migration restores the guarantees the repository already declares, with the same names', () => {
  const sql = read(MIGRATION)
  const original = read(path.join(ROOT, 'supabase/migrations/20260704_fix_ci_queue_production_safety.sql'))
  assert.match(original, /idx_ci_queue_unique_active_per_lead[\s\S]*status IN \('pending', 'processing'\)/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_queue_unique_active_per_lead[\s\S]*WHERE status IN \('pending', 'processing'\)/)
  assert.match(sql, /valid_status[\s\S]*CHECK \(status IN \('pending', 'processing', 'completed', 'failed'\)\)/)
  assert.ok(!/UNIQUE\s*\(\s*lead_id\s*\)/i.test(top(sql)), 'a full UNIQUE(lead_id) would block history and re-runs')
  function top(text) { return topLevelSql(text) }
})

test('the migration is idempotent by construction and ordered after every existing migration', () => {
  const sql = read(MIGRATION)
  for (const pattern of [/CREATE UNIQUE INDEX IF NOT EXISTS/, /ADD COLUMN IF NOT EXISTS run_id/, /CREATE INDEX IF NOT EXISTS idx_ci_queue_user_run/, /DROP TRIGGER IF EXISTS trg_guard_ci_queue_user_write/, /DROP POLICY IF EXISTS/, /CREATE OR REPLACE FUNCTION public\.claim_ci_queue_items/]) {
    assert.match(sql, pattern)
  }
  const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((name) => /^\d{8}_/.test(name)).sort()
  // B1.1 is a historical record (supabase/applied-records), never replayed; every real migration sorts before it.
  assert.ok(files.every((name) => name < path.basename(MIGRATION)), 'sorts after every migration in supabase/migrations')
  assert.match(sql, /RAISE EXCEPTION 'B1\.1 preflight/, 'preflight aborts instead of deleting')
})

test('the proposed migration does not redefine the service-role worker functions', () => {
  const sql = read(MIGRATION)
  for (const worker of ['claim_ci_queue_items_worker', 'complete_ci_enrichment_worker', 'reset_stale_ci_processing_worker', 'enqueue_private_preview_ci_worker', 'configure_alpa_ci_worker_schedule']) {
    assert.ok(!new RegExp(`FUNCTION\\s+public\\.${worker}\\b`, 'i').test(sql), `${worker} must not be redefined`)
  }
})

test('the application only INSERTS into the queue directly, so revoking UPDATE and DELETE cannot break it', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', '.git'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const source = fs.readFileSync(full, 'utf8')
        // .from('commercial_intelligence_queue') followed (within the same chain) by a write verb other than insert
        for (const match of source.matchAll(/\.from\(\s*['"]commercial_intelligence_queue['"]\s*\)([\s\S]{0,400}?)(?:\n\s*\n|;|\bawait\b)/g)) {
          if (/\.(update|delete|upsert)\s*\(/.test(match[1])) offenders.push(path.relative(ROOT, full))
        }
      }
    }
  }
  for (const dir of ['app', 'lib', 'components']) walk(path.join(ROOT, dir))
  // The customer's one retry re-queues a failed job through the service-role admin client (never the customer's session), which keeps
  // UPDATE; the migration revokes UPDATE and DELETE only from `authenticated`. It is listed so any other writer is still caught.
  assert.deepEqual(offenders.filter((file) => file !== 'lib/commercial-intelligence/retry-run-item.ts'), [])
  const retry = fs.readFileSync(path.join(ROOT, 'lib/commercial-intelligence/retry-run-item.ts'), 'utf8')
  assert.match(retry, /export async function requeueFailedItem\(admin: Client/)

  const manager = read(path.join(ROOT, 'lib/commercial-intelligence/queue-manager.ts'))
  assert.match(manager, /\.from\('commercial_intelligence_queue'\)\s*\.insert\(payload\)/)
  for (const rpc of ['claim_ci_run_items', 'complete_ci_run_item', 'recover_ci_run_items']) {
    assert.ok(manager.includes(`'${rpc}'`), `${rpc} is still called as an RPC with the same name`)
  }
  // the payload the app inserts is exactly what the new insert guard allows
  assert.match(manager, /const payload = \{\s*lead_id: leadId,\s*user_id: userId,\s*status: 'pending',\s*\}/)
})

test('the rollback and the fixture exist and the rollback restores the previous function bodies', () => {
  const rollback = read(ROLLBACK)
  assert.match(rollback, /PROPOSED\. NOT APPLIED\./)
  assert.match(rollback, /DROP INDEX IF EXISTS public\.idx_ci_queue_unique_active_per_lead/)
  assert.ok(!/SECURITY DEFINER/.test(rollback), 'restored functions are the previous SECURITY INVOKER versions')
  assert.match(read(BASELINE), /NOT a migration and must never be run against Supabase/)
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

/** Runs SQL and returns stdout. Throws with the server message when the SQL fails. */
function sql(database, text, extra = []) {
  try {
    return execFileSync(PSQL, [...baseArgs(database), ...extra], { input: text, env: env(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    throw Object.assign(new Error(String(error.stderr || error.message).trim()), { stderr: String(error.stderr || '') })
  }
}
const attempt = (database, text, extra = []) => {
  try {
    return { ok: true, out: sql(database, text, extra), err: '' }
  } catch (error) {
    return { ok: false, out: '', err: error.message }
  }
}
const rejects = (database, text, code) => {
  const result = attempt(database, text)
  assert.equal(result.ok, false, `expected an error from: ${text.slice(0, 120)}`)
  if (code) assert.ok(result.err.includes(code), `expected SQLSTATE ${code}, got: ${result.err.slice(0, 200)}`)
  return result.err
}

const A = 'aaaaaaaa-0000-0000-0000-00000000000a'
const B = 'bbbbbbbb-0000-0000-0000-00000000000b'
const LEAD_A1 = '11111111-0000-0000-0000-0000000000a1'
const LEAD_A2 = '11111111-0000-0000-0000-0000000000a2'
const LEAD_B1 = '22222222-0000-0000-0000-0000000000b1'

const asUser = (id) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false), set_config('request.jwt.claim.role','authenticated',false) \\g /dev/null\n`
const asService = `SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false) \\g /dev/null\n`
const asAnon = `SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false) \\g /dev/null\n`
const RESET = 'RESET ROLE;\n'

const SEED = `
INSERT INTO auth.users(id) VALUES ('${A}'), ('${B}');
INSERT INTO leads(id, user_id, website, company_name) VALUES
  ('${LEAD_A1}', '${A}', 'https://a1.example.com', 'A1'),
  ('${LEAD_A2}', '${A}', 'https://a2.example.com', 'A2'),
  ('${LEAD_B1}', '${B}', 'https://b1.example.com', 'B1');
`

const created = []
let templatesReady = false
function ensureTemplates() {
  if (templatesReady) return
  for (const [name, migrate] of [['b11t_base', false], ['b11t_mig', true]]) {
    sql('postgres', `DROP DATABASE IF EXISTS ${name}`)
    sql('postgres', `CREATE DATABASE ${name}`)
    sql(name, read(BASELINE))
    if (migrate) sql(name, read(MIGRATION), ['-1'])
  }
  templatesReady = true
}
let counter = 0
function freshDb(migrated, seed = true) {
  ensureTemplates()
  const name = `b11_${process.pid}_${++counter}`
  sql('postgres', `CREATE DATABASE ${name} TEMPLATE ${migrated ? 'b11t_mig' : 'b11t_base'}`)
  created.push(name)
  if (seed) sql(name, SEED)
  return name
}
after(() => {
  if (!dbReady) return
  for (const name of [...created, 'b11t_base', 'b11t_mig']) {
    try { sql('postgres', `DROP DATABASE IF EXISTS ${name}`) } catch {}
  }
})

test('baseline: the production gaps B1.1 closes are real (proves the later tests are meaningful)', opts, () => {
  const db = freshDb(false)
  // two active jobs for one lead
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}'),('${LEAD_A1}','${A}');`)
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A1}'`), '2')
  // a job for someone else's lead
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_B1}','${A}');`)
  // forged state
  sql(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET status='completed', max_retries=999 WHERE user_id='${A}';`)
  assert.ok(Number(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE max_retries=999`)) >= 2)
  // an unknown status
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id,status) VALUES ('${LEAD_A2}','${A}','anything');`)
  // a stale reset that never counts the failed attempt
  sql(db, `TRUNCATE commercial_intelligence_queue; INSERT INTO commercial_intelligence_queue(lead_id,user_id,status,started_at) VALUES ('${LEAD_A1}','${A}','processing', now()-interval '1 hour');`)
  sql(db, `${asUser(A)} SELECT * FROM reset_stale_ci_processing(300);`)
  assert.equal(sql(db, `SELECT retry_count FROM commercial_intelligence_queue`), '0')
})

test('the migration applies in one transaction, twice, and changes no existing row', opts, () => {
  ensureTemplates()
  const db = freshDb(false)
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,status,retry_count,created_at) VALUES
      ('${LEAD_A1}','${A}','pending',0, now()-interval '3 days'),
      ('${LEAD_A2}','${A}','completed',1, now()-interval '2 days');`)
  const fingerprint = () => sql(db, `SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM (SELECT id,lead_id,user_id,status,retry_count,max_retries,created_at,started_at,completed_at,last_error,worker_eligible,claim_token FROM commercial_intelligence_queue) t`)
  const before = fingerprint()
  sql(db, read(MIGRATION), ['-1'])
  sql(db, read(MIGRATION), ['-1']) // idempotent
  assert.equal(fingerprint(), before, 'historical rows are byte-for-byte unchanged')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE run_id IS NOT NULL`), '0', 'historical rows have no run id')
})

test('preflight aborts without changing anything when existing data would violate the rules', opts, () => {
  const cases = [
    ['duplicate active jobs', `INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}'),('${LEAD_A1}','${A}');`, 'more than one active job'],
    ['a job for another user\'s lead', `INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_B1}','${A}');`, 'different user'],
    ['an unknown status', `INSERT INTO commercial_intelligence_queue(lead_id,user_id,status) VALUES ('${LEAD_A1}','${A}','cancelled');`, 'unknown status'],
  ]
  for (const [label, setup, message] of cases) {
    const db = freshDb(false)
    sql(db, setup)
    const result = attempt(db, read(MIGRATION), ['-1'])
    assert.equal(result.ok, false, `${label}: the migration must stop`)
    assert.ok(result.err.includes(message), `${label}: ${result.err.slice(0, 200)}`)
    assert.equal(sql(db, `SELECT count(*) FROM pg_indexes WHERE indexname='idx_ci_queue_unique_active_per_lead'`), '0', `${label}: nothing was created`)
    assert.equal(sql(db, `SELECT count(*) FROM pg_trigger WHERE tgname='trg_guard_ci_queue_user_write'`), '0')
    assert.equal(sql(db, `SELECT bool_or(prosecdef)::text FROM pg_proc WHERE proname='claim_ci_queue_items'`), 'false', `${label}: functions unchanged`)
    assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue`), label.startsWith('duplicate') ? '2' : '1', `${label}: no row was deleted`)
  }
})

test('one active job per lead; retries and completed history never conflict', opts, () => {
  const db = freshDb(true)
  const enqueue = (lead = LEAD_A1) => `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${lead}','${A}');`
  sql(db, enqueue())
  rejects(db, enqueue(), '23505') // second active job
  // the app's own dedupe branch (23505 treated as "already queued") and ON CONFLICT DO NOTHING now both work
  assert.equal(sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}') ON CONFLICT DO NOTHING RETURNING id`), '')

  // claim (user path) -> fail -> back to pending on the SAME row -> the unique rule is not involved
  const id = sql(db, `SELECT id FROM commercial_intelligence_queue`)
  sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(10);`)
  assert.equal(sql(db, `SELECT status FROM commercial_intelligence_queue WHERE id='${id}'`), 'processing')
  rejects(db, enqueue(), '23505') // processing is also active
  assert.match(sql(db, `${asUser(A)} SELECT success||':'||message FROM complete_ci_enrichment('${id}','${LEAD_A1}',null,null,null,false,'boom');`), /true:retry_pending/)
  assert.equal(sql(db, `SELECT status||'/'||retry_count FROM commercial_intelligence_queue WHERE id='${id}'`), 'pending/1')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A1}'`), '1')

  // run it to completion through the remaining retries: attempt 2 retry, attempt 3 terminal failure
  for (const expected of ['retry_pending', 'enrichment_failed']) {
    sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = now() - interval '2 minutes' WHERE id='${id}'`)
    sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(10);`)
    assert.match(sql(db, `${asUser(A)} SELECT message FROM complete_ci_enrichment('${id}','${LEAD_A1}',null,null,null,false,'boom');`), new RegExp(expected))
  }
  assert.equal(sql(db, `SELECT status||'/'||retry_count FROM commercial_intelligence_queue WHERE id='${id}'`), 'failed/3')
  assert.equal(sql(db, `SELECT ci_enrichment_status FROM leads WHERE id='${LEAD_A1}'`), 'failed')

  // a failed job does not block a re-run: a new pending row is allowed, history is kept
  sql(db, enqueue())
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A1}'`), '2')
  rejects(db, enqueue(), '23505')

  // a completed job does not block a re-run either
  sql(db, enqueue(LEAD_A2))
  const second = sql(db, `SELECT id FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A2}'`)
  sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(10);`)
  sql(db, `${asUser(A)} SELECT * FROM complete_ci_enrichment('${second}','${LEAD_A2}','{"s":1}','{"g":1}','{"summary":"ok"}',true,null);`)
  sql(db, enqueue(LEAD_A2))
  assert.equal(sql(db, `SELECT status FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A2}' ORDER BY created_at, status`).split('\n').sort().join(','), 'completed,pending')
  assert.equal(sql(db, `SELECT commercial_profile->>'summary' FROM leads WHERE id='${LEAD_A2}'`), 'ok')
})

test('the backfill function still works and respects the unique rule', opts, () => {
  const db = freshDb(true)
  const out = sql(db, `${asUser(A)} SELECT leads_found||'/'||queue_entries_created||'/'||queue_entries_skipped FROM backfill_missing_ci_queue_entries();`)
  assert.equal(out, '2/2/0')
  assert.equal(sql(db, `${asUser(A)} SELECT leads_found||'/'||queue_entries_created||'/'||queue_entries_skipped FROM backfill_missing_ci_queue_entries();`), '0/0/0', 'running it again creates nothing')
})

test('customers read their own status and file plain requests, and nothing else', opts, () => {
  const db = freshDb(true)
  const insert = (columns, values) => `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id${columns}) VALUES ('${LEAD_A1}','${A}'${values});`

  sql(db, insert('', '')) // the exact shape the app inserts
  assert.equal(sql(db, `${asUser(A)} SELECT status FROM commercial_intelligence_queue`), 'pending', 'own status is readable')
  assert.equal(sql(db, `${asUser(B)} SELECT count(*) FROM commercial_intelligence_queue`), '0', 'other customers see nothing')
  rejects(db, `${asAnon} SELECT count(*) FROM commercial_intelligence_queue`, '42501') // anonymous callers have no access at all

  // direct writes are refused, each with a permission error
  rejects(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET status='completed'`, '42501')
  rejects(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET retry_count=0`, '42501')
  rejects(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET claim_token=gen_random_uuid()`, '42501')
  rejects(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET worker_eligible=true`, '42501')
  rejects(db, `${asUser(A)} DELETE FROM commercial_intelligence_queue`, '42501')
  rejects(db, `${asUser(A)} TRUNCATE commercial_intelligence_queue`, '42501')
  rejects(db, `BEGIN; ${asUser(A)} LOCK TABLE commercial_intelligence_queue IN ACCESS EXCLUSIVE MODE; ROLLBACK;`, '42501')
  rejects(db, `${asAnon} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}')`, '42501')

  // presets on insert are refused (database default values are the only accepted shape)
  for (const [columns, values] of [
    [',status', ",'completed'"], [',status', ",'bogus'"], [',retry_count', ',1'], [',max_retries', ',999'],
    [',claim_token', ',gen_random_uuid()'], [',worker_eligible', ',true'], [',started_at', ',now()'],
    [',completed_at', ',now()'], [',last_error', ",'x'"], [',total_cost', ',5'], [',processing_duration_ms', ',1'],
    [',run_id', ",'99999999-0000-0000-0000-000000000001'"], [',created_at', ",now()-interval '9 days'"], [',updated_at', ",now()-interval '9 days'"],
  ]) {
    sql(db, 'TRUNCATE commercial_intelligence_queue')
    rejects(db, insert(columns, values), '')
  }

  // another user's lead
  sql(db, 'TRUNCATE commercial_intelligence_queue')
  rejects(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_B1}','${A}')`, '42501')
  rejects(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${B}')`, '42501') // someone else's user_id
  // the plain request works, including INSERT ... RETURNING (what supabase-js .insert().select() sends)
  sql(db, 'TRUNCATE commercial_intelligence_queue')
  assert.equal(sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id,status) VALUES ('${LEAD_A1}','${A}','pending') RETURNING status`), 'pending')
})

test('review findings stay closed: worker-claimed jobs, ACLs, ownership, search_path, parity, a production-sized queue', opts, () => {
  const db = freshDb(true)

  // a job claimed by the service-role worker is the worker's: the customer path cannot complete or reset it
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,status,started_at,claim_token) VALUES ('${LEAD_A1}','${A}','processing', now()-interval '1 hour', gen_random_uuid())`)
  const id = sql(db, 'SELECT id FROM commercial_intelligence_queue')
  assert.match(sql(db, `${asUser(A)} SELECT success||':'||message FROM complete_ci_enrichment('${id}','${LEAD_A1}',null,null,'{"summary":"forged"}',true,null)`), /false:claim_lost/)
  assert.equal(sql(db, `${asUser(A)} SELECT reset_count FROM reset_stale_ci_processing(60)`), '0')
  assert.equal(sql(db, `SELECT status FROM commercial_intelligence_queue`), 'processing')
  sql(db, `UPDATE commercial_intelligence_queue SET status='pending', started_at=NULL`)
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(10)`), '0', 'a row holding a worker token is not claimable by the customer path')
  sql(db, 'TRUNCATE commercial_intelligence_queue')

  // EXECUTE grants: nothing reachable through PUBLIC or anon, the trigger function by nobody
  const acl = (fn) => sql(db, `SELECT coalesce(proacl::text,'') FROM pg_proc WHERE oid='${fn}'::regprocedure`)
  for (const fn of ['public.guard_ci_queue_user_write()']) {
    assert.doesNotMatch(acl(fn), /(^|[{,])=X|anon=|authenticated=/, `${fn} is not executable by PUBLIC, anon or authenticated`)
  }
  for (const fn of ['public.claim_ci_queue_items(integer)', 'public.complete_ci_enrichment(uuid,uuid,jsonb,jsonb,jsonb,boolean,text)', 'public.reset_stale_ci_processing(integer)']) {
    assert.doesNotMatch(acl(fn), /(^|[{,])=X|anon=/, `${fn} is not executable by PUBLIC or anon`)
    assert.match(acl(fn), /authenticated=X/)
  }
  assert.equal(sql(db, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('claim_ci_queue_items','complete_ci_enrichment','reset_stale_ci_processing') AND pg_get_userbyid(p.proowner)<>'postgres'`), '0', 'ownership unchanged')
  assert.equal(sql(db, `SELECT count(*) FROM pg_proc p WHERE p.proname IN ('claim_ci_queue_items','complete_ci_enrichment','reset_stale_ci_processing') AND NOT (p.proconfig::text LIKE '%search_path=public%')`), '0', 'search_path is pinned on every definer function')

  // a temp table named like the queue cannot capture the definer functions' reads or writes
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}')`)
  assert.equal(sql(db, `${asUser(A)} CREATE TEMP TABLE commercial_intelligence_queue (LIKE public.commercial_intelligence_queue); SELECT count(*) FROM claim_ci_queue_items(5)`), '1')
  assert.equal(sql(db, `SELECT status FROM public.commercial_intelligence_queue`), 'processing')
  sql(db, 'TRUNCATE commercial_intelligence_queue')

  // a customer cannot hand themselves worker powers or touch queue rows by any other route
  rejects(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET worker_eligible=true`, '42501')
  assert.equal(sql(db, `SELECT count(*) FROM pg_policies WHERE tablename='commercial_intelligence_queue' AND cmd IN ('UPDATE','DELETE','ALL')`), '0')
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM get_ci_statistics('${A}')`), '1')
  assert.equal(sql(db, `${asUser(A)} SELECT consistency_status FROM audit_ci_queue_consistency('${A}')`).length > 0, true)
})

test('a production-sized queue (60 pending, 10 completed, historical rows) migrates untouched and keeps working', opts, () => {
  const db = freshDb(false)
  sql(db, `INSERT INTO leads(id,user_id,company_name,ci_enrichment_status)
           SELECT gen_random_uuid(), '${A}', 'lead '||g, CASE WHEN g<=60 THEN 'pending' ELSE 'completed' END FROM generate_series(1,70) g;
           INSERT INTO commercial_intelligence_queue(lead_id,user_id,status,completed_at)
           SELECT id, user_id, CASE WHEN ci_enrichment_status='pending' THEN 'pending' ELSE 'completed' END, CASE WHEN ci_enrichment_status='completed' THEN now() END FROM leads WHERE user_id='${A}' AND company_name LIKE 'lead %';`)
  const fingerprint = () => sql(db, `SELECT md5(string_agg(concat_ws(',', q.id, q.lead_id, q.user_id, q.status, q.retry_count, q.max_retries, q.created_at, q.updated_at, q.started_at, q.completed_at, q.worker_eligible, q.claim_token), '|' ORDER BY q.id)) FROM commercial_intelligence_queue q`)
  const before = fingerprint()
  sql(db, read(MIGRATION), ['-1'])
  assert.equal(fingerprint(), before, 'no queue row is rewritten by the migration')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE status='pending'`), '60')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE status='completed'`), '10')
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(100)`), '50', 'one batch is capped at 50')
})

test('deleting a lead still removes its queue rows (cascade) although customers cannot delete queue rows', opts, () => {
  const db = freshDb(true)
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}')`)
  sql(db, `${asUser(A)} DELETE FROM leads WHERE id='${LEAD_A1}'`)
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue`), '0')
})

test('customers cannot act on other customers\' jobs through the functions', opts, () => {
  const db = freshDb(true)
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,status,started_at) VALUES ('${LEAD_B1}','${B}','processing', now()-interval '1 hour')`)
  const id = sql(db, 'SELECT id FROM commercial_intelligence_queue')

  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(10)`), '0')
  assert.match(sql(db, `${asUser(A)} SELECT success||':'||message FROM complete_ci_enrichment('${id}','${LEAD_B1}',null,null,'{"summary":"forged"}',true,null)`), /false:claim_lost/)
  assert.equal(sql(db, `${asUser(A)} SELECT reset_count FROM reset_stale_ci_processing(300)`), '0')
  assert.equal(sql(db, `SELECT status FROM commercial_intelligence_queue WHERE id='${id}'`), 'processing')
  assert.equal(sql(db, `SELECT commercial_profile IS NULL FROM leads WHERE id='${LEAD_B1}'`), 't', 'the other customer\'s lead was not written')
})

test('anonymous callers cannot execute the user-path functions', opts, () => {
  const db = freshDb(true)
  for (const call of ['claim_ci_queue_items(10)', "reset_stale_ci_processing(300)"]) {
    rejects(db, `${asAnon} SELECT * FROM ${call}`, '42501')
  }
})

test('a repeated or late completion cannot overwrite the outcome', opts, () => {
  const db = freshDb(true)
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}')`)
  const id = sql(db, 'SELECT id FROM commercial_intelligence_queue')
  sql(db, `${asUser(A)} SELECT count(*) FROM claim_ci_queue_items(10)`)
  assert.match(sql(db, `${asUser(A)} SELECT message FROM complete_ci_enrichment('${id}','${LEAD_A1}',null,null,'{"summary":"first"}',true,null)`), /enrichment_completed/)
  assert.match(sql(db, `${asUser(A)} SELECT success||':'||message FROM complete_ci_enrichment('${id}','${LEAD_A1}',null,null,'{"summary":"second"}',true,null)`), /false:claim_lost/)
  assert.equal(sql(db, `SELECT commercial_profile->>'summary' FROM leads WHERE id='${LEAD_A1}'`), 'first')
  // a job that was never claimed cannot be completed either
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A2}','${A}')`)
  const pending = sql(db, `SELECT id FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A2}'`)
  assert.match(sql(db, `${asUser(A)} SELECT success||':'||message FROM complete_ci_enrichment('${pending}','${LEAD_A2}',null,null,'{"summary":"x"}',true,null)`), /false:claim_lost/)
})

test('a stale job counts as a failed attempt and eventually fails instead of cycling forever', opts, () => {
  const db = freshDb(true)
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,status,started_at,retry_count) VALUES
    ('${LEAD_A1}','${A}','processing', now()-interval '1 hour', 0),
    ('${LEAD_A2}','${A}','processing', now()-interval '1 hour', 2),
    ('${LEAD_B1}','${B}','processing', now()-interval '1 hour', 0)`)
  assert.equal(sql(db, `${asUser(A)} SELECT reset_count FROM reset_stale_ci_processing(300)`), '1')
  assert.equal(sql(db, `SELECT status||'/'||retry_count FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A1}'`), 'pending/1')
  assert.equal(sql(db, `SELECT status||'/'||retry_count FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A2}'`), 'failed/3')
  assert.equal(sql(db, `SELECT ci_enrichment_status FROM leads WHERE id='${LEAD_A2}'`), 'failed')
  assert.equal(sql(db, `SELECT status FROM commercial_intelligence_queue WHERE lead_id='${LEAD_B1}'`), 'processing', 'only the caller\'s jobs')
  // a fresh job is left alone
  sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() WHERE lead_id='${LEAD_B1}'`)
  assert.equal(sql(db, `${asUser(B)} SELECT reset_count FROM reset_stale_ci_processing(300)`), '0')
})

test('existing service-role worker functions behave exactly as before', opts, () => {
  const db = freshDb(true)
  // two research-eligible jobs (newest run), and historical rows that must never be claimed
  sql(db, `INSERT INTO leads(id,user_id,website) VALUES ('33333333-0000-0000-0000-000000000003','${A}','https://a3.example.com');
    INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible,created_at) VALUES
      ('${LEAD_A1}','${A}',false, now()-interval '5 days'),
      ('${LEAD_B1}','${B}',false, now()-interval '4 days');`)
  assert.equal(sql(db, `${asService} SELECT enqueue_private_preview_ci_worker('${LEAD_A2}','${A}')`).split('\n').pop(), 'queued')
  assert.equal(sql(db, `${asService} SELECT enqueue_private_preview_ci_worker('${LEAD_A2}','${A}')`).split('\n').pop(), 'already_queued')
  assert.equal(sql(db, `${asService} SELECT enqueue_private_preview_ci_worker('${LEAD_A1}','${A}')`).split('\n').pop(), 'enabled_existing', 'an existing pending job is enabled, not duplicated')
  assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE lead_id='${LEAD_A1}'`), '1')

  const claimed = sql(db, `${asService} SELECT id||'|'||lead_id||'|'||claim_token FROM claim_ci_queue_items_worker(10)`).split('\n').filter((line) => line.includes('|'))
  assert.equal(claimed.length, 2, 'only the two eligible jobs')
  assert.ok(!claimed.join().includes(LEAD_B1), 'a historical, non-eligible job is never claimed')
  const [id, lead, token] = claimed.find((line) => line.includes(LEAD_A2)).split('|')
  assert.match(sql(db, `${asService} SELECT message FROM complete_ci_enrichment_worker('${id}','${lead}','${token}',null,null,'{"summary":"w"}',true,null)`), /enrichment_completed/)
  assert.match(sql(db, `${asService} SELECT success||':'||message FROM complete_ci_enrichment_worker('${id}','${lead}','${token}',null,null,'{"summary":"again"}',true,null)`), /false:claim_lost/)
  assert.equal(sql(db, `SELECT commercial_profile->>'summary' FROM leads WHERE id='${LEAD_A2}'`), 'w')

  // service-role direct inserts are unrestricted (they set eligibility and run ids)
  sql(db, `${asService} INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible,run_id) VALUES ('33333333-0000-0000-0000-000000000003','${A}',true,'99999999-0000-0000-0000-000000000002')`)
  assert.equal(sql(db, `SELECT worker_eligible||'/'||(run_id IS NOT NULL) FROM commercial_intelligence_queue WHERE lead_id='33333333-0000-0000-0000-000000000003'`), 'true/true')
  // worker stale recovery still increments
  sql(db, `UPDATE commercial_intelligence_queue SET status='processing', started_at=now()-interval '1 hour' WHERE lead_id='33333333-0000-0000-0000-000000000003'`)
  assert.match(sql(db, `${asService} SELECT reset_count||'/'||failed_count FROM reset_stale_ci_processing_worker(300)`), /1\/0/)
})

test('concurrent claims never hand the same job to two sessions', opts, async () => {
  const db = freshDb(true)
  const rows = Array.from({ length: 12 }, (_, i) => `('44444444-0000-0000-0000-${String(i).padStart(12, '0')}','${A}','https://c${i}.example.com')`).join(',')
  sql(db, `INSERT INTO leads(id,user_id,website) VALUES ${rows};
    INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) SELECT id,user_id,true FROM leads WHERE id::text LIKE '44444444%';`)

  const session = (sqlText) => new Promise((resolve, reject) => {
    const child = spawn(PSQL, baseArgs(db), { env: env() })
    let out = ''; let err = ''
    child.stdout.on('data', (chunk) => (out += chunk)); child.stderr.on('data', (chunk) => (err += chunk))
    child.on('close', (code) => (code === 0 ? resolve(out.trim().split('\n').filter(Boolean)) : reject(new Error(err))))
    child.stdin.end(sqlText)
  })
  // each session holds its claimed rows locked for a second, so the sessions genuinely overlap
  const workerSql = (limit) => `BEGIN; ${asService} SELECT id FROM claim_ci_queue_items_worker(${limit}); SELECT pg_sleep(1); COMMIT;`
  const userSql = (limit) => `BEGIN; ${asUser(A)} SELECT id FROM claim_ci_queue_items(${limit}); SELECT pg_sleep(1); COMMIT;`

  const [first, second, third] = await Promise.all([session(workerSql(5)), session(workerSql(5)), session(workerSql(5))])
  const all = [...first, ...second, ...third]
  assert.equal(new Set(all).size, all.length, 'no job claimed twice')
  assert.equal(all.length, 12, 'together they claimed every eligible job exactly once')

  // the same guarantee for the customer path (user-scoped, SECURITY DEFINER now)
  sql(db, `UPDATE commercial_intelligence_queue SET status='pending', started_at=NULL, claim_token=NULL, worker_eligible=false`)
  const [u1, u2] = await Promise.all([session(userSql(8)), session(userSql(8))])
  const userAll = [...u1, ...u2]
  assert.equal(new Set(userAll).size, userAll.length)
  assert.equal(userAll.length, 12)
})

test('run_id: historical rows stay out of any run and runs of different customers stay apart', opts, () => {
  const db = freshDb(true)
  const RUN = '99999999-0000-0000-0000-0000000000a1'
  sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,created_at) VALUES ('${LEAD_A1}','${A}', now()-interval '9 days');
           INSERT INTO commercial_intelligence_queue(lead_id,user_id,run_id) VALUES ('${LEAD_A2}','${A}','${RUN}'), ('${LEAD_B1}','${B}','${RUN}');`)
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM commercial_intelligence_queue WHERE run_id='${RUN}'`), '1', 'a run id shared by accident still never crosses customers')
  assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM commercial_intelligence_queue WHERE run_id IS NULL`), '1', 'the historical row has no run')
  const plan = sql(db, `SET enable_seqscan=off; EXPLAIN SELECT 1 FROM commercial_intelligence_queue WHERE user_id='${A}' AND run_id='${RUN}'`)
  assert.match(plan, /idx_ci_queue_user_run/, 'the run lookup uses its index')
})

test('rollback restores the previous behaviour and the migration can be applied again', opts, () => {
  const db = freshDb(true)
  sql(db, read(ROLLBACK), ['-1'])
  assert.equal(sql(db, `SELECT count(*) FROM pg_indexes WHERE indexname='idx_ci_queue_unique_active_per_lead'`), '0')
  assert.equal(sql(db, `SELECT count(*) FROM pg_trigger WHERE tgname='trg_guard_ci_queue_user_write'`), '0')
  assert.equal(sql(db, `SELECT bool_or(prosecdef)::text FROM pg_proc WHERE proname IN ('claim_ci_queue_items','complete_ci_enrichment','reset_stale_ci_processing')`), 'false')
  sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}'),('${LEAD_A1}','${A}')`) // old behaviour is back
  sql(db, `TRUNCATE commercial_intelligence_queue`)
  sql(db, read(MIGRATION), ['-1'])
  rejects(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET status='completed'`, '42501')
})

test('static: the migration qualifies every table it touches and does not depend on Discover V3 work', () => {
  const body = read(MIGRATION).split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(body, /\b(?:FROM|UPDATE|JOIN|INTO)\s+(?:commercial_intelligence_queue|leads)\b/i, 'tables are schema-qualified')
  assert.doesNotMatch(body, /discover|replay|scraper_runs|search_runs/i, 'no dependency on unreleased Discover objects')
  assert.doesNotMatch(body, /GRANT[^;]*\bTO\s+PUBLIC\b/i, 'nothing is granted to PUBLIC')
  assert.doesNotMatch(body, /OWNER\s+TO/i, 'no ownership changes')
})
