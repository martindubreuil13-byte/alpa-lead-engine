import { isResearchEnabled } from './research-switch.ts'

// Starts research for a just-authorized Discover run, in the background, with no scheduler.
//
// The worker route does the real work and enforces everything (operator switch, allow-list, budgets, run scope). This
// only asks that route for a tick, authenticated with the same secret a cron would use. It runs after the customer's
// results were sent (Next `after`), never throws, and does nothing while research is off, so it cannot delay or break
// Discover.

export const WORKER_ROUTE = '/api/internal/cron/commercial-intelligence'
const TICK_TIMEOUT_MS = 290_000

export async function kickResearch(
  origin: string,
  options: { secret?: string; enabled?: boolean; fetcher?: typeof fetch } = {}
): Promise<{ ticks: number }> {
  const secret = options.secret ?? process.env.CRON_SECRET
  if (!(options.enabled ?? isResearchEnabled()) || !secret || !origin) return { ticks: 0 }
  const call = options.fetcher ?? fetch
  // One tick: each profile gets one attempt, so there is nothing to wait for or poll. A tick processes the run's jobs in
  // rounds until none is left to claim.
  try {
    await call(`${origin}${WORKER_ROUTE}`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TICK_TIMEOUT_MS),
    })
  } catch {
    // Nothing to do: the customer's results are unaffected, and the worker route enforces every limit itself.
  }
  return { ticks: 1 }
}
