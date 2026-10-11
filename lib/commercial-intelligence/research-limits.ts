// Hard ceilings for research execution. Environment settings may lower these, never raise them.
// They bound what one scheduled tick can start, so a misconfiguration cannot create runaway processing.

export const RESEARCH_HARD_LIMITS = {
  /** Most jobs one tick may claim. */
  maxBatchSize: 20,
  /** Most jobs researched at the same time inside one tick. */
  maxConcurrency: 4,
  /** Longest stale-claim timeout that may be configured, in seconds. */
  maxStaleSeconds: 3600,
  /** Shortest stale-claim timeout: a job is never reclaimed while it could still be running. */
  minStaleSeconds: 60,
} as const

/** The effective limits for the current configuration, for operators. Reads the environment only. */
export function describeResearchLimits(config: { batchSize: number; concurrency: number; staleTimeoutSeconds: number }, deadlineMs: number, graceMs: number, tickBudgetMs: number) {
  return {
    batchSize: config.batchSize,
    concurrency: config.concurrency,
    staleTimeoutSeconds: config.staleTimeoutSeconds,
    perJobDeadlineMs: deadlineMs,
    perJobGraceMs: graceMs,
    tickBudgetMs,
    hardLimits: RESEARCH_HARD_LIMITS,
  }
}
