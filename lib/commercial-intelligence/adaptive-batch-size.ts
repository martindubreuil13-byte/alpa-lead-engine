/**
 * Determines batch claim size based on queue depth.
 * Processes smaller batches for small queues (faster feedback),
 * larger batches for massive queues (throughput optimization).
 *
 * Logic:
 * - Queue < 100: Claim 10 items (responsive, quick feedback)
 * - Queue 100-1000: Claim 25 items (balanced)
 * - Queue > 1000: Claim 50 items (throughput)
 *
 * This can be tuned later by modifying the thresholds.
 */
export function getAdaptiveBatchSize(pendingCount: number): number {
  if (pendingCount < 100) return 10
  if (pendingCount < 1000) return 25
  return 50
}

/**
 * Get human-readable batch size for logging/monitoring.
 * Helps identify which batch tier is being used.
 */
export function describeBatchSize(pendingCount: number): string {
  const size = getAdaptiveBatchSize(pendingCount)
  if (size === 10) return '10 (responsive mode)'
  if (size === 25) return '25 (balanced mode)'
  return '50 (throughput mode)'
}
