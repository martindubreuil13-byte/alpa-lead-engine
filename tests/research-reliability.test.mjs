// B1.2a — atomic completion and hard deadlines for Business Profile research.
//
// Fully offline: no network, no Supabase, no OpenAI. The real enrich-lead-direct, process-queue and
// queue-manager modules run against fakes (a recording Supabase client and stub research stages) through a
// tiny module loader that resolves the app's "@/..." imports and stubs the modules that would reach the
// network. The database side of the same guarantees is in tests/ci-completion-fencing.test.mjs.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

// B2 Phase 0: research is OFF unless CI_RESEARCH_ENABLED=true. These tests exercise an enabled system; the OFF
// behavior is covered in tests/b2-phase0-safety.test.mjs.
process.env.CI_RESEARCH_ENABLED = 'true'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const hooks = `
const ROOT = ${JSON.stringify(ROOT)}
const shim = (code) => ({ url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true })
const STUBS = {
  '@/lib/supabase/server': 'export const createServerClient = async () => globalThis.__fake.supabase',
  '@/lib/supabase/admin': 'export const createAdminClient = () => globalThis.__fake.supabase',
  '@/lib/ai/openai': 'export const openai = {}',
}
const STAGES = {
  'extract-website-snapshot': 'export const extractWebsiteSnapshot = (w, o) => globalThis.__fake.stages.snapshot(w, { signal: o && o.fetchOptions && o.fetchOptions.signal })',
  'generate-business-signals': 'export const generateBusinessSignals = (w, o) => globalThis.__fake.stages.signals(w, { signal: o && o.signal })',
  'generate-commercial-profile': 'export const generateCommercialProfile = (w, s, g, o) => globalThis.__fake.stages.profile(w, s, g, { signal: o && o.signal })',
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

const { enrichLeadDirect } = await import('../lib/commercial-intelligence/enrich-lead-direct.ts')
const { runBackgroundWorkerCore } = await import('../lib/commercial-intelligence/background-worker-core.ts')
const { runResearchStages } = await import('../lib/commercial-intelligence/research-run.ts')
const { buildCompletion, hasUsableProfile } = await import('../lib/commercial-intelligence/research-completion.ts')
const { createResearchDeadline, jobsThatFit, ResearchDeadlineError, RESEARCH_DEADLINE_MS } = await import('../lib/commercial-intelligence/research-deadline.ts')
const { safeFetchWebsite, WebsiteFetchError } = await import('../lib/commercial-intelligence/safe-website-fetch.ts')

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

const PROFILE = { summary: 'A factual two-sentence profile of the business.', industry: 'x', business_category: 'x', primary_service: 'x', core_services: [], target_customer: '', competitive_advantage: '', keywords: [], generated_at: 'now' }
const SNAPSHOT = { title: 't', source_urls: ['https://example.com'] }
const SIGNALS = { has_https: true, detected_at: 'now' }
const ok = (data) => ({ ok: true, data, duration_ms: 1, cost: 0.001 })
const failed = (message) => ({ ok: false, error: { code: 'X', message }, duration_ms: 1, cost: 0 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const abortion = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))

function goodStages(overrides = {}) {
  return {
    calls: { snapshot: 0, signals: 0, profile: 0 },
    snapshot: async function () { return ok(SNAPSHOT) },
    signals: async function () { return ok(SIGNALS) },
    profile: async function () { return ok(PROFILE) },
    ...overrides,
  }
}

/** A Supabase stand-in that records every lead write and every RPC. */
function fakeSupabase({ lead = { id: 'lead-1', user_id: 'u1', website: 'https://example.com', company_name: 'Acme' }, rpc = {} } = {}) {
  const writes = []
  const rpcCalls = []
  const builder = (table) => {
    const state = { op: 'select', payload: null }
    const api = {
      select: () => api,
      eq: () => api,
      abortSignal: () => api,
      update: (payload) => { state.op = 'update'; state.payload = payload; return api },
      single: () => Promise.resolve({ data: lead, error: null }),
      then(resolve, reject) {
        if (state.op === 'update') writes.push({ table, payload: state.payload })
        return Promise.resolve({ data: [], error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return {
    writes,
    rpcCalls,
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'u1' } } }, error: null }),
    },
    from: builder,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      const handler = rpc[name]
      return handler ? handler(args) : { data: [], error: null }
    },
  }
}

function install(stages, supabase) {
  globalThis.__fake = { stages, supabase }
}

const finalLeadWrites = (supabase) => supabase.writes.filter((w) => w.table === 'leads' && w.payload.ci_enrichment_status !== 'processing')

// ---------------------------------------------------------------------------------------------
// The deadline itself
// ---------------------------------------------------------------------------------------------

test('a deadline aborts its signal and rejects guarded work that cannot be cancelled', async () => {
  const deadline = createResearchDeadline(60)
  const started = Date.now()
  await assert.rejects(deadline.guard(sleep(5_000), 'stuck step'), (error) => error instanceof ResearchDeadlineError && /stuck step/.test(error.message))
  assert.ok(Date.now() - started < 1_000, 'returned at the deadline, not when the work finished')
  assert.equal(deadline.signal.aborted, true)
  assert.equal(deadline.expired(), true)
  await assert.rejects(deadline.guard(Promise.resolve(1)), ResearchDeadlineError, 'nothing new starts after expiry')
  deadline.dispose()
})

test('work that finishes in time is returned and the timer is released', async () => {
  const deadline = createResearchDeadline(5_000)
  assert.equal(await deadline.guard(Promise.resolve('done')), 'done')
  assert.equal(deadline.signal.aborted, false)
  deadline.dispose()
})

test('one request never claims more jobs than it can finish', () => {
  assert.equal(RESEARCH_DEADLINE_MS, 60_000)
  assert.equal(jobsThatFit(10), 3, '240 s budget / (60 s + 5 s grace) = 3 sequential jobs')
  assert.equal(jobsThatFit(50), 3)
  assert.equal(jobsThatFit(2), 2)
  assert.equal(jobsThatFit(0), 1)
  assert.equal(jobsThatFit(20, { parallel: 4 }), 12)
})

// ---------------------------------------------------------------------------------------------
// What may be reported to the completion RPC
// ---------------------------------------------------------------------------------------------

test('only a usable profile can be reported as success', () => {
  const full = { success: true, ci_enrichment_status: 'completed', website_snapshot: SNAPSHOT, business_signals: SIGNALS, commercial_profile: PROFILE }
  assert.equal(buildCompletion(full).success, true)
  assert.equal(buildCompletion(full).profile, PROFILE)

  for (const broken of [
    { ...full, commercial_profile: null },
    { ...full, commercial_profile: { summary: '   ' } },
    { ...full, commercial_profile: [] },
    { ...full, website_snapshot: null },
    { ...full, business_signals: null },
  ]) {
    const completion = buildCompletion(broken)
    assert.equal(completion.success, false, 'a success without a usable profile is a failure')
    assert.equal(completion.profile, null)
    assert.match(completion.errorMessage, /usable business profile/)
  }
  assert.equal(hasUsableProfile(PROFILE), true)
  assert.equal(hasUsableProfile({}), false)
})

test('a failed run reports no partial data and keeps its error; a lead without a website is a skip', () => {
  const failure = buildCompletion({ success: false, ci_last_error: 'boom', website_snapshot: SNAPSHOT, commercial_profile: PROFILE })
  assert.deepEqual([failure.success, failure.snapshot, failure.signals, failure.profile, failure.errorMessage], [false, null, null, null, 'boom'])
  const skipped = buildCompletion({ success: true, ci_enrichment_status: 'skipped' })
  assert.deepEqual([skipped.success, skipped.profile, skipped.errorMessage], [true, null, undefined])
})

// ---------------------------------------------------------------------------------------------
// Stage runner: scenarios 1-3 (fetch timeout, OpenAI timeout, overall deadline)
// ---------------------------------------------------------------------------------------------

test('scenario 1: a website fetch that times out is a controlled failure and stops the run', async () => {
  const stages = goodStages({ snapshot: async () => failed('Website request timed out') })
  const outcome = await runResearchStages('https://example.com', stages, { deadlineMs: 5_000 })
  assert.equal(outcome.snapshot.ok, false)
  assert.equal(outcome.deadlineExceeded, false)
  assert.match(outcome.errors[0], /timed out/)
  assert.ok(outcome.errors.some((message) => /skipped due to snapshot or signals failure/.test(message)), 'no profile is attempted')
})

test('scenario 2: an OpenAI timeout never produces a profile or a completed status', async () => {
  const stages = goodStages({ profile: async () => { throw new Error('Request timed out.') } })
  const outcome = await runResearchStages('https://example.com', stages, { deadlineMs: 5_000 })
  assert.equal(outcome.profile.ok, false)
  assert.match(outcome.errors.join('|'), /Commercial profile generation failed: Request timed out/)
  assert.equal(buildCompletion({ success: false, ci_last_error: outcome.errors[0] }).success, false)
})

test('scenario 3: the overall deadline stops a stage that ignores cancellation, and nothing later starts', async () => {
  let profileStarted = false
  let sawAbort = false
  const stages = goodStages({
    snapshot: async (_website, { signal }) => { signal.addEventListener('abort', () => { sawAbort = true }); await sleep(5_000); return ok(SNAPSHOT) },
    profile: async () => { profileStarted = true; return ok(PROFILE) },
  })
  const started = Date.now()
  const outcome = await runResearchStages('https://example.com', stages, { deadlineMs: 80 })
  assert.ok(Date.now() - started < 1_000)
  assert.equal(outcome.deadlineExceeded, true)
  assert.equal(sawAbort, true, 'the stage was told to cancel')
  assert.equal(profileStarted, false)
  assert.match(outcome.errors[0], /exceeded its 0s deadline during website snapshot|deadline during website snapshot/)
})

test('the outer signal cancels a real website request (it does not just stop waiting for it)', async () => {
  let fetchSawAbort = false
  const fetchImpl = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { fetchSawAbort = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 40)
  const started = Date.now()
  await assert.rejects(
    safeFetchWebsite('https://example.com', { fetchImpl, resolveHostname: async () => ['93.184.216.34'], signal: controller.signal, timeoutMs: 30_000 }),
    (error) => error instanceof WebsiteFetchError && error.failure === 'timeout'
  )
  assert.equal(fetchSawAbort, true)
  assert.ok(Date.now() - started < 2_000)

  // already expired: no lookup, no request
  let lookups = 0
  const expired = new AbortController()
  expired.abort()
  await assert.rejects(
    safeFetchWebsite('https://example.com', { fetchImpl, resolveHostname: async () => { lookups += 1; return ['93.184.216.34'] }, signal: expired.signal }),
    WebsiteFetchError
  )
  assert.equal(lookups, 0)
})

// ---------------------------------------------------------------------------------------------
// enrichLeadDirect: deferred vs direct persistence (the root cause of premature completion)
// ---------------------------------------------------------------------------------------------

test('queued research (deferred) writes nothing to the lead at all, not even a "processing" marker', async () => {
  const supabase = fakeSupabase()
  install(goodStages(), supabase)
  const result = await enrichLeadDirect('lead-1', { client: supabase, persist: 'deferred', deadlineMs: 5_000 })
  assert.equal(result.success, true)
  assert.equal(result.commercial_profile.summary, PROFILE.summary)
  assert.deepEqual(supabase.writes, [], 'the queue claim and the completion RPC are the only writers of state')

  // The marker has no claim check. A run that stalled before reaching it, was recovered and replaced, and then
  // woke up would flip a lead that is already completed back to "processing" and nothing would repair it.
  // With no write there is nothing for a stale run to do to the lead.
  const stale = fakeSupabase()
  install(goodStages({ snapshot: async () => { await sleep(30); return ok(SNAPSHOT) } }), stale)
  await enrichLeadDirect('lead-1', { client: stale, persist: 'deferred', deadlineMs: 5_000 })
  assert.deepEqual(stale.writes, [])

  const failing = fakeSupabase()
  install(goodStages({ signals: async () => failed('no signals') }), failing)
  const failure = await enrichLeadDirect('lead-1', { client: failing, persist: 'deferred', deadlineMs: 5_000 })
  assert.equal(failure.success, false)
  assert.deepEqual(finalLeadWrites(failing), [])
})

test('manual research (direct, the default) still stores its own result, but never overwrites good data with NULL', async () => {
  const supabase = fakeSupabase()
  install(goodStages(), supabase)
  const result = await enrichLeadDirect('lead-1', { client: supabase, deadlineMs: 5_000 })
  assert.equal(result.success, true)
  const [final] = finalLeadWrites(supabase)
  assert.equal(final.payload.ci_enrichment_status, 'completed')
  assert.equal(final.payload.commercial_profile.summary, PROFILE.summary)
  assert.deepEqual(supabase.writes.map((w) => w.payload.ci_enrichment_status), ['processing', 'completed'], 'manual research keeps its "processing" marker')

  const failing = fakeSupabase()
  install(goodStages({ profile: async () => failed('INSUFFICIENT_INFORMATION') }), failing)
  const failure = await enrichLeadDirect('lead-1', { client: failing, deadlineMs: 5_000 })
  assert.equal(failure.success, false)
  const [failedWrite] = finalLeadWrites(failing)
  assert.equal(failedWrite.payload.ci_enrichment_status, 'failed')
  assert.ok(!('commercial_profile' in failedWrite.payload), 'a failed run leaves the stored profile alone')
  assert.ok('website_snapshot' in failedWrite.payload, 'what did succeed is kept')
})

test('an empty profile is a failure, whatever the AI step reported', async () => {
  const supabase = fakeSupabase()
  install(goodStages({ profile: async () => ok({ ...PROFILE, summary: '  ' }) }), supabase)
  const result = await enrichLeadDirect('lead-1', { client: supabase, persist: 'deferred', deadlineMs: 5_000 })
  assert.equal(result.success, false)
  assert.equal(result.commercial_profile, null)
  assert.equal(buildCompletion(result).success, false)
})

test('scenario 3 (end to end): a stuck job returns a deadline failure on time and writes nothing final', async () => {
  const supabase = fakeSupabase()
  let aborted = false
  install(goodStages({ snapshot: async (_w, { signal }) => { signal.addEventListener('abort', () => { aborted = true }); await sleep(5_000); return ok(SNAPSHOT) } }), supabase)
  const started = Date.now()
  const result = await enrichLeadDirect('lead-1', { client: supabase, persist: 'deferred', deadlineMs: 80 })
  assert.ok(Date.now() - started < 1_000)
  assert.equal(result.success, false)
  assert.equal(result.error.code, 'DEADLINE_EXCEEDED')
  assert.equal(aborted, true)
  assert.deepEqual(finalLeadWrites(supabase), [])
  assert.equal(buildCompletion(result).success, false, 'a timed-out job is never completed')
})

test('a lead without a website is reported as a skip and (queued) written by the RPC only', async () => {
  const supabase = fakeSupabase({ lead: { id: 'lead-1', user_id: 'u1', website: null, company_name: 'Acme' } })
  install(goodStages(), supabase)
  const queued = await enrichLeadDirect('lead-1', { client: supabase, persist: 'deferred' })
  assert.equal(queued.ci_enrichment_status, 'skipped')
  assert.equal(supabase.writes.length, 0)
  assert.deepEqual([buildCompletion(queued).success, buildCompletion(queued).profile], [true, null])

  const direct = await enrichLeadDirect('lead-1', { client: supabase })
  assert.equal(direct.ci_enrichment_status, 'skipped')
  assert.equal(supabase.writes[0].payload.ci_enrichment_status, 'skipped')
})

// ---------------------------------------------------------------------------------------------
// The customer path (process-queue, customer claim/complete) was removed in B2 Phase 0: customers no longer
// drive research. Its scenarios are covered by the worker path below and by tests/b2-phase0-safety.test.mjs.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Worker path (background-worker-core)
// ---------------------------------------------------------------------------------------------

const workerItem = (n, token = `token-${n}`) => ({ id: `queue-${n}`, lead_id: `lead-${n}`, status: 'processing', retry_count: 0, max_retries: 3, created_at: '', started_at: '', completed_at: null, last_error: null, last_retry_at: null, claim_token: token })
const goodResult = (leadId) => ({ success: true, ci_enrichment_status: 'completed', leadId, website_snapshot: SNAPSHOT, business_signals: SIGNALS, commercial_profile: PROFILE, ci_last_error: null, ci_cost_estimate: 0.001 })
const workerDeps = (overrides = {}) => ({
  recover: async () => ({ resetCount: 0, failedCount: 0 }),
  claim: async () => [workerItem(1)],
  enrich: async (leadId) => goodResult(leadId),
  complete: async () => ({ ok: true, nextStatus: 'enrichment_completed' }),
  ...overrides,
})

test('worker path asks for deferred persistence and a deadline, and reports a usable profile as success', async () => {
  let seen
  let reported
  const result = await runBackgroundWorkerCore({}, workerDeps({
    enrich: async (leadId, options) => { seen = options; return goodResult(leadId) },
    complete: async (_c, _i, snapshot, signals, profile, success, error) => { reported = { snapshot, signals, profile, success, error }; return { ok: true, nextStatus: 'enrichment_completed' } },
  }))
  assert.equal(seen.persist, 'deferred')
  assert.equal(seen.deadlineMs, RESEARCH_DEADLINE_MS)
  assert.equal(reported.success, true)
  assert.equal(reported.profile, PROFILE)
  assert.equal(result.completed, 1)
})

test('worker path: a "successful" result without a profile is reported as a failure, never completed', async () => {
  let reported
  const result = await runBackgroundWorkerCore({}, workerDeps({
    enrich: async (leadId) => ({ ...goodResult(leadId), commercial_profile: null }),
    complete: async (_c, _i, _s, _g, profile, success, error) => { reported = { profile, success, error }; return { ok: true, nextStatus: 'retry_pending' } },
  }))
  assert.deepEqual([reported.success, reported.profile], [false, null])
  assert.match(reported.error, /usable business profile/)
  assert.equal(result.completed, 0)
  assert.equal(result.retrying, 1)
})

test('scenario 3 (worker): a job that never returns is failed at deadline + grace and the tick still finishes', async () => {
  let reported
  const started = Date.now()
  const result = await runBackgroundWorkerCore({}, workerDeps({
    enrich: () => new Promise(() => {}),
    complete: async (_c, _i, _s, _g, _p, success, error) => { reported = { success, error }; return { ok: true, nextStatus: 'retry_pending' } },
  }), { jobDeadlineMs: 50, graceMs: 50 })
  assert.ok(Date.now() - started < 2_000)
  assert.equal(reported.success, false)
  assert.match(reported.error, /deadline/)
  assert.equal(result.retrying, 1)
  assert.equal(result.completed, 0)
})

test('scenario 4: a worker that dies after researching but before completing leaves the job for stale recovery', async () => {
  const completions = []
  const result = await runBackgroundWorkerCore({}, workerDeps({
    complete: async (...args) => { completions.push(args); throw new Error('process terminated') },
  }))
  assert.equal(result.completed, 0)
  assert.equal(result.interrupted, 1)
  assert.equal(completions.length, 2, 'one attempt to complete, one to record the failure, then it gives up cleanly')
  assert.equal(completions[1][5], false)
})

test('scenario 5 (worker): a failing completion RPC is never counted as completed', async () => {
  const result = await runBackgroundWorkerCore({}, workerDeps({ complete: async () => { throw new Error('rpc down') } }))
  assert.equal(result.completed, 0)
  assert.equal(result.interrupted, 1)
})

test('scenario 6/7/12: duplicate or concurrent workers on one job: only the claim holder completes, the rest are claim_lost', async () => {
  const live = new Map([['queue-1', 'token-A']])
  const outcomes = []
  const complete = async (_client, item) => {
    if (live.get(item.id) !== item.claim_token) return { ok: false }
    live.delete(item.id) // the RPC clears the token on completion
    return { ok: true, nextStatus: 'enrichment_completed' }
  }
  const run = (token) => runBackgroundWorkerCore({}, workerDeps({ claim: async () => [workerItem(1, token)], complete }))
  const [holder, stale] = await Promise.all([run('token-A'), run('token-OLD')])
  outcomes.push(holder.results[0].status, stale.results[0].status)
  assert.deepEqual(outcomes.sort(), ['claim_lost', 'enrichment_completed'])
  const replay = await run('token-A')
  assert.equal(replay.results[0].status, 'claim_lost', 'a duplicate completion is harmless')
})

test('scenario 10: after the last retry the failure is reported as failed, not retried forever', async () => {
  const result = await runBackgroundWorkerCore({}, workerDeps({
    claim: async () => [{ ...workerItem(1), retry_count: 2 }],
    enrich: async (leadId) => ({ ...goodResult(leadId), success: false, commercial_profile: null, ci_last_error: 'site down' }),
    complete: async () => ({ ok: true, nextStatus: 'enrichment_failed' }),
  }))
  assert.equal(result.failed, 1)
  assert.equal(result.completed, 0)
})

test('scenario 9: stale recovery runs before every claim, and one tick claims no more than it can finish', async () => {
  const order = []
  let requested
  await runBackgroundWorkerCore({}, workerDeps({
    recover: async () => { order.push('recover'); return { resetCount: 1, failedCount: 0 } },
    claim: async (_client, limit) => { order.push('claim'); requested = limit; return [] },
  }), { batchSize: 20, concurrency: 1 })
  assert.deepEqual(order, ['recover', 'claim'])
  assert.equal(requested, 3)
})

// ---------------------------------------------------------------------------------------------
// Scenario 11 and static guarantees
// ---------------------------------------------------------------------------------------------

test('scenario 11: a closed browser does not cancel or half-finish a job (nothing listens to the client)', () => {
  for (const file of ['app/api/leads/process-ci-queue-batch/route.ts', 'lib/commercial-intelligence/enrich-lead-direct.ts']) {
    assert.ok(!/request\.signal|req\.signal/.test(read(file)), `${file} ignores client disconnects`)
  }
})

test('queued research uses deferred persistence everywhere, manual routes keep the default', () => {
  assert.match(read('lib/commercial-intelligence/background-worker-core.ts'), /persist: 'deferred'/)
  for (const file of ['app/api/admin/enrich-lead/route.ts']) {
    assert.ok(!/persist:/.test(read(file)), `${file} still uses direct persistence`)
  }
  const enrich = read('lib/commercial-intelligence/enrich-lead-direct.ts')
  assert.ok(!/MAX_PROCESSING_DURATION/.test(enrich), 'the after-the-fact time check is gone')
  // every lead write after the "processing" marker is skipped in deferred mode
  // the skip write, the "processing" marker, the final write and the fatal-error write
  assert.equal((enrich.match(/persist === 'deferred' \? \{ error: null \}/g) || []).length, 4)
})

test('the stage deadline does not change what safeFetchWebsite does without a signal', async () => {
  const response = new Response('<html><body>hello</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
  const page = await safeFetchWebsite('https://example.com', { fetchImpl: async () => response, resolveHostname: async () => ['93.184.216.34'] })
  assert.match(page.html, /hello/)
})
