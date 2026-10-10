import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyDiscoveryLog,
  confirmDiscoveryResult,
  getStageViews,
  INITIAL_DISCOVERY_PROGRESS,
} from '../lib/scraper/discover-progress.ts'

const page = readFileSync(new URL('../app/dashboard/scraper/page.tsx', import.meta.url), 'utf8')

const fold = (lines, start = INITIAL_DISCOVERY_PROGRESS) => lines.reduce(applyDiscoveryLog, start)
const names = (n, prefix = 'Biz') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`)
const stage = (views, key) => views.find((view) => view.key === key)
const views = (progress, running = true, savedCount = null) =>
  getStageViews(progress, 10, { running, savedCount })

// Recorded server sequence for a 10-business search (no improvement pass).
const discoveryLines = [
  '🚀 starting scraper',
  'Finding businesses',
  '🔎 dentists in Austin',
  '🛰️ Serper priority pass',
  ...names(10).map((n) => `📥 ${n}`),
  '📦 discovered: 10',
]
const scanLines = [
  'Checking websites',
  'Extracting contacts',
  ...names(8).map((n) => `🔬 ${n}`),
]
const resolveLines = [
  '✨ Biz 1',
  '✨ Biz 2',
  '⛔ no email: Biz 3',
  '✨ Biz 4',
  '✨ Biz 5',
  '⛔ no email: Biz 6',
  '✨ Biz 7',
  '⛔ no email: Biz 8',
]
const finishLines = [
  '📊 websites: 8, valid emails: 5, enrichment rate: 62.5%',
  '📦 enriched: 7',
  '💾 saved: 7, duplicates: 0, invalid: 0, db errors: 0',
  '🎉 Prospecting complete',
]

test('Finding businesses: label and bar measure the same real count against the requested target', () => {
  const partial = fold(discoveryLines.slice(0, 8)) // 4 businesses announced
  const finding = stage(views(partial), 'finding')
  assert.equal(finding.value, '4 of 10')
  assert.equal(finding.progress, 40)
  assert.equal(finding.state, 'active')
  assert.equal(finding.indeterminate, false)
})

test('Finding businesses completes only on the final discovered count, then shows a full bar', () => {
  const done = stage(views(fold(discoveryLines)), 'finding')
  assert.equal(done.state, 'complete')
  assert.equal(done.progress, 100)
  assert.equal(done.value, '10 businesses found')
})

test('a short final count completes the stage honestly instead of pretending the target was met', () => {
  const lines = [...names(7).map((n) => `📥 ${n}`), '📦 discovered: 7']
  const finding = stage(views(fold(lines)), 'finding')
  assert.equal(finding.state, 'complete')
  assert.equal(finding.value, '7 businesses found')
  assert.equal(finding.detail, '10 requested')
})

test('candidates beyond the requested count never push the meter past 100%', () => {
  const finding = stage(views(fold(names(14).map((n) => `📥 ${n}`))), 'finding')
  assert.equal(finding.value, '10 of 10')
  assert.equal(finding.progress, 100)
  assert.equal(finding.state, 'active') // still not complete until the final count arrives
})

test('Checking websites shows real counts and an indeterminate bar, never a percentage', () => {
  const midScan = fold([...discoveryLines, ...scanLines, ...resolveLines.slice(0, 3)])
  const checking = stage(views(midScan), 'checking')
  assert.equal(checking.state, 'active')
  assert.equal(checking.indeterminate, true)
  assert.equal(checking.progress, null)
  assert.equal(checking.value, '3 checked')
  assert.equal(checking.detail, '2 emails found')
})

test('regression: 8 websites started with 3 results is not reported as 30%', () => {
  const midScan = fold([...discoveryLines, ...scanLines, ...resolveLines.slice(0, 3)])
  assert.equal(midScan.checksStarted, 8)
  for (const view of views(midScan)) {
    assert.ok(view.progress === null || view.progress === 100 || view.key === 'finding', `${view.key} has no fabricated percentage`)
  }
})

test('one discovered email does not complete website checking', () => {
  const afterFirstEmail = fold([...discoveryLines, ...scanLines, '✨ Biz 1'])
  const checking = stage(views(afterFirstEmail), 'checking')
  assert.equal(checking.state, 'active')
  assert.notEqual(checking.progress, 100)
})

test('website checking completes on the contact-ready count, then saving becomes active', () => {
  const checked = fold([...discoveryLines, ...scanLines, ...resolveLines, ...finishLines.slice(0, 2)])
  const [, checking, saving] = views(checked)
  assert.equal(checking.state, 'complete')
  assert.equal(checking.progress, 100)
  assert.equal(checking.value, '8 checked')
  assert.equal(checking.detail, '5 emails found')
  assert.equal(saving.state, 'active')
  assert.equal(saving.indeterminate, true)
  assert.equal(saving.progress, null)
  assert.equal(saving.detail, '7 businesses with contact details')
})

test('no premature completion: "Prospecting complete" without the result keeps saving active', () => {
  const allLogs = fold([...discoveryLines, ...scanLines, ...resolveLines, ...finishLines])
  assert.equal(allLogs.completionLogSeen, true)
  assert.equal(allLogs.resultConfirmed, false)
  const saving = stage(views(allLogs), 'saving')
  assert.equal(saving.state, 'active')
  assert.notEqual(saving.progress, 100)
  assert.equal(saving.value, '')
})

test('the authoritative result event completes saving with the saved count', () => {
  const confirmed = confirmDiscoveryResult(
    fold([...discoveryLines, ...scanLines, ...resolveLines, ...finishLines])
  )
  const saving = stage(views(confirmed, true, 7), 'saving')
  assert.equal(saving.state, 'complete')
  assert.equal(saving.progress, 100)
  assert.equal(saving.value, '7 saved')
})

test('the "Improving results" pass is more searching, not validation', () => {
  const lines = [...discoveryLines, 'Improving results']
  const progress = fold(lines)
  assert.equal(progress.searchingMore, true)
  const finding = stage(views(progress), 'finding')
  assert.notEqual(finding.state, 'complete')
  assert.equal(finding.detail, 'Searching additional sources for stronger matches')
  const labels = views(progress).map((view) => view.label).join(' ')
  assert.doesNotMatch(labels, /validat|verif/i)
  assert.equal(fold([...lines, '📦 enriched: 6']).searchingMore, false)
})

test('a search with no results still resolves every stage', () => {
  const lines = ['📦 discovered: 0', '📦 enriched: 0', '💾 saved: 0, duplicates: 0, invalid: 0, db errors: 0', '🎉 Prospecting complete']
  const progress = confirmDiscoveryResult(fold(lines))
  const result = views(progress, true, 0)
  assert.deepEqual(result.map((view) => view.state), ['complete', 'complete', 'complete'])
  assert.equal(result[2].value, '0 saved')
})

test('counters are monotonic, pure and ignore look-alike messages', () => {
  const before = fold(discoveryLines.slice(0, 6))
  const snapshot = JSON.stringify(before)
  const after = applyDiscoveryLog(before, '📥 Another')
  assert.equal(JSON.stringify(before), snapshot) // input untouched
  assert.equal(after.candidatesFound, before.candidatesFound + 1)
  assert.equal(applyDiscoveryLog(after, 'Found 📥 inside text').candidatesFound, after.candidatesFound)
  assert.equal(applyDiscoveryLog(after, '').candidatesFound, after.candidatesFound)
  assert.equal(applyDiscoveryLog(after, '⛔ no website: Acme').checksFinished, 0) // not a started check
})

test('unknown or missing requested count never yields a fabricated percentage', () => {
  const progress = fold(['📥 A', '📥 B'])
  const finding = getStageViews(progress, Number.NaN, { running: true })[0]
  assert.equal(finding.progress, null)
  assert.equal(finding.indeterminate, true)
})

test('before anything runs every stage is pending with no progress', () => {
  const idle = getStageViews(INITIAL_DISCOVERY_PROGRESS, 10, { running: false })
  assert.deepEqual(idle.map((view) => view.state), ['pending', 'pending', 'pending'])
})

// ---- source-level guarantees for the Discover page ----

test('completion is acknowledged at the authoritative result, with no artificial delay', () => {
  assert.doesNotMatch(page, /4800/)
  assert.doesNotMatch(page, /completionModalTimeoutRef/)
  assert.doesNotMatch(page, /FirstSuccessModal|PartialCompletionModal/)

  const messageHandler = page.slice(page.indexOf('const handleMessage'), page.indexOf('const finalizeResult'))
  assert.doesNotMatch(messageHandler, /Prospecting complete/)
  assert.doesNotMatch(messageHandler, /finish\('Discovery complete\.'\)/)

  const resultHandler = page.slice(page.indexOf('const handleResult'), page.indexOf('const handleLead'))
  assert.match(resultHandler, /confirmDiscoveryResult/)
  assert.match(resultHandler, /finalizeResult\(result\)/)
  assert.match(resultHandler, /finish\('Discovery complete\.'\)/)
  assert.match(resultHandler, /void refreshAuthenticatedUsage/)
  assert.doesNotMatch(page, /await refreshAuthenticatedUsage\(profile\.id, profile\.plan\)\s*\n\s*}\s*\n\s*\n\s*if \(latestResult\)/)
})

test('the live engine stays until the result is confirmed, then settles above the results', () => {
  assert.match(page, /const isLive = loading && !completionResult/)
  assert.match(page, /const showEngine = isLive \|\| isSettled/)
  assert.match(page, /\{showEngine \? \(\s*<DiscoverEngine/)
  assert.match(page, /\{completionResult \? \(/)
  assert.match(page, /<ResultsIndex/)
})

test('no invented validation percentages or lagging display counters remain', () => {
  assert.doesNotMatch(page, /Math\.max\(20, Math\.min\(92/)
  assert.doesNotMatch(page, /displayedDiscovered|logDrain|logQueueRef/)
  assert.doesNotMatch(page, /Math\.round\(item\.progress\)\}%/)
  assert.match(readFileSync(new URL('../lib/scraper/engine-view.ts', import.meta.url), 'utf8'), /getDiscoveredCount\(progress, requestedCount\)/)
  assert.match(readFileSync(new URL('../components/scraper/DiscoverEngine.tsx', import.meta.url), 'utf8'), /role="status"/)
})

test('customer-facing terminology is accurate: no verified / validated claims', () => {
  const copy = page
    .split('\n')
    .filter((line) => !line.includes('valid emails: (')) // server log parser, not UI copy
    .join('\n')
  assert.doesNotMatch(copy, /verif|validated|validating|Enriching contacts|Deep enrichment/i)
  assert.doesNotMatch(copy, /Lead validated|Businesses validated|ALPA Quality Check|Contact information verified/)
})

test('discovery and Business Profile building are described as separate steps', () => {
  const rail = readFileSync(new URL('../components/scraper/EngineRail.tsx', import.meta.url), 'utf8')
  assert.match(rail, /value="Available separately"/)
  assert.match(page, /Business Profiles are a separate step/)
  assert.match(page, /Business Profiles are available separately/)
  assert.match(page, /available with an account/) // guest
  // nothing in this experience claims profiles are being, or will be, generated automatically
  assert.doesNotMatch(page, /queued for background research|being generated|Open My Leads to build/)
})

test('fabricated guest activity events are gone; real guest leads are still stored', () => {
  assert.doesNotMatch(page, /Verified contact|Contact found for|formatLeadDiscoveryLine/)
  assert.match(page, /const handleLead = \(lead: TrialLead\) => \{\s*(\/\/[^\n]*\n\s*)?upsertGuestLead\(lead\)\s*\}/)
})

test('the duplicate, non-functional recent-searches section is removed from Discover', () => {
  assert.doesNotMatch(page, /search_analytics|Recent searches|runRecentSearch|canShowRecentSearches/)
})

test('guest and owner-preview behavior is preserved', () => {
  assert.match(page, /export function DiscoverExperience\(\{ privatePreview = false \}/)
  // owner preview: rows show the real state of background research through the shared results index
  assert.match(page, /showResearchStatus=\{privatePreview\}/)
  assert.match(page, /researchState: privatePreview \? getPrivatePreviewResearchStatus\(lead\) : null/)
  assert.match(page, /PRIVATE_PREVIEW_POLL_INTERVAL_MS/)
  assert.match(page, /isGuest\s*\?\s*mergeGuestLeads\(getGuestLeads\(\), finalResult\.addedLeads\)/)
  assert.match(page, /guestSessionId: isGuest \? getOrCreateGuestSessionId\(\) : null/)
  assert.match(page, /params\.get\('q'\)/) // dashboard "Run again" prefill still works
  assert.match(page, /fetch\('\/api\/scrape'/)
  // request contract unchanged
  assert.match(page, /maxLeads: activeRequestedLeadCount/)
})
