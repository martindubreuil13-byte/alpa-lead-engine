import { enrichLeadDirect } from '@/lib/commercial-intelligence/enrich-lead-direct'
import {
  claimPendingQueueItems,
  resetStaleProcessingItems,
  completeEnrichment,
  getQueueStats,
} from '@/lib/commercial-intelligence/queue-manager'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const maxDuration = 300 // 5 minutes for queue processing

type AuthMode = 'admin' | 'cron'

function isCronAuthorized(req: Request) {
  const workerSecret = process.env.CI_QUEUE_WORKER_SECRET
  const vercelCronSecret = process.env.CRON_SECRET

  const headerSecret = req.headers.get('x-ci-worker-secret')
  const authHeader = req.headers.get('authorization')

  return (
    (Boolean(workerSecret) && headerSecret === workerSecret) ||
    (Boolean(workerSecret) && authHeader === `Bearer ${workerSecret}`) ||
    (Boolean(vercelCronSecret) && authHeader === `Bearer ${vercelCronSecret}`)
  )
}

async function requireWorkerAuth(req: Request): Promise<AuthMode | null> {
  if (isCronAuthorized(req)) {
    return 'cron'
  }

  const profile = await getUserProfile()
  if (profile && isAdmin(profile)) {
    return 'admin'
  }

  return null
}

async function processQueue(authMode: AuthMode) {
  console.log('[CI-WORKER] worker invoked')
  console.log(`[CI-WORKER] auth mode: ${authMode}`)
  console.log('[CI-Worker] Starting queue processing')

  // STEP 1: Crash recovery - reset items stuck in processing
  // This handles case where worker died mid-processing
  const { resetCount } = await resetStaleProcessingItems(300) // 5 minute timeout
  if (resetCount > 0) {
    console.log(`[CI-Worker] Reset ${resetCount} stale processing items`)
  }

  // STEP 2: Atomically claim pending items
  // Uses FOR UPDATE SKIP LOCKED to ensure no two workers get same items
  const claimedItems = await claimPendingQueueItems(10)
  console.log(`[CI-Worker] Claimed ${claimedItems.length} items for processing`)
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

  // STEP 3: Process each claimed item
  for (const queueItem of claimedItems) {
    console.log(
      `[CI-Worker] Processing lead ${queueItem.lead_id} (queue ${queueItem.id}, attempt ${queueItem.retry_count + 1}/${queueItem.max_retries})`
    )

    try {
      // Call the canonical enrichment engine
      const enrichResult = await enrichLeadDirect(queueItem.lead_id)

      // STEP 4: Atomically complete enrichment and update queue + lead
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
        console.error(`[CI-Worker] Failed to complete enrichment for queue ${queueItem.id}`)
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
        // Failed but will retry
        retryCount++
        results.push({
          queueId: queueItem.id,
          leadId: queueItem.lead_id,
          status: 'retrying',
          attempt: queueItem.retry_count + 1,
          reason: enrichResult.error?.message || 'Enrichment failed',
        })
      } else {
        // Failed, no more retries
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
      console.error(`[CI-Worker] Exception processing queue ${queueItem.id}:`, err)

      // Try to mark as failed (error handler for unexpected exceptions)
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

  console.log(
    `[CI-Worker] Processing complete. Claimed: ${claimedItems.length}, Completed: ${successCount}, Retrying: ${retryCount}, Failed: ${failureCount}`
  )
  console.log(`[CI-WORKER] completed count: ${successCount}`)
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

/**
 * Worker endpoint to process Commercial Intelligence enrichment queue.
 *
 * Production-safe implementation:
 * 1. Reset stale processing items (crash recovery)
 * 2. Atomically claim pending items (FOR UPDATE SKIP LOCKED)
 * 3. Call canonical enrichLeadDirect() function
 * 4. Atomically update queue + lead (transaction safety)
 *
 * The enrichment engine (enrichLeadDirect) remains completely independent
 * and can be called directly for manual refresh without any queue involvement.
 *
 * Handles:
 * - Queue deduplication (unique constraint on active jobs)
 * - Atomic claiming (multiple workers can't process same item)
 * - Stale recovery (5-minute timeout on processing items)
 * - Retry logic (exponential backoff, max 3 retries by default)
 * - Transaction safety (queue + lead updated atomically)
 */
export async function POST(req: Request) {
  try {
    const authMode = await requireWorkerAuth(req)
    if (!authMode) {
      console.log('[CI-Worker] Unauthorized attempt')
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Admin access required',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await processQueue(authMode)

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[CI-Worker] Unhandled exception', err)
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * GET /api/admin/ci-queue-worker
 * - Cron authenticated request: process queue
 * - Admin authenticated request: check queue status
 */
export async function GET(req: Request) {
  try {
    if (isCronAuthorized(req)) {
      const result = await processQueue('cron')
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const profile = await getUserProfile()
    if (!profile || !isAdmin(profile)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Admin access required',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const stats = await getQueueStats()

    return new Response(
      JSON.stringify({
        ok: true,
        stats,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
