import { WORKER_DEFAULTS } from './worker-config.ts'

export type WorkerQueueItem = {
  id: string
  lead_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  retry_count: number
  max_retries: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  last_error: string | null
  last_retry_at: string | null
  claim_token: string
}

export type WorkerEnrichmentResult = {
  success: boolean
  website_snapshot: unknown
  business_signals: unknown
  commercial_profile: unknown
  ci_last_error: string | null
  ci_cost_estimate: number
}

type WorkerClient = any

export type BackgroundWorkerDependencies = {
  claim: (client: WorkerClient, limit: number) => Promise<WorkerQueueItem[]>
  recover: (client: WorkerClient, timeoutSeconds: number) => Promise<{ resetCount: number; failedCount: number }>
  enrich: (leadId: string, options: { client: WorkerClient }) => Promise<WorkerEnrichmentResult>
  complete: (client: WorkerClient, item: WorkerQueueItem, snapshot: unknown, signals: unknown, profile: unknown, success: boolean, errorMsg?: string) => Promise<{ ok: boolean; nextStatus?: string }>
}

export async function runBackgroundWorkerCore(
  client: WorkerClient,
  dependencies: BackgroundWorkerDependencies,
  options: { batchSize?: number; concurrency?: number; staleTimeoutSeconds?: number } = {}
) {
  const batchSize = Math.min(Math.max(options.batchSize || WORKER_DEFAULTS.batchSize, 1), 20)
  const concurrency = Math.min(Math.max(options.concurrency || WORKER_DEFAULTS.concurrency, 1), 4)
  const recovery = await dependencies.recover(client, options.staleTimeoutSeconds || WORKER_DEFAULTS.staleTimeoutSeconds)
  const claimed = await dependencies.claim(client, batchSize)
  let nextIndex = 0
  const results: Array<{ queueId: string; leadId: string; status: string; cost: number }> = []

  const workers = Array.from({ length: Math.min(concurrency, claimed.length) }, async () => {
    while (nextIndex < claimed.length) {
      const item = claimed[nextIndex]
      nextIndex += 1
      if (!item) continue

      let enrichment: WorkerEnrichmentResult | null = null
      try {
        enrichment = await dependencies.enrich(item.lead_id, { client })
        const completion = await dependencies.complete(client, item, enrichment.website_snapshot, enrichment.business_signals, enrichment.commercial_profile, enrichment.success, enrichment.ci_last_error || undefined)
        results.push({ queueId: item.id, leadId: item.lead_id, status: completion.ok ? completion.nextStatus || 'completed' : 'claim_lost', cost: enrichment.ci_cost_estimate })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown worker error'
        console.error('[CI-BACKGROUND] Job failed', { queueId: item.id, leadId: item.lead_id, error: message })
        try {
          const completion = await dependencies.complete(client, item, enrichment?.website_snapshot || null, enrichment?.business_signals || null, enrichment?.commercial_profile || null, false, message)
          results.push({ queueId: item.id, leadId: item.lead_id, status: completion.ok ? completion.nextStatus || 'failed' : 'claim_lost', cost: enrichment?.ci_cost_estimate || 0 })
        } catch (completionError) {
          console.error('[CI-BACKGROUND] Could not record job failure', { queueId: item.id, leadId: item.lead_id, error: completionError instanceof Error ? completionError.message : 'Unknown completion error' })
          results.push({ queueId: item.id, leadId: item.lead_id, status: 'interrupted', cost: enrichment?.ci_cost_estimate || 0 })
        }
      }
    }
  })

  await Promise.all(workers)
  return {
    ok: true,
    claimed: claimed.length,
    recovered: recovery.resetCount,
    permanentlyFailedDuringRecovery: recovery.failedCount,
    completed: results.filter((result) => result.status === 'enrichment_completed').length,
    retrying: results.filter((result) => result.status === 'retry_pending').length,
    failed: results.filter((result) => result.status === 'enrichment_failed').length,
    interrupted: results.filter((result) => result.status === 'interrupted').length,
    estimatedCost: results.reduce((total, result) => total + result.cost, 0),
    results,
  }
}
