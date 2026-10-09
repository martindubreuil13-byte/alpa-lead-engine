export const WORKER_DEFAULTS = {
  batchSize: 2,
  concurrency: 1,
  staleTimeoutSeconds: 600,
} as const

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

export function resolveWorkerConfig(env: Record<string, string | undefined> = process.env) {
  return {
    batchSize: positiveInteger(env.CI_WORKER_BATCH_SIZE, WORKER_DEFAULTS.batchSize, 20),
    concurrency: positiveInteger(env.CI_WORKER_CONCURRENCY, WORKER_DEFAULTS.concurrency, 4),
    staleTimeoutSeconds: positiveInteger(
      env.CI_WORKER_STALE_SECONDS,
      WORKER_DEFAULTS.staleTimeoutSeconds,
      3600
    ),
  }
}
