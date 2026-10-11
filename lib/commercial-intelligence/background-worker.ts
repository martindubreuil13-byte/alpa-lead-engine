import { enrichLeadDirect } from './enrich-lead-direct'
import { runBackgroundWorkerCore } from './background-worker-core'
import { claimRunItems, completeRunItem, recoverRunItems } from './queue-manager'

// The only research worker: it processes jobs of authorized Discover runs, nothing else. Claim, recovery and
// completion are the run-scoped database functions, which also enforce the operator switch and every budget.
export async function runCommercialIntelligenceWorker(
  client: any,
  options: { batchSize?: number; concurrency?: number; staleTimeoutSeconds?: number; maxRounds?: number } = {}
) {
  return runBackgroundWorkerCore(
    client,
    {
      claim: claimRunItems,
      recover: recoverRunItems,
      enrich: enrichLeadDirect,
      complete: completeRunItem,
    },
    options
  )
}
