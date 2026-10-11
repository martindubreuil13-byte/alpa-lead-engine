// B2 Phase 1 — run-scoped Business Intelligence: application behaviour. Fully offline (no network, no database,
// no AI, no paid service). The database half of the same guarantees is in tests/b2-phase1-run-scoped.test.mjs.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { runBackgroundWorkerCore } from '../lib/commercial-intelligence/background-worker-core.ts'
import { getEffectiveResearchStatus } from '../lib/commercial-intelligence/research-status.ts'
import { authorizeResearchRun, isRunAuthorizationEnabled } from '../lib/commercial-intelligence/run-authorization.ts'
import { buildReplayResearchResponse } from '../lib/scraper/replay-intelligence.ts'
import { withIntelligence } from '../lib/intelligence/row-intelligence.ts'
import { REPLAY_SCENARIOS } from '../lib/scraper/replay-fixture.ts'
import {
  buildProfileCard,
  describeProfileNote,
  deriveLeadProfileState,
  describeIntelligence,
  LEAD_PROFILE_LABEL,
  PROFILE_STATES,
  ROW_LABEL,
  STALL_AFTER_SECONDS,
  summarizeRun,
  toProfileReason,
} from '../lib/intelligence/run-progress.ts'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const rows = (spec) => Object.entries(spec).flatMap(([state, count]) => Array.from({ length: count }, (_, i) => ({ lead_id: `${state}-${i}`, state, queued_at: '2026-10-11T10:00:00Z', run_status: 'active' })))
const NOW = Date.parse('2026-10-11T10:01:00Z')

// ---------------------------------------------------------------------------------------------
// Third-stage truth: only server-confirmed counts
// ---------------------------------------------------------------------------------------------

test('every stage statement is a function of real counts: preparing, researching, complete, not running', () => {
  const preparing = describeIntelligence(summarizeRun(rows({ queued: 25 }), NOW), true)
  assert.deepEqual([preparing.phase, preparing.headline, preparing.detail, preparing.live], ['preparing', 'Preparing business intelligence', '0 of 25 profiles ready', true])

  const researching = describeIntelligence(summarizeRun(rows({ ready: 12, researching: 4, queued: 9 }), NOW), true)
  assert.deepEqual([researching.phase, researching.headline, researching.detail], ['researching', 'Research in progress', '12 of 25 profiles ready'])

  const complete = describeIntelligence(summarizeRun(rows({ ready: 25 }), NOW), true)
  assert.deepEqual([complete.phase, complete.headline, complete.live], ['complete', '25 business profiles ready', false])
  assert.equal(describeIntelligence(summarizeRun(rows({ ready: 1 }), NOW), true).headline, '1 business profile ready')
})

test('"complete" is never shown while a job is unresolved; failures and gaps are stated, not hidden', () => {
  for (const unresolved of [{ queued: 1 }, { researching: 1 }, { retry_pending: 1 }]) {
    const stage = describeIntelligence(summarizeRun(rows({ ready: 24, ...unresolved }), NOW), true)
    assert.notEqual(stage.phase, 'complete', JSON.stringify(unresolved))
  }
  const done = describeIntelligence(summarizeRun(rows({ ready: 20, failed: 2, unavailable: 3 }), NOW), true)
  assert.equal(done.phase, 'complete')
  assert.equal(done.headline, '20 business profiles ready')
  assert.equal(done.detail, '2 could not be completed · 3 without a website to read')
  assert.equal(describeIntelligence(summarizeRun(rows({ ready: 20, failed: 5 }), NOW), true).ready, 20)
})

test('when research is off the stage says so, and queued profiles are never called researching', () => {
  const stage = describeIntelligence(summarizeRun(rows({ queued: 25 }), NOW), false)
  assert.equal(stage.phase, 'not_running')
  assert.equal(stage.headline, 'Business Intelligence is not currently running')
  assert.equal(stage.live, false)
  assert.ok(!/research in progress|researching/i.test(stage.headline + stage.detail))
  // even with some ready profiles from before it was switched off
  assert.equal(describeIntelligence(summarizeRun(rows({ ready: 3, queued: 2 }), NOW), false).phase, 'not_running')
  // nothing queued and nothing running: it is simply complete, whatever the switch says
  assert.equal(describeIntelligence(summarizeRun(rows({ ready: 3 }), NOW), false).phase, 'complete')
})

test('a stalled queue is reported honestly after five minutes with nothing running', () => {
  const old = rows({ queued: 3 }).map((row) => ({ ...row, queued_at: '2026-10-11T09:50:00Z' }))
  const stage = describeIntelligence(summarizeRun(old, NOW), true)
  assert.equal(stage.phase, 'stalled')
  assert.ok(summarizeRun(old, NOW).oldestQueuedSeconds > STALL_AFTER_SECONDS)
  assert.equal(describeIntelligence(summarizeRun(old.map((row, i) => (i === 0 ? { ...row, state: 'researching' } : row)), NOW), true).phase, 'researching')
})

test('progress survives a refresh: the same server rows always produce the same statement (no client state)', () => {
  const server = rows({ ready: 7, researching: 2, queued: 6, failed: 1, unavailable: 2 })
  const first = describeIntelligence(summarizeRun(server, NOW), true)
  const afterRefresh = describeIntelligence(summarizeRun(structuredClone(server), NOW), true)
  assert.deepEqual(afterRefresh, first)
  const summary = summarizeRun(server, NOW)
  assert.equal(summary.total, 18)
  assert.equal(summary.ready + summary.researching + summary.queued + summary.failed + summary.unavailable, summary.total)
  assert.equal(summary.unresolved, 8)
})

test('a cancelled run reads as stopped; a finished profile is kept', () => {
  const cancelled = rows({ ready: 4, cancelled: 6 }).map((row) => ({ ...row, run_status: 'cancelled' }))
  const stage = describeIntelligence(summarizeRun(cancelled, NOW), true)
  assert.equal(stage.phase, 'stopped')
  assert.equal(stage.headline, '4 business profiles ready')
  assert.match(stage.detail, /6 stopped/)
  assert.equal(describeIntelligence(summarizeRun(rows({ cancelled: 5 }).map((row) => ({ ...row, run_status: 'cancelled' })), NOW), true).headline, 'Business intelligence stopped')
})

test('no run, no stage: the page keeps its previous wording', () => {
  assert.equal(summarizeRun([], NOW), null)
  assert.equal(describeIntelligence(null, true), null)
  assert.deepEqual(PROFILE_STATES.sort(), ['cancelled', 'failed', 'partial', 'queued', 'ready', 'researching', 'retry_pending', 'unavailable'].sort())
  for (const state of PROFILE_STATES) assert.ok(ROW_LABEL[state])
})

test('customers never see internal error text: only a safe reason', () => {
  assert.equal(toProfileReason('failed', 'run_budget_exhausted'), 'budget')
  assert.equal(toProfileReason('failed', 'profile_budget_exhausted'), 'budget')
  assert.equal(toProfileReason('failed', 'HTTP 500 at https://internal/db?token=abc'), 'research_failed')
  assert.equal(toProfileReason('cancelled', 'cancelled by customer'), 'cancelled')
  assert.equal(toProfileReason('ready', null), null)
})

// ---------------------------------------------------------------------------------------------
// The profile as the customer reads it: facts and AI interpretation apart, nothing invented
// ---------------------------------------------------------------------------------------------

const LEAD = {
  commercial_profile: {
    summary: 'Northbridge Advisory is a London consultancy that helps mid-size manufacturers redesign their supply chains and reduce inventory costs through process audits.',
    primary_service: 'Supply chain consulting', core_services: ['Process audits', 'Supply chain consulting', 'Inventory planning'],
    target_customer: 'Mid-size manufacturers', competitive_advantage: 'The market leader in everything', keywords: ['x'], industry: 'Consulting',
  },
  website_snapshot: { research_pages: [{ kind: 'homepage', url: 'x', text: 'a' }, { kind: 'services', url: 'y', text: 'b' }], source_urls: ['https://www.northbridge.example/', 'https://www.northbridge.example/services', 'javascript:alert(1)', 'not a url'] },
  business_signals: { has_pricing: true, has_testimonials: false, has_booking_link: true, has_blog: false },
}

test('the profile card separates website facts from AI-written text, and never shows an unverifiable advantage', () => {
  const card = buildProfileCard(LEAD)
  assert.match(card.summary, /Northbridge Advisory/)
  assert.deepEqual(card.services, ['Supply chain consulting', 'Process audits', 'Inventory planning'])
  assert.equal(card.audience, 'Mid-size manufacturers')
  assert.deepEqual(card.facts.signals, ['Mentions pricing', 'Offers online booking'])
  assert.deepEqual(card.facts.pagesRead, ['Home page', 'Services page'])
  assert.deepEqual(card.facts.sources.map((source) => source.url), ['https://www.northbridge.example/', 'https://www.northbridge.example/services'], 'only http(s) sources survive')
  assert.ok(!JSON.stringify(card).includes('market leader'), 'competitive_advantage is not displayed')
  assert.ok(card.limitations.some((text) => /Written by AI/.test(text)))
  assert.ok(card.limitations.some((text) => /two pages|2 pages/.test(text)))
  // nothing is invented for a thin profile
  const thin = buildProfileCard({ commercial_profile: { summary: LEAD.commercial_profile.summary } })
  assert.deepEqual([thin.services, thin.audience, thin.facts.signals, thin.facts.sources], [[], null, [], []])
  assert.ok(thin.limitations.some((text) => /did not clearly describe who it serves/.test(text)))
  assert.equal(buildProfileCard({ commercial_profile: { summary: '   ' } }), null)
  assert.equal(buildProfileCard({}), null)
  for (const forbidden of ['revenue', 'employee', 'customers include', 'buying intent', 'partner']) assert.ok(!JSON.stringify(card).toLowerCase().includes(forbidden), forbidden)
})

test('a lead\'s profile state comes from its profile and its own run job, never from the pending default or history', () => {
  const none = { commercial_profile: null, website: 'https://a.example' }
  assert.equal(deriveLeadProfileState(none, null), 'not_started')
  assert.equal(deriveLeadProfileState(none, { status: 'pending', retry_count: 0, last_error: null, run_id: null }), 'not_started', 'a historical (run-less) pending job means nothing')
  assert.equal(deriveLeadProfileState(none, { status: 'pending', retry_count: 0, last_error: null, run_id: 'r' }), 'queued')
  assert.equal(deriveLeadProfileState(none, { status: 'pending', retry_count: 1, last_error: 'x', run_id: 'r' }), 'retry_pending')
  assert.equal(deriveLeadProfileState(none, { status: 'processing', retry_count: 0, last_error: null, run_id: 'r' }), 'researching')
  assert.equal(deriveLeadProfileState(none, { status: 'failed', retry_count: 2, last_error: 'x', run_id: 'r' }), 'failed')
  assert.equal(deriveLeadProfileState(none, { status: 'failed', retry_count: 0, last_error: 'cancelled by customer', run_id: 'r' }), 'cancelled')
  assert.equal(deriveLeadProfileState({ commercial_profile: null, website: '' }, null), 'unavailable')
  assert.equal(deriveLeadProfileState({ commercial_profile: { summary: 'A real profile.' }, website: null }, null), 'ready')
  for (const state of [...PROFILE_STATES, 'not_started']) assert.ok(LEAD_PROFILE_LABEL[state], state)
})

// ---------------------------------------------------------------------------------------------
// Authorization and the layered switches
// ---------------------------------------------------------------------------------------------

test('run authorization is OFF by default, and a failure to authorize can never throw into Discover', async () => {
  assert.equal(isRunAuthorizationEnabled({}), false)
  assert.equal(isRunAuthorizationEnabled({ CI_RUN_AUTHORIZATION_ENABLED: '1' }), false)
  assert.equal(isRunAuthorizationEnabled({ CI_RUN_AUTHORIZATION_ENABLED: 'true' }), true)

  const calls = []
  const ok = await authorizeResearchRun({ rpc: async (name, args) => { calls.push([name, args]); return { data: { run_id: 'r1', saved: 23, queued: 23, already: false }, error: null } } }, { runId: 'r1', userId: 'u1', planLeadsLimit: 500 })
  assert.deepEqual(ok, { ok: true, runId: 'r1', saved: 23, queued: 23, already: false })
  // the application passes ONLY the run, the customer and the plan limit: never lead ids
  assert.deepEqual(calls, [['authorize_ci_research_run', { p_run_id: 'r1', p_user_id: 'u1', p_plan_leads_limit: 500 }]])

  assert.deepEqual(await authorizeResearchRun({ rpc: async () => ({ data: null, error: { message: 'No confirmed save' } }) }, { runId: 'r', userId: 'u', planLeadsLimit: 5 }), { ok: false, reason: 'refused' })
  assert.deepEqual(await authorizeResearchRun({ rpc: async () => { throw new Error('boom') } }, { runId: 'r', userId: 'u', planLeadsLimit: 5 }), { ok: false, reason: 'unavailable' })
  assert.deepEqual(await authorizeResearchRun({ rpc: () => new Promise(() => {}) }, { runId: 'r', userId: 'u', planLeadsLimit: 5 }, { timeoutMs: 20 }), { ok: false, reason: 'timeout' })
  for (const bad of [{ runId: '', userId: 'u', planLeadsLimit: 5 }, { runId: 'r', userId: '', planLeadsLimit: 5 }, { runId: 'r', userId: 'u', planLeadsLimit: 0 }, { runId: 'r', userId: 'u', planLeadsLimit: 2.5 }]) {
    assert.deepEqual(await authorizeResearchRun({ rpc: async () => { throw new Error('must not be called') } }, bad), { ok: false, reason: 'invalid' })
  }
})

test('research is "running" only when the environment switch AND the database switch are on and budgets exist', async () => {
  const database = (overrides = {}) => ({ rpc: async () => ({ data: { enabled: true, budgets_configured: true, ...overrides }, error: null }) })
  const on = { CI_RESEARCH_ENABLED: 'true' }
  assert.equal((await getEffectiveResearchStatus(database(), on)).running, true)
  assert.equal((await getEffectiveResearchStatus(database(), {})).running, false, 'environment switch off')
  assert.equal((await getEffectiveResearchStatus(database({ enabled: false }), on)).running, false, 'database switch off')
  assert.equal((await getEffectiveResearchStatus(database({ budgets_configured: false }), on)).running, false, 'no budget configured: fail closed')
  assert.equal((await getEffectiveResearchStatus({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, on)).running, false, 'unreadable: not running')
  assert.equal((await getEffectiveResearchStatus({ rpc: async () => { throw new Error('down') } }, on)).running, false)
  assert.equal((await getEffectiveResearchStatus(null, on)).running, false)
})

// ---------------------------------------------------------------------------------------------
// The worker: run-scoped, cost-aware, switch-gated
// ---------------------------------------------------------------------------------------------

const item = (n) => ({ id: `q${n}`, lead_id: `l${n}`, status: 'processing', retry_count: 0, max_retries: 2, created_at: '', started_at: '', completed_at: null, last_error: null, last_retry_at: null, claim_token: `t${n}`, reserved_usd: 0.002 })

test('the worker reports each job\'s actual cost to its completion, and bills an unknowable cost at the reservation', async () => {
  const completions = []
  const result = await runBackgroundWorkerCore({}, {
    recover: async () => ({ resetCount: 0, failedCount: 0 }),
    claim: async () => [item(1), item(2)],
    enrich: async (leadId) => {
      if (leadId === 'l2') throw new Error('website hung until the deadline')
      return { success: true, ci_enrichment_status: 'completed', website_snapshot: { s: 1 }, business_signals: { g: 1 }, commercial_profile: { summary: 'A real profile.' }, ci_last_error: null, ci_cost_estimate: 0.0006 }
    },
    complete: async (_client, job, _s, _g, _p, success, _error, cost) => { completions.push({ id: job.id, success, cost }); return { ok: true, nextStatus: success ? 'enrichment_completed' : 'retry_pending' } },
  }, { researchEnabled: true, batchSize: 5, concurrency: 1 })
  assert.deepEqual(completions, [{ id: 'q1', success: true, cost: 0.0006 }, { id: 'q2', success: false, cost: 0.002 }])
  assert.equal(result.completed, 1)
  assert.equal(result.retrying, 1)
})

test('one tick keeps a customer\'s run moving: several rounds inside the time budget, each sized to what can still finish', async () => {
  let clock = 0
  let remaining = 25
  let nextId = 0
  const asked = []
  const processed = []
  const result = await runBackgroundWorkerCore({}, {
    recover: async () => ({ resetCount: 0, failedCount: 0 }),
    // the database caps one customer at 4 running jobs per claim; 20 seconds pass between rounds
    claim: async (_client, limit) => {
      asked.push(limit)
      const take = Math.min(limit, 4, remaining)
      remaining -= take
      clock += 20_000
      return Array.from({ length: take }, () => item(++nextId))
    },
    enrich: async (leadId) => ({ success: true, ci_enrichment_status: 'completed', website_snapshot: { s: 1 }, business_signals: { g: 1 }, commercial_profile: { summary: `Profile ${leadId}` }, ci_last_error: null, ci_cost_estimate: 0.0005 }),
    complete: async (_client, job) => { processed.push(job.id); return { ok: true, nextStatus: 'enrichment_completed' } },
  }, { researchEnabled: true, batchSize: 12, concurrency: 4, maxRounds: 20, now: () => clock })
  assert.equal(result.claimed, 25, 'all 25 profiles fit in one tick (7 rounds of up to 4 at 20 s each)')
  assert.equal(result.completed, 25)
  assert.equal(new Set(processed).size, 25)
  assert.ok(asked.every((limit) => limit >= 1 && limit <= 12))
  // a round starts only while one whole job still fits before the tick ends
  assert.ok(clock <= 240_000 - 65_000 + 20_000)
})

test('later rounds never claim more than the remaining budget can finish, and rounds stop when nothing is claimed', async () => {
  let clock = 0
  const asked = []
  await runBackgroundWorkerCore({}, {
    recover: async () => ({ resetCount: 0, failedCount: 0 }),
    claim: async (_client, limit) => { asked.push(limit); clock += 100_000; return [item(asked.length)] },
    enrich: async () => ({ success: false, ci_enrichment_status: 'failed', website_snapshot: null, business_signals: null, commercial_profile: null, ci_last_error: 'x', ci_cost_estimate: 0 }),
    complete: async () => ({ ok: true, nextStatus: 'retry_pending' }),
  }, { researchEnabled: true, batchSize: 20, concurrency: 4, maxRounds: 20, tickBudgetMs: 240_000, now: () => clock })
  // round 1 at t=0 (full budget); round 2 at t=100 s (140 s left: 2 waves of 4 = 8 jobs); round 3 at t=200 s: only 40 s left, less than one job: stop
  assert.equal(asked.length, 2)
  assert.ok(asked[1] <= 8, `round 2 asked for ${asked[1]}`)
  const empty = []
  await runBackgroundWorkerCore({}, { recover: async () => ({ resetCount: 0, failedCount: 0 }), claim: async () => { empty.push(1); return [] }, enrich: async () => ({}), complete: async () => ({ ok: true }) }, { researchEnabled: true, maxRounds: 20 })
  assert.equal(empty.length, 1, 'nothing claimed: one claim, no spinning')
  // the default stays one round, so existing behaviour is unchanged
  let defaultCalls = 0
  await runBackgroundWorkerCore({}, { recover: async () => ({ resetCount: 0, failedCount: 0 }), claim: async () => { defaultCalls += 1; return [item(1)] }, enrich: async () => ({ success: true, ci_enrichment_status: 'completed', website_snapshot: {}, business_signals: {}, commercial_profile: { summary: 'x' }, ci_last_error: null, ci_cost_estimate: 0 }), complete: async () => ({ ok: true, nextStatus: 'enrichment_completed' }) }, { researchEnabled: true })
  assert.equal(defaultCalls, 1)
})

test('the environment switch still stops a tick before any database call; a disabled database switch is enforced inside claim', async () => {
  const calls = []
  const deps = { recover: async () => { calls.push('recover'); return { resetCount: 0, failedCount: 0 } }, claim: async () => { calls.push('claim'); return [] }, enrich: async () => ({}), complete: async () => ({ ok: true }) }
  const off = await runBackgroundWorkerCore({}, deps, { researchEnabled: false })
  assert.equal(off.disabled, true)
  assert.deepEqual(calls, [])
  const queueManager = read('lib/commercial-intelligence/queue-manager.ts')
  assert.match(queueManager, /Returns nothing while research is off or a budget is missing/)
})

test('the only worker is run-scoped; no application code can reach the old pending-queue claim', () => {
  const worker = read('lib/commercial-intelligence/background-worker.ts')
  assert.match(worker, /claim: claimRunItems/)
  assert.match(worker, /recover: recoverRunItems/)
  assert.match(worker, /complete: completeRunItem/)
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(relative, out)
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative)
    }
    return out
  }
  for (const file of [...walk('app'), ...walk('lib'), ...walk('components')]) {
    const source = read(file)
    assert.ok(!/claim_ci_queue_items_worker|reset_stale_ci_processing_worker|complete_ci_enrichment_worker/.test(source), `${file} uses the old worker RPCs`)
    assert.ok(!/worker_eligible\s*[:=]\s*true|\.update\([^)]*worker_eligible/.test(source.replace(/\/\/.*$/gm, '')), `${file} sets worker_eligible`)
  }
})

// ---------------------------------------------------------------------------------------------
// Discover: unchanged unless authorization is on, and never in the way of the results
// ---------------------------------------------------------------------------------------------

test('Discover authorizes only after the results were sent, only when enabled, never for guests, and never throws into the stream', () => {
  const route = read('app/api/scrape/route.ts')
  const resultEmit = route.indexOf("emit({ type: 'result', payload: resultPayload })")
  const authorize = route.indexOf('authorizeResearchRun(createAdminClient()')
  assert.ok(resultEmit > 0 && authorize > resultEmit, 'authorization comes after the result event')
  const guard = route.slice(route.lastIndexOf('if (isRunAuthorizationEnabled()', authorize), authorize)
  assert.match(guard, /!isGuestMode/)
  assert.match(guard, /config\.accounting/)
  assert.match(guard, /finalResult\.addedCount > 0/)
  assert.match(route, /type: 'intelligence'/)
  // with the flag off the previous per-lead handoff is exactly as before, and with it on it is skipped
  assert.match(route, /if \(!isRunAuthorizationEnabled\(\)\) \{\s*try \{\s*const queued = await enqueueLeadEnrichment\(outcome\.id, supabase, \{ workerEligible: false \}\)/)
  // research is never started from the Discover request
  assert.ok(!/runCommercialIntelligenceWorker|enrichLeadDirect|claimRunItems/.test(route))
  // the save itself is untouched
  assert.match(route, /saveDiscoverResults\(createAdminClient\(\)/)
  assert.match(route, /getDiscoverCapacity\(createAdminClient\(\), user\.id, leadsLimit, monthly\)/)
})

test('the stored authorization result is the receipt\'s: the application never names lead ids', () => {
  const authorization = read('lib/commercial-intelligence/run-authorization.ts')
  assert.ok(!/p_lead_ids|leadIds|lead_ids/.test(authorization))
  const proposal = read('supabase/proposed/20261016_ci_phase1_run_scoped.sql')
  assert.match(proposal, /FROM public\.discover_save_receipts WHERE run_id = p_run_id/)
  assert.match(proposal, /o->>'status' = 'saved'/)
  assert.ok(!/worker_eligible = true|SET worker_eligible/.test(proposal.replace(/--.*$/gm, '')), 'the proposal never sets the broad flag')
})

// ---------------------------------------------------------------------------------------------
// Routes and pages
// ---------------------------------------------------------------------------------------------

test('customer routes read only their own run and cannot start, claim or retry research', () => {
  const progress = read('app/api/research/runs/[runId]/route.ts')
  assert.ok(!/export (async )?function (POST|PUT|PATCH|DELETE)/.test(progress), 'the progress route is read-only')
  assert.match(progress, /\(supabase as any\)\.rpc\('get_ci_run_progress'/)
  assert.ok(!/claim_ci|authorize_ci|complete_ci|recover_ci|set_ci_research/.test(progress))
  assert.match(progress, /getUserProfile\(\)/)
  assert.match(progress, /Cache-Control': 'no-store'/)

  const cancel = read('app/api/research/runs/[runId]/cancel/route.ts')
  assert.match(cancel, /p_user_id: profile\.id/, 'the customer is the authenticated one, never a request value')
  assert.ok(!/request\.json|await request/.test(cancel), 'nothing from the body is trusted')

  const control = read('app/api/admin/research-control/route.ts')
  assert.ok(control.indexOf('isAdmin(profile)') < control.indexOf('set_ci_research_enabled'))
  assert.equal((control.match(/isAdmin\(profile\)/g) || []).length, 2, 'both GET and POST are admin-only')
})

test('the third stage and rows: real state only, A2.3 wording when no run is followed, honest facts-versus-AI layout', () => {
  const rail = read('components/scraper/EngineRail.tsx')
  assert.match(rail, /name="Business Profiles"/, 'A2.3 wording kept')
  assert.match(rail, /value="Not included in this search"/)
  assert.match(rail, /intelligence\.phase === 'complete' \? 'complete' : intelligence\.live \? 'active' : 'upcoming'/)
  const page = read('app/dashboard/scraper/page.tsx')
  assert.match(page, /intelligence=\{research\?\.stage \?\? null\}/)
  assert.match(page, /enabled: isAuthenticated && !privatePreview/)
  const results = read('components/scraper/ResultsIndex.tsx')
  for (const required of ['From their website', 'Written by AI', 'How this profile was built', 'rel="noopener noreferrer"']) assert.ok(results.includes(required), required)
  assert.ok(!/competitive/i.test(results + read('lib/intelligence/run-progress.ts').replace(/\/\/.*$/gm, '').replace(/\* .*$/gm, '').replace(/competitive_advantage[^\n]*\n/g, '')))
  for (const file of ['components/scraper/useResearchProgress.ts', 'components/scraper/EngineRail.tsx', 'lib/intelligence/run-progress.ts']) {
    assert.ok(!/Math\.random|setInterval|requestAnimationFrame/.test(read(file)), `${file} fabricates or animates progress`)
  }
})

test('the progress hook only reads, pauses when hidden, and stops when everything is resolved', () => {
  const hook = read('components/scraper/useResearchProgress.ts')
  assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(hook))
  assert.match(hook, /\/api\/research\/runs\//)
  assert.match(hook, /document\.hidden/)
  assert.match(hook, /visibilitychange/)
  assert.match(hook, /phase === 'complete' \|\| phase === 'stopped'/)
  assert.match(hook, /controller\?\.abort\(\)/)
})

test('My Leads stays read-only, shows a real profile state per lead, and offers a "Profile ready" filter', () => {
  const page = read('app/dashboard/my-leads/page.tsx')
  assert.match(page, /deriveLeadProfileState\(lead, jobByLead\.get\(lead\.id\)\)/)
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(page), 'the page performs no writes and calls no function')
  assert.match(page, /\.not\('run_id', 'is', null\)/, 'historical jobs are not even read as progress')
  const client = read('app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx')
  assert.match(client, /Profile ready/)
  assert.match(client, /LEAD_PROFILE_LABEL\[lead\.profile_state \?\? 'not_started'\]/)
  assert.ok(!/fetch\(\s*['"`]\/api\/(leads\/process|research|admin)/.test(client))
})

test('the operator guide documents both switches, the budgets, the lifecycle and the rollback', () => {
  const guide = read('docs/b2-phase1-run-scoped-intelligence.md')
  for (const required of ['CI_RUN_AUTHORIZATION_ENABLED', 'CI_RESEARCH_ENABLED', 'set_ci_research_enabled', '/api/admin/research-control', 'per_profile_ceiling_usd', 'run_id', 'rollback', 'historical', 'allowed_user_ids', 'disable.sql']) {
    assert.ok(guide.includes(required), required)
  }
})

// ---------------------------------------------------------------------------------------------
// Release review: the screens, the review fixtures, the runbooks
// ---------------------------------------------------------------------------------------------

const REFILL = REPLAY_SCENARIOS.find((scenario) => scenario.id === 'refill')

test('the review fixtures drive the real stage logic: each mocked mode reads exactly as the product would', () => {
  const stage = (mode, poll = 0) => buildReplayResearchResponse(REFILL.leads, mode, poll).stage
  assert.deepEqual([stage('disabled').phase, stage('disabled').headline], ['not_running', 'Business Intelligence is not currently running'])
  assert.equal(stage('queued').phase, 'preparing')
  assert.equal(stage('progress').headline, 'Research in progress')
  assert.equal(stage('complete').phase, 'complete')
  assert.equal(stage('mixed').phase, 'complete')
  assert.match(stage('mixed').detail, /2 could not be completed/)
  // the lead without a website is unavailable in every mode, never "queued" or "researching"
  const noSite = REFILL.leads.findIndex((lead) => !lead.website)
  assert.ok(noSite >= 0)
  for (const mode of ['queued', 'progress', 'complete', 'live']) assert.equal(buildReplayResearchResponse(REFILL.leads, mode, 2).rows[noSite].state, 'unavailable')
  // "live" advances only by polls: it never completes by itself or jumps ahead
  const first = buildReplayResearchResponse(REFILL.leads, 'live', 1)
  const later = buildReplayResearchResponse(REFILL.leads, 'live', 3)
  assert.ok(later.summary.ready > first.summary.ready)
  assert.equal(buildReplayResearchResponse(REFILL.leads, 'live', 99).stage.phase, 'complete')
  // a ready row carries its profile; the others carry none
  const complete = buildReplayResearchResponse(REFILL.leads, 'complete')
  assert.equal(Object.keys(complete.profiles).length, complete.summary.ready)
  const rows = withIntelligence(REFILL.leads.map((lead) => ({ id: lead.id, synopsis: 'old' })), complete.rows, complete.profiles)
  assert.equal(rows.find((row) => row.intelligence.state === 'ready').synopsis, null, 'the older one-line synopsis yields to the profile block')
  assert.equal(withIntelligence([{ id: 'x', synopsis: 'kept' }], null, null)[0].synopsis, 'kept', 'no run, no change')
})

test('the Results line agrees with Stage 03 while a run is followed, and is unchanged otherwise', () => {
  const stage = (spec, running) => describeIntelligence(summarizeRun(rows(spec), NOW), running)
  assert.equal(describeProfileNote(null), null)
  assert.match(describeProfileNote(stage({ ready: 2, queued: 3 }, true)), /appear here as they are ready/)
  assert.match(describeProfileNote(stage({ queued: 5 }, false)), /not currently running/)
  assert.match(describeProfileNote(stage({ ready: 5 }, true)), /written from each business's own website/)
  assert.ok(!/available separately/i.test(describeProfileNote(stage({ ready: 5 }, true))))
  assert.match(read('app/dashboard/scraper/page.tsx'), /describeProfileNote\(research\?\.stage\) \?\? profileNote/)
})

test('review-only pages answer 404 outside development and are imported by nothing in production', () => {
  for (const file of ['app/dashboard/intelligence-preview/page.tsx', 'app/dashboard/discover-replay/page.tsx']) {
    assert.match(read(file), /process\.env\.NODE_ENV !== 'development'\)\s*\{?\s*notFound\(\)/, file)
  }
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(relative, out)
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative)
    }
    return out
  }
  for (const file of [...walk('app'), ...walk('lib'), ...walk('components')]) {
    if (/replay-intelligence|ReplayStudio|intelligence-preview/.test(file)) continue
    const source = read(file)
    assert.ok(!/replay-intelligence/.test(source), `${file} imports the review fixture`)
    if (!/discover-replay\/page\.tsx$/.test(file)) assert.ok(!/ReplayStudio/.test(source), `${file} imports the replay studio`)
  }
  assert.ok(!/fetch\(|supabase|rpc\(/.test(read('app/dashboard/intelligence-preview/page.tsx').replace(/\/\/.*$/gm, '')), 'the fixture page makes no request')
  assert.ok(!/\.\/(route|api)|XMLHttpRequest/.test(read('lib/scraper/replay-intelligence.ts')))
})

test('My Leads no longer invites an analysis it cannot start, and says what is true for each state', () => {
  const client = read('app/dashboard/my-leads/MyLeadsWorkspaceClient.tsx')
  assert.ok(!/Analyze this business|Ready for Commercial Intelligence/.test(client))
  for (const text of ['Business profile queued.', 'Business profile in progress.', 'Business profile will be retried.', "Business profile couldn't be completed.", 'Business profile stopped.']) {
    assert.ok(client.includes(text), text)
  }
})

test('the third rail label fits a phone: smaller tracking below the sm breakpoint', () => {
  assert.match(read('components/scraper/EngineRail.tsx'), /text-\[10px\] font-medium uppercase tracking-\[0\.14em\] sm:text-xs sm:tracking-\[0\.2em\]/)
})

test('the owner-test runbook fixes the limits, the order, the verification and the stop conditions', () => {
  const guide = read('docs/b2-phase1-owner-live-test.md')
  for (const required of ['max_leads_per_run', '**10**', '**0.05**', '**0.25**', 'set_ci_research_access', 'set_ci_research_limits', 'normal **Discover** page',
    'not** the private preview', 'CRON_SECRET', 'There is no scheduler', '50be1c1e9e0f94070a41c88785376966', 'Stop immediately', 'Pass criteria', 'disable.sql']) {
    assert.ok(guide.includes(required), required)
  }
  // the worst case the limits allow is below the run cap
  assert.ok(10 * 2 * 0.002 <= 0.05)
  const plan = read('docs/b2-phase1-deployment-plan.md')
  for (const required of ['20261016_ci_phase1_run_scoped.sql', 'Compatibility matrix', 'Emergency stop and undo', 'teardown_unused', 'never restores the old FIFO claim', 'dpl_4ktutLabGAfwt3Dscw5fnE8Yw2HV', 'permission denied']) {
    assert.ok(plan.includes(required), required)
  }
})
