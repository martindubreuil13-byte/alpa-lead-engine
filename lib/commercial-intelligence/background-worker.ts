import { enrichLeadDirect } from './enrich-lead-direct'
import { runBackgroundWorkerCore } from './background-worker-core'
import {
  claimWorkerQueueItems,
  completeWorkerEnrichment,
  resetStaleWorkerItems,
} from './queue-manager'

export async function runCommercialIntelligenceWorker(
  client: any,
  options: { batchSize?: number; concurrency?: number; staleTimeoutSeconds?: number } = {}
) {
  return runBackgroundWorkerCore(
    client,
    {
      claim: claimWorkerQueueItems,
      recover: resetStaleWorkerItems,
      enrich: enrichLeadDirect,
      complete: completeWorkerEnrichment,
    },
    options
  )
}
