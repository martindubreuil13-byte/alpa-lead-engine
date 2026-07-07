import { enrichLeadDirect } from '@/lib/commercial-intelligence/enrich-lead-direct'
import {
  claimPendingQueueItems,
  resetStaleProcessingItems,
  completeEnrichment,
  getQueueStats,
} from '@/lib/commercial-intelligence/queue-manager'

export interface ProcessCommercialIntelligenceQueueOptions {
  limit?: number
  source?: 'admin-route' | 'scrape-request' | 'client-trigger'
}

export interface DrainCommercialIntelligenceQueueOptions {
  batchLimit?: number
  maxBatches?: number
  maxRuntimeMs?: number
  source?: 'scrape-request' | 'client-trigger'
}

export async function processCommercialIntelligenceQueue(
  options: ProcessCommercialIntelligenceQueueOptions = {}
) {
  const startedAt = Date.now()
  const limit = options.limit ?? 10
  const source = options.source ?? 'admin-route'

  const { resetCount } = await resetStaleProcessingItems(300)

  const claimedItems = await claimPendingQueueItems(limit)
  console.log(`[CI-WORKER] claimed count: ${claimedItems.length}`)

  if (claimedItems.length === 0) {
    const stats = await getQueueStats()
    console.log('[CI-WORKER] completed count: 0')
    console.log('[CI-WORKER] failed count: 0')

    return {
      ok: true,
      message: 'Queue is empty',
      stats,
      processed: 0,
      recovered: resetCount,
      succeeded: 0,
      retrying: 0,
      failed: 0,
      results: [],
    }
  }

  let successCount = 0
  let retryCount = 0
  let failureCount = 0
  const results = []

  for (const queueItem of claimedItems) {
    try {
      const enrichResult = await enrichLeadDirect(queueItem.lead_id)

      const completeResult = await completeEnrichment(
        queueItem.id,
        queueItem.lead_id,
        enrichResult.website_snapshot,
        enrichResult.business_signals,
        enrichResult.commercial_profile,
        enrichResult.success,
        enrichResult.ci_last_error ?? undefined
      )

      if (!completeResult.ok) {
        failureCount++
        results.push({
          queueId: queueItem.id,
          leadId: queueItem.lead_id,
          status: 'error',
          reason: 'Failed to save enrichment to database',
        })
        continue
      }

      const nextStatus = completeResult.nextStatus || 'unknown'

      if (enrichResult.success) {
        successCount++
        results.push({
          queueId: queueItem.id,
          leadId: queueItem.lead_id,
          status: 'completed',
          duration: enrichResult.ci_processing_duration_ms,
          cost: enrichResult.ci_cost_estimate,
        })
      } else if (nextStatus === 'pending') {
        retryCount++
        results.push({
          queueId: queueItem.id,
          leadId: queueItem.lead_id,
          status: 'retrying',
          attempt: queueItem.retry_count + 1,
          reason: enrichResult.error?.message || 'Enrichment failed',
        })
      } else {
        failureCount++
        results.push({
          queueId: queueItem.id,
          leadId: queueItem.lead_id,
          status: 'failed',
          attempts: queueItem.retry_count + 1,
          reason: enrichResult.error?.message || 'Enrichment failed after retries',
        })
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[CI-WORKER] Exception processing queue ${queueItem.id}:`, err)

      const completeResult = await completeEnrichment(
        queueItem.id,
        queueItem.lead_id,
        null,
        null,
        null,
        false,
        `Exception: ${errorMsg}`
      )

      if (completeResult.nextStatus === 'pending') {
        retryCount++
        results.push({
          queueId: queueItem.id,
          leadId: queueItem.lead_id,
          status: 'retrying',
          attempt: queueItem.retry_count + 1,
          reason: errorMsg,
        })
      } else {
        failureCount++
        results.push({
          queueId: queueItem.id,
          leadId: queueItem.lead_id,
          status: 'failed',
          attempts: queueItem.retry_count + 1,
          reason: errorMsg,
        })
      }
    }
  }

  const stats = await getQueueStats()

  console.log(`[CI-WORKER] completed count: ${successCount}`)
  console.log(`[CI-WORKER] retrying count: ${retryCount}`)
  console.log(`[CI-WORKER] failed count: ${failureCount}`)

  return {
    ok: true,
    message: `Processed ${claimedItems.length} items`,
    stats,
    processed: claimedItems.length,
    succeeded: successCount,
    retrying: retryCount,
    failed: failureCount,
    recovered: resetCount,
    results,
  }
}

export async function drainCommercialIntelligenceQueue(
  options: DrainCommercialIntelligenceQueueOptions = {}
) {
  const batchLimit = options.batchLimit ?? 5
  const maxBatches = options.maxBatches ?? 5
  const maxRuntimeMs = options.maxRuntimeMs ?? 55_000
  const source = options.source ?? 'scrape-request'
  const startedAt = Date.now()

  let batches = 0
  let totalProcessed = 0
  let totalSucceeded = 0
  let totalRetrying = 0
  let totalFailed = 0
  let stoppingReason = 'max_batches_reached'

  try {
    while (batches < maxBatches) {
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs >= maxRuntimeMs) {
        stoppingReason = 'max_runtime_reached'
        console.log(
          `[CI-DRAIN] stopping reason: max_runtime_reached (elapsed ${elapsedMs}ms >= ${maxRuntimeMs}ms)`
        )
        break
      }

      const batchStartedAt = Date.now()
      const result = await processCommercialIntelligenceQueue({
        limit: batchLimit,
        source,
      })
      const batchElapsedMs = Date.now() - batchStartedAt

      batches += 1
      totalProcessed += result.processed
      totalSucceeded += result.succeeded
      totalRetrying += result.retrying
      totalFailed += result.failed

      console.log(
        `[CI-DRAIN] batch=${batches} processed=${result.processed} succeeded=${result.succeeded} retrying=${result.retrying} failed=${result.failed} elapsed_ms=${batchElapsedMs}`
      )

      if (result.processed === 0) {
        stoppingReason = 'queue_empty'
        console.log(
          `[CI-DRAIN] stopping reason: queue_empty (no items claimed in batch ${batches})`
        )
        break
      }
    }

    if (batches >= maxBatches) {
      stoppingReason = 'max_batches_reached'
      console.log(
        `[CI-DRAIN] stopping reason: max_batches_reached (${batches} batches completed)`
      )
    }

    const summary = {
      ok: true,
      batches,
      totalProcessed,
      totalSucceeded,
      totalRetrying,
      totalFailed,
      elapsedMs: Date.now() - startedAt,
      stoppingReason,
    }

    console.log(`[CI-DRAIN] stopping reason: ${stoppingReason}`)
    return summary
  } catch (err) {
    stoppingReason = 'error'
    console.error('[CI-DRAIN] error:', err)

    const summary = {
      ok: false,
      batches,
      totalProcessed,
      totalSucceeded,
      totalRetrying,
      totalFailed,
      elapsedMs: Date.now() - startedAt,
      stoppingReason,
      error: err instanceof Error ? err.message : 'Unknown error',
    }

    return summary
  }
}
