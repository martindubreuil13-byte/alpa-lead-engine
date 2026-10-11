import { RESEARCH_HARD_LIMITS } from './research-limits.ts'

export const WORKER_DEFAULTS = {
  batchSize: 2,
  concurrency: 1,
  staleTimeoutSeconds: 600,
  /** Claim rounds one tick may run while time remains (B2 Phase 1). The scheduler's tick keeps a run moving. */
  maxRounds: 8,
} as const

function positiveInteger(value: string | undefined, fallback: number, maximum: number, minimum = 1) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum ? Math.min(parsed, maximum) : fallback
}

export function resolveWorkerConfig(env: Record<string, string | undefined> = process.env) {
  return {
    batchSize: positiveInteger(env.CI_WORKER_BATCH_SIZE, WORKER_DEFAULTS.batchSize, RESEARCH_HARD_LIMITS.maxBatchSize),
    concurrency: positiveInteger(env.CI_WORKER_CONCURRENCY, WORKER_DEFAULTS.concurrency, RESEARCH_HARD_LIMITS.maxConcurrency),
    maxRounds: positiveInteger(env.CI_WORKER_ROUNDS, WORKER_DEFAULTS.maxRounds, 20),
    staleTimeoutSeconds: positiveInteger(
      env.CI_WORKER_STALE_SECONDS,
      WORKER_DEFAULTS.staleTimeoutSeconds,
      RESEARCH_HARD_LIMITS.maxStaleSeconds,
      RESEARCH_HARD_LIMITS.minStaleSeconds
    ),
  }
}
