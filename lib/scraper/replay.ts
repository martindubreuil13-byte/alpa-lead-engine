// Pure replay engine: computes exactly what the interface would hold at any moment of a
// scenario. It reuses the real reducers, so the replay passes through the same logic as a real
// search. It has no timers, no network access and no storage; the studio component only
// decides which moment (t) to ask about, which also makes pause, restart and scrubbing trivial.

import {
  applyDiscoveryLog,
  applyProgressEvent,
  confirmDiscoveryResult,
  INITIAL_DISCOVERY_PROGRESS,
  type DiscoveryProgress,
} from './discover-progress.ts'
import { buildActivityItems, type LiveActivityItem } from './live-activity.ts'
import { advanceRunTimings, startRunTimings, type RunTimings } from './stage-timing.ts'
import { parseProgressEvent } from './progress-events.ts'
import type { ReplayScenario } from './replay-fixture.ts'

export type ReplayState = {
  progress: DiscoveryProgress
  timings: RunTimings
  lastEventAt: number | null
  activity: LiveActivityItem[]
  /** True until the result event has been reached. */
  running: boolean
  finished: boolean
}

export function replayStateAt(scenario: ReplayScenario, tMs: number): ReplayState {
  let progress = INITIAL_DISCOVERY_PROGRESS
  let timings = startRunTimings(0)
  let lastEventAt: number | null = null
  const logs: string[] = []

  for (const event of scenario.events) {
    if (event.at > tMs) break

    if (event.kind === 'log') {
      logs.push(event.message)
      progress = applyDiscoveryLog(progress, event.message)
    } else if (event.kind === 'progress') {
      const parsed = parseProgressEvent(event.event)
      if (parsed) progress = applyProgressEvent(progress, parsed)
    } else {
      progress = confirmDiscoveryResult(progress)
    }

    lastEventAt = event.at
    // Timestamps come from the scenario clock, so durations are the scenario's, not real ones.
    timings = advanceRunTimings(timings, progress, event.at)
  }

  return {
    progress,
    timings,
    lastEventAt,
    activity: buildActivityItems(logs),
    running: !progress.resultConfirmed,
    finished: progress.resultConfirmed,
  }
}
