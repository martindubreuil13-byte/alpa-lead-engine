import { isResearchEnabled } from './research-switch.ts'

// Starts research for a just-authorized Discover run, in the background, with no scheduler.
//
// The worker route does the real work and enforces everything (operator switch, allow-list, budgets, run scope). This
// only asks that route for a tick, authenticated with the same secret a cron would use. It runs after the customer's
// results were sent (Next `after`), never throws, and does nothing while research is off, so it cannot delay or break
// Discover.

export const WORKER_ROUTE = '/api/internal/cron/commercial-intelligence'
const TICK_TIMEOUT_MS = 290_000
const MAX_TICKS = 2

export async function kickResearch(
  origin: string,
  options: { secret?: string; enabled?: boolean; fetcher?: typeof fetch } = {}
): Promise<{ ticks: number }> {
  const secret = options.secret ?? process.env.CRON_SECRET
  if (!(options.enabled ?? isResearchEnabled()) || !secret || !origin) return { ticks: 0 }
  const call = options.fetcher ?? fetch
  let ticks = 0
  while (ticks < MAX_TICKS) {
    ticks += 1
    try {
      const response = await call(`${origin}${WORKER_ROUTE}`, {
        headers: { authorization: `Bearer ${secret}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(TICK_TIMEOUT_MS),
      })
      const result = (await response.json().catch(() => null)) as { retrying?: number; disabled?: boolean } | null
      // A second tick only when jobs were left waiting for a retry; otherwise the run is done or stopped.
      if (!response.ok || !result || result.disabled || !(Number(result.retrying) > 0)) break
    } catch {
      break
    }
  }
  return { ticks }
}
