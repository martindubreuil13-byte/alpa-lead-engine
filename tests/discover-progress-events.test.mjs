import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyDiscoveryLog,
  applyProgressEvent,
  confirmDiscoveryResult,
  getStageViews,
  INITIAL_DISCOVERY_PROGRESS,
} from '../lib/scraper/discover-progress.ts'
import {
  createSaveTracker,
  createWebsiteCheckTracker,
  parseProgressEvent,
} from '../lib/scraper/progress-events.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const stage = (views, key) => views.find((view) => view.key === key)
const view = (progress, savedCount = null, requested = 10) =>
  getStageViews(progress, requested, { running: true, savedCount })

function collectChecks(run) {
  const events = []
  const tracker = createWebsiteCheckTracker((event) => events.push(event))
  run(tracker)
  return events
}

function collectSaves(considered, run) {
  const events = []
  const tracker = createSaveTracker(considered, (event) => events.push(event))
  run(tracker)
  return events
}

const nonDecreasing = (events, keys) =>
  events.every((event, index) => index === 0 || keys.every((key) => event[key] >= events[index - 1][key]))

// ---------------- server-side trackers ----------------

test('normal 10-business search: 8 eligible websites, 5 with emails, never above 100%', () => {
  const events = collectChecks((tracker) => {
    tracker.plan(8)
    for (let i = 0; i < 8; i += 1) tracker.complete(i < 5)
  })
  assert.deepEqual(events[0], { type: 'progress', stage: 'checking', planned: 8, completed: 0, emailsFound: 0 })
  const last = events.at(-1)
  assert.deepEqual(last, { type: 'progress', stage: 'checking', planned: 8, completed: 8, emailsFound: 5 })
  assert.ok(events.every((event) => event.completed <= event.planned))
  assert.ok(nonDecreasing(events, ['planned', 'completed', 'emailsFound']))
})

test('businesses without websites are not planned, so they can never stall the meter', () => {
  // 10 businesses found, only 6 have a checkable website
  const events = collectChecks((tracker) => {
    tracker.plan(6)
    for (let i = 0; i < 6; i += 1) tracker.complete(false)
  })
  assert.equal(events.at(-1).planned, 6)
  assert.equal(events.at(-1).completed, 6)
})

test('zero eligible websites is an explicit, valid answer', () => {
  const events = collectChecks((tracker) => tracker.plan(0))
  assert.deepEqual(events, [{ type: 'progress', stage: 'checking', planned: 0, completed: 0, emailsFound: 0 }])
})

test('failed website checks count as processed, not as emails found', () => {
  const events = collectChecks((tracker) => {
    tracker.plan(4)
    tracker.complete(false) // site unreachable or no email
    tracker.complete(false)
    tracker.complete(true)
  })
  assert.deepEqual(events.at(-1), { type: 'progress', stage: 'checking', planned: 4, completed: 3, emailsFound: 1 })
})

test('completions beyond the plan are clamped, never exceeding 100%', () => {
  const events = collectChecks((tracker) => {
    tracker.plan(2)
    for (let i = 0; i < 5; i += 1) tracker.complete(false)
  })
  assert.ok(events.every((event) => event.completed <= event.planned))
  assert.equal(events.at(-1).completed, 2)
})

test('the optional second enrichment pass grows the plan cumulatively and monotonically', () => {
  const events = collectChecks((tracker) => {
    tracker.plan(8)
    for (let i = 0; i < 8; i += 1) tracker.complete(i < 3)
    tracker.plan(3) // Google improvement pass
    for (let i = 0; i < 3; i += 1) tracker.complete(true)
  })
  assert.ok(nonDecreasing(events, ['planned', 'completed', 'emailsFound']))
  assert.deepEqual(events.at(-1), { type: 'progress', stage: 'checking', planned: 11, completed: 11, emailsFound: 6 })
})

test('save progress: attempted and saved are separate and saved never leads persistence', () => {
  const events = collectSaves(10, (tracker) => {
    tracker.start()
    for (let i = 0; i < 7; i += 1) tracker.record('saved')
    tracker.record('duplicate')
    tracker.record('invalid')
    tracker.record('failed')
  })
  assert.deepEqual(events[0], { type: 'progress', stage: 'saving', considered: 10, processed: 0, saved: 0, duplicates: 0, invalid: 0, failed: 0 })
  assert.ok(events.every((event) => event.saved <= event.processed && event.processed <= event.considered))
  assert.ok(nonDecreasing(events, ['processed', 'saved', 'duplicates', 'invalid', 'failed']))
  assert.deepEqual(events.at(-1), { type: 'progress', stage: 'saving', considered: 10, processed: 10, saved: 7, duplicates: 1, invalid: 1, failed: 1 })
})

test('save failures are processed but never counted as saved', () => {
  const events = collectSaves(3, (tracker) => {
    tracker.start()
    tracker.record('failed')
    tracker.record('failed')
    tracker.record('failed')
  })
  assert.equal(events.at(-1).saved, 0)
  assert.equal(events.at(-1).failed, 3)
  assert.equal(events.at(-1).processed, 3)
})

test('fewer businesses than requested: the save total follows what exists', () => {
  const events = collectSaves(7, (tracker) => {
    tracker.start()
    for (let i = 0; i < 7; i += 1) tracker.record('saved')
  })
  assert.equal(events.at(-1).considered, 7)
  assert.equal(events.at(-1).processed, 7)
})

test('no businesses found: one explicit zero-total event', () => {
  const events = collectSaves(0, (tracker) => tracker.start())
  assert.deepEqual(events, [{ type: 'progress', stage: 'saving', considered: 0, processed: 0, saved: 0, duplicates: 0, invalid: 0, failed: 0 }])
})

test('extra attempts after failures raise the estimate instead of exceeding 100%', () => {
  const events = collectSaves(3, (tracker) => {
    tracker.start()
    for (let i = 0; i < 4; i += 1) tracker.record(i < 1 ? 'failed' : 'saved')
  })
  assert.ok(events.every((event) => event.processed <= event.considered))
  assert.equal(events.at(-1).considered, 4)
})

test('trackers stay silent without a listener (agent missions and other callers)', () => {
  const checks = createWebsiteCheckTracker()
  checks.plan(3)
  checks.complete(true)
  assert.deepEqual(checks.snapshot(), { planned: 3, completed: 1, emailsFound: 1 })
  assert.doesNotThrow(() => createSaveTracker(2).record('saved'))
})

test('parseProgressEvent validates and clamps untrusted payloads', () => {
  assert.equal(parseProgressEvent(null), null)
  assert.equal(parseProgressEvent({ type: 'log', message: 'x' }), null)
  assert.equal(parseProgressEvent({ type: 'progress', stage: 'unknown' }), null)
  assert.deepEqual(
    parseProgressEvent({ type: 'progress', stage: 'checking', planned: 4, completed: 9, emailsFound: 99 }),
    { type: 'progress', stage: 'checking', planned: 4, completed: 4, emailsFound: 4 }
  )
  assert.deepEqual(
    parseProgressEvent({ type: 'progress', stage: 'checking', planned: -3, completed: 'NaN', emailsFound: null }),
    { type: 'progress', stage: 'checking', planned: 0, completed: 0, emailsFound: 0 }
  )
  const saving = parseProgressEvent({ type: 'progress', stage: 'saving', considered: 2, processed: 5, saved: 9, duplicates: 0, invalid: 0, failed: 0 })
  assert.ok(saving.processed <= saving.considered && saving.saved <= saving.processed)
})

// ---------------- client progress model ----------------

test('website checks show a real percentage and keep emails as a separate metric', () => {
  const progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'checking', planned: 8, completed: 4, emailsFound: 1 })
  const checking = stage(view(progress), 'checking')
  assert.equal(checking.progress, 50)
  assert.equal(checking.indeterminate, false)
  assert.equal(checking.value, '4 of 8')
  assert.equal(checking.detail, '1 email found')
})

test('failed checks advance the meter without inflating emails', () => {
  const progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'checking', planned: 8, completed: 8, emailsFound: 0 })
  const checking = stage(view(progress), 'checking')
  assert.equal(checking.progress, 100)
  assert.equal(checking.detail, '0 emails found')
})

test('zero eligible websites reports "No websites to check" instead of a stuck bar', () => {
  const progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'checking', planned: 0, completed: 0, emailsFound: 0 })
  const checking = stage(view(progress), 'checking')
  assert.equal(checking.state, 'complete')
  assert.equal(checking.value, 'No websites to check')
  assert.equal(checking.progress, 100)
})

test('saving shows attempted versus saved and never reaches complete without the result event', () => {
  let progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'saving', considered: 10, processed: 5, saved: 4, duplicates: 1, invalid: 0, failed: 0 })
  let saving = stage(view(progress), 'saving')
  assert.equal(saving.progress, 50)
  assert.equal(saving.value, '5 of 10 processed')
  assert.equal(saving.detail, '4 saved · 1 duplicate')
  assert.equal(saving.indeterminate, false)

  progress = applyProgressEvent(progress, { type: 'progress', stage: 'saving', considered: 10, processed: 10, saved: 9, duplicates: 1, invalid: 0, failed: 0 })
  saving = stage(view(progress), 'saving')
  assert.equal(saving.progress, 100)
  assert.equal(saving.state, 'active') // 100% processed, but completion belongs to the result event

  saving = stage(view(confirmDiscoveryResult(progress), 9), 'saving')
  assert.equal(saving.state, 'complete')
  assert.equal(saving.value, '9 saved')
})

test('save failures appear as failures, not as saved businesses', () => {
  const progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'saving', considered: 3, processed: 3, saved: 1, duplicates: 0, invalid: 0, failed: 2 })
  assert.equal(stage(view(progress), 'saving').detail, '1 saved · 2 failed')
})

test('no businesses: saving reports "Nothing to save" rather than a fabricated bar', () => {
  const progress = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, { type: 'progress', stage: 'saving', considered: 0, processed: 0, saved: 0, duplicates: 0, invalid: 0, failed: 0 })
  assert.equal(stage(view(progress), 'saving').value, 'Nothing to save')
})

test('duplicate events are idempotent and older events never move progress backwards', () => {
  const newer = { type: 'progress', stage: 'checking', planned: 8, completed: 6, emailsFound: 2 }
  const older = { type: 'progress', stage: 'checking', planned: 8, completed: 3, emailsFound: 1 }
  const once = applyProgressEvent(INITIAL_DISCOVERY_PROGRESS, newer)
  assert.equal(applyProgressEvent(once, newer), once) // same object: nothing changed
  const afterOld = applyProgressEvent(once, older)
  assert.deepEqual(afterOld.checks, once.checks)
  assert.equal(stage(view(afterOld), 'checking').progress, 75)
})

test('without progress events (older server) the honest indeterminate fallback is kept', () => {
  const progress = ['🔬 A', '🔬 B', '✨ A'].reduce(applyDiscoveryLog, INITIAL_DISCOVERY_PROGRESS)
  const checking = stage(view(progress), 'checking')
  assert.equal(checking.indeterminate, true)
  assert.equal(checking.progress, null)
  assert.equal(checking.value, '1 checked')
})

// A full recorded stream, as it appears on the wire, fed through the same steps the page uses.
function consume(stream) {
  let progress = INITIAL_DISCOVERY_PROGRESS
  const history = []
  for (const line of stream) {
    if (!line.startsWith('data: ')) continue
    const parsed = JSON.parse(line.slice(6))
    if (parsed.type === 'log') progress = applyDiscoveryLog(progress, parsed.message)
    else if (parsed.type === 'progress') {
      const event = parseProgressEvent(parsed)
      if (event) progress = applyProgressEvent(progress, event)
    } else if (parsed.type === 'result') progress = confirmDiscoveryResult(progress)
    // unknown event types are ignored, exactly like the existing consumers
    history.push(getStageViews(progress, 10, { running: true, savedCount: parsed.type === 'result' ? parsed.payload.addedCount : null }))
  }
  return { progress, history }
}

const sse = (value) => `data: ${JSON.stringify(value)}\n\n`.trimEnd()
const log = (message) => sse({ type: 'log', message })

test('event ordering end to end: stages only move forward and finish on the result event', () => {
  const stream = [
    log('🟢 stream started'),
    log('Finding businesses'),
    ...Array.from({ length: 10 }, (_, i) => log(`📥 Biz ${i + 1}`)),
    log('📦 discovered: 10'),
    sse({ type: 'progress', stage: 'checking', planned: 8, completed: 0, emailsFound: 0 }),
    log('Checking websites'),
    ...Array.from({ length: 8 }, (_, i) => [
      log(`🔬 Biz ${i + 1}`),
      log(i < 5 ? `✨ Biz ${i + 1}` : `⛔ no email: Biz ${i + 1}`),
      sse({ type: 'progress', stage: 'checking', planned: 8, completed: i + 1, emailsFound: Math.min(i + 1, 5) }),
    ]).flat(),
    log('📊 websites: 8, valid emails: 5, enrichment rate: 62.5%'),
    log('📦 enriched: 7'),
    sse({ type: 'progress', stage: 'saving', considered: 7, processed: 0, saved: 0, duplicates: 0, invalid: 0, failed: 0 }),
    ...Array.from({ length: 7 }, (_, i) =>
      sse({ type: 'progress', stage: 'saving', considered: 7, processed: i + 1, saved: i + 1, duplicates: 0, invalid: 0, failed: 0 })
    ),
    sse({ type: 'progress', stage: 'saving', considered: 7, processed: 7, saved: 7, duplicates: 0, invalid: 0, failed: 0 }), // duplicate
    sse({ type: 'telemetry', note: 'future event type' }), // unknown type is ignored
    log('💾 saved: 7, duplicates: 0, invalid: 0, db errors: 0'),
    log('🎉 Prospecting complete'),
    sse({ type: 'result', payload: { addedCount: 7 } }),
  ]

  const { progress, history } = consume(stream)
  const rank = { pending: 0, active: 1, complete: 2 }

  for (const key of ['finding', 'checking', 'saving']) {
    const states = history.map((views) => rank[stage(views, key).state])
    assert.ok(states.every((value, index) => index === 0 || value >= states[index - 1]), `${key} never moves backwards`)
  }
  for (const key of ['checking', 'saving']) {
    const percents = history.map((views) => stage(views, key).progress).filter((value) => value !== null)
    assert.ok(percents.every((value) => value >= 0 && value <= 100), `${key} stays within 0-100`)
    assert.ok(percents.every((value, index) => index === 0 || value >= percents[index - 1]), `${key} percent is monotonic`)
  }

  // before the result event nothing is complete in the saving stage
  const beforeResult = history.at(-2)
  assert.equal(stage(beforeResult, 'saving').state, 'active')
  assert.equal(stage(beforeResult, 'saving').progress, 100)
  // the result event is what completes it
  const final = history.at(-1)
  assert.deepEqual(final.map((item) => item.state), ['complete', 'complete', 'complete'])
  assert.equal(stage(final, 'saving').value, '7 saved')
  assert.equal(progress.resultConfirmed, true)
})

test('guest stream: saves are counted from events, with no 💾 log line required', () => {
  const stream = [
    log('📦 discovered: 2'),
    sse({ type: 'progress', stage: 'checking', planned: 0, completed: 0, emailsFound: 0 }),
    log('📦 enriched: 2'),
    sse({ type: 'progress', stage: 'saving', considered: 2, processed: 1, saved: 1, duplicates: 0, invalid: 0, failed: 0 }),
    sse({ type: 'progress', stage: 'saving', considered: 2, processed: 2, saved: 2, duplicates: 0, invalid: 0, failed: 0 }),
    sse({ type: 'result', payload: { addedCount: 2 } }),
  ]
  const { progress, history } = consume(stream)
  assert.equal(progress.saved, null) // guests never receive the 💾 log
  assert.equal(stage(history.at(-1), 'saving').value, '2 saved')
})

test('owner-preview reuse of an existing business is reported as saved, matching the result count', () => {
  const route = read('app/api/scrape/route.ts')
  const reuse = route.slice(route.indexOf('const requeue = await enqueueLeadEnrichment'))
  assert.match(reuse.slice(0, 400), /saveTracker\.record\('saved'\)/)
})

// ---------------- compatibility ----------------

test('existing event types are untouched and the new type is purely additive', () => {
  const route = read('app/api/scrape/route.ts')
  assert.match(route, /emit\(\{ type: 'log', message: msg \}\)/)
  assert.match(route, /emit\(\{ type: 'lead', payload: lead \}\)/)
  assert.match(route, /emit\(\{ type: 'result', payload: resultPayload \}\)/)
  assert.match(route, /onProgress\(event\) \{\s*try \{\s*emit\(event\)/)
  assert.match(route, /\} catch \{\s*\/\/ stream already closed or cancelled/)
})

test('no persistence is reported before it succeeds: saved is recorded after the save and enqueue', () => {
  const route = read('app/api/scrape/route.ts')
  const savedBranch = route.slice(route.indexOf('const saved = await saveLead'))
  assert.ok(savedBranch.indexOf('await enqueueLeadEnrichment(saved.id') < savedBranch.indexOf("saveTracker.record('saved')"))
  assert.ok(savedBranch.indexOf('saveLead(') < savedBranch.indexOf("saveTracker.record('duplicate')"))
  assert.match(route, /saveTracker\.record\('failed'\)/)
})

test('other consumers of the discovery code and stream are unaffected', () => {
  // agent missions call the shared discovery with two arguments only
  const executor = read('lib/agent/mission-executor.ts')
  assert.match(executor, /mode: 'fast',\s*\},\s*\(\) => \{\}\s*\)/)
  // the landing trial flow only acts on 'lead' and 'result' events and ignores everything else
  const trial = read('components/landing/FreeTrialCommandFlow.tsx')
  assert.match(trial, /evt\.type === 'lead'/)
  assert.match(trial, /evt\.type === 'result'/)
  assert.doesNotMatch(trial, /evt\.type === 'progress'/)
  // Discover reads progress at both parse sites and still decides completion on the result event
  const page = read('app/dashboard/scraper/page.tsx')
  assert.equal((page.match(/parsed\?\.type === 'progress'/g) || []).length, 2)
  assert.match(page, /parseProgressEvent\(raw\)/)
  assert.match(page, /const handleResult = \(result: ScrapeResultPayload\) => \{[\s\S]*?finish\('Discovery complete\.'\)/)
})

test('discovery logic itself is untouched: hooks only observe', () => {
  const shared = read('lib/scraper/run-scraper-shared.ts')
  assert.match(shared, /const initialCheckQueue = validDiscoveredLeads\.filter\(shouldAttemptEnrichment\)/)
  assert.match(shared, /websiteChecks\.plan\(googleEnrichmentTargets\.length\)/)
  // the same filter and queue as before; tracker calls sit beside, not inside, the decisions
  assert.equal((shared.match(/tracker\?\.complete\(/g) || []).length, 3)
})
