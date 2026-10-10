// Discover V3 / A2 — the results reveal and the results workspace.
// Pure functions are tested directly; component files are checked structurally for the guarantees
// that matter (honest wording, no research triggers, no expensive motion). The behaviour in a real
// browser (scroll, focus, ambient pause, mobile) is covered by the fixture-backed replay checks.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyDiscoveryLog,
  confirmDiscoveryResult,
  INITIAL_DISCOVERY_PROGRESS,
} from '../lib/scraper/discover-progress.ts'
import { ACHIEVEMENT_HOLD_MS, buildEngineView, getSignalStates } from '../lib/scraper/engine-view.ts'
import { REPLAY_LEADS, REPLAY_SCENARIOS } from '../lib/scraper/replay-fixture.ts'
import {
  decideReveal,
  NAVIGATION_KEYS,
  revealDelay,
  REVEAL_DELAY_MS,
  shouldMoveFocus,
} from '../lib/scraper/results-reveal.ts'
import {
  describeContacts,
  describeFiltering,
  describeLead,
  describePossibleEmails,
  describeSettledNote,
  describeShown,
  isPossibleEmail,
  summarizeContacts,
  toResultRow,
  websiteHost,
} from '../lib/scraper/results-summary.ts'
import { advanceRunTimings, startRunTimings } from '../lib/scraper/stage-timing.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const lead = (overrides = {}) => ({
  id: 'l1', company_name: 'Acme Dental', city: 'Miami', industry: 'dentists', email: null, email_source: null,
  email_confidence: null, is_generic_email: false, phone: null, website: null, status: 'new', pipeline_stage: null,
  close_reason: null, source: null, cost_estimate: null, created_at: '', ...overrides,
})

// ---------------------------------------------------------------------------------------------
// Contact figures: different facts are never presented as one another
// ---------------------------------------------------------------------------------------------

test('emails count only high and medium confidence; low or unknown confidence is "possible" and counted apart', () => {
  const leads = [
    lead({ email: 'a@a.example', email_confidence: 'high' }),
    lead({ email: 'b@b.example', email_confidence: 'medium' }),
    lead({ email: 'c@c.example', email_confidence: 'low' }),
    lead({ email: 'd@d.example', email_confidence: null }), // unknown is treated as lower confidence, never as confirmed
    lead({ email: '   ', email_confidence: 'high' }), // blank is not an address
    lead(),
  ]
  const summary = summarizeContacts(leads)
  assert.deepEqual(summary, { businesses: 6, websites: 0, emails: 2, possibleEmails: 2, phones: 0 })
  assert.equal(isPossibleEmail({ email: 'x@x.example', email_confidence: 'low' }), true)
  assert.equal(isPossibleEmail({ email: null, email_confidence: 'low' }), false)
})

test('websites and phones count only what exists; a website link says nothing about its content', () => {
  const summary = summarizeContacts([
    lead({ website: 'https://a.example', phone: '(305) 555-0100' }),
    lead({ website: '  ', phone: '' }),
    lead({ phone: '305-555-0111' }),
  ])
  assert.equal(summary.websites, 1)
  assert.equal(summary.phones, 2)
  assert.equal(summary.businesses, 3)
})

test('the contact line always names all three kinds, including zero, and never says verified', () => {
  assert.deepEqual(describeContacts({ businesses: 9, websites: 7, emails: 5, possibleEmails: 0, phones: 9 }), ['7 websites', '5 emails', '9 phone numbers'])
  assert.deepEqual(describeContacts({ businesses: 1, websites: 1, emails: 1, possibleEmails: 0, phones: 1 }), ['1 website', '1 email', '1 phone number'])
  assert.deepEqual(describeContacts({ businesses: 3, websites: 0, emails: 0, possibleEmails: 0, phones: 0 }), ['0 websites', '0 emails', '0 phone numbers'])
  assert.equal(describePossibleEmails({ businesses: 1, websites: 0, emails: 0, possibleEmails: 0, phones: 0 }), null)
  assert.equal(
    describePossibleEmails({ businesses: 3, websites: 0, emails: 0, possibleEmails: 2, phones: 0 }),
    '2 possible emails not counted above (lower confidence)'
  )
})

test('the replay fixture exercises every case: a possible email, a missing website and phone, a stored synopsis', () => {
  const summary = summarizeContacts(REPLAY_LEADS)
  assert.deepEqual(summary, { businesses: 9, websites: 8, emails: 2, possibleEmails: 1, phones: 8 })
  assert.equal(REPLAY_LEADS.filter((item) => item.commercial_profile?.summary).length, 1)
  for (const scenario of REPLAY_SCENARIOS) assert.ok(scenario.leads.length === 9)
})

// ---------------------------------------------------------------------------------------------
// Rows: nothing is invented
// ---------------------------------------------------------------------------------------------

test('a row shows only fields that exist and links only to the existing lead page', () => {
  const full = toResultRow(
    lead({ website: 'https://www.acme.example/contact', email: 'hi@acme.example', email_confidence: 'high', phone: '(305) 555-0142' })
  )
  assert.equal(full.name, 'Acme Dental')
  assert.equal(full.descriptor, 'Miami · Dentists')
  assert.deepEqual(full.website, { host: 'acme.example', href: 'https://www.acme.example/contact' })
  assert.deepEqual(full.email, { address: 'hi@acme.example', href: 'mailto:hi@acme.example', possible: false })
  assert.deepEqual(full.phone, { display: '(305) 555-0142', href: 'tel:3055550142' })
  assert.equal(full.detailHref, '/dashboard/leads/l1')
  assert.equal(full.synopsis, null, 'no synopsis is ever generated here')
  assert.equal(full.research, null)

  const bare = toResultRow(lead({ city: null, industry: null }))
  assert.deepEqual([bare.website, bare.email, bare.phone, bare.descriptor], [null, null, null, null])
})

test('a low-confidence address is marked possible on its row', () => {
  assert.equal(toResultRow(lead({ email: 'x@x.example', email_confidence: 'low' })).email.possible, true)
  assert.equal(toResultRow(lead({ email: 'x@x.example', email_confidence: 'medium' })).email.possible, false)
})

test('a synopsis appears only when one is already stored, and is shown as stored', () => {
  const stored = toResultRow(lead({ commercial_profile: { summary: '  A stored, factual summary.  ' } }))
  assert.equal(stored.synopsis, 'A stored, factual summary.')
  assert.equal(toResultRow(lead({ commercial_profile: { summary: '   ' } })).synopsis, null)
  assert.equal(toResultRow(lead({ commercial_profile: null })).synopsis, null)
})

test('research state is carried only when the caller asks for it (owner preview)', () => {
  assert.equal(toResultRow(lead(), { researchState: 'researching' }).research, 'researching')
  assert.equal(toResultRow(lead()).research, null)
})

test('website hosts are readable and tolerate odd input', () => {
  assert.equal(websiteHost('https://www.Example.com/a/b?x=1'), 'example.com')
  assert.equal(websiteHost('example.com/path'), 'example.com')
  assert.equal(websiteHost(''), null)
  assert.equal(websiteHost(null), null)
})

test('descriptors tidy a lower-case industry and skip empty parts', () => {
  assert.equal(describeLead({ city: 'Miami', industry: 'dentists' }), 'Miami · Dentists')
  assert.equal(describeLead({ city: 'New York', industry: 'Law Firms' }), 'New York · Law Firms')
  assert.equal(describeLead({ city: null, industry: 'dentists' }), 'Dentists')
  assert.equal(describeLead({ city: ' ', industry: null }), null)
})

test('notes report only real, non-zero numbers', () => {
  assert.equal(describeShown(5, 25), 'Showing 5 of 25')
  assert.equal(describeShown(9, 9), null)
  assert.equal(describeFiltering({ duplicates: 0, invalid: 0 }), null)
  assert.equal(describeFiltering({ duplicates: 1, invalid: 2 }), '1 duplicate removed · 2 without usable contact details filtered')
  assert.equal(describeSettledNote({ discovered: 10, added: 10, duplicates: 0, invalid: 0 }), null)
  assert.equal(describeSettledNote({ discovered: 10, added: 9, duplicates: 1, invalid: 0 }), '9 added to your results · 1 duplicate removed')
  assert.equal(describeSettledNote({ discovered: null, added: 9, duplicates: 0, invalid: 0 }), null, 'no claim without a known discovery count')
})

// ---------------------------------------------------------------------------------------------
// The engine settles only on the authoritative result
// ---------------------------------------------------------------------------------------------

function viewAt(progress, { nowMs = 20_000, discoveryAt = 6_000, running = false, holdMs } = {}) {
  return buildEngineView({
    progress,
    timings: advanceRunTimings(startRunTimings(0), progress, discoveryAt),
    nowMs,
    lastEventAt: nowMs - 100,
    requestedCount: 10,
    businessType: 'Dentists',
    location: 'Miami',
    running,
    holdMs,
  })
}

test('the engine settles at the authoritative result and not before, whatever else has finished', () => {
  const discovered = applyDiscoveryLog(INITIAL_DISCOVERY_PROGRESS, '📦 discovered: 10')
  const enriched = applyDiscoveryLog(discovered, '📦 enriched: 9')
  const logged = applyDiscoveryLog(enriched, '🎉 Prospecting complete')
  for (const progress of [discovered, enriched, logged]) {
    assert.notEqual(viewAt(progress, { running: true }).focus, 'settled', 'a log line or a finished stage is not the result')
  }
  const confirmed = viewAt(confirmDiscoveryResult(logged))
  assert.equal(confirmed.focus, 'settled')
  assert.equal(confirmed.phase, 'complete')
  assert.equal(confirmed.discover.count, 10)
})

test('settling never waits on, or is delayed by, the presentation hold', () => {
  const confirmed = confirmDiscoveryResult(applyDiscoveryLog(INITIAL_DISCOVERY_PROGRESS, '📦 discovered: 10'))
  // the result arrives right after discovery: still settled, not held on the count
  assert.equal(viewAt(confirmed, { nowMs: 6_050, discoveryAt: 6_000, holdMs: ACHIEVEMENT_HOLD_MS }).focus, 'settled')
})

test('the hold on the discovery count is short', () => {
  assert.ok(ACHIEVEMENT_HOLD_MS <= 2_000 && ACHIEVEMENT_HOLD_MS >= 1_000)
})

test('signals are "checked", an aggregate that never claims a website was read', () => {
  const states = getSignalStates({ total: 4, eligible: 3, checked: 2, withEmail: 1 })
  assert.deepEqual(states, ['email', 'checked', 'waiting', 'skipped'])
})

// ---------------------------------------------------------------------------------------------
// The reveal: a courtesy, never a takeover
// ---------------------------------------------------------------------------------------------

test('the reveal scrolls only when it helps and the customer is not doing something else', () => {
  const base = { reducedMotion: false, userNavigated: false, focusInEditable: false, resultsTop: 900, viewportHeight: 800 }
  assert.deepEqual(decideReveal(base), { scroll: true, behavior: 'smooth' })
  assert.deepEqual(decideReveal({ ...base, reducedMotion: true }), { scroll: true, behavior: 'auto' })
  assert.deepEqual(decideReveal({ ...base, focusInEditable: true }), { scroll: false, reason: 'editing' })
  assert.deepEqual(decideReveal({ ...base, userNavigated: true }), { scroll: false, reason: 'navigated' })
  assert.deepEqual(decideReveal({ ...base, resultsTop: 300 }), { scroll: false, reason: 'in-view' })
  // scrolled past the heading entirely: bring it back
  assert.equal(decideReveal({ ...base, resultsTop: -400 }).scroll, true)
  // just below the comfortable zone
  assert.equal(decideReveal({ ...base, resultsTop: 800 * 0.66 + 1 }).scroll, true)
})

test('editing and navigating outrank everything else', () => {
  const both = decideReveal({ reducedMotion: false, userNavigated: true, focusInEditable: true, resultsTop: 5000, viewportHeight: 800 })
  assert.equal(both.scroll, false)
})

test('reduced motion has no delay and focus is only moved when it would otherwise be lost', () => {
  assert.equal(revealDelay(true), 0)
  assert.equal(revealDelay(false), REVEAL_DELAY_MS)
  assert.equal(shouldMoveFocus({ activeInsideEngine: true, activeIsBody: false, focusInEditable: false }), true)
  assert.equal(shouldMoveFocus({ activeInsideEngine: false, activeIsBody: true, focusInEditable: false }), true)
  assert.equal(shouldMoveFocus({ activeInsideEngine: false, activeIsBody: false, focusInEditable: false }), false)
  assert.equal(shouldMoveFocus({ activeInsideEngine: true, activeIsBody: true, focusInEditable: true }), false)
  assert.ok(NAVIGATION_KEYS.includes('PageDown') && !NAVIGATION_KEYS.includes('Tab'))
})

test('the hook listens only for the customer navigating, and cleans up', () => {
  const hook = read('components/scraper/useResultsReveal.ts')
  assert.match(hook, /addEventListener\('wheel'/)
  assert.match(hook, /addEventListener\('touchmove'/)
  assert.match(hook, /removeEventListener\('wheel'/)
  assert.match(hook, /clearTimeout\(timer\)/)
  assert.match(hook, /preventScroll: true/)
  assert.doesNotMatch(hook, /fetch\(|supabase|router/)
})

// ---------------------------------------------------------------------------------------------
// Honesty, safety and scope of the new components
// ---------------------------------------------------------------------------------------------

const engine = stripComments(read('components/scraper/DiscoverEngine.tsx'))
const rail = stripComments(read('components/scraper/EngineRail.tsx'))
const results = stripComments(read('components/scraper/ResultsIndex.tsx'))
const signals = stripComments(read('components/scraper/SignalField.tsx'))
const summary = stripComments(read('lib/scraper/results-summary.ts'))
const page = read('app/dashboard/scraper/page.tsx')

test('no new component or label claims verification, deliverability, analysis or generated profiles', () => {
  for (const [name, source] of Object.entries({ engine, rail, results, signals, summary })) {
    assert.doesNotMatch(source, /verif|deliverab|validated|analyz|AI-generated|being generated profiles/i, name)
  }
})

test('the workspace never triggers research, queues, workers or network calls', () => {
  for (const [name, source] of Object.entries({ engine, rail, results, signals, summary })) {
    assert.doesNotMatch(source, /fetch\(|supabase|process-ci|claim_ci|enrichLead|enrich-lead|queue-manager|process-queue|commercial-intelligence\/|\/api\//i, name)
  }
  assert.match(read('lib/scraper/results-summary.ts'), /detailHref: `\/dashboard\/leads\/\$\{lead\.id\}`/)
})

test('Business Profiles are stated as separate, never as part of this search or running', () => {
  assert.match(rail, /Available separately/)
  assert.match(rail, /tone="upcoming"/)
  assert.doesNotMatch(rail, /tone=\{[^}]*profile/i)
  assert.match(page, /Business Profiles are available separately\./)
})

test('rows use one valid link per row (stretched), contact links above it, and 44px touch targets', () => {
  assert.match(results, /after:absolute after:inset-0/)
  assert.match(results, /relative z-10/)
  assert.match(results, /min-h-\[44px\]/)
  assert.match(results, /focus-visible:after:outline/)
  assert.match(results, /rel="noopener noreferrer"/)
  assert.match(results, /opens in a new tab/)
  assert.doesNotMatch(results, /<button/) // no repeated per-row buttons
})

test('the results surface keeps readable contrast: dark ink on near-white, muted text at least 4.5:1', () => {
  const luminance = (hex) => {
    const channel = (offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const surface = '#f7f5ef'
  const hover = '#efece2'
  for (const [color, minimum] of [['#0b1a33', 7], ['#5b6372', 4.5], ['#7a5f27', 4.5], ['#3b4455', 7]]) {
    assert.ok(ratio(color, surface) >= minimum, `${color} on the surface is ${ratio(color, surface).toFixed(2)}:1`)
    assert.ok(ratio(color, hover) >= minimum - 0.4, `${color} on the hover tint is ${ratio(color, hover).toFixed(2)}:1`)
  }
  for (const color of ['#0b1a33', '#5b6372', '#7a5f27']) assert.ok(results.includes(color), `${color} is used`)
  assert.ok(!results.includes('#8a6d2f'), 'the previous, slightly too light gold is gone')
})

test('the page no longer uses the gradient card results or the old lead cards', () => {
  assert.doesNotMatch(page, /rounded-\[32px\]|LeadCard|PrivatePreviewLeadCard|getMetricIcon|animate-\[fadeInUp/)
  assert.match(page, /import ResultsIndex from '@\/components\/scraper\/ResultsIndex'/)
})

test('the form does not return after a result; "New search" is the one way back', () => {
  assert.match(page, /\{!showEngine \? \(\s*<DiscoverSearchForm/)
  assert.match(page, /onNewSearch=\{resetSearchFlow\}/)
  assert.match(engine, /New search/)
  assert.ok(!/Run another search/.test(page))
})

test('the reveal and entrance scrolling are wired to the real result and never run on failure', () => {
  assert.match(page, /useResultsReveal\(\{\s*ready: isSettled,/)
  assert.match(page, /const isSettled = completionResult !== null/)
  // the engine entrance only runs while live
  assert.match(page, /if \(!isLive\) return\s*const frame = window\.requestAnimationFrame/)
})

test('ambient motion is gated by search state, tab visibility and on-screen presence', () => {
  const hook = read('components/scraper/useAmbientMotion.ts')
  assert.match(hook, /visibilityState === 'visible'/)
  assert.match(hook, /IntersectionObserver/)
  assert.match(hook, /return enabled && !reducedMotion && visible && onScreen/)
  assert.match(engine, /\{ambient \? \(/)
})

test('the replay stays development-only and never leaves the page', () => {
  const route = read('app/dashboard/discover-replay/page.tsx')
  assert.match(route, /process\.env\.NODE_ENV !== 'development'/)
  assert.match(route, /notFound\(\)/)
  const studioSource = read('components/scraper/ReplayStudio.tsx')
  assert.match(studioSource, /detailHref: `#fixture-\$\{lead\.id\}`/)
  assert.doesNotMatch(stripComments(studioSource), /fetch\(|supabase|\/api\/|router\.push/)
  assert.match(studioSource, /if \(!playing \|\| atEnd\) return/, 'the replay timer stops at the end')
})
