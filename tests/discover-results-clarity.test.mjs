import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { describeOutcomeLines, describeSearchOutcome } from '../lib/scraper/results-summary.ts'
import { describeIntelligence, summarizeRun } from '../lib/intelligence/run-progress.ts'

const rows = (counts) => Object.entries(counts).flatMap(([state, n]) => Array.from({ length: n }, (_, i) => ({ lead_id: `${state}${i}`, state })))
const NOW = Date.parse('2026-10-12T10:00:00Z')
const stage = (counts, running = true, breakdown) => describeIntelligence(summarizeRun(rows(counts), NOW), running, breakdown)

test('progress is counted against the businesses authorized for research, not every saved business', () => {
  // Laval: 20 saved, 10 authorized (8 over the run limit, 2 with no website). It used to read "0 of 20".
  const preparing = stage({ queued: 10, unavailable: 10 })
  assert.equal(preparing.detail, '0 of 10 profiles generated')
  const midway = stage({ ready: 4, researching: 2, queued: 4, unavailable: 10 })
  assert.equal(midway.detail, '4 of 10 profiles generated')
  assert.equal(midway.progress, 0.4)
  assert.equal(stage({ ready: 9, failed: 1, unavailable: 10 }, true, { noWebsite: 2, overLimit: 8 }).headline, '9 business profiles generated')
})

test('with no business authorized there is no 0-of-0 and no division by zero', () => {
  const none = stage({ unavailable: 5 })
  assert.equal(none.phase, 'complete')
  assert.equal(none.progress, null)
  assert.equal(none.headline, '0 business profiles generated')
  // unresolved work with a zero denominator cannot occur, but the text never shows "of 0"
  for (const counts of [{ unavailable: 3 }, { unavailable: 3, ready: 0 }]) assert.ok(!/of 0\b/.test(stage(counts).detail))
})

test('the research limit and the counts themselves are unchanged', () => {
  const summary = summarizeRun(rows({ ready: 7, failed: 3, unavailable: 25 }), NOW)
  assert.equal(summary.total, 35)
  assert.equal(summary.ready, 7)
  assert.equal(summary.unavailable, 25)
})

test('a search whose businesses were all already saved is stated as such, from the receipt counts', () => {
  const outcome = describeSearchOutcome({ saved: 0, alreadySaved: 24 })
  assert.deepEqual(outcome, { kind: 'all_duplicates', found: 24, saved: 0, alreadySaved: 24 })
  assert.deepEqual(describeOutcomeLines(outcome), ['All 24 are already in My Leads', 'No new businesses added'])
  assert.deepEqual(describeOutcomeLines(describeSearchOutcome({ saved: 0, alreadySaved: 1 })), ['It is already in My Leads', 'No new businesses added'])
})

test('a mixed search separates found, new and already saved; a clean one adds no extra line', () => {
  const mixed = describeSearchOutcome({ saved: 20, alreadySaved: 5 })
  assert.deepEqual(mixed, { kind: 'mixed', found: 25, saved: 20, alreadySaved: 5 })
  assert.deepEqual(describeOutcomeLines(mixed), ['25 found · 5 already in My Leads'])
  assert.deepEqual(describeOutcomeLines(describeSearchOutcome({ saved: 10, alreadySaved: 0 })), [])
  assert.equal(describeSearchOutcome({ saved: 0, alreadySaved: 0 }).kind, 'none')
})

test('nothing is invented: bad input is clamped, never turned into a count', () => {
  assert.deepEqual(describeSearchOutcome({ saved: -3, alreadySaved: Number.NaN }), { kind: 'none', found: 0, saved: 0, alreadySaved: 0 })
})

const engine = readFileSync('components/scraper/DiscoverEngine.tsx', 'utf8')
const rail = readFileSync('components/scraper/EngineRail.tsx', 'utf8')
const page = readFileSync('app/dashboard/scraper/page.tsx', 'utf8')
const route = readFileSync('app/api/scrape/route.ts', 'utf8')

test('Stage 03 explains an all-duplicate search, and the hero is never a bare zero', () => {
  assert.match(rail, /No new businesses to research\./)
  assert.match(engine, /noNewBusinesses=\{allDuplicates\}/)
  assert.match(engine, /allDuplicates \? outcome!\.found/)
})

test('the outcome comes from the save receipt\'s own counts, for signed-in customers only, and a shortfall message does not hide them', () => {
  assert.match(route, /`💾 saved: \$\{addedCount\}, duplicates: \$\{duplicateCount \+ alreadySavedBeforeSave\}/)
  assert.match(route, /duplicateCount \+= 1/)
  assert.match(page, /completionResult && !isGuest\s*\?\s*describeSearchOutcome\(\{/)
  assert.match(page, /alreadySaved: savedSummary\.duplicates,/)
  assert.ok(!/alreadySaved: completionResult\.shortfallMessage \? 0/.test(page), 'a shortfall message (present whenever fewer than requested were added) must not zero the count')
  assert.match(page, /otherUnsaved: savedSummary\.invalid \+ savedSummary\.dbErrors,/)
  assert.match(page, /limited: Boolean\(completionResult\.limitMessage\)/)
})

test('duplicate claims are made only when every business presented to the save is accounted for', () => {
  // Something else kept businesses out (invalid, could not be saved, allowance): no "all/N already saved" claim is made.
  assert.equal(describeSearchOutcome({ saved: 0, alreadySaved: 3, otherUnsaved: 2 }).kind, 'none')
  assert.equal(describeSearchOutcome({ saved: 4, alreadySaved: 3, otherUnsaved: 1 }).kind, 'new')
  assert.equal(describeSearchOutcome({ saved: 0, alreadySaved: 3, limited: true }).kind, 'none')
  assert.deepEqual(describeOutcomeLines(describeSearchOutcome({ saved: 0, alreadySaved: 3, limited: true })), [])
  // Missing receipt line: zero already saved, nothing invented.
  assert.deepEqual(describeSearchOutcome({ saved: 0, alreadySaved: 0 }), { kind: 'none', found: 0, saved: 0, alreadySaved: 0 })
  assert.deepEqual(describeSearchOutcome({ saved: 12, alreadySaved: 0 }), { kind: 'new', found: 12, saved: 12, alreadySaved: 0 })
})

test('terminology: businesses found, new businesses saved, business profiles generated; "ready" no longer names different things', () => {
  assert.match(engine, /'New business saved'/)
  assert.match(engine, /'New businesses saved'/)
  assert.ok(!/Businesses? ready/.test(engine), 'the settled hero no longer says "ready"')
  assert.ok(!/(businesses?|saved|found)\.? ready|ready\.`/i.test(engine.split('const announcement')[1].split('const fraction')[0]), 'the announcement no longer says "ready"')
  const progress = readFileSync('lib/intelligence/run-progress.ts', 'utf8')
  assert.match(progress, /profiles? generated|\$\{noun\(authorized\)\} generated/)
  assert.match(progress, /ready: 'Business profile generated'/)
})

test('My Leads keeps its own natural wording for a finished profile', () => {
  const progress = readFileSync('lib/intelligence/run-progress.ts', 'utf8')
  assert.match(progress, /LEAD_PROFILE_LABEL[\s\S]*ready: 'Business profile ready'/)
  assert.match(progress, /ready: 'Business profile generated'/) // Discover's row label for a live run
})

test('search providers, authorization, budgets, credits and the profile cap are untouched', () => {
  for (const file of ['lib/sources/serper.ts', 'lib/sources/google.ts', 'lib/commercial-intelligence/run-authorization.ts', 'lib/commercial-intelligence/queue-manager.ts']) {
    assert.ok(!/describeSearchOutcome|describeOutcomeLines|noNewBusinesses/.test(readFileSync(file, 'utf8')), file)
  }
})
