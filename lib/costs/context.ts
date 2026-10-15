import { AsyncLocalStorage } from 'node:async_hooks'

// Which run and customer the provider calls inside a function belong to, carried without changing any signature. Calls made outside
// any context are still recorded, just without a run.
export type CostContext = {
  runId: string | null
  userId: string | null
  /** What the spending is for. */
  purpose: 'discovery' | 'research_profile' | 'guest_profile' | 'outreach' | 'agent' | 'other'
  audience: 'guest' | 'member' | 'system'
}

const storage = new AsyncLocalStorage<CostContext>()

export const runWithCostContext = <T>(context: CostContext, work: () => T): T => storage.run(context, work)
export const currentCostContext = (): CostContext | undefined => storage.getStore()
