import { verifyEntitlementLive } from '@/lib/auth/paid-entitlement'
import { resolveUserSubscription } from '@/lib/auth/resolve-user-subscription'
import { enrichLeadDirect } from './enrich-lead-direct'
import { isEntitledToAutomaticResearch } from './research-entitlement'
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
      // Authorization happened when the run was saved; every job re-confirms that the customer is still entitled (Stripe, not the stored plan).
      verifyEntitlement: async (userId) => {
        const check = await verifyEntitlementLive(() => resolveUserSubscription(userId, { requireFresh: true }))
        if (!check.ok) return 'unavailable'
        return isEntitledToAutomaticResearch(check.subscription.subscription_active ? check.subscription.plan : 'free') ? 'entitled' : 'not_entitled'
      },
    },
    options
  )
}
