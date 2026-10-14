// Phase 8 regression tests: invalid-output handling, the internal repair, the customer retry, honest statuses, expired runs,
// budget alerts, entitlements, and keeping leads after a plan change. The spend engine itself is in ci-spend-engine.test.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { evaluateBudget, readMonthlyBudget } from '../lib/commercial-intelligence/budget-alerts.ts'
import {
  generateProfileFromEvidence,
  isThinEvidence,
  validateCommercialProfileResponse,
} from '../lib/commercial-intelligence/commercial-profile-core.ts'
import { findUnsupportedClaim } from '../lib/commercial-intelligence/evidence-grounding.ts'
import { requeueFailedItem } from '../lib/commercial-intelligence/retry-run-item.ts'
import { isEntitledToAutomaticResearch } from '../lib/commercial-intelligence/research-entitlement.ts'
import { reconcileExpiredRuns } from '../lib/commercial-intelligence/run-reconciliation.ts'
import { audienceFor, describeResearchAvailability } from '../lib/intelligence/availability.ts'
import { isRecoverableFailure, RETRY_REFUSAL_TEXT, retryVerdict } from '../lib/intelligence/retry-eligibility.ts'
import { deriveLeadProfileState, toProfileReason } from '../lib/intelligence/run-progress.ts'
import { memberDossierModel } from '../lib/my-leads/dossier-model.ts'
import { fetchLeadDossier, fetchLeadPage, parseListParams } from '../lib/my-leads/list.ts'
import { createFakeClient } from './helpers/fake-postgrest.mjs'

const read = (file) => fs.readFileSync(file, 'utf8')
const words = (n, base = 'word') => Array.from({ length: n }, (_, i) => `${base}${i % 7}`).join(' ')

const snapshot = (text) => ({
  title: 'Example Co', meta_description: null, h1: 'Example Co', body_excerpt: text, contact_url: null, about_url: null, services_url: null,
  visible_email: null, visible_phone: null, social_links: {}, html_hash: 'h', extracted_at: new Date(0).toISOString(),
  research_pages: [{ kind: 'homepage', url: 'https://example.com/', text }], source_urls: ['https://example.com/'],
})
const signals = { has_https: true, has_contact_page: true, has_about_page: false, has_services_page: true, has_pricing: false, has_testimonials: false, has_blog: false, has_faq: false, has_booking_link: false, has_social_links: false, has_visible_email: false, has_visible_phone: false, detected_at: new Date(0).toISOString() }
const summaryOf = (n) => Array.from({ length: n }, (_, i) => `filtration${i % 5}`).join(' ')
const answer = (summary) => JSON.stringify({ summary, industry: 'x', business_category: '', primary_service: '', core_services: [], target_customer: '', competitive_advantage: '', keywords: [] })
const THIN = 'Atelier Dubois restores antique furniture in Quebec City. The workshop repairs chairs, tables and cabinets and refinishes wood surfaces by hand for private clients and collectors. It also offers upholstery, gilding and French polishing for heirloom pieces.' // ~40 words
const RICH = Array.from({ length: 40 }, (_, i) => `Example Co manufactures filtration housings for laboratories, line ${i}.`).join(' ')

// ----------------------------------------------------------------------------------------------- A. output validation and repair
test('valid and invalid output: length bounds by evidence, reason codes, never the rejected text', () => {
  assert.equal(validateCommercialProfileResponse(answer(summaryOf(55))).ok, true)
  assert.deepEqual(validateCommercialProfileResponse(answer(summaryOf(30))), { ok: false, code: 'too_short', words: 30 })
  assert.equal(validateCommercialProfileResponse(answer(summaryOf(30)), { minWords: 25 }).ok, true, 'a thin site may have a shorter synopsis')
  assert.deepEqual(validateCommercialProfileResponse(answer(summaryOf(24)), { minWords: 25 }), { ok: false, code: 'too_short', words: 24 })
  assert.equal(validateCommercialProfileResponse(answer(Array(95).fill('data').join(' '))).code, 'too_long')
  assert.equal(validateCommercialProfileResponse('not json at all').code, 'not_json')
  assert.equal(validateCommercialProfileResponse('{"summary": ').code, 'not_json')
})

test('no invented facts: figures and addresses must come from the website text, in any number format', () => {
  const evidence = 'We have helped 4 500 business leaders since 2012. Write to hello@example.com or visit https://example.com/about.'
  assert.equal(findUnsupportedClaim('Helped more than 4,500 business leaders since 2012.', evidence), null, '4,500 and 4 500 are the same figure')
  assert.equal(findUnsupportedClaim('Helped more than 9,000 business leaders.', evidence), 'unsupported_figure')
  assert.equal(findUnsupportedClaim('Founded in 1998 by two partners.', evidence), 'unsupported_figure')
  assert.equal(findUnsupportedClaim('Reach them at sales@other.com.', evidence), 'unsupported_address')
  assert.equal(findUnsupportedClaim('Contact hello@example.com.', evidence), null)
  assert.equal(findUnsupportedClaim('Offers 3 locations.', 'We have several locations.'), null, 'a single-digit count is not treated as a hard fact')
  // a French site summarised in English is fine: no word-overlap rule
  assert.equal(findUnsupportedClaim('A dental clinic offering whitening and implants.', 'Clinique dentaire: blanchiment et implants.'), null)
  const verdict = validateCommercialProfileResponse(answer(`${summaryOf(54)} 7777`), { evidence: RICH })
  assert.equal(verdict.code, 'unsupported_figure')
})

test('thin evidence: a shorter factual synopsis is allowed, and only for thin evidence', async () => {
  assert.equal(isThinEvidence(snapshot(THIN)), true); assert.equal(isThinEvidence(snapshot(RICH)), false)
  const prompts = []
  const thin = await generateProfileFromEvidence('https://example.com', snapshot(THIN), signals, async (prompt) => { prompts.push(prompt); return { content: answer(`${THIN} Reach the workshop through its website for details.`.split(' ').slice(0, 32).join(' ')), inputTokens: 300, outputTokens: 60 } })
  assert.equal(thin.ok, true); assert.equal(thin.calls, 1)
  assert.match(prompts[0], /25-60 words/); assert.match(prompts[0], /never add words to reach a length/)
  const rich = await generateProfileFromEvidence('https://example.com', snapshot(RICH), signals, async () => ({ content: answer(summaryOf(30)) }), { repairCostCeilingUsd: 0 })
  assert.equal(rich.ok, false, 'a rich site still needs the full synopsis')
})

test('the internal repair: at most one extra call, on the same text, reason only, costs added up', async () => {
  const prompts = []
  const script = [answer(summaryOf(20)), answer(summaryOf(55))]
  const fixed = await generateProfileFromEvidence('https://example.com', snapshot(RICH), signals, async (prompt) => { prompts.push(prompt); return { content: script[prompts.length - 1], inputTokens: 500, outputTokens: 80 } })
  assert.equal(fixed.ok, true); assert.equal(fixed.calls, 2); assert.equal(fixed.inputTokens, 1000); assert.equal(fixed.outputTokens, 160, 'both calls are counted for spend')
  assert.match(prompts[1], /previous answer was rejected because its summary had 20 words, fewer than the 50-80 required/)
  assert.doesNotMatch(prompts[1], /filtration0 filtration1/, 'the rejected answer is never sent back')
  assert.equal(prompts[1].split('Example Co manufactures filtration housings').length, prompts[0].split('Example Co manufactures filtration housings').length, 'the same website text, no new fetch')

  let calls = 0
  const failed = await generateProfileFromEvidence('https://example.com', snapshot(RICH), signals, async () => { calls += 1; return { content: answer(summaryOf(20)), inputTokens: 500, outputTokens: 80 } })
  assert.equal(failed.ok, false); assert.equal(calls, 2, 'never a third call'); assert.equal(failed.error.code, 'INVALID_RESPONSE')
  assert.match(failed.error.message, /^profile_rejected:too_short:20w:calls=2$/)
  assert.equal(failed.outputTokens, 160)
})

test('the repair never runs when the cost would pass its ceiling, nor for insufficient evidence, nor after a good first answer', async () => {
  let calls = 0
  const expensive = await generateProfileFromEvidence('https://example.com', snapshot(RICH), signals, async () => { calls += 1; return { content: answer(summaryOf(20)), inputTokens: 5000, outputTokens: 400 } })
  assert.equal(expensive.ok, false); assert.equal(calls, 1, 'two calls this size would not fit the per-job reservation')
  calls = 0
  const none = await generateProfileFromEvidence('https://example.com', snapshot('Tiny.'), signals, async () => { calls += 1; return { content: '{}' } })
  assert.equal(none.ok, false); assert.equal(calls, 0)
  calls = 0
  const first = await generateProfileFromEvidence('https://example.com', snapshot(RICH), signals, async () => { calls += 1; return { content: answer(summaryOf(55)) } })
  assert.equal(first.ok, true); assert.equal(calls, 1)
})

test('diagnostics hold a reason code and a word count, never website text or model output', async () => {
  const secret = 'zebrasecretmarker'
  const result = await generateProfileFromEvidence('https://example.com', snapshot(`${RICH} ${secret}`), signals, async () => ({ content: answer(`${secret} ${secret}`), inputTokens: 100, outputTokens: 20 }))
  assert.equal(result.ok, false)
  assert.doesNotMatch(JSON.stringify(result.error), new RegExp(secret))
  assert.match(result.error.message, /^profile_rejected:[a-z_]+:\d+w:calls=\d$/)
})

// ----------------------------------------------------------------------------------------------- B. customer retry
const base = {
  jobStatus: 'failed', lastError: 'Website request timed out', retryCount: 1, maxRetries: 1, runMaxAttempts: 1, claimed: false, runStatus: 'active',
  runExpiresAt: '2999-01-01T00:00:00Z', allowed: true, perJobReserve: 0.002, profileCeiling: 0.004,
  spent: { profile: 0.0004, run: 0.01, customerMonth: 0.01, globalMonth: 0.01 }, limits: { run: 0.05, customerMonth: 0.12, globalMonth: 10 },
}
const verdict = (patch) => retryVerdict({ ...base, ...patch, spent: { ...base.spent, ...(patch.spent ?? {}) } })

test('one customer retry after the run\'s attempts are used; never a second; never for a failure a retry cannot fix', () => {
  assert.deepEqual(verdict({}), { ok: true, grant: true })
  assert.equal(verdict({ maxRetries: 2, retryCount: 2 }).reason, 'attempts', 'the granted retry was used')
  for (const lastError of ['Website returned HTTP 404', 'Website returned HTTP 403', 'Website response exceeded the size limit', 'certificate has expired', 'The website did not provide enough readable business information for a factual synopsis', 'profile_budget_exhausted']) {
    assert.equal(verdict({ lastError }).reason, 'not_recoverable', lastError)
  }
  for (const lastError of ['Website request timed out', 'Failed to fetch website: https://x.test/', 'profile_rejected:too_short:20w:calls=2', 'Research interrupted and attempts exhausted']) {
    assert.equal(isRecoverableFailure(lastError), true, lastError)
  }
  assert.equal(verdict({ allowed: false }).reason, 'not_allowed')
  assert.equal(verdict({ runStatus: 'cancelled' }).reason, 'cancelled')
})

test('a retry is budget-checked like any attempt: ceiling, run, customer month, global', () => {
  assert.equal(verdict({ spent: { profile: 0.0021 } }).reason, 'budget', '0.0021 + 0.002 is over the $0.004 ceiling')
  assert.deepEqual(verdict({ spent: { profile: 0.002 } }), { ok: true, grant: true }, 'exactly at the ceiling is allowed')
  assert.equal(verdict({ spent: { run: 0.049 } }).reason, 'budget')
  assert.equal(verdict({ spent: { customerMonth: 0.119 } }).reason, 'budget')
  assert.equal(verdict({ spent: { globalMonth: 9.999 } }).reason, 'budget')
})

test('the re-queue raises only the one job\'s ceiling, clears the cool-down, and the messages are accurate', async () => {
  const calls = []
  const chain = { update(v) { calls.push(v); return chain }, eq() { return chain }, is() { return chain }, select: async () => ({ data: [{ id: 'q' }], error: null }) }
  const admin = { from: () => chain }
  await requeueFailedItem(admin, { runId: 'r', leadId: 'l', userId: 'u', queueId: 'q', retryCount: 1, grant: true })
  assert.equal(calls[0].max_retries, 2); assert.equal(calls[0].last_retry_at, null); assert.equal(calls[0].status, 'pending')
  assert.ok(!('retry_count' in calls[0]), 'the attempt counter is never reset')
  await requeueFailedItem(admin, { runId: 'r', leadId: 'l', userId: 'u', queueId: 'q', retryCount: 1 })
  assert.ok(!('max_retries' in calls[1]), 'without a grant the ceiling is untouched')
  assert.match(RETRY_REFUSAL_TEXT.attempts, /already been retried once/); assert.doesNotMatch(RETRY_REFUSAL_TEXT.attempts, /both/)
  assert.match(RETRY_REFUSAL_TEXT.not_recoverable, /trying again would not help/)
  const retry = read('app/api/research/runs/[runId]/retry/route.ts')
  assert.doesNotMatch(retry, /leads_used|get_discover_capacity|increment_|usage/, 'a retry never touches the lead allowance')
  assert.match(retry, /grant: decision\.grant/)
})

// ----------------------------------------------------------------------------------------------- C. honest statuses and entitlements
test('plan-aware availability: guest, free member and paying member', () => {
  const guest = describeResearchAvailability({ audience: audienceFor({ isGuest: true, paidAccess: false }), searchSettled: true, authorized: false })
  assert.equal(guest.rail.value, 'Ready to explore')
  const free = describeResearchAvailability({ audience: audienceFor({ isGuest: false, paidAccess: false }), searchSettled: true, authorized: false })
  assert.match(free.rail.value, /paid plans/); assert.match(free.note, /saved businesses, and any profile already written, stay available/)
  const paidActive = describeResearchAvailability({ audience: audienceFor({ isGuest: false, paidAccess: true }), searchSettled: true, authorized: true })
  assert.equal(paidActive.rail, null, 'the real research stage speaks for itself')
  const paidWaiting = describeResearchAvailability({ audience: 'paid_member', searchSettled: false, authorized: false })
  assert.equal(paidWaiting.rail.value, 'Follows your search')
  const paidInactive = describeResearchAvailability({ audience: 'paid_member', searchSettled: true, authorized: false })
  assert.equal(paidInactive.rail.value, 'Included in your plan'); assert.match(paidInactive.note, /nothing has been used/)
  for (const result of [paidWaiting, paidInactive]) assert.doesNotMatch(JSON.stringify(result), /separately|purchase|buy|upgrade|extra|add-on/i, 'a paying customer is never told to buy research')
})

test('the Discover rail uses the plan-aware wording, and the legacy sentence only remains as a last-resort default', () => {
  const page = read('app/dashboard/scraper/page.tsx')
  assert.match(page, /describeResearchAvailability\(/); assert.match(page, /availability=\{researchAvailability\.rail\}/)
  const rail = read('components/scraper/EngineRail.tsx')
  assert.ok(rail.indexOf('availability ?') < rail.indexOf('Available separately'))
})

test('five honest states, plus expired and unreadable reasons', () => {
  const lead = { commercial_profile: null, website: 'https://x.test' }
  const job = (status, extra = {}) => ({ status, retry_count: 0, last_error: null, run_id: 'r', ...extra })
  assert.equal(deriveLeadProfileState(lead, job('pending')), 'queued')
  assert.equal(deriveLeadProfileState(lead, job('processing')), 'researching')
  assert.equal(deriveLeadProfileState({ commercial_profile: { summary: 'Done.' } }, job('completed')), 'ready')
  assert.equal(deriveLeadProfileState(lead, job('failed', { last_error: 'Website request timed out' })), 'failed')
  assert.equal(deriveLeadProfileState({ commercial_profile: null, website: null }, null), 'unavailable')
  assert.equal(deriveLeadProfileState(lead, job('failed', { last_error: 'run expired' })), 'unavailable', 'an expired run is not a failure')
  assert.equal(toProfileReason('unavailable', 'run expired'), 'expired')
  assert.equal(toProfileReason('failed', 'Website returned HTTP 404'), 'unreadable')
  assert.equal(toProfileReason('failed', 'Website request timed out'), 'research_failed')
  assert.equal(toProfileReason('failed', 'run_budget_exhausted'), 'budget')
})

test('a free member sees the plan note on a business without a profile; a paying customer keeps the neutral wording; a saved profile always shows', () => {
  const lead = (patch = {}) => ({
    id: 'x', company_name: 'Clinique', industry: 'Dentist', city: 'Laval', website: null, lightProfile: null,
    contact: { name: null, email: null, phone: null, website: 'https://x.test', source_url: null, email_source: null, email_confidence: null, is_generic_email: false },
    intelligence: { state: 'not_started', label: 'x', reason: null, researched_at: null, card: null, profile: null }, ...patch,
  })
  const free = memberDossierModel(lead({ researchNote: describeResearchAvailability({ audience: 'free_member', searchSettled: true, authorized: false }).note }))
  assert.match(free.what.empty, /included with paid plans/)
  const paid = memberDossierModel(lead())
  assert.match(paid.what.empty, /No business profile has been generated/); assert.doesNotMatch(paid.what.empty, /paid plans|separately/)
  const kept = memberDossierModel(lead({ researchNote: 'x', intelligence: { state: 'ready', label: 'r', reason: null, researched_at: null, card: { summary: 'Kept profile.', services: [], audience: null, facts: { signals: [], pagesRead: [], sources: [] }, limitations: [] }, profile: null } }))
  assert.equal(kept.what.ai.text, 'Kept profile.')
})

// ----------------------------------------------------------------------------------------------- entitlements and downgrade
test('entitlements: only guests reach the guest profile endpoint; research needs the operator allow-list, not the plan', () => {
  const profile = read('app/api/guest/profile/route.ts')
  assert.match(profile, /guestSession\(\)/); assert.doesNotMatch(profile, /commercial-intelligence|authorize_ci|plan/i)
  const dashboard = [...fs.readdirSync('components/my-leads')].map((file) => read(`components/my-leads/${file}`)).join('\n') + read('app/dashboard/scraper/page.tsx')
  assert.doesNotMatch(dashboard, /api\/guest\/profile/, 'members never call the guest generator')
  assert.match(read('lib/commercial-intelligence/run-authorization.ts'), /authorize_ci_research_run/)
  assert.doesNotMatch(read('app/api/research/runs/[runId]/retry/route.ts'), /allow_all_customers\s*[:=]\s*true/)
})

test('cancelling or downgrading never removes leads: the library and its profiles are read without any plan', async () => {
  const leads = [
    { id: 'a1', user_id: 'u', company_name: 'Kept One', industry: null, city: null, email: 'a@x.test', phone: null, website: 'https://a.test', status: 'inbox', pipeline_stage: null, closed_at: null, created_at: '2026-09-01T00:00:00Z', last_activity_at: null, commercial_profile: { summary: 'A saved profile.' }, website_snapshot: {}, business_signals: {}, website_facts: null, light_profile: null },
    { id: 'a2', user_id: 'u', company_name: 'Kept Two', industry: null, city: null, email: null, phone: '1', website: null, status: 'inbox', pipeline_stage: null, closed_at: null, created_at: '2026-09-02T00:00:00Z', last_activity_at: null, commercial_profile: null, website_snapshot: {}, business_signals: {}, website_facts: null, light_profile: null },
  ]
  const client = createFakeClient({ leads, commercial_intelligence_queue: [] })
  const page = await fetchLeadPage(client, 'u', parseListParams(new URLSearchParams('')).params)
  assert.equal(page.total, 2, 'a free-plan or lapsed account sees all of its leads')
  assert.equal((await fetchLeadDossier(client, 'u', 'a1')).intelligence.state, 'ready')
  assert.equal(fetchLeadPage.length <= 3 && fetchLeadDossier.length <= 3, true, 'no plan parameter exists to gate on')
  for (const file of ['lib/stripe/subscription.ts', 'lib/stripe.ts']) {
    if (fs.existsSync(file)) assert.doesNotMatch(read(file), /from\('leads'\)\s*\.(delete|update)/, `${file} never removes leads`)
  }
  const webhook = fs.existsSync('app/api/stripe/webhook/route.ts') ? read('app/api/stripe/webhook/route.ts') : ''
  assert.doesNotMatch(webhook, /from\('leads'\)\s*\.delete/)
})

// ----------------------------------------------------------------------------------------------- D. reconciliation and alerts
function fakeAdmin({ runs, jobs }) {
  const log = []
  const filter = []
  const api = {
    from(table) { filter.length = 0; filter.push(['from', table]); return api },
    select() { filter.push(['select']); return api },
    update(values) { filter.push(['update', values]); return api },
    eq(c, v) { filter.push(['eq', c, v]); return api },
    lt(c, v) { filter.push(['lt', c, v]); return api },
    in(c, v) { filter.push(['in', c, v]); return api },
    is(c, v) { filter.push(['is', c, v]); return api },
    limit() { return api },
    then(resolve) {
      const table = filter[0][1]
      const update = filter.find((f) => f[0] === 'update')
      if (table === 'ci_research_runs') return resolve({ data: runs, error: null })
      const targets = jobs.filter((j) => j.status === 'pending' && j.claim_token === null)
      log.push({ table, update: update?.[1], filters: filter.filter((f) => ['eq', 'in', 'is'].includes(f[0])).map((f) => f.slice(1).join('=')) })
      if (update) { targets.forEach((j) => Object.assign(j, update[1])); return resolve({ data: targets.map((j) => ({ id: j.id })), error: null }) }
      return resolve({ data: targets.map((j) => ({ id: j.id })), error: null })
    },
  }
  return { api, log }
}

test('expired-run reconciliation: dry run by default, closes only unstarted unclaimed jobs, repeatable', async () => {
  const jobs = [{ id: 'j1', status: 'pending', claim_token: null }, { id: 'j2', status: 'pending', claim_token: null }, { id: 'j3', status: 'processing', claim_token: 't' }, { id: 'j4', status: 'completed', claim_token: null }]
  const { api, log } = fakeAdmin({ runs: [{ run_id: 'r1' }], jobs })
  const dry = await reconcileExpiredRuns(api)
  assert.deepEqual(dry, { dryRun: true, expiredRuns: 1, jobsToClose: 2, jobsClosed: 0 })
  assert.ok(jobs.every((j) => j.status !== 'failed'), 'a dry run changes nothing')
  const real = await reconcileExpiredRuns(api, { dryRun: false })
  assert.deepEqual(real, { dryRun: false, expiredRuns: 1, jobsToClose: 2, jobsClosed: 2 })
  assert.deepEqual(jobs.map((j) => j.status), ['failed', 'failed', 'processing', 'completed'], 'running and finished jobs are untouched')
  assert.equal(jobs[0].last_error, 'run expired')
  assert.ok(log.at(-1).filters.includes('status=pending') && log.at(-1).filters.includes('claim_token='))
  assert.deepEqual(await reconcileExpiredRuns(api, { dryRun: false }), { dryRun: false, expiredRuns: 1, jobsToClose: 0, jobsClosed: 0 }, 'a second pass finds nothing')
  assert.deepEqual(await reconcileExpiredRuns(fakeAdmin({ runs: [], jobs }).api), { dryRun: true, expiredRuns: 0, jobsToClose: 0, jobsClosed: 0 })
})

test('reconciliation never touches leads, profiles, spend or allowances, and the route needs an admin and a confirmation', () => {
  const source = read('lib/commercial-intelligence/run-reconciliation.ts').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(source, /from\('leads'\)|ci_research_charges|rpc\(|usage|plan/)
  const route = read('app/api/admin/research-reconcile/route.ts')
  assert.match(route, /isAdmin\(profile\)/); assert.match(route, /confirm !== true|body\?\.confirm !== true/)
  const vercel = JSON.parse(read('vercel.json'))
  assert.equal(JSON.stringify(vercel).includes('reconcile'), false, 'not scheduled')
})

test('budget alerts at 50% and 80%: what is due is decided, nothing is sent or scheduled', async () => {
  assert.deepEqual([evaluateBudget({ spentUsd: 4.99, limitUsd: 10 }).level, evaluateBudget({ spentUsd: 4.99, limitUsd: 10 }).due], ['ok', []])
  const half = evaluateBudget({ spentUsd: 5, limitUsd: 10 })
  assert.deepEqual([half.level, half.due, half.crossed], ['notice', [50], [50]])
  const eighty = evaluateBudget({ spentUsd: 8.2, limitUsd: 10, notified: [50] })
  assert.deepEqual([eighty.level, eighty.due, eighty.crossed], ['warning', [80], [50, 80]])
  assert.match(eighty.message, /82% used/)
  assert.equal(evaluateBudget({ spentUsd: 8.2, limitUsd: 10, notified: [50, 80] }).due.length, 0, 'an alert already sent is not due again')
  const out = evaluateBudget({ spentUsd: 10.5, limitUsd: 10 })
  assert.equal(out.level, 'exhausted'); assert.match(out.message, /paused/)
  assert.equal(evaluateBudget({ spentUsd: 3, limitUsd: null }).percent, null, 'no configured limit is reported, not guessed')
  const rows = { ci_research_charges: [{ actual_usd: 0.0008, reserved_usd: 0.002 }, { actual_usd: null, reserved_usd: 0.002 }], ci_research_controls: { global_monthly_limit_usd: 10 } }
  const fake = { from: (table) => { const q = { select: () => q, gte: () => q, maybeSingle: async () => ({ data: rows[table], error: null }), then: (resolve) => resolve({ data: rows[table], error: null }) }; return q } }
  const budget = await readMonthlyBudget(fake)
  assert.ok(Math.abs(budget.spentUsd - 0.0028) < 1e-9, 'settled actual, else the reservation'); assert.equal(budget.limitUsd, 10)
  const route = read('app/api/admin/research-budget/route.ts')
  assert.match(route, /isAdmin\(profile\)/); assert.doesNotMatch(route.replace(/^\s*\/\/.*$/gm, ''), /POST|send|fetch\(|resend|email/i)
})

test('nothing in Phase 8 enables research for customers or changes the stored limits', () => {
  for (const file of ['lib/commercial-intelligence/budget-alerts.ts', 'lib/commercial-intelligence/run-reconciliation.ts', 'lib/intelligence/availability.ts']) {
    assert.doesNotMatch(read(file), /allow_all_customers|set_ci_research_|per_profile_ceiling_usd\s*[:=]\s*0\.0/, file)
  }
})

test('automatic research is a paid-plan entitlement, decided from the live subscription plan', () => {
  for (const plan of ['prospector', 'starter', 'pro', 'admin']) assert.equal(isEntitledToAutomaticResearch(plan), true, plan)
  for (const plan of ['free', '', null, undefined, 'guest', 'canceled']) assert.equal(isEntitledToAutomaticResearch(plan), false, String(plan))
  const route = read('app/api/scrape/route.ts')
  assert.match(route, /isRunAuthorizationEnabled\(\) && !isGuestMode && isEntitledToAutomaticResearch\(authenticatedPlan\)/)
  assert.match(route, /authenticatedPlan = subscription\.subscription_active \? subscription\.plan : 'free'/, 'a lapsed subscription resolves to free')
})
