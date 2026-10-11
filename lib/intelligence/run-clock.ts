// The stopwatch for one Discover run: from the start of Discover to the final Business Intelligence state.
//
// The server reports its own timestamps (the run's creation and the end of its last job) together with its clock at
// that moment. Each is converted to the browser's clock using the moment the answer arrived, so a browser whose clock
// is off still shows the right durations, and a refresh gives the same numbers from what the database persisted.

export type RunTiming = { startedAt: string | null; endedAt: string | null; serverNow: string }

export type RunClock = { startedAtMs: number; endedAtMs: number | null }

/** The browser-clock time of a server timestamp: `receivedAtMs` minus how long before the answer the event happened. */
function toBrowserMs(iso: string | null, serverNow: string, receivedAtMs: number): number | null {
  if (!iso) return null
  const at = Date.parse(iso)
  const now = Date.parse(serverNow)
  return Number.isFinite(at) && Number.isFinite(now) ? receivedAtMs - Math.max(now - at, 0) : null
}

export function toRunClock(timing: RunTiming | null | undefined, receivedAtMs: number): RunClock | null {
  if (!timing) return null
  const startedAtMs = toBrowserMs(timing.startedAt, timing.serverNow, receivedAtMs)
  if (startedAtMs === null) return null
  return { startedAtMs, endedAtMs: toBrowserMs(timing.endedAt, timing.serverNow, receivedAtMs) }
}

/**
 * `totalMs` runs from the start of Discover (when this page saw it; otherwise from the start of the run) to the end of
 * Business Intelligence, and stops there. `intelligenceMs` is Business Intelligence alone. Both are null without a run.
 */
export function computeRunElapsed(discoverStartedAtMs: number | null, clock: RunClock | null, nowMs: number) {
  if (!clock) return { totalMs: null, intelligenceMs: null, final: false }
  const end = clock.endedAtMs ?? nowMs
  const start = discoverStartedAtMs ?? clock.startedAtMs
  return {
    totalMs: Math.max(end - start, 0),
    intelligenceMs: Math.max(end - clock.startedAtMs, 0),
    final: clock.endedAtMs !== null,
  }
}
