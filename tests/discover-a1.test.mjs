import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyDiscoveryLog,
  applyProgressEvent,
  confirmDiscoveryResult,
  getDiscoveredCount,
  getStageViews,
  INITIAL_DISCOVERY_PROGRESS,
} from '../lib/scraper/discover-progress.ts'
import {
  ACHIEVEMENT_HOLD_MS,
  buildEngineView,
  getSignalStates,
  STALL_AFTER_MS,
} from '../lib/scraper/engine-view.ts'
import { replayStateAt } from '../lib/scraper/replay.ts'
import { getReplayScenario, REPLAY_SCENARIOS } from '../lib/scraper/replay-fixture.ts'
import {
  advanceRunTimings,
  EMPTY_RUN_TIMINGS,
  formatStageDuration,
  stageDurationMs,
  startRunTimings,
} from '../lib/scraper/stage-timing.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('app/dashboard/scraper/page.tsx')
const form = read('components/scraper/DiscoverSearchForm.tsx')
const engine = read('components/scraper/DiscoverEngine.tsx')
const rail = read('components/scraper/EngineRail.tsx')
const signals = read('components/scraper/SignalField.tsx')
const strip = read('components/scraper/ActivityStrip.tsx')
const studio = read('components/scraper/ReplayStudio.tsx')
const replayRoute = read('app/dashboard/discover-replay/page.tsx')
const css = read('app/globals.css')

const fold = (lines, start = INITIAL_DISCOVERY_PROGRESS) => lines.reduce(applyDiscoveryLog, start)
const names = (n) => Array.from({ length: n }, (_, i) => `Biz ${i + 1}`)

function view(progress, overrides = {}) {
  const timings = overrides.timings ?? advanceRunTimings(startRunTimings(0), progress, overrides.discoveryAt ?? 0)
  return buildEngineView({
    progress,
    timings,
    nowMs: overrides.nowMs ?? 1000,
    lastEventAt: overrides.lastEventAt ?? 0,
    requestedCount: 10,
    businessType: 'Dentists',
    location: 'Miami',
    running: overrides.running ?? true,
    holdMs: overrides.holdMs,
  })
}

// ---------------- moment one: searching ----------------

test('searching claims no discovered businesses and shows only a real elapsed clock', () => {
  const v = buildEngineView({
    progress: INITIAL_DISCOVERY_PROGRESS,
    timings: startRunTimings(1_000),
    nowMs: 8_000,
    lastEventAt: 1_000,
    requestedCount: 10,
    businessType: 'Dentists',
    location: 'Miami',
    running: true,
  })
  assert.equal(v.focus, 'search')
  assert.equal(v.phase, 'searching')
  assert.equal(v.elapsedMs, 7_000)
  assert.equal(v.discover.state, 'active')
  assert.equal(v.foundSoFar, 0)
  assert.equal(v.context, 'Miami · Dentists')
  assert.equal(v.signals.total, 0) // no signals until businesses are actually discovered
  assert.match(engine, /Searching for businesses/)
  assert.match(engine, /formatClock\(view\.elapsedMs\)/)
})

test('"found so far" is the real announced count, capped at the request', () => {
  const some = view(fold(['🔎 q', '📥 A', '📥 B', '📥 C']))
  assert.equal(some.foundSoFar, 3)
  assert.equal(some.focus, 'search') // still searching until the final count arrives
  assert.equal(view(fold(names(14).map((n) => `📥 ${n}`))).foundSoFar, 10)
})

// ---------------- moment two: discovery achievement ----------------

test('a burst from 0 to 10 is shown as the real value 10, with no intermediate counts', () => {
  const before = view(INITIAL_DISCOVERY_PROGRESS)
  const after = view(fold([...names(10).map((n) => `📥 ${n}`), '📦 discovered: 10']), { discoveryAt: 6_000, nowMs: 6_100 })
  assert.equal(before.discover.count, 0)
  assert.equal(after.discover.count, 10)
  // nothing in the model or components interpolates the value
  assert.doesNotMatch(engine + signals + rail, /setInterval|requestAnimationFrame|setTimeout|countUp|useSpring/)
})

test('the achievement holds focus briefly, then moves to enrichment, while metrics keep updating', () => {
  const discovered = fold([...names(10).map((n) => `📥 ${n}`), '📦 discovered: 10'])
  const withChecks = applyProgressEvent(discovered, { type: 'progress', stage: 'checking', planned: 8, completed: 0, emailsFound: 0 })
  const timings = advanceRunTimings(startRunTimings(0), withChecks, 6_000)

  const during = view(withChecks, { timings, nowMs: 6_000 + ACHIEVEMENT_HOLD_MS - 1 })
  assert.equal(during.focus, 'discover')
  assert.equal(during.discover.state, 'complete')
  assert.equal(during.discover.durationMs, 6_000)

  // real-time metrics continue behind the presentation
  const progressed = applyProgressEvent(withChecks, { type: 'progress', stage: 'checking', planned: 8, completed: 3, emailsFound: 1 })
  const stillHeld = view(progressed, { timings, nowMs: 6_000 + 1_000 })
  assert.equal(stillHeld.focus, 'discover')
  assert.equal(stillHeld.enrich.completed, 3)
  assert.equal(stillHeld.enrich.emails, 1)

  const after = view(progressed, { timings, nowMs: 6_000 + ACHIEVEMENT_HOLD_MS })
  assert.equal(after.focus, 'enrich')
})

test('reduced motion skips the presentation hold entirely', () => {
  const discovered = fold(['📦 discovered: 10'])
  const timings = advanceRunTimings(startRunTimings(0), discovered, 5_000)
  assert.equal(view(discovered, { timings, nowMs: 5_100, holdMs: 0 }).focus, 'enrich')
})

test('the discovery duration is frozen at the real completion moment', () => {
  const discovered = fold(['📦 discovered: 10'])
  const timings = advanceRunTimings(startRunTimings(0), discovered, 8_000)
  assert.equal(view(discovered, { timings, nowMs: 8_000 }).discover.durationMs, 8_000)
  assert.equal(view(discovered, { timings, nowMs: 60_000 }).discover.durationMs, 8_000)
  assert.equal(formatStageDuration(8_000), '8s')
  assert.match(engine, /Found in \{secondsPhrase\(discover\.durationMs\)\}/)
})

// ---------------- moment three: enrichment ----------------

test('enrichment is driven by authoritative progress against the reported total', () => {
  let progress = fold(['📦 discovered: 10'])
  progress = applyProgressEvent(progress, { type: 'progress', stage: 'checking', planned: 8, completed: 5, emailsFound: 2 })
  const v = view(progress, { holdMs: 0 })
  assert.equal(v.enrich.state, 'active')
  assert.equal(v.enrich.completed, 5)
  assert.equal(v.enrich.planned, 8)
  assert.equal(v.enrich.ratio, 5 / 8)
  assert.equal(v.enrich.emails, 2)
  assert.equal(v.phase, 'checking') // a check concluding is not the same as a website being analyzed
})

test('enrichment completes on the authoritative event; zero eligible websites completes immediately', () => {
  const done = fold(['📦 discovered: 10', '📦 enriched: 9'], applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'checking', planned: 8, completed: 8, emailsFound: 3 }))
  assert.equal(view(done, { holdMs: 0 }).enrich.state, 'complete')
  assert.equal(view(done, { holdMs: 0 }).phase, 'finishing')
  const none = applyProgressEvent(fold(['📦 discovered: 3']), { type: 'progress', stage: 'checking', planned: 0, completed: 0, emailsFound: 0 })
  assert.equal(view(none, { holdMs: 0 }).enrich.state, 'complete')
  assert.equal(view(none, { holdMs: 0 }).enrich.ratio, 1)
})

test('without totals (older server) the view falls back to honest counts', () => {
  const v = view(fold(['📦 discovered: 6', '🔬 A', '🔬 B', '✨ A']), { holdMs: 0 })
  assert.equal(v.enrich.planned, null)
  assert.equal(v.enrich.ratio, null)
  assert.equal(v.enrich.completed, 1)
})

// ---------------- signals: aggregate, never individual ----------------

test('signals mirror real aggregates: checked, with email, waiting and skipped', () => {
  let progress = fold(['📦 discovered: 10'])
  progress = applyProgressEvent(progress, { type: 'progress', stage: 'checking', planned: 8, completed: 5, emailsFound: 2 })
  const states = getSignalStates(view(progress, { holdMs: 0 }).signals)
  assert.equal(states.length, 10)
  assert.equal(states.filter((s) => s === 'email').length, 2)
  assert.equal(states.filter((s) => s === 'checked').length, 3)
  assert.equal(states.filter((s) => s === 'waiting').length, 3)
  assert.equal(states.filter((s) => s === 'skipped').length, 2) // businesses with no website to check
})

test('signals never exceed what happened and appear only after discovery completes', () => {
  assert.equal(getSignalStates(view(fold(['📥 A', '📥 B'])).signals).length, 0)
  const progress = applyProgressEvent(fold(['📦 discovered: 4']), { type: 'progress', stage: 'checking', planned: 99, completed: 99, emailsFound: 99 })
  const s = view(progress, { holdMs: 0 }).signals
  assert.ok(s.total === 4 && s.eligible <= s.total && s.checked <= s.eligible && s.withEmail <= s.checked)
  assert.match(signals, /does\s+not identify a particular business|aggregate/i)
})

test('signal animation replays only for signals whose state really changed', () => {
  assert.match(signals, /key=\{`\$\{index\}-\$\{state\}`\}/)
  assert.match(signals, /state === 'email' \|\| state === 'checked' \? 'signal-pop' : ''/)
})

// ---------------- honest stall ----------------

test('a long silence from a running search is reported instead of animating forever', () => {
  const progress = INITIAL_DISCOVERY_PROGRESS
  const timings = startRunTimings(0)
  const quiet = buildEngineView({ progress, timings, nowMs: STALL_AFTER_MS + 1_000, lastEventAt: 500, requestedCount: 10, businessType: 'x', location: 'y', running: true })
  assert.equal(quiet.stalled, true)
  const fresh = buildEngineView({ progress, timings, nowMs: STALL_AFTER_MS + 1_000, lastEventAt: 15_000, requestedCount: 10, businessType: 'x', location: 'y', running: true })
  assert.equal(fresh.stalled, false)
  const idle = buildEngineView({ progress, timings, nowMs: 99_000, lastEventAt: 0, requestedCount: 10, businessType: 'x', location: 'y', running: false })
  assert.equal(idle.stalled, false)
  assert.match(engine, /Still working\. This is taking longer than usual\./)
  // ambient movement is switched off while stalled
  assert.match(engine, /enabled: focus === 'search' && view\.running && !view\.stalled/)
})

// ---------------- profile stays honest ----------------

test('the Profile stage is only ever "upcoming" and offers a next step only after the result', () => {
  assert.equal(view(INITIAL_DISCOVERY_PROGRESS).profile.state, 'upcoming')
  assert.equal(view(INITIAL_DISCOVERY_PROGRESS).profile.canContinue, false)
  const complete = view(confirmDiscoveryResult(fold(['📦 discovered: 3'])), { holdMs: 0 })
  assert.equal(complete.profile.state, 'upcoming') // never "running" or "ready"
  assert.equal(complete.profile.canContinue, true)
  // A2: the third stage says plainly that profiles are a separate step and is never active
  assert.match(rail, /name="Business Profiles"[^>]*tone="upcoming" value="Available separately"/)
  assert.doesNotMatch(engine + rail, /process-ci-queue-batch|claim_ci|worker|fetch\(|supabase/i)
})

// ---------------- composition and copy ----------------

test('the primary composition carries minimal, accurate copy', () => {
  for (const text of ['Searching for businesses', 'Businesses discovered', 'Checking websites', 'Websites checked', 'FOUND']) {
    assert.ok((engine + rail).toUpperCase().includes(text.toUpperCase()), text)
  }
  // removed from the primary visual
  assert.doesNotMatch(engine + rail, /Built separately from discovery|Times are measured in your browser|Saving to My Leads|Live discovery/)
  assert.doesNotMatch(engine + rail + signals + strip, /verif|validated|validating|Enriching contacts/i)
  // A2: a check that concluded is not an analysis, and nothing here claims the content was read
  assert.doesNotMatch(engine + rail + signals, /analyz/i)
  assert.doesNotMatch(engine + rail, /phone/i) // phone counts are not available live
})

test('the browser-timing disclosure lives in the activity history, not the hero', () => {
  assert.match(page, /footnote="Times are measured in your browser\."/)
  assert.match(strip, /expanded && footnote/)
})

test('one dominant stage over a slim rail: completed stages stay as small achievements', () => {
  assert.match(engine, /<EngineRail view=\{view\}/)
  assert.match(rail, /tone=\{discover\.state === 'complete' \? 'complete' : 'active'\}/)
  assert.match(rail, /formatStageDuration\(discover\.durationMs\)/)
})

test('activity stays a compact secondary strip with expandable history', () => {
  assert.match(strip, /const latest = items\.at\(-1\)/)
  assert.match(strip, /aria-expanded=\{expanded\}/)
  assert.match(strip, /aria-controls=\{listId\}/)
  assert.match(page, /activity=\{liveActivityItems\}/)
  assert.match(page, /const liveActivityItems = buildActivityItems\(displayedLogs\)/)
  assert.doesNotMatch(strip, /setInterval|setTimeout|Math\.random/)
})

test('customer-facing activity labels avoid provider and database jargon', () => {
  const lib = read('lib/scraper/live-activity.ts')
  const shown = [...lib.matchAll(/label: '([^']+)'/g)].map((match) => match[1]).join(' | ')
  assert.ok(shown.length > 100)
  assert.doesNotMatch(shown, /Serper|Google|Supabase|database|API|queue/i)
})

// ---------------- motion ----------------

test('ambient and event-driven motion are separate, tied to the right conditions', () => {
  // ambient: one ring, rendered only while searching, visible, on screen and allowed
  assert.match(engine, /\{ambient \? \(\s*<span\s+aria-hidden="true"\s+className="engine-pulse/)
  assert.match(engine, /useAmbientMotion\(ref, \{\s*enabled: focus === 'search' && view\.running && !view\.stalled,\s*reducedMotion,/)
  // a faint static ring remains for everyone, including reduced motion
  assert.match(engine, /rounded-full border border-white\/10/)
  // event-driven: reveal and pop play when something real changes
  assert.match(engine, /engine-reveal/)
  assert.match(signals, /key=\{`\$\{index\}-\$\{state\}`\}/)
  assert.doesNotMatch(rail + engine + signals, /Math\.random|setInterval|requestAnimationFrame/)
})

test('all engine motion is removed for reduced-motion users and static versions remain', () => {
  const guardedBlocks = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g) || []
  const guarded = guardedBlocks.join('\n')
  const unguarded = css
    .replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, '')
    .replace(/@keyframes[\s\S]*?\n\}\n/g, '')
  for (const name of ['enginePulse', 'engineReveal', 'signalPop', 'signalsIn', 'resultIn']) {
    assert.match(guarded, new RegExp(`animation: ${name}`), `${name} is applied only inside the media query`)
    assert.doesNotMatch(unguarded, new RegExp(`animation: ${name}`), `${name} is never applied outside it`)
  }
  // the settling transitions are motion too
  assert.match(guarded, /\.engine-stage \{\s*transition: min-height/)
  assert.match(guarded, /\.engine-count \{\s*transition: font-size/)
  assert.doesNotMatch(unguarded, /\.engine-stage \{[^}]*transition/)
  // the ambient element is invisible until animated, and exactly one animation loops
  assert.match(css, /\.engine-pulse \{\s*opacity: 0;\s*will-change: transform, opacity;/)
  assert.equal((guarded.match(/infinite/g) || []).length, 1, 'one looping animation in the whole engine')
})

test('the engine uses no expensive decorative effects', () => {
  const discoverCss = css.slice(css.indexOf('Discover V3 / A2.'))
  // the A1.1 costs: full-area moving gradient, SVG rings, blur filter, large shadows animated
  assert.doesNotMatch(discoverCss, /filter:\s*blur|backdrop-filter|background-position|engineSweep|engineRing|engineBurst/)
  assert.doesNotMatch(discoverCss, /@keyframes[^{]+\{[^}]*(box-shadow|width|height|top|left)/)
  // the ambient keyframes only touch transform and opacity (compositor-only)
  const pulse = discoverCss.match(/@keyframes enginePulse \{[\s\S]*?\n\}\n/)[0]
  assert.doesNotMatch(pulse.replace(/transform: scale\([^)]*\);|opacity: [\d.]+;|[\d%]+ \{|\}|@keyframes enginePulse \{|\s/g, ''), /[a-z]/i)
  assert.doesNotMatch(engine + rail + signals, /<svg|PipelineConnector|AchievementBurst|engine-sweep|engine-ring|engine-burst/)
})

// ---------------- search form ----------------

test('the search form keeps every field and behavior, with quieter placeholder text', () => {
  assert.match(form, /Who are we looking for\?/)
  for (const text of ['Business type', 'Location', 'Businesses', 'Find businesses', 'Use 1–3 simple keywords.', 'City, state, province, or country', 'Add a business type.', 'Add a location.']) {
    assert.ok(form.includes(text), text)
  }
  assert.match(form, /aria-pressed=\{selected\}/)
  assert.match(form, /htmlFor="discover-business-type"/)
  assert.match(form, /htmlFor="discover-location"/)
  // ghost placeholders, bright real input
  assert.match(form, /placeholder:text-base/)
  assert.match(form, /placeholder:text-white\/35/)
  assert.match(form, /text-2xl text-white/)
  assert.doesNotMatch(form, /rounded-\[(2|3)\d+px\]|backdrop-blur|shadow-\[|bg-gradient|bg-\[radial|bg-\[linear|cyan-/)
})

test('the page keeps validation, result options, usage text, refs and the dashboard prefill', () => {
  assert.match(page, /const LEAD_OPTIONS = \['10', '25', '50'\]/)
  assert.match(page, /onBusinessTypeChange=\{\(value\) => \{\s*setBusinessType\(value\)\s*if \(showValidation && value\.trim\(\)\) \{\s*clearValidation\(\)/)
  assert.match(page, /onResultCountChange=\{setMaxLeads\}/)
  assert.match(page, /onSubmit=\{\(\) => void runScrape\(\)\}/)
  assert.match(page, /businessTypeRef=\{businessTypeRef\}/)
  assert.match(page, /businesses discovered this month/)
  assert.match(page, /params\.get\('q'\)/)
  assert.match(page, /submitDisabled=\{loading \|\| hasMissingRequiredFields\}/)
})

// ---------------- state transitions, errors, stop, retry ----------------

test('the form becomes the engine for a run, and the same engine settles at the authoritative result', () => {
  assert.match(page, /const isLive = loading && !completionResult/)
  assert.match(page, /const isSettled = completionResult !== null/)
  assert.match(page, /const showEngine = isLive \|\| isSettled/)
  assert.match(page, /\{!showEngine \? \(\s*<DiscoverSearchForm/)
  assert.match(page, /\{showEngine \? \(\s*<DiscoverEngine/)
  assert.match(page, /buildEngineView\(\{\s*progress,\s*timings: runTimings,\s*nowMs,\s*lastEventAt,/)
  assert.match(page, /setLastEventAt\(Date\.now\(\)\)\s*\n\s*setProgress\(\(current\) => applyDiscoveryLog/)
})

test('failures stay visible, retry is manual, and Stop uses the existing abort', () => {
  assert.match(page, /\{searchFailure && !loading \? \(\s*<SearchFailureNotice/)
  assert.match(page, /onRetry=\{\(\) => void runScrape\(\)\}/)
  assert.match(page, /onStop=\{abortMission\}/)
  assert.match(engine, /Stop search/)
  assert.match(engine, /\{onStop && view\.running \? \(/)
})

test('accessibility: milestones are announced once, signals have a text alternative', () => {
  assert.match(engine, /role="status" aria-live="polite"/)
  assert.match(engine, /Search complete\./)
  assert.match(signals, /<p className="sr-only">\{summary\}<\/p>/)
  assert.match(engine, /'ALPA is working on your search'/)
  assert.match(engine, /'Search summary'/)
})

// ---------------- replay studio ----------------

test('replay scenarios are labelled illustrative and are deterministic', () => {
  for (const scenario of REPLAY_SCENARIOS) {
    assert.equal(scenario.illustrativeTiming, true)
    assert.ok(scenario.events.length > 20)
  }
  const a = replayStateAt(getReplayScenario('standard'), 9_000)
  const b = replayStateAt(getReplayScenario('standard'), 9_000)
  assert.deepEqual(a.progress, b.progress)
  assert.deepEqual(a.timings, b.timings)
})

test('replay follows the real event shape through the real reducers', () => {
  const scenario = getReplayScenario('standard')
  const searching = replayStateAt(scenario, 3_000)
  assert.equal(searching.progress.discoveredFinal, null)
  assert.equal(searching.progress.candidatesFound, 0)
  assert.equal(searching.running, true)

  const burst = replayStateAt(scenario, 6_300)
  assert.equal(burst.progress.discoveredFinal, 10)
  assert.equal(burst.progress.candidatesFound, 10)
  assert.equal(burst.timings.discoveryAt, 6_260) // the scenario clock, not a measurement

  const mid = replayStateAt(scenario, 12_000)
  assert.equal(mid.progress.checks.planned, 8)
  assert.ok(mid.progress.checks.completed > 0 && mid.progress.checks.completed < 8)

  const end = replayStateAt(scenario, scenario.durationMs)
  assert.equal(end.progress.resultConfirmed, true)
  assert.equal(end.progress.checks.completed, 8)
  assert.equal(end.progress.checks.emailsFound, 3)
  assert.equal(end.running, false)
})

test('replay progress only moves forward as time advances (monotonic)', () => {
  const scenario = getReplayScenario('standard')
  let previous = replayStateAt(scenario, 0).progress
  for (let t = 250; t <= scenario.durationMs + 500; t += 250) {
    const next = replayStateAt(scenario, t).progress
    assert.ok(next.candidatesFound >= previous.candidatesFound)
    assert.ok((next.checks?.completed ?? 0) >= (previous.checks?.completed ?? 0))
    assert.ok((next.saves?.processed ?? 0) >= (previous.saves?.processed ?? 0))
    previous = next
  }
})

test('pause is a no-op on state and restart returns to the initial state', () => {
  const scenario = getReplayScenario('standard')
  const paused = replayStateAt(scenario, 10_000)
  assert.deepEqual(replayStateAt(scenario, 10_000).progress, paused.progress) // time not advancing
  const restarted = replayStateAt(scenario, 0)
  assert.equal(restarted.progress.candidatesFound, 0)
  assert.equal(restarted.progress.discoveredFinal, null)
  assert.equal(restarted.lastEventAt, null)
  assert.match(studio, /onClick=\{\(\) => setPlaying\(\(value\) => !value\)\}/)
  assert.match(studio, /function restart\(/)
  assert.match(studio, /setT\(0\)/)
  assert.match(studio, /Pause/)
  assert.match(studio, /Restart/)
})

test('the slow scenario really goes quiet long enough to show the honest stall message', () => {
  const slow = getReplayScenario('slow')
  const state = replayStateAt(slow, 24_000)
  const v = buildEngineView({
    progress: state.progress,
    timings: state.timings,
    nowMs: 24_000,
    lastEventAt: state.lastEventAt,
    requestedCount: 10,
    businessType: 'Dentists',
    location: 'Miami',
    running: state.running,
  })
  assert.equal(v.stalled, true)
  assert.equal(v.focus, 'search')
})

test('the replay never touches the network, storage, analytics or the database', () => {
  const sources = [studio, read('lib/scraper/replay.ts'), read('lib/scraper/replay-fixture.ts'), read('lib/scraper/engine-view.ts'), engine, rail, signals, replayRoute]
  const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const source of sources) {
    assert.doesNotMatch(withoutComments(source), /fetch\(|\/api\/|supabase|createClient|trackEvent|localStorage|sessionStorage|XMLHttpRequest|WebSocket/i)
  }
  // and nothing in the replay path imports a network or data layer
  for (const source of [studio, read('lib/scraper/replay.ts'), read('lib/scraper/replay-fixture.ts'), replayRoute]) {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]).join(' ')
    assert.doesNotMatch(imports, /supabase|analytics|track|guest-session|usage|queue|commercial-intelligence/i)
  }
  assert.match(studio, /Demo \/ Replay/)
  assert.match(studio, /not measured/)
  assert.match(studio, /No search is running, no\s+paid service is called, and nothing is saved/)
})

test('the replay route is development-only', () => {
  assert.match(replayRoute, /process\.env\.NODE_ENV !== 'development'/)
  assert.match(replayRoute, /notFound\(\)/)
  assert.match(replayRoute, /dynamic = 'force-dynamic'/)
  // not linked from any navigation
  assert.doesNotMatch(read('components/dashboard/DashboardShell.tsx'), /discover-replay/)
})

// ---------------- unchanged contracts ----------------

test('real searches still use the same request and the same authoritative events', () => {
  assert.match(page, /fetch\('\/api\/scrape'/)
  assert.match(page, /maxLeads: activeRequestedLeadCount/)
  assert.match(page, /guestSessionId: isGuest \? getOrCreateGuestSessionId\(\) : null/)
  assert.match(page, /privatePreview,/)
  assert.match(page, /const handleResult = \(result: ScrapeResultPayload\) => \{\s*if \(resultHandled\) return/)
})

test('the page stays small and no longer owns presentation logic', () => {
  assert.ok(page.split('\n').length < 1500)
  assert.doesNotMatch(page, /getStageViews/)
})

test('earlier helpers remain intact: stage views, timing and counters', () => {
  assert.equal(getDiscoveredCount(INITIAL_DISCOVERY_PROGRESS, 10), 0)
  assert.equal(getStageViews(INITIAL_DISCOVERY_PROGRESS, 10, { running: false }).length, 3)
  assert.equal(stageDurationMs(null, null, 5), null)
  assert.equal(advanceRunTimings(EMPTY_RUN_TIMINGS, fold(['📦 discovered: 5']), 1), EMPTY_RUN_TIMINGS)
})
