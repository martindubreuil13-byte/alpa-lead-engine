import test from 'node:test'
import assert from 'node:assert/strict'

import { computeRunElapsed, toRunClock } from '../lib/intelligence/run-clock.ts'
import { describeIntelligence, summarizeRun, toBackgroundStage } from '../lib/intelligence/run-progress.ts'

const rows = (states) => states.map((state, i) => ({ lead_id: `l${i}`, state }))

test('server timestamps are converted with the answer time, so a skewed browser clock does not matter', () => {
  // The server says the run began 40s and ended 10s before the answer; the browser received it at its own 1_000_000.
  const clock = toRunClock({ startedAt: '2026-10-11T12:00:00Z', endedAt: '2026-10-11T12:00:30Z', serverNow: '2026-10-11T12:00:40Z' }, 1_000_000)
  assert.deepEqual(clock, { startedAtMs: 960_000, endedAtMs: 990_000 })
  assert.equal(toRunClock(null, 1), null)
  assert.equal(toRunClock({ startedAt: null, endedAt: null, serverNow: '2026-10-11T12:00:40Z' }, 1), null)
})

test('the stopwatch runs from Discover start, keeps going while running and freezes at the final state', () => {
  const running = { startedAtMs: 1_020_000, endedAtMs: null }
  assert.deepEqual(computeRunElapsed(1_000_000, running, 1_050_000), { totalMs: 50_000, intelligenceMs: 30_000, foregroundMs: 40_000, final: false, backgrounded: true })
  assert.equal(computeRunElapsed(1_000_000, running, 1_090_000).totalMs, 90_000)
  const done = { startedAtMs: 1_020_000, endedAtMs: 1_080_000 }
  assert.deepEqual(computeRunElapsed(1_000_000, done, 9_999_999), { totalMs: 80_000, intelligenceMs: 60_000, foregroundMs: 40_000, final: true, backgrounded: false })
})

test('after a refresh (no Discover start) the stopwatch runs from the persisted run start; with no run there is none', () => {
  assert.equal(computeRunElapsed(null, { startedAtMs: 1_020_000, endedAtMs: null }, 1_050_000).totalMs, 30_000)
  assert.deepEqual(computeRunElapsed(1_000_000, null, 2_000_000), { totalMs: null, intelligenceMs: null, foregroundMs: null, final: false, backgrounded: false })
})

test('the progress line counts resolved over authorized profiles and is never full while any is pending', () => {
  const at = (states) => describeIntelligence(summarizeRun(rows(states)), true)
  assert.equal(at(['queued', 'queued', 'queued', 'queued']).progress, 0)
  assert.equal(at(['ready', 'ready', 'researching', 'queued']).progress, 0.5)
  assert.equal(at(['ready', 'ready', 'ready', 'retry_pending']).progress, 0.75)
  assert.ok(at(['ready', 'ready', 'ready', 'researching']).progress < 1)
  // Failed profiles have ended; profiles without a website were never authorized and do not count.
  assert.equal(at(['ready', 'failed', 'unavailable', 'unavailable']).progress, 1)
  assert.equal(at(['ready', 'failed', 'unavailable', 'unavailable']).phase, 'complete')
  assert.equal(at(['unavailable', 'unavailable']).progress, null)
})

test('after the 20s foreground budget the experience time freezes while the true research time keeps running', () => {
  const running = { startedAtMs: 1_000_000, endedAtMs: null }
  const early = computeRunElapsed(990_000, running, 1_015_000)
  assert.equal(early.backgrounded, false)
  const late = computeRunElapsed(990_000, running, 1_130_000)
  assert.equal(late.backgrounded, true)
  assert.equal(late.foregroundMs, 30_000) // Discover start to 20s into Business Intelligence, frozen
  assert.equal(late.intelligenceMs, 130_000) // the true research time, not capped
  assert.equal(late.totalMs, 140_000)
  const done = computeRunElapsed(990_000, { startedAtMs: 1_000_000, endedAtMs: 1_135_000 }, 5_000_000)
  assert.equal(done.backgrounded, false) // finished: the true total is shown, nothing is "background" any more
  assert.equal(done.totalMs, 145_000)
})

test('the background summary names the unfinished profiles by their real state and leaves other stages alone', () => {
  const states = ['ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'researching']
  const stage = describeIntelligence(summarizeRun(rows(states)), true)
  const bg = toBackgroundStage(stage, rows(states), true)
  assert.equal(bg.phase, 'background')
  assert.equal(bg.headline, '9 of 10 profiles ready')
  assert.match(bg.detail, /1 still processing · continuing in the background/)
  assert.equal(bg.live, true)
  assert.equal(toBackgroundStage(stage, rows(states), false), stage)
  const retry = ['ready', 'retry_pending', 'queued', 'unavailable']
  assert.match(toBackgroundStage(describeIntelligence(summarizeRun(rows(retry)), true), rows(retry), true).detail, /1 awaiting retry · 1 waiting to start/)
  const done = describeIntelligence(summarizeRun(rows(['ready', 'ready'])), true)
  assert.equal(toBackgroundStage(done, rows(['ready', 'ready']), true).phase, 'complete')
  const off = describeIntelligence(summarizeRun(rows(['queued'])), false)
  assert.equal(toBackgroundStage(off, rows(['queued']), true).phase, 'not_running')
})
