// Is cost tracking working? Decided from facts the database reports: whether tracking is enabled, whether it is receiving activity it is
// expected to receive, and the write failures that could be recorded. Pure.
//
// "Healthy" is never the default. An empty failure list proves nothing (a broken tracker also has no failures), so healthy needs positive
// evidence: tracking has recorded events, there was independent activity to compare with, and that activity was recorded.

export type RawTrackingHealth = {
  first_event_at: string | null
  last_event_at: string | null
  events_24h: number
  /** Member discovery runs that saved results after tracking began (older than a 15-minute grace). Independent of tracking itself. */
  expected_runs: number
  /** Of those, the runs tracking also recorded. */
  covered_runs: number
  failures_7d: number
  failures_30d: number
  last_failure_at: string | null
}

export type HealthState = 'healthy' | 'degraded' | 'unknown'
export type HealthReason =
  | 'not_enabled' // the cost tables are not in this database
  | 'unavailable' // the health facts could not be read
  | 'no_events' // enabled, but nothing has been recorded yet
  | 'no_expected_activity' // recording, but nothing independent to compare it with
  | 'failures' // write failures were recorded in the last 7 days
  | 'missing_runs' // runs happened that tracking did not record
  | 'confirmed' // events recorded and the activity that was expected was recorded

export type TrackingHealth = {
  state: HealthState
  reason: HealthReason
  headline: string
  detail: string
  /** Always shown: what this check cannot see. */
  caveat: string
  events24h: number
  lastEventAt: string | null
  expectedRuns: number
  coveredRuns: number
  missingRuns: number
  failures7d: number
  failures30d: number
  lastFailureAt: string | null
}

export const HEALTH_CAVEAT =
  'Unexpected serverless termination, or a database outage while a request is running, can lose a record without leaving any trace, so some gaps cannot be detected. The cross-check covers member discovery runs only, not guest searches or AI profile calls.'

/** Share of expected runs that may be missing before tracking is called degraded. */
export const MISSING_RUN_TOLERANCE = 0.05

const n = (value: unknown) => { const v = Number(value); return Number.isFinite(v) ? v : 0 }

const base = (raw: RawTrackingHealth | null) => ({
  caveat: HEALTH_CAVEAT,
  events24h: n(raw?.events_24h),
  lastEventAt: raw?.last_event_at ?? null,
  expectedRuns: n(raw?.expected_runs),
  coveredRuns: n(raw?.covered_runs),
  missingRuns: Math.max(0, n(raw?.expected_runs) - n(raw?.covered_runs)),
  failures7d: n(raw?.failures_7d),
  failures30d: n(raw?.failures_30d),
  lastFailureAt: raw?.last_failure_at ?? null,
})

export function classifyTrackingHealth(raw: RawTrackingHealth | null, status: 'ok' | 'not_enabled' | 'unavailable' = raw ? 'ok' : 'unavailable'): TrackingHealth {
  const facts = base(status === 'ok' ? raw : null)
  if (status === 'not_enabled') {
    return { ...facts, state: 'unknown', reason: 'not_enabled', headline: 'Unknown: tracking is not switched on', detail: 'The cost tables have not been created in this database, so nothing is being recorded or checked.' }
  }
  if (!raw || status === 'unavailable') {
    return { ...facts, state: 'unknown', reason: 'unavailable', headline: 'Unknown: the tracking check could not be read', detail: 'ALPA could not read its own tracking records just now. The figures below may be incomplete.' }
  }

  // Failures that were recorded are evidence of a problem whatever else is true.
  if (facts.failures7d > 0) {
    return {
      ...facts, state: 'degraded', reason: 'failures',
      headline: `Degraded: ${facts.failures7d.toLocaleString('en-US')} usage ${facts.failures7d === 1 ? 'recording' : 'recordings'} failed in the last 7 days`,
      detail: 'Spending shown may be lower than the real spending for the affected period. Customer searches and AI research were not interrupted.',
    }
  }
  if (!raw.first_event_at) {
    return { ...facts, state: 'unknown', reason: 'no_events', headline: 'Unknown: nothing has been recorded yet', detail: 'Tracking is switched on but has not recorded a request. It cannot be confirmed to work until it has received activity.' }
  }
  const tolerance = Math.floor(facts.expectedRuns * MISSING_RUN_TOLERANCE)
  if (facts.missingRuns > tolerance) {
    return {
      ...facts, state: 'degraded', reason: 'missing_runs',
      headline: `Degraded: ${facts.missingRuns.toLocaleString('en-US')} of ${facts.expectedRuns.toLocaleString('en-US')} recent discovery runs were not recorded`,
      detail: 'These runs saved results for customers but left no cost record, so their spending is missing from the figures.',
    }
  }
  if (facts.expectedRuns === 0) {
    return { ...facts, state: 'unknown', reason: 'no_expected_activity', headline: 'Unknown: no recent activity to check against', detail: 'There were no member discovery runs since tracking began, so ALPA cannot confirm that tracking is receiving the activity it should. No failures were recorded, which on its own proves nothing.' }
  }
  return {
    ...facts, state: 'healthy', reason: 'confirmed',
    headline: 'Healthy: recent discovery runs were recorded',
    detail: `${facts.coveredRuns.toLocaleString('en-US')} of ${facts.expectedRuns.toLocaleString('en-US')} recent member discovery runs have cost records and no failed recordings were logged in the last 7 days.`,
  }
}
