import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDiscoveryLog, applyProgressEvent, INITIAL_DISCOVERY_PROGRESS } from '../lib/scraper/discover-progress.ts'
import { buildEngineView, describeCheckSummary, getSignalStates } from '../lib/scraper/engine-view.ts'
import { parseProgressEvent } from '../lib/scraper/progress-events.ts'
import { startRunTimings } from '../lib/scraper/stage-timing.ts'

const snapshot = (overrides = {}) => ({ type: 'progress', stage: 'checking', planned: 9, completed: 9, emailsFound: 5, possibleEmails: 1, sequence: 1, ...overrides })
const fold = (progress, event) => applyProgressEvent(progress, parseProgressEvent(event))
const view = (progress) => buildEngineView({ progress, timings: startRunTimings(0), nowMs: 5000, lastEventAt: 5000, requestedCount: 25, businessType: 'Agency', location: 'Pakistan', running: true, holdMs: 0 })

test('the fraction, signals and text alternative all represent 14 checks, even with 10 businesses', () => {
  let progress = applyDiscoveryLog(INITIAL_DISCOVERY_PROGRESS, '📦 discovered: 10')
  progress = fold(progress, snapshot({ planned: 14, completed: 14 }))
  const engine = view(progress)
  assert.equal(engine.discover.count, 10)
  assert.equal(engine.enrich.completed, 14)
  assert.equal(engine.enrich.planned, 14)
  assert.equal(engine.signals.checked, 14)
  assert.equal(engine.signals.eligible, 14)
  assert.equal(getSignalStates(engine.signals).length, 14)
  assert.equal(describeCheckSummary(engine.enrich), '14 of 14 website checks completed. 5 businesses with an email, 1 possible match.')
})

test('a replacement website can invalidate an old contact without erasing completed attempts', () => {
  let progress = fold(INITIAL_DISCOVERY_PROGRESS, snapshot())
  progress = fold(progress, snapshot({ sequence: 2, planned: 10, completed: 9, emailsFound: 4, possibleEmails: 0 }))
  assert.equal(progress.checks.completed, 9)
  assert.equal(progress.checks.emailsFound, 4)
  assert.equal(progress.checks.possibleEmails, 0)
  progress = fold(progress, snapshot({ sequence: 3, planned: 10, completed: 10, emailsFound: 4, possibleEmails: 1 }))
  assert.equal(progress.checks.completed, 10)
  assert.equal(progress.checks.emailsFound, 4)
  assert.equal(progress.checks.possibleEmails, 1)
})

test('older, duplicated and legacy events cannot restore an invalidated email', () => {
  const newer = fold(INITIAL_DISCOVERY_PROGRESS, snapshot({ sequence: 3, emailsFound: 2, possibleEmails: 0 }))
  assert.equal(fold(newer, snapshot({ sequence: 2 })), newer)
  assert.equal(fold(newer, snapshot({ sequence: 3 })), newer)
  const legacy = { type: 'progress', stage: 'checking', planned: 9, completed: 9, emailsFound: 9 }
  assert.equal(fold(newer, legacy), newer)
})

test('malformed contact counters cannot claim more matches than completed checks', () => {
  const event = parseProgressEvent(snapshot({ planned: 4, completed: 99, emailsFound: 2, possibleEmails: 99 }))
  assert.equal(event.completed, 4)
  assert.equal(event.emailsFound, 2)
  assert.equal(event.possibleEmails, 2)
})

test('an older stream does not claim confidence or unique business totals', () => {
  const progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'checking', planned: 5, completed: 3, emailsFound: 2 })
  const engine = view(progress)
  assert.equal(engine.enrich.confidenceKnown, false)
  assert.equal(describeCheckSummary(engine.enrich), '3 of 5 website checks completed. 2 email matches found during checks; confidence totals are unavailable.')
})

test('missing check totals remain unknown rather than using the business count as a denominator', () => {
  const progress = ['📦 discovered: 10', '🔬 A', '⛔ no email: A'].reduce(applyDiscoveryLog, INITIAL_DISCOVERY_PROGRESS)
  assert.equal(describeCheckSummary(view(progress).enrich), '1 website check completed. 0 email matches found during checks; confidence totals are unavailable.')
})
