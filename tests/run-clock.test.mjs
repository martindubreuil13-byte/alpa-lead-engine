import test from 'node:test'
import assert from 'node:assert/strict'

import { computeRunElapsed, toRunClock } from '../lib/intelligence/run-clock.ts'
import { describeIntelligence, summarizeRun } from '../lib/intelligence/run-progress.ts'

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
  assert.deepEqual(computeRunElapsed(1_000_000, running, 1_050_000), { totalMs: 50_000, intelligenceMs: 30_000, final: false })
  assert.equal(computeRunElapsed(1_000_000, running, 1_090_000).totalMs, 90_000)
  const done = { startedAtMs: 1_020_000, endedAtMs: 1_080_000 }
  assert.deepEqual(computeRunElapsed(1_000_000, done, 9_999_999), { totalMs: 80_000, intelligenceMs: 60_000, final: true })
})

test('after a refresh (no Discover start) the stopwatch runs from the persisted run start; with no run there is none', () => {
  assert.equal(computeRunElapsed(null, { startedAtMs: 1_020_000, endedAtMs: null }, 1_050_000).totalMs, 30_000)
  assert.deepEqual(computeRunElapsed(1_000_000, null, 2_000_000), { totalMs: null, intelligenceMs: null, final: false })
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

test('the stopwatch is one continuous clock: it never freezes while research is running and stops only at the true end', () => {
  const running = { startedAtMs: 1_000_000, endedAtMs: null }
  assert.equal(computeRunElapsed(990_000, running, 1_015_000).totalMs, 25_000)
  assert.equal(computeRunElapsed(990_000, running, 1_130_000).totalMs, 140_000) // well past 20s: still counting
  assert.equal(computeRunElapsed(990_000, running, 1_130_000).final, false)
  const done = computeRunElapsed(990_000, { startedAtMs: 1_000_000, endedAtMs: 1_135_000 }, 5_000_000)
  assert.deepEqual(done, { totalMs: 145_000, intelligenceMs: 135_000, final: true })
})
