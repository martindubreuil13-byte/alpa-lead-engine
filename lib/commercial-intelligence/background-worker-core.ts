import { buildCompletion } from './research-completion.ts'
import { createResearchDeadline, jobsThatFit, RESEARCH_BATCH_BUDGET_MS, RESEARCH_DEADLINE_GRACE_MS, RESEARCH_DEADLINE_MS } from './research-deadline.ts'
import { RESEARCH_HARD_LIMITS } from './research-limits.ts'
import { isResearchEnabled } from './research-switch.ts'
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
  ci_enrichment_status?: string
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
  enrich: (leadId: string, options: { client: WorkerClient; persist: 'deferred'; deadlineMs: number }) => Promise<WorkerEnrichmentResult>
  complete: (client: WorkerClient, item: WorkerQueueItem, snapshot: unknown, signals: unknown, profile: unknown, success: boolean, errorMsg?: string, actualCostUsd?: number) => Promise<{ ok: boolean; nextStatus?: string }>
}

export async function runBackgroundWorkerCore(
  client: WorkerClient,
  dependencies: BackgroundWorkerDependencies,
  options: { batchSize?: number; concurrency?: number; staleTimeoutSeconds?: number; jobDeadlineMs?: number; graceMs?: number; researchEnabled?: boolean; maxRounds?: number; tickBudgetMs?: number; now?: () => number } = {}
) {
  // The emergency switch is checked before anything else: no recovery, no claim, no database call.
  // Jobs and profiles stay exactly as they are while research is off.
  if (!(options.researchEnabled ?? isResearchEnabled())) {
    return { ok: true, disabled: true, claimed: 0, recovered: 0, permanentlyFailedDuringRecovery: 0, completed: 0, retrying: 0, failed: 0, interrupted: 0, estimatedCost: 0, results: [] }
  }
  const jobDeadlineMs = options.jobDeadlineMs ?? RESEARCH_DEADLINE_MS
  const graceMs = options.graceMs ?? RESEARCH_DEADLINE_GRACE_MS
  const concurrency = Math.min(Math.max(options.concurrency || WORKER_DEFAULTS.concurrency, 1), RESEARCH_HARD_LIMITS.maxConcurrency)
  const requestedBatch = Math.min(Math.max(options.batchSize || WORKER_DEFAULTS.batchSize, 1), RESEARCH_HARD_LIMITS.maxBatchSize)
  const tickBudgetMs = options.tickBudgetMs ?? RESEARCH_BATCH_BUDGET_MS
  const now = options.now ?? Date.now
  const tickEnd = now() + tickBudgetMs
  // One round is the original behaviour. Several rounds let one tick keep a customer's run moving: each round claims
  // only what can still finish before the tick ends, and a new round starts only if one whole job still fits.
  const maxRounds = Math.min(Math.max(options.maxRounds ?? 1, 1), 20)
  const recovery = await dependencies.recover(client, options.staleTimeoutSeconds || WORKER_DEFAULTS.staleTimeoutSeconds)
  const results: Array<{ queueId: string; leadId: string; status: string; cost: number }> = []
  let claimedTotal = 0

  for (let round = 0; round < maxRounds; round += 1) {
    const remainingMs = tickEnd - now()
    if (round > 0 && remainingMs < jobDeadlineMs + graceMs) break
    // Never claim more than this round can finish: unfinished claims sit in 'processing' until stale recovery.
    const batchSize = jobsThatFit(requestedBatch, { parallel: concurrency, budgetMs: round === 0 ? undefined : remainingMs })
    const claimed = await dependencies.claim(client, batchSize)
    if (claimed.length === 0) break
    claimedTotal += claimed.length
    await processRound(claimed)
  }

  async function processRound(claimed: WorkerQueueItem[]) {
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(concurrency, claimed.length) }, async () => {
      while (nextIndex < claimed.length) {
        const item = claimed[nextIndex]
        nextIndex += 1
        if (!item) continue

        let enrichment: WorkerEnrichmentResult | null = null
        try {
          // The job's own deadline aborts its fetches and AI request. This outer guard is the backstop for
          // anything that cannot be cancelled: the job is then reported as failed and left to the retry policy.
          const guard = createResearchDeadline(jobDeadlineMs + graceMs)
          try {
            enrichment = await guard.guard(
              dependencies.enrich(item.lead_id, { client, persist: 'deferred', deadlineMs: jobDeadlineMs }),
              'research'
            )
          } finally {
            guard.dispose()
          }
          const outcome = buildCompletion(enrichment)
          const completion = await dependencies.complete(client, item, outcome.snapshot, outcome.signals, outcome.profile, outcome.success, outcome.errorMessage, enrichment.ci_cost_estimate)
          results.push({ queueId: item.id, leadId: item.lead_id, status: completion.ok ? completion.nextStatus || 'completed' : 'claim_lost', cost: enrichment.ci_cost_estimate })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown worker error'
          console.error('[CI-BACKGROUND] Job failed', { queueId: item.id, leadId: item.lead_id, error: message })
          try {
            const completion = await dependencies.complete(client, item, null, null, null, false, message, enrichment?.ci_cost_estimate ?? (item as { reserved_usd?: number }).reserved_usd ?? 0)
            results.push({ queueId: item.id, leadId: item.lead_id, status: completion.ok ? completion.nextStatus || 'failed' : 'claim_lost', cost: enrichment?.ci_cost_estimate ?? (item as { reserved_usd?: number }).reserved_usd ?? 0 })
          } catch (completionError) {
            console.error('[CI-BACKGROUND] Could not record job failure', { queueId: item.id, leadId: item.lead_id, error: completionError instanceof Error ? completionError.message : 'Unknown completion error' })
            results.push({ queueId: item.id, leadId: item.lead_id, status: 'interrupted', cost: enrichment?.ci_cost_estimate || 0 })
          }
        }
      }
    })

    await Promise.all(workers)
  }

  return {
    ok: true,
    claimed: claimedTotal,
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
