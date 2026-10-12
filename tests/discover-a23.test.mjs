import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildLeadCsv } from '../lib/leads/csv.ts'
import { applyDiscoveryLog, applyProgressEvent, confirmDiscoveryResult, INITIAL_DISCOVERY_PROGRESS } from '../lib/scraper/discover-progress.ts'
import { buildEngineView, describeCheckSummary } from '../lib/scraper/engine-view.ts'
import { replayStateAt } from '../lib/scraper/replay.ts'
import { getReplayScenario } from '../lib/scraper/replay-fixture.ts'
import { getAccessibleResults } from '../lib/scraper/results-access.ts'
import {
  describeContacts,
  describeEmailStatus,
  describePossibleEmails,
  describeSettledNote,
  describeShown,
  EMAIL_WORDING,
  summarizeContacts,
  toResultRow,
} from '../lib/scraper/results-summary.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('app/dashboard/scraper/page.tsx')
const results = read('components/scraper/ResultsIndex.tsx')
const engine = read('components/scraper/DiscoverEngine.tsx')
const rail = read('components/scraper/EngineRail.tsx')

const SCENARIO = getReplayScenario('refill')
const viewAt = (t, requested = SCENARIO.requested) => {
  const state = replayStateAt(SCENARIO, t)
  return buildEngineView({
    progress: state.progress,
    timings: state.timings,
    nowMs: t,
    lastEventAt: state.lastEventAt,
    requestedCount: requested,
    businessType: SCENARIO.query,
    location: SCENARIO.location,
    running: state.running,
    holdMs: 0,
  })
}

// ---------------------------------------------------------------------------------------------
// 1. Counters: progress toward what was asked for, never the candidates the search looked at
// ---------------------------------------------------------------------------------------------

test('requested 25, discovered 27, 26 checks, 25 saved: the primary counters never exceed 25', () => {
  for (let t = 0; t <= SCENARIO.durationMs; t += 50) {
    const view = viewAt(t)
    assert.ok(view.foundSoFar <= 25, `foundSoFar at ${t}`)
    assert.ok(view.discover.count <= 25, `discover.count at ${t}`)
    assert.ok(view.enrich.done <= 25, `enrich.done at ${t}`)
    assert.ok(view.enrich.scope === null || view.enrich.scope <= 25, `enrich.scope at ${t}`)
    assert.ok(view.signals.total <= 25 && view.signals.checked <= 25, `signals at ${t}`)
  }
})

test('the raw numbers survive for the activity detail: 27 candidates, 26 website checks', () => {
  const end = viewAt(SCENARIO.durationMs)
  assert.equal(end.discover.candidates, 27)
  assert.equal(end.enrich.completed, 26)
  assert.equal(end.enrich.planned, 27)
  assert.equal(end.enrich.scope, 25)
  assert.equal(end.enrich.done, 25)
  assert.equal(end.enrich.extraCandidates, true)
  assert.equal(describeCheckSummary(end.enrich).startsWith('25 of 25 businesses checked.'), true)
})

test('discovery progress reads as real events toward the target (no interpolation)', () => {
  const mid = viewAt(2000)
  const real = replayStateAt(SCENARIO, 2000).progress.candidatesFound
  assert.equal(mid.foundSoFar, real)
  assert.ok(real > 0 && real < 25)
  assert.equal(mid.target, 25)
})

test('requested 10, returned 10: the counters match exactly', () => {
  let progress = ['📦 discovered: 10'].reduce(applyDiscoveryLog, INITIAL_DISCOVERY_PROGRESS)
  progress = applyProgressEvent(progress, { type: 'progress', stage: 'checking', planned: 10, completed: 7, emailsFound: 3, possibleEmails: 1, sequence: 1 })
  const view = buildEngineView({ progress, timings: { startedAt: 0, discoveryAt: 0, enrichStartedAt: 0, enrichAt: null }, nowMs: 9000, lastEventAt: 9000, requestedCount: 10, businessType: 'x', location: 'y', running: true, holdMs: 0 })
  assert.deepEqual([view.discover.count, view.enrich.done, view.enrich.scope, view.enrich.extraCandidates], [10, 7, 10, false])
})

test('requested 25, fewer than 25 saved: the denominator is the real scope, not the request', () => {
  let progress = ['📦 discovered: 18'].reduce(applyDiscoveryLog, INITIAL_DISCOVERY_PROGRESS)
  progress = applyProgressEvent(progress, { type: 'progress', stage: 'checking', planned: 15, completed: 15, emailsFound: 6, possibleEmails: 0, sequence: 1 })
  progress = confirmDiscoveryResult(progress)
  const view = buildEngineView({ progress, timings: { startedAt: 0, discoveryAt: 0, enrichStartedAt: 0, enrichAt: 1 }, nowMs: 9000, lastEventAt: 9000, requestedCount: 25, businessType: 'x', location: 'y', running: false, holdMs: 0 })
  assert.deepEqual([view.discover.count, view.enrich.scope, view.enrich.done], [18, 15, 15])
  assert.equal(view.discover.candidates, 18)
})

test('the settled note explains the 27 / 26 difference quietly; nothing is said when nothing differs', () => {
  assert.equal(describeSettledNote({ discovered: 27, added: 25, inspected: 26, duplicates: 0, invalid: 0 }), '27 candidates evaluated · 26 websites inspected')
  assert.equal(describeSettledNote({ discovered: 25, added: 25, inspected: 25, duplicates: 0, invalid: 0 }), null)
  assert.equal(describeSettledNote({ discovered: null, added: 25, inspected: 26, duplicates: 0, invalid: 0 }), null)
})

test('the hero is the delivered count; the contact line has no prefix; possible emails stay separate', () => {
  assert.match(engine, /results\.businesses/)
  assert.match(engine, /'New business saved'/)
  assert.match(engine, /'New businesses saved'/)
  assert.doesNotMatch(engine, /Checks include repeat visits|In your results:/)
  assert.match(engine, /Evaluating additional candidates/)
  const summary = summarizeContacts(SCENARIO.leads)
  assert.equal(summary.businesses, 25)
  assert.equal(describeContacts(summary).length, 3)
  assert.match(describeContacts(summary)[2], /websites?$/) // emails · phone numbers · websites
  assert.match(describePossibleEmails(summary), /possible email/)
  assert.equal(summary.emails + summary.possibleEmails, SCENARIO.leads.filter((l) => l.email).length)
})

// ---------------------------------------------------------------------------------------------
// 2. Contact display
// ---------------------------------------------------------------------------------------------

test('each contact has one outline icon, an accessible name, and a proper scheme', () => {
  assert.equal((results.match(/<svg \{\.\.\.ICON_PROPS\}>/g) ?? []).length, 3)
  assert.match(results, /stroke: 'currentColor'|stroke: "currentColor"|stroke: 'currentColor',|stroke="currentColor"|stroke: 'currentColor'/)
  assert.match(results, /'aria-hidden': true/)
  assert.match(results, /aria-label=\{`Website: /)
  assert.match(results, /aria-label=\{`Email: /)
  assert.match(results, /aria-label=\{`Telephone: /)
  assert.match(results, /min-h-\[44px\]/)
  assert.match(results, /focus-visible:outline/)
  assert.doesNotMatch(results.slice(results.indexOf('function GlobeIcon'), results.indexOf('export default function')), /shadow-|gradient|animate-/)
  const row = toResultRow({ ...SCENARIO.leads[0], website: 'acme.example', phone: '020 7946 0000' })
  assert.equal(row.website.href, 'https://acme.example')
  assert.match(row.email.href, /^mailto:/)
  assert.equal(row.phone.href, 'tel:02079460000')
})

// ---------------------------------------------------------------------------------------------
// 3. Missing-email wording
// ---------------------------------------------------------------------------------------------

test('"Email not discovered" is the one primary message; honest reasons stay secondary', () => {
  const lead = (o) => ({ website: 'https://a.example', email: null, email_inspection: null, ...o })
  const states = {
    whole: describeEmailStatus(lead({ email_inspection: { state: 'checked', partial: false } })),
    partial: describeEmailStatus(lead({ email_inspection: { state: 'checked', partial: true } })),
    unreadable: describeEmailStatus(lead({ email_inspection: { state: 'unreadable', partial: false } })),
    none: describeEmailStatus(lead({ website: null })),
  }
  for (const state of Object.values(states)) assert.equal(state.missing, 'Email not discovered')
  assert.deepEqual(
    [states.whole.reason, states.partial.reason, states.unreadable.reason, states.none.reason],
    [null, 'Only part of the website was checked.', "Website couldn't be checked.", 'No website provided.']
  )
  const withAddress = describeEmailStatus(lead({ email: 'a@a.example', email_inspection: { state: 'checked', partial: true } }))
  assert.equal(withAddress.missing, null)
  assert.equal(withAddress.note, EMAIL_WORDING.partialNote)
  assert.doesNotMatch(JSON.stringify(EMAIL_WORDING), /verified|deliverable|valid/i)
})

test('confident and possible emails stay distinguishable on the rows', () => {
  const confident = toResultRow({ ...SCENARIO.leads[0], email: 'a@a.example', email_confidence: 'high' })
  const possible = toResultRow({ ...SCENARIO.leads[0], email: 'b@a.example', email_confidence: 'low' })
  assert.equal(confident.email.possible, false)
  assert.equal(possible.email.possible, true)
  assert.match(results, /Possible/)
})

// ---------------------------------------------------------------------------------------------
// 4. Five-result limitation
// ---------------------------------------------------------------------------------------------

const saved25 = SCENARIO.leads

test('all users see all 25 businesses; guest exports require email', () => {
  assert.equal(getAccessibleResults(saved25, true).length, 25)
  assert.equal(getAccessibleResults(saved25, false).length, 25)
  assert.equal(buildLeadCsv(getAccessibleResults(saved25, true)).trim().split('\n').length, 26)
  assert.equal(buildLeadCsv(getAccessibleResults(saved25, false)).trim().split('\n').length, 26)
  assert.equal(describeShown(25, 25), null)
  assert.equal(describeShown(5, 25), 'Showing 5 of 25')
})

test('the page uses one entitlement for the rows and the CSV, and never builds a "null" note', () => {
  assert.match(page, /const fullResultsAccess = privatePreview \|\| isAuthenticated/)
  assert.match(page, /getAccessibleResults\(sessionSavedLeads, fullResultsAccess\)/)
  assert.equal((page.match(/getAccessibleResults\(/g) ?? []).length, 2) // rows + CSV: the same function, the same flag
  assert.doesNotMatch(page, /\.slice\(0, ?5\)/)
  assert.match(page, /const resultsNote = shownNote \?/)
  assert.doesNotMatch(page, /\$\{describeShown\(/) // a null must never be interpolated into text
})

// ---------------------------------------------------------------------------------------------
// 5. Business Profiles stage, reduced motion
// ---------------------------------------------------------------------------------------------

test('Business Profiles is a separate capability, not a pending step', () => {
  assert.match(rail, /name="Business Profiles"/)
  assert.match(rail, /value="Not included in this search"/)
  assert.match(rail, /tone="separate"/)
  assert.doesNotMatch(rail.slice(rail.indexOf('name="Business Profiles"')), /index=/)
})

test('motion stays gated by the reduced-motion preference', () => {
  assert.match(engine, /usePrefersReducedMotion/)
  assert.match(engine, /reducedMotion/)
  assert.match(page, /holdMs: prefersReducedMotion \? 0 : ACHIEVEMENT_HOLD_MS/)
})

test('the premature 25/25 is replaced by "Finalizing" while extra candidates are still processing', () => {
  // 25 of 25 checked inside the scope, but the improvement pass still has candidates in flight
  const t = SCENARIO.events.find((e) => e.kind === 'progress' && e.event.stage === 'checking' && e.event.planned === 27 && e.event.completed === 25).at
  const mid = viewAt(t + 1)
  assert.equal(mid.enrich.done, 25)
  assert.equal(mid.enrich.finalizing, true)
  assert.equal(mid.focus === 'settled', false)
  assert.match(engine, /enrich\.finalizing \? 'Finalizing'/)
  assert.match(rail, /enrich\.finalizing/)
  // only the authoritative result settles the engine
  const end = viewAt(SCENARIO.durationMs)
  assert.equal(end.focus, 'settled')
  assert.equal(end.enrich.finalizing, false)
})

test('internal numbers live behind "View activity" on the completed screen, not in the headline', () => {
  assert.match(engine, /View activity/)
  assert.match(engine, /<details/)
  assert.deepEqual(describeContacts({ businesses: 25, websites: 24, emails: 16, possibleEmails: 1, phones: 25 }), ['16 emails', '25 phone numbers', '24 websites'])
})
