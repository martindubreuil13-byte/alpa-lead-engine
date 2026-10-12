import { RESEARCH_HARD_LIMITS } from './research-limits.ts'

export const WORKER_DEFAULTS = {
  batchSize: 2,
  concurrency: 1,
  // A claimed job has its own 60 s deadline (+5 s grace), so 180 s of silence means the worker that held it died. A shorter
  // stale window returns an interrupted job to the queue (or fails it, with one attempt) much sooner than the old 600 s.
  staleTimeoutSeconds: 180,
  /** Claim rounds one tick may run while time remains: 25 rounds of 2 jobs is one full 50-profile search per tick. */
  maxRounds: 25,
} as const

function positiveInteger(value: string | undefined, fallback: number, maximum: number, minimum = 1) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum ? Math.min(parsed, maximum) : fallback
}

export function resolveWorkerConfig(env: Record<string, string | undefined> = process.env) {
  return {
    batchSize: positiveInteger(env.CI_WORKER_BATCH_SIZE, WORKER_DEFAULTS.batchSize, RESEARCH_HARD_LIMITS.maxBatchSize),
    concurrency: positiveInteger(env.CI_WORKER_CONCURRENCY, WORKER_DEFAULTS.concurrency, RESEARCH_HARD_LIMITS.maxConcurrency),
    maxRounds: positiveInteger(env.CI_WORKER_ROUNDS, WORKER_DEFAULTS.maxRounds, RESEARCH_HARD_LIMITS.maxRounds),
    staleTimeoutSeconds: positiveInteger(
      env.CI_WORKER_STALE_SECONDS,
      WORKER_DEFAULTS.staleTimeoutSeconds,
      RESEARCH_HARD_LIMITS.maxStaleSeconds,
      RESEARCH_HARD_LIMITS.minStaleSeconds
    ),
  }
}
