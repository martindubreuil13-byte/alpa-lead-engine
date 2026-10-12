// B2 Phase 0 — Business Intelligence safety and reliability.
//
// Offline tests always run: no network, no Supabase, no OpenAI, no research. The database tests need a
// DISPOSABLE local Postgres 17 and run only when ALPA_TEST_DB_URL points at one (loopback only; the runner
// refuses anything that is not 127.0.0.1/localhost or that looks like Supabase). They build throwaway
// databases from the production-faithful fixture + B1.1 (live in production) + the proposals, and drop them.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { register } from 'node:module'
import path from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(ROOT, relative))

// Same tiny loader as tests/research-reliability.test.mjs: resolves "@/..." and stubs the network modules.
const hooks = `
const ROOT = ${JSON.stringify(ROOT)}
const shim = (code) => ({ url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true })
const STUBS = {
  '@/lib/supabase/server': 'export const createServerClient = async () => { globalThis.__touched.push("createServerClient"); return globalThis.__fake.supabase }',
  '@/lib/supabase/admin': 'export const createAdminClient = () => { globalThis.__touched.push("createAdminClient"); return globalThis.__fake.supabase }',
  '@/lib/ai/openai': 'export const openai = {}',
}
const STAGES = {
  'extract-website-snapshot': 'export const extractWebsiteSnapshot = () => { globalThis.__touched.push("snapshot"); return Promise.reject(new Error("must not run")) }',
  'generate-business-signals': 'export const generateBusinessSignals = () => { globalThis.__touched.push("signals"); return Promise.reject(new Error("must not run")) }',
  'generate-commercial-profile': 'export const generateCommercialProfile = () => { globalThis.__touched.push("profile"); return Promise.reject(new Error("must not run")) }',
}
export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return shim(STUBS[specifier])
  const stage = specifier.match(/(?:^|\\/)(extract-website-snapshot|generate-business-signals|generate-commercial-profile)(?:\\.ts)?$/)
  if (stage) return shim(STAGES[stage[1]])
  if (specifier.startsWith('@/')) specifier = 'file://' + ROOT + '/' + specifier.slice(2)
  try {
    return await next(specifier, context)
  } catch (error) {
    if (error && error.code === 'ERR_MODULE_NOT_FOUND' && !/\\.\\w+$/.test(specifier)) return next(specifier + '.ts', context)
    throw error
  }
}
`
register('data:text/javascript,' + encodeURIComponent(hooks), pathToFileURL(ROOT + '/'))
globalThis.__touched = []
globalThis.__fake = { supabase: new Proxy({}, { get: (_, key) => { globalThis.__touched.push(`supabase.${String(key)}`); return () => { throw new Error('database must not be touched') } } }) }

const { isResearchEnabled, getResearchSwitchStatus, assertResearchEnabled, ResearchDisabledError, RESEARCH_SWITCH_ENV } = await import('../lib/commercial-intelligence/research-switch.ts')
const { runBackgroundWorkerCore } = await import('../lib/commercial-intelligence/background-worker-core.ts')
const { resolveWorkerConfig } = await import('../lib/commercial-intelligence/worker-config.ts')
const { RESEARCH_HARD_LIMITS } = await import('../lib/commercial-intelligence/research-limits.ts')
const { isCommercialIntelligenceCronAuthorized } = await import('../lib/commercial-intelligence/cron-auth.ts')
const { enrichLeadDirect } = await import('../lib/commercial-intelligence/enrich-lead-direct.ts')

const withEnv = async (value, work) => {
  const previous = process.env[RESEARCH_SWITCH_ENV]
  if (value === undefined) delete process.env[RESEARCH_SWITCH_ENV]
  else process.env[RESEARCH_SWITCH_ENV] = value
  try { return await work() } finally {
    if (previous === undefined) delete process.env[RESEARCH_SWITCH_ENV]
    else process.env[RESEARCH_SWITCH_ENV] = previous
  }
}

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(relative, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// 1. The emergency switch
// ---------------------------------------------------------------------------------------------

test('the kill switch is OFF by default and only the exact value "true" turns research on', () => {
  assert.equal(RESEARCH_SWITCH_ENV, 'CI_RESEARCH_ENABLED')
  assert.equal(isResearchEnabled({}), false)
  for (const value of ['', ' ', '1', 'yes', 'on', 'TRUE', 'True', 'false', 'enabled', 'truee', 'true;']) {
    assert.equal(isResearchEnabled({ CI_RESEARCH_ENABLED: value }), false, JSON.stringify(value))
  }
  assert.equal(isResearchEnabled({ CI_RESEARCH_ENABLED: 'true' }), true)
  assert.equal(isResearchEnabled({ CI_RESEARCH_ENABLED: ' true ' }), true)
  assert.deepEqual(getResearchSwitchStatus({}), { enabled: false, state: 'off', variable: 'CI_RESEARCH_ENABLED', configured: false })
  assert.throws(() => assertResearchEnabled({}), (error) => error instanceof ResearchDisabledError && error.code === 'RESEARCH_DISABLED')
})

test('the switch reads the server environment only: no request, cookie, header or database input', () => {
  const source = read('lib/commercial-intelligence/research-switch.ts')
  assert.ok(!/headers|cookies|searchParams|request|supabase|fetch\(/i.test(source.replace(/\/\/.*$/gm, '')), 'no external input')
  assert.match(source, /process\.env/)
})

test('switch OFF: a worker tick does not recover, claim, research or complete anything', async () => {
  const calls = []
  const dependencies = {
    recover: async () => { calls.push('recover'); return { resetCount: 0, failedCount: 0 } },
    claim: async () => { calls.push('claim'); return [] },
    enrich: async () => { calls.push('enrich'); throw new Error('must not run') },
    complete: async () => { calls.push('complete'); return { ok: true } },
  }
  // explicit option, and the environment default (unset)
  const explicit = await runBackgroundWorkerCore({}, dependencies, { researchEnabled: false })
  const implicit = await withEnv(undefined, () => runBackgroundWorkerCore({}, dependencies, {}))
  for (const result of [explicit, implicit]) {
    assert.equal(result.ok, true)
    assert.equal(result.disabled, true)
    assert.equal(result.claimed, 0)
  }
  assert.deepEqual(calls, [], 'the database layer is never reached while research is off')
})

test('switch ON: the same tick claims work (the switch is the only gate)', async () => {
  const calls = []
  const result = await withEnv('true', () => runBackgroundWorkerCore({}, {
    recover: async () => { calls.push('recover'); return { resetCount: 0, failedCount: 0 } },
    claim: async () => { calls.push('claim'); return [] },
    enrich: async () => { throw new Error('unused') },
    complete: async () => ({ ok: true }),
  }, {}))
  assert.deepEqual(calls, ['recover', 'claim'])
  assert.equal(result.disabled, undefined)
})

test('switch OFF does not alter jobs or profiles: it touches no data and offers no way to', async () => {
  // The only effect of the switch is an early return before any dependency is called (previous test). Nothing
  // in the module deletes, resets or rewrites rows.
  const source = read('lib/commercial-intelligence/research-switch.ts')
  assert.ok(!/delete|update\(|insert\(|rpc\(/i.test(source.replace(/\/\/.*$/gm, '')))
})

test('manual (direct) research obeys the switch before touching the database, the website or the AI', async () => {
  globalThis.__touched.length = 0
  await withEnv(undefined, async () => {
    await assert.rejects(() => enrichLeadDirect('lead-1'), (error) => error instanceof ResearchDisabledError)
    await assert.rejects(() => enrichLeadDirect('lead-1', { client: globalThis.__fake.supabase }), (error) => error instanceof ResearchDisabledError)
  })
  assert.deepEqual(globalThis.__touched, [], 'nothing was touched')
})

test('the scheduled route checks the secret, then the switch, before it creates a client or runs the worker', () => {
  const route = read('app/api/internal/cron/commercial-intelligence/route.ts')
  const auth = route.indexOf('isCommercialIntelligenceCronAuthorized(request)')
  const switchCheck = route.indexOf('isResearchEnabled()')
  const client = route.indexOf('createAdminClient()')
  assert.ok(auth > 0 && switchCheck > auth && client > switchCheck)
  assert.match(route, /disabled: true/)
})

test('the scheduled-route secret check is constant-time and an unset secret authorizes nothing', () => {
  const request = (value) => ({ headers: { get: () => value } })
  assert.equal(isCommercialIntelligenceCronAuthorized(request('Bearer s3cret'), 's3cret'), true)
  assert.equal(isCommercialIntelligenceCronAuthorized(request('Bearer wrong!'), 's3cret'), false)
  assert.equal(isCommercialIntelligenceCronAuthorized(request('Bearer s3cret '), 's3cret'), false)
  assert.equal(isCommercialIntelligenceCronAuthorized(request(null), 's3cret'), false)
  assert.equal(isCommercialIntelligenceCronAuthorized(request('Bearer undefined'), undefined), false)
  assert.equal(isCommercialIntelligenceCronAuthorized(request('Bearer '), ''), false)
  assert.match(read('lib/commercial-intelligence/cron-auth.ts'), /timingSafeEqual/)
})

test('the manual admin route is admin-only and obeys the switch first; its writes use the server client', () => {
  const route = read('app/api/admin/enrich-lead/route.ts')
  assert.ok(route.indexOf('isAdmin(profile)') < route.indexOf('isResearchEnabled()'))
  assert.ok(route.indexOf('isResearchEnabled()') < route.indexOf('enrichLeadDirect('))
  assert.match(route, /status: 503/)
  assert.match(route, /enrichLeadDirect\(leadId, \{ client: createAdminClient\(\) \}\)/)
})

test('the operator status route is admin-only, read-only and starts nothing', () => {
  const route = read('app/api/admin/research-status/route.ts')
  assert.match(route, /isAdmin\(profile\)/)
  assert.ok(!/POST|PUT|PATCH|DELETE|supabase|rpc\(|enrich|claim/i.test(route.replace(/\/\/.*$/gm, '').replace(/enrichment/gi, '')))
})

// ---------------------------------------------------------------------------------------------
// 2. Customers cannot start or drive research
// ---------------------------------------------------------------------------------------------

test('opening My Leads cannot initiate research: no request to any research endpoint, no loop, no timer', () => {
  const files = walk('app/dashboard/my-leads')
  assert.ok(files.length >= 3)
  for (const file of files) {
    const source = read(file)
    for (const forbidden of [/process-ci-queue-batch/, /enrich-commercial-intelligence/, /process-ci-jobs/, /__ciWorkerRunning/, /setInterval\(/, /visibilitychange/, /runWorker/, /\bclaim_ci/, /enrichLeadDirect/]) {
      assert.ok(!forbidden.test(source), `${file} matches ${forbidden}`)
    }
    // My Leads makes no research-related request at all (the old read-only statistics banner was removed in M1.1)
    for (const match of source.matchAll(/fetch\(\s*([`'"])([^`'"]*)\1/g)) {
      const url = match[2]
      assert.ok(!/ci|enrich|research|process|queue|worker/i.test(url), `${file} fetches ${url}`)
    }
  }
  assert.ok(!fs.existsSync('app/dashboard/my-leads/CommercialIntelligenceStatus.tsx'), 'the legacy status banner is gone')
})

test('the three customer-facing execution endpoints are retired: 410, no queue, no AI, no authentication work', () => {
  for (const file of ['app/api/leads/process-ci-queue-batch/route.ts', 'app/api/leads/[id]/enrich-commercial-intelligence/route.ts', 'app/api/admin/process-ci-jobs/route.ts']) {
    const source = read(file)
    assert.match(source, /status: 410/)
    const imports = [...source.matchAll(/^import .* from '(.*)'/gm)].map((match) => match[1])
    assert.deepEqual(imports, ['next/server'], `${file} imports only next/server`)
    assert.match(source, /export const POST = retired/)
  }
})

test('nothing in the app calls a retired endpoint or a customer-session execution RPC', () => {
  const retired = [/process-ci-queue-batch/, /enrich-commercial-intelligence/, /process-ci-jobs/]
  const restricted = /rpc\(\s*['"](claim_ci_queue_items|complete_ci_enrichment|reset_stale_ci_processing|backfill_missing_ci_queue_entries|audit_ci_queue_consistency)['"]/
  for (const file of [...walk('app'), ...walk('components'), ...walk('lib')]) {
    if (/\/route\.ts$/.test(file) && retired.some((pattern) => pattern.test(file.replace(/\[id\]/, 'id')) || /retired/.test(read(file)))) continue
    const source = read(file)
    for (const pattern of retired) assert.ok(!pattern.test(source), `${file} references ${pattern}`)
    assert.ok(!restricted.test(source), `${file} calls a customer-session execution RPC`)
  }
  for (const gone of ['lib/commercial-intelligence/process-queue.ts', 'lib/commercial-intelligence/adaptive-batch-size.ts', 'lib/commercial-intelligence/enrich-lead.ts']) {
    assert.equal(exists(gone), false, `${gone} was removed`)
  }
  const manager = read('lib/commercial-intelligence/queue-manager.ts')
  for (const rpc of ['claim_ci_queue_items', 'complete_ci_enrichment', 'reset_stale_ci_processing']) {
    assert.ok(!new RegExp(`'${rpc}'`).test(manager), `queue-manager no longer calls ${rpc}`)
  }
  for (const rpc of ['claim_ci_run_items', 'complete_ci_run_item', 'recover_ci_run_items']) {
    assert.ok(manager.includes(`'${rpc}'`), `${rpc} is the execution path`)
  }
  // Phase 1: the old first-in-first-out claim is not called by any application code
  assert.ok(!/claim_ci_queue_items_worker/.test(manager))
})

test('the application sends only parameters the run-scoped RPCs define (production contract test covers the rest)', () => {
  const manager = read('lib/commercial-intelligence/queue-manager.ts')
  const complete = manager.slice(manager.indexOf("rpc('complete_ci_run_item'"))
  const params = [...complete.slice(0, complete.indexOf('})')).matchAll(/(p_[a-z_]+):/g)].map((match) => match[1])
  assert.deepEqual(params, ['p_queue_id', 'p_lead_id', 'p_claim_token', 'p_snapshot', 'p_signals', 'p_profile', 'p_success', 'p_error_msg', 'p_actual_cost_usd'])
  assert.ok(!/p_expected_retry_count/.test(manager), 'the 8-argument customer completion is not called')
})

// ---------------------------------------------------------------------------------------------
// 3. Execution and cost bounds
// ---------------------------------------------------------------------------------------------

test('configuration can lower the execution limits but never raise them above the hard ceilings', () => {
  assert.deepEqual(RESEARCH_HARD_LIMITS, { maxBatchSize: 20, maxConcurrency: 4, maxStaleSeconds: 3600, minStaleSeconds: 60 })
  assert.deepEqual(resolveWorkerConfig({}), { batchSize: 2, concurrency: 1, maxRounds: 8, staleTimeoutSeconds: 600 })
  assert.deepEqual(resolveWorkerConfig({ CI_WORKER_BATCH_SIZE: '9999', CI_WORKER_CONCURRENCY: '99', CI_WORKER_STALE_SECONDS: '999999' }), { batchSize: 20, concurrency: 4, maxRounds: 8, staleTimeoutSeconds: 3600 })
  assert.deepEqual(resolveWorkerConfig({ CI_WORKER_BATCH_SIZE: '-5', CI_WORKER_CONCURRENCY: 'abc', CI_WORKER_STALE_SECONDS: '5' }), { batchSize: 2, concurrency: 1, maxRounds: 8, staleTimeoutSeconds: 600 })
})

test('a tick never claims more than the hard ceiling, whatever is asked', async () => {
  let asked = 0
  await runBackgroundWorkerCore({}, {
    recover: async () => ({ resetCount: 0, failedCount: 0 }),
    claim: async (_client, limit) => { asked = limit; return [] },
    enrich: async () => { throw new Error('unused') },
    complete: async () => ({ ok: true }),
  }, { researchEnabled: true, batchSize: 10_000, concurrency: 10_000 })
  assert.ok(asked >= 1 && asked <= RESEARCH_HARD_LIMITS.maxBatchSize, `claimed ${asked}`)
})

test('research bounds exist: per-job deadline, no SDK retries, response and redirect limits', () => {
  assert.match(read('lib/commercial-intelligence/research-deadline.ts'), /RESEARCH_DEADLINE_MS = 60_000/)
  assert.match(read('lib/commercial-intelligence/commercial-profile-core.ts'), /timeout: 30_000, maxRetries: 0/)
  const fetcher = read('lib/commercial-intelligence/safe-website-fetch.ts')
  assert.match(fetcher, /DEFAULT_MAX_BYTES = 1_000_000/)
  assert.match(fetcher, /DEFAULT_MAX_REDIRECTS = 3/)
  assert.match(fetcher, /DEFAULT_TIMEOUT_MS = 8_000/)
})

// ---------------------------------------------------------------------------------------------
// 4. Research never touches the lead allowance; Discover is unchanged
// ---------------------------------------------------------------------------------------------

test('research code cannot consume or refund lead allowance (usage is written only by the atomic Discover save)', () => {
  for (const file of walk('lib/commercial-intelligence')) {
    const source = read(file).replace(/\/\/.*$/gm, '')
    assert.ok(!/leads_used|\.from\(\s*['"]usage['"]|save_discover_results|get_discover_capacity|discover_save_receipts/.test(source), `${file} touches usage accounting`)
  }
})

test('Discover still saves atomically and queues only inert, non-worker-eligible jobs for public users', () => {
  const route = read('app/api/scrape/route.ts')
  assert.match(route, /saveDiscoverResults\(createAdminClient\(\)/)
  assert.match(route, /getDiscoverCapacity\(createAdminClient\(\), user\.id, leadsLimit, monthly\)/)
  assert.match(route, /enqueueLeadEnrichment\(outcome\.id, supabase, \{ workerEligible: false \}\)/)
  const manager = read('lib/commercial-intelligence/queue-manager.ts')
  const insert = manager.indexOf('const payload = {')
  assert.doesNotMatch(manager.slice(insert, insert + 160), /worker_eligible|run_id/)
})

// ---------------------------------------------------------------------------------------------
// 5. Proposed SQL and documentation
// ---------------------------------------------------------------------------------------------

const LOCKDOWN = 'supabase/applied-records/20261015_ci_phase0_lockdown.sql'
const LOCKDOWN_ROLLBACK = 'supabase/proposed/20261015_ci_phase0_lockdown_rollback.sql'
const topLevelSql = (text) => text.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")

test('the lockdown proposal is clearly unapplied, changes no row, and only revokes execution and adds one guard trigger', () => {
  const text = read(LOCKDOWN)
  assert.match(text, /STATUS: PROPOSED\. NOT APPLIED\./)
  assert.match(read(LOCKDOWN_ROLLBACK), /PROPOSED\. NOT APPLIED\./)
  const top = topLevelSql(text)
  for (const forbidden of [/\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bDROP\s+TABLE\b/i, /\bALTER\s+TABLE\b/i, /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w[\w.]*\s+SET\b/i, /\bCREATE\s+POLICY\b/i, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!forbidden.test(top), `top-level statement matches ${forbidden}`)
  }
  assert.deepEqual([...text.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g)].map((match) => match[1]), ['guard_leads_research_columns'])
  assert.deepEqual([...text.matchAll(/CREATE TRIGGER (\w+)/g)].map((match) => match[1]), ['trg_guard_leads_research_columns'])
  assert.ok(!/GRANT[^;]*\bTO\s+(PUBLIC|authenticated|anon)\b/i.test(text), 'grants nothing to customers')
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((name) => /20261013|20261015/.test(name)), [], 'not in the applied-migrations directory')
  for (const protectedColumn of ['ci_enrichment_status', 'ci_started_at', 'ci_completed_at', 'ci_last_error', 'ci_retry_count', 'ci_processing_duration_ms', 'ci_cost_estimate', 'ci_model_versions', 'website_snapshot', 'business_signals', 'commercial_profile']) {
    assert.ok(text.includes(`NEW.${protectedColumn}`), `${protectedColumn} is protected`)
  }
})

test('historical records are never in the migrations directory (nothing can replay B1.1, atomic-save, B1.2 or the lockdown)', () => {
  const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
  assert.deepEqual(migrations.filter((name) => /^2026101[2-9]/.test(name)), [])
  for (const record of ['20261012_ci_queue_integrity.sql', '20261014_discover_atomic_saves.sql', 'README.md']) {
    assert.ok(exists(`supabase/applied-records/${record}`), record)
  }
  assert.match(read('supabase/applied-records/README.md'), /never replay|must never replay/i)
})

test('the lockdown refuses to run against a schema it does not recognise (preflight comes before any change)', () => {
  const text = read(LOCKDOWN)
  const preflight = text.indexOf('0. Preflight')
  assert.ok(preflight > 0 && preflight < text.indexOf('REVOKE EXECUTE') && preflight < text.indexOf('CREATE TRIGGER'))
  assert.match(text, /public\.leads is missing column/)
  assert.match(text, /already has other triggers/)
})

test('no code outside the research module writes a protected research column from a customer session', () => {
  const protectedNames = 'ci_enrichment_status|ci_started_at|ci_completed_at|ci_last_error|ci_retry_count|ci_processing_duration_ms|ci_cost_estimate|ci_model_versions|website_snapshot|business_signals|commercial_profile'
  for (const file of [...walk('app'), ...walk('components'), ...walk('lib')]) {
    if (file.startsWith('lib/commercial-intelligence') || /\/api\/admin\/enrich-lead\//.test(file)) continue
    const source = read(file)
    for (const match of source.matchAll(new RegExp(`\\.(update|insert|upsert)\\(\\s*\\{[^}]*\\b(${protectedNames})\\b`, 'gs'))) {
      assert.fail(`${file} writes ${match[2]}`)
    }
  }
  // lead insert payloads: none of the builders names a protected column
  for (const file of ['lib/scraper/lead-payload.ts', 'app/api/guest/claim/route.ts']) {
    assert.ok(!new RegExp(`\\b(${protectedNames})\\b`).test(read(file).replace(/\/\/.*$/gm, '')), `${file} names a protected column`)
  }
})

test('the operator guide documents the switch, the limits and how Phase 1 separates new runs from history', () => {
  const guide = read('docs/b2-phase0-research-safety.md')
  for (const required of ['CI_RESEARCH_ENABLED', 'OFF', 'vercel env', 'run_id', 'worker_eligible', 'historical', '/api/admin/research-status']) {
    assert.ok(guide.includes(required), `the guide mentions ${required}`)
  }
})

// ---------------------------------------------------------------------------------------------
// 6. Database behaviour (disposable local Postgres only)
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

const B11 = path.join(ROOT, 'supabase/applied-records/20261012_ci_queue_integrity.sql')
const B12 = path.join(ROOT, 'supabase/proposed/20261013_ci_completion_integrity.sql')
const LOCK = path.join(ROOT, LOCKDOWN)
const ROLLBACK_FILE = path.join(ROOT, LOCKDOWN_ROLLBACK)
const BASELINE = path.join(ROOT, 'tests/sql/ci-queue-baseline.sql')
// Production's real column defaults on leads (the fixture omits them); test-only.
const PRODUCTION_DEFAULTS = `
ALTER TABLE public.leads ALTER COLUMN ci_retry_count SET DEFAULT 0;
ALTER TABLE public.leads ALTER COLUMN ci_cost_estimate SET DEFAULT 0;
ALTER TABLE public.leads ALTER COLUMN ci_model_versions SET DEFAULT '{"profile": "v1", "signals": "v1", "snapshot": "v1"}'::jsonb;
CREATE TABLE public.usage (user_id uuid PRIMARY KEY, leads_used integer NOT NULL DEFAULT 0);
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
const attempt = (database, text, extra = []) => {
  try { return { ok: true, out: sql(database, text, extra), err: '' } } catch (error) { return { ok: false, out: '', err: error.message } }
}

const A = 'aaaaaaaa-0000-0000-0000-00000000000a'
const B = 'bbbbbbbb-0000-0000-0000-00000000000b'
const LEAD_A1 = '11111111-0000-0000-0000-0000000000a1'
const LEAD_A2 = '11111111-0000-0000-0000-0000000000a2'
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
  ('${LEAD_A2}', '${A}', 'A2', 'pending', NULL),
  ('${LEAD_B1}', '${B}', 'B1', 'pending', ${OLD_PROFILE});
INSERT INTO usage(user_id, leads_used) VALUES ('${A}', 7), ('${B}', 3);
`

const created = []
const templates = { asis: false, b12: false }
function ensureTemplate(kind) {
  if (templates[kind]) return
  const name = `p0t_${kind}`
  const steps = kind === 'asis' ? [BASELINE, PRODUCTION_DEFAULTS, B11, LOCK] : [BASELINE, PRODUCTION_DEFAULTS, B11, B12, LOCK]
  sql('postgres', `DROP DATABASE IF EXISTS ${name}`)
  sql('postgres', `CREATE DATABASE ${name}`)
  for (const step of steps) {
    const text = step.startsWith('/') ? fs.readFileSync(step, 'utf8') : step
    sql(name, text, step === BASELINE || !step.startsWith('/') ? [] : ['-1'])
  }
  templates[kind] = true
}
let counter = 0
function freshDb(kind = 'asis') {
  ensureTemplate(kind)
  const name = `p0_${process.pid}_${++counter}`
  sql('postgres', `CREATE DATABASE ${name} TEMPLATE p0t_${kind}`)
  created.push(name)
  sql(name, SEED)
  return name
}
after(() => {
  if (!dbReady) return
  for (const name of [...created, 'p0t_asis', 'p0t_b12']) {
    try { sql('postgres', `DROP DATABASE IF EXISTS ${name}`) } catch {}
  }
})

const RESTRICTED = ['claim_ci_queue_items', 'complete_ci_enrichment', 'reset_stale_ci_processing', 'backfill_missing_ci_queue_entries', 'audit_ci_queue_consistency']
const leadState = (db, lead = LEAD_A1) => sql(db, `SELECT ci_enrichment_status || '|' || coalesce(commercial_profile->>'summary','NULL') FROM leads WHERE id='${lead}'`)
const queueFingerprint = (db) => sql(db, `SELECT coalesce(md5(string_agg(q::text, '|' ORDER BY q.id)), 'empty') || ':' || count(*) FROM commercial_intelligence_queue q`)

for (const kind of ['asis', 'b12']) {
  test(`[${kind}] customers (and anon) cannot execute any research execution function, any overload`, opts, () => {
    const db = freshDb(kind)
    const overloads = sql(db, `SELECT p.oid::regprocedure::text FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname = ANY(ARRAY['${RESTRICTED.join("','")}'])`).split('\n').filter(Boolean)
    assert.ok(overloads.length >= RESTRICTED.length, `found ${overloads.length} overloads`)
    for (const signature of overloads) {
      for (const role of ['authenticated', 'anon', 'public']) {
        const allowed = sql(db, `SELECT has_function_privilege('${role === 'public' ? 'public' : role}', '${signature}'::regprocedure, 'EXECUTE')`)
        assert.equal(allowed, 'f', `${role} can execute ${signature}`)
      }
      assert.equal(sql(db, `SELECT has_function_privilege('service_role', '${signature}'::regprocedure, 'EXECUTE')`), 't', `service_role keeps ${signature}`)
    }
    // and through a real call
    assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM claim_ci_queue_items(5)`).ok)
    assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM reset_stale_ci_processing(300)`).ok)
    assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM backfill_missing_ci_queue_entries(NULL)`).ok)
    assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM audit_ci_queue_consistency(NULL)`).ok)
    assert.ok(!attempt(db, `${asAnon} SELECT * FROM claim_ci_queue_items(5)`).ok)
    const forged = attempt(db, `${asUser(A)} SELECT * FROM complete_ci_enrichment('${LEAD_A1}','${LEAD_A1}',NULL,NULL,${PROFILE},true,NULL)`)
    assert.ok(!forged.ok && /permission denied/i.test(forged.err), forged.err)
    assert.equal(leadState(db), 'pending|The earlier, good profile.', 'a forged completion changed nothing')
  })

  test(`[${kind}] bulk queueing through the backfill RPC is impossible for a customer, and the 146-style backlog cannot grow that way`, opts, () => {
    const db = freshDb(kind)
    const before = queueFingerprint(db)
    assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM backfill_missing_ci_queue_entries(NULL)`).ok)
    assert.equal(queueFingerprint(db), before, 'no job was created')
  })

  test(`[${kind}] customer sessions cannot modify any protected research column of their own leads`, opts, () => {
    const db = freshDb(kind)
    const attempts = {
      ci_enrichment_status: `'completed'`, ci_started_at: 'now()', ci_completed_at: 'now()', ci_last_error: `'x'`, ci_retry_count: '99',
      ci_processing_duration_ms: '1', ci_cost_estimate: '0.5', ci_model_versions: `'{"profile":"forged"}'::jsonb`,
      website_snapshot: `'{"a":1}'::jsonb`, business_signals: `'{"a":1}'::jsonb`, commercial_profile: `'{"summary":"forged"}'::jsonb`,
    }
    for (const [column, value] of Object.entries(attempts)) {
      const result = attempt(db, `${asUser(A)} UPDATE leads SET ${column} = ${value} WHERE id='${LEAD_A1}'`)
      assert.ok(!result.ok && /cannot be modified directly/.test(result.err), `${column}: ${result.err}`)
    }
    assert.equal(leadState(db), 'pending|The earlier, good profile.')
    // deleting a profile is a modification too
    assert.ok(!attempt(db, `${asUser(A)} UPDATE leads SET commercial_profile = NULL WHERE id='${LEAD_A1}'`).ok)
    // a customer cannot write another customer's lead (row security) and cannot create one carrying research data
    assert.equal(sql(db, `${asUser(A)} WITH u AS (UPDATE leads SET company_name='x' WHERE id='${LEAD_B1}' RETURNING 1) SELECT count(*) FROM u`), '0')
    const forgedInsert = attempt(db, `${asUser(A)} INSERT INTO leads(user_id, company_name, commercial_profile) VALUES ('${A}','Forged', '{"summary":"forged"}'::jsonb)`)
    assert.ok(!forgedInsert.ok && /cannot be created with research state/.test(forgedInsert.err), forgedInsert.err)
    assert.ok(!attempt(db, `${asUser(A)} INSERT INTO leads(user_id, company_name, ci_enrichment_status) VALUES ('${A}','Forged','completed')`).ok)
    assert.ok(!attempt(db, `${asUser(A)} INSERT INTO leads(user_id, company_name, ci_cost_estimate) VALUES ('${A}','Forged', 5)`).ok)
  })

  test(`[${kind}] ordinary customer work is unaffected: other columns, unchanged research values, plain inserts, own-profile reads`, opts, () => {
    const db = freshDb(kind)
    assert.equal(sql(db, `${asUser(A)} UPDATE leads SET company_name='Renamed' WHERE id='${LEAD_A1}' RETURNING company_name`), 'Renamed')
    // an update that re-sends the stored research values (a client that spreads the whole row) is not a change
    assert.equal(sql(db, `${asUser(A)} UPDATE leads SET company_name='Again', ci_enrichment_status = ci_enrichment_status, commercial_profile = commercial_profile WHERE id='${LEAD_A1}' RETURNING company_name`), 'Again')
    // a plain insert with the column defaults, as the app does
    assert.match(sql(db, `${asUser(A)} INSERT INTO leads(user_id, company_name) VALUES ('${A}','Plain') RETURNING ci_enrichment_status`), /pending/)
    // explicit default values are allowed too
    assert.ok(attempt(db, `${asUser(A)} INSERT INTO leads(user_id, company_name, ci_enrichment_status, ci_retry_count, ci_cost_estimate) VALUES ('${A}','Defaults','pending',0,0)`).ok)
    // reading: own profile yes, another customer's no
    assert.equal(sql(db, `${asUser(A)} SELECT commercial_profile->>'summary' FROM leads WHERE id='${LEAD_A1}'`), 'The earlier, good profile.')
    assert.equal(sql(db, `${asUser(A)} SELECT count(*) FROM leads WHERE id='${LEAD_B1}'`), '0')
    // read-only statistics stay available to customers
    assert.ok(attempt(db, `${asUser(A)} SELECT * FROM get_ci_statistics('${A}')`).ok)
  })

  test(`[${kind}] the server can still write results: service role, and the worker completion through its own function`, opts, () => {
    const db = freshDb(kind)
    assert.equal(sql(db, `${asService} UPDATE leads SET commercial_profile = ${PROFILE}, ci_enrichment_status='completed' WHERE id='${LEAD_A2}' RETURNING ci_enrichment_status`), 'completed')
    sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) VALUES ('${LEAD_A1}','${A}',true)`)
    const [id, token] = sql(db, `${asService} SELECT id || '|' || claim_token FROM claim_ci_queue_items_worker(1)`).split('|')
    assert.equal(sql(db, `${asService} SELECT success || ':' || message FROM complete_ci_enrichment_worker('${id}','${LEAD_A1}','${token}','{"s":1}'::jsonb,'{"g":1}'::jsonb,${PROFILE},true,NULL)`), 'true:enrichment_completed')
    assert.equal(leadState(db), 'completed|A factual profile of the business.')
  })

  test(`[${kind}] historical jobs stay inert: nothing claims, resets or changes them, and customers cannot claim them`, opts, () => {
    const db = freshDb(kind)
    // customer-filed requests: the only kind of row that exists today (pending, worker_eligible = false)
    sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A1}','${A}')`)
    sql(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_A2}','${A}')`)
    sql(db, `${asUser(B)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_B1}','${B}')`)
    sql(db, `UPDATE commercial_intelligence_queue SET created_at = now() - interval '3 days', last_retry_at = now() - interval '2 days'`)
    const before = queueFingerprint(db)
    assert.equal(sql(db, `SELECT count(*) FROM commercial_intelligence_queue WHERE worker_eligible = false AND status = 'pending'`), '3')
    // the worker claim ignores them
    assert.equal(sql(db, `${asService} SELECT count(*) FROM claim_ci_queue_items_worker(20)`), '0')
    // stale recovery does not touch pending rows
    assert.equal(sql(db, `${asService} SELECT reset_count || ',' || failed_count FROM reset_stale_ci_processing_worker(60)`), '0,0')
    // a customer can neither claim nor reset them
    assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM claim_ci_queue_items(20)`).ok)
    assert.ok(!attempt(db, `${asUser(A)} UPDATE commercial_intelligence_queue SET status='processing'`).ok)
    assert.equal(queueFingerprint(db), before, 'every historical row is byte-for-byte unchanged')
    // a customer cannot make a row eligible, join a run, or file one for another customer's lead
    assert.ok(!attempt(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) VALUES ('${LEAD_A1}','${A}',true)`).ok)
    assert.ok(!attempt(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id,run_id) VALUES ('${LEAD_A2}','${A}','99999999-9999-9999-9999-999999999999')`).ok)
    assert.ok(!attempt(db, `${asUser(A)} INSERT INTO commercial_intelligence_queue(lead_id,user_id) VALUES ('${LEAD_B1}','${A}')`).ok)
  })

  test(`[${kind}] worker semantics: expired claims, duplicate completion, retry limits and failures never touch the allowance`, opts, () => {
    const db = freshDb(kind)
    const usageBefore = sql(db, `SELECT string_agg(user_id::text || '=' || leads_used, ',' ORDER BY user_id) FROM usage`)
    sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) VALUES ('${LEAD_A2}','${A}',true)`)
    const claim = () => sql(db, `${asService} SELECT id || '|' || claim_token FROM claim_ci_queue_items_worker(1)`).split('|')
    const complete = (id, token, success, profile, error = 'NULL') =>
      sql(db, `${asService} SELECT success || ':' || message FROM complete_ci_enrichment_worker('${id}','${LEAD_A2}','${token}',${profile === 'NULL' ? 'NULL' : `'{"s":1}'::jsonb`},${profile === 'NULL' ? 'NULL' : `'{"g":1}'::jsonb`},${profile},${success},${error})`)
    let [id, token] = claim()
    // an expired/wrong claim cannot complete
    assert.equal(complete(id, 'ffffffff-ffff-ffff-ffff-ffffffffffff', true, PROFILE), 'false:claim_lost')
    // a failure is a retry (bounded) ...
    assert.equal(complete(id, token, false, 'NULL', `'site down'`), 'true:retry_pending')
    // ... and a completion after it, with the old token, is refused (duplicate/late completion is harmless)
    assert.equal(complete(id, token, true, PROFILE), 'false:claim_lost')
    for (let attemptNumber = 2; attemptNumber <= 3; attemptNumber += 1) {
      sql(db, `UPDATE commercial_intelligence_queue SET last_retry_at = now() - interval '5 minutes'`);
      [id, token] = claim()
      const expected = attemptNumber < 3 ? 'true:retry_pending' : 'true:enrichment_failed'
      assert.equal(complete(id, token, false, 'NULL', `'site down'`), expected)
    }
    assert.equal(sql(db, `SELECT status || '|' || retry_count FROM commercial_intelligence_queue`), 'failed|3', 'the retry limit ends in failed')
    assert.equal(sql(db, `${asService} SELECT count(*) FROM claim_ci_queue_items_worker(5)`), '0', 'a failed job is never claimed again')
    assert.equal(complete(id, token, true, PROFILE), 'false:claim_lost', 'a late success after the final failure changes nothing')
    assert.equal(leadState(db, LEAD_A2), 'failed|NULL')
    assert.equal(sql(db, `SELECT string_agg(user_id::text || '=' || leads_used, ',' ORDER BY user_id) FROM usage`), usageBefore, 'research failures consumed no allowance')
    assert.equal(sql(db, `SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname ~ 'ci_|enqueue_private' AND prosrc ~* '\\musage\\M|leads_used'`), '0', 'no research function references usage accounting')
  })

  test(`[${kind}] a stale (timed-out) claim is recovered by the worker, counted as an attempt, and cannot complete late`, opts, () => {
    const db = freshDb(kind)
    sql(db, `INSERT INTO commercial_intelligence_queue(lead_id,user_id,worker_eligible) VALUES ('${LEAD_A2}','${A}',true)`)
    const [id, token] = sql(db, `${asService} SELECT id || '|' || claim_token FROM claim_ci_queue_items_worker(1)`).split('|')
    sql(db, `UPDATE commercial_intelligence_queue SET started_at = now() - interval '2 hours'`)
    assert.match(sql(db, `${asService} SELECT reset_count FROM reset_stale_ci_processing_worker(600)`), /^1$/)
    assert.equal(sql(db, `SELECT status || '|' || retry_count FROM commercial_intelligence_queue`), 'pending|1')
    assert.equal(sql(db, `${asService} SELECT success || ':' || message FROM complete_ci_enrichment_worker('${id}','${LEAD_A2}','${token}','{"s":1}'::jsonb,'{"g":1}'::jsonb,${PROFILE},true,NULL)`), 'false:claim_lost')
    assert.equal(leadState(db, LEAD_A2), 'pending|NULL')
  })
}

test('[asis] the lockdown is idempotent and its rollback restores the previous execution rights', opts, () => {
  const db = freshDb('asis')
  sql(db, fs.readFileSync(LOCK, 'utf8'), ['-1'])
  assert.ok(!attempt(db, `${asUser(A)} SELECT * FROM claim_ci_queue_items(5)`).ok)
  sql(db, fs.readFileSync(ROLLBACK_FILE, 'utf8'), ['-1'])
  assert.ok(attempt(db, `${asUser(A)} SELECT * FROM claim_ci_queue_items(5)`).ok, 'rollback re-grants')
  assert.equal(sql(db, `SELECT count(*) FROM pg_trigger WHERE tgname='trg_guard_leads_research_columns'`), '0')
  assert.ok(attempt(db, `${asUser(A)} UPDATE leads SET commercial_profile = ${PROFILE} WHERE id='${LEAD_A2}'`).ok, 'rollback re-opens the writes (documented)')
})

test('[asis] the trigger function is not executable by customers and customers cannot drop or replace it', opts, () => {
  const db = freshDb('asis')
  assert.equal(sql(db, `SELECT has_function_privilege('authenticated','public.guard_leads_research_columns()','EXECUTE')`), 'f')
  assert.ok(!attempt(db, `${asUser(A)} DROP TRIGGER trg_guard_leads_research_columns ON leads`).ok)
  assert.ok(!attempt(db, `${asUser(A)} ALTER TABLE leads DISABLE TRIGGER trg_guard_leads_research_columns`).ok)
})

test('[asis] the lockdown preflight stops, changing nothing, when a protected column is missing', opts, () => {
  const db = freshDb('asis')
  sql(db, fs.readFileSync(ROLLBACK_FILE, 'utf8'), ['-1']) // back to the pre-lockdown state
  sql(db, 'ALTER TABLE leads DROP COLUMN business_signals')
  const result = attempt(db, fs.readFileSync(LOCK, 'utf8'), ['-1'])
  assert.ok(!result.ok && /missing column\(s\): business_signals/.test(result.err), result.err)
  assert.equal(sql(db, `SELECT count(*) FROM pg_trigger WHERE tgname='trg_guard_leads_research_columns'`), '0')
  assert.equal(sql(db, `SELECT has_function_privilege('authenticated','claim_ci_queue_items(integer)','EXECUTE')`), 't', 'nothing was revoked')
})
