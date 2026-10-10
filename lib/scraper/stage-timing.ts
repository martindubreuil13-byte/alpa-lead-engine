// Client-observed stage timing for the Discover pipeline.
//
// The discovery stream carries no server timestamps (and A1 does not change the SSE protocol),
// so durations are measured in the customer's browser from the moments the authoritative
// events arrive. The UI says so ("measured in your browser"). Once a stage has a completion
// time it never changes: timers freeze at the real moment the stage finished.

import type { DiscoveryProgress } from './discover-progress.ts'

export type RunTimings = {
  /** When the search request was started. */
  startedAt: number | null
  /** When the final discovered count arrived (`📦 discovered`). */
  discoveryAt: number | null
  /** When website checking was first announced or observed. */
  enrichStartedAt: number | null
  /** When website checking finished (`📦 enriched`). */
  enrichAt: number | null
}

export const EMPTY_RUN_TIMINGS: RunTimings = {
  startedAt: null,
  discoveryAt: null,
  enrichStartedAt: null,
  enrichAt: null,
}

export function startRunTimings(now: number): RunTimings {
  return { ...EMPTY_RUN_TIMINGS, startedAt: now }
}

/**
 * Records first-observation timestamps. Returns the same object when nothing changed so
 * React state updates stay cheap, and never overwrites a timestamp that is already set.
 */
export function advanceRunTimings(previous: RunTimings, progress: DiscoveryProgress, now: number): RunTimings {
  if (previous.startedAt === null) return previous

  let next = previous

  if (next.discoveryAt === null && progress.discoveredFinal !== null) {
    next = { ...next, discoveryAt: now }
  }

  const enrichmentObserved = progress.checks !== null || progress.checksStarted > 0
  if (next.enrichStartedAt === null && enrichmentObserved) {
    next = { ...next, enrichStartedAt: now }
  }

  if (next.enrichAt === null && progress.contactReady !== null) {
    next = {
      ...next,
      enrichStartedAt: next.enrichStartedAt ?? now,
      enrichAt: now,
    }
  }

  return next
}

/** Elapsed milliseconds for a stage: frozen once `end` exists, live otherwise, null before it starts. */
export function stageDurationMs(start: number | null, end: number | null, now: number): number | null {
  if (start === null) return null
  return Math.max((end ?? now) - start, 0)
}

export function formatStageDuration(milliseconds: number | null): string {
  if (milliseconds === null) return ''
  const seconds = milliseconds / 1000
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}
