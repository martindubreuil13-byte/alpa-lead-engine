// The presentation state model for the Discover "living intelligence engine".
//
// One pure function turns real progress (the same progress, timing and event-recency data the
// live page already holds) into everything the visuals need. The live Discover page and the
// local replay studio both feed this function, so the two can never drift apart.
//
// Honesty rules encoded here:
//  - The discovery number is the real count only. While searching it is not claimed at all.
//  - Website figures come from authoritative progress events, not from the passage of time.
//  - Signal states are aggregates (how many website checks finished, how many produced an email); they
//    do not identify individual businesses.
//  - The Profile stage is always "upcoming" until background research genuinely exists.
//  - A long silence from the stream is reported as a stall instead of animating forever.

import { getDiscoveredCount, type DiscoveryProgress } from './discover-progress.ts'
import { stageDurationMs, type RunTimings } from './stage-timing.ts'

/** How long the discovery count stays the single focal point before the view moves on to enrichment. */
export const ACHIEVEMENT_HOLD_MS = 1800
/** Silence from the stream, while a search is running, after which we say so honestly. */
export const STALL_AFTER_MS = 20_000

/**
 * The one thing the interface emphasizes right now. 'settled' is reached only when the
 * authoritative result has arrived: the engine becomes a compact summary above the results.
 */
export type EngineFocus = 'search' | 'discover' | 'enrich' | 'settled'
export type EnginePhase = 'searching' | 'checking' | 'finishing' | 'complete'

export type EngineView = {
  phase: EnginePhase
  focus: EngineFocus
  running: boolean
  elapsedMs: number
  stalled: boolean
  /** "Miami · Dentists" */
  context: string
  /** Businesses announced so far while discovery is still running. Real count, may be 0. */
  foundSoFar: number
  discover: {
    state: 'active' | 'complete'
    count: number
    durationMs: number | null
    searchingMore: boolean
  }
  enrich: {
    state: 'pending' | 'active' | 'complete'
    completed: number
    /** Null when the server did not announce a total. */
    planned: number | null
    /** 0–1 against the reported total; null when unknown. */
    ratio: number | null
    emails: number
    durationMs: number | null
  }
  /** Aggregated signal counts. They never identify individual businesses. */
  signals: { total: number; eligible: number; checked: number; withEmail: number }
  profile: { state: 'upcoming'; canContinue: boolean }
  resultConfirmed: boolean
}

export type EngineViewInput = {
  progress: DiscoveryProgress
  timings: RunTimings
  /** Wall-clock (or replay-clock) "now" in milliseconds. */
  nowMs: number
  /** When the most recent real event arrived; null before the first one. */
  lastEventAt: number | null
  requestedCount: number | null
  businessType: string
  location: string
  running: boolean
  /** Presentation hold for the achievement; pass 0 for users who prefer reduced motion. */
  holdMs?: number
}

export function buildEngineView(input: EngineViewInput): EngineView {
  const { progress, timings, nowMs, lastEventAt, requestedCount, running } = input
  const holdMs = input.holdMs ?? ACHIEVEMENT_HOLD_MS

  const discoveryDone = progress.discoveredFinal !== null
  const count = getDiscoveredCount(progress, requestedCount)

  const checks = progress.checks
  const enrichmentComplete = progress.contactReady !== null || (checks !== null && checks.planned === 0)
  const enrichmentObserved = checks !== null || progress.checksStarted > 0

  const completed = checks ? checks.completed : progress.checksFinished
  const planned = checks ? checks.planned : null
  const emails = checks ? checks.emailsFound : progress.emailsFound
  const ratio = planned === null ? null : planned === 0 ? 1 : Math.min(completed / planned, 1)

  const enrichState: EngineView['enrich']['state'] = enrichmentComplete
    ? 'complete'
    : enrichmentObserved
      ? 'active'
      : 'pending'

  const total = discoveryDone ? count : 0
  const eligible = discoveryDone ? Math.min(planned ?? total, total) : 0
  const checked = Math.min(completed, eligible)
  const withEmail = Math.min(emails, checked)

  const inAchievementHold =
    discoveryDone &&
    holdMs > 0 &&
    timings.discoveryAt !== null &&
    nowMs - timings.discoveryAt < holdMs &&
    enrichState !== 'complete' &&
    !progress.resultConfirmed

  const focus: EngineFocus = progress.resultConfirmed
    ? 'settled'
    : !discoveryDone
      ? 'search'
      : inAchievementHold
        ? 'discover'
        : 'enrich'

  const phase: EnginePhase = progress.resultConfirmed
    ? 'complete'
    : !discoveryDone
      ? 'searching'
      : enrichState === 'complete'
        ? 'finishing'
        : 'checking'

  const stalled =
    running && !progress.resultConfirmed && lastEventAt !== null && nowMs - lastEventAt > STALL_AFTER_MS

  const context = [input.location, input.businessType]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')

  return {
    phase,
    focus,
    running,
    elapsedMs: timings.startedAt === null ? 0 : Math.max(nowMs - timings.startedAt, 0),
    stalled,
    context,
    foundSoFar: discoveryDone ? count : requestedCount ? Math.min(progress.candidatesFound, requestedCount) : progress.candidatesFound,
    discover: {
      state: discoveryDone ? 'complete' : 'active',
      count,
      durationMs: stageDurationMs(timings.startedAt, timings.discoveryAt, nowMs),
      searchingMore: progress.searchingMore,
    },
    enrich: {
      state: enrichState,
      completed,
      planned,
      ratio,
      emails,
      durationMs: stageDurationMs(timings.enrichStartedAt, timings.enrichAt, nowMs),
    },
    signals: { total, eligible, checked, withEmail },
    profile: { state: 'upcoming', canContinue: progress.resultConfirmed },
    resultConfirmed: progress.resultConfirmed,
  }
}

export type SignalState = 'email' | 'checked' | 'waiting' | 'skipped'

/**
 * Aggregate signal states for the visual. The first `withEmail` signals are email-bearing,
 * the next checked ones are plain, the rest of the eligible ones wait, and any businesses with
 * no website to check are marked skipped. Position carries no meaning about a specific business.
 */
export function getSignalStates(signals: EngineView['signals']): SignalState[] {
  return Array.from({ length: signals.total }, (_, index): SignalState => {
    if (index < signals.withEmail) return 'email'
    if (index < signals.checked) return 'checked'
    if (index < signals.eligible) return 'waiting'
    return 'skipped'
  })
}
