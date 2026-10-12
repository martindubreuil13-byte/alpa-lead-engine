import { isResearchEnabled } from './research-switch.ts'
import { RESEARCH_HARD_LIMITS } from './research-limits.ts'

// Starts, and bounded-continues, background research for an authorized Discover run. There is no scheduler.
//
// The worker route does the real work and enforces everything (operator switch, allow-list, budgets, run scope, one claim per
// job). This only asks that route for a tick, authenticated with the same secret a cron would use.
//
// A tick is dispatched in "async" mode: the route validates the request, answers 202 immediately, and runs the tick after the
// response. The caller therefore waits only for that acknowledgement (a few hundred milliseconds), never for the tick, and the
// tick lives in its own invocation with its own 300 s limit. When a tick stops on its own limits while jobs were still being
// claimed, it dispatches the next tick the same way. Every link carries its depth, the chain stops at a fixed maximum, and a
// tick that finds nothing to claim ends it earlier. A dispatch is tried up to three times for a transient failure (network,
// timeout, 5xx, 429) and never otherwise. If a link is still lost, nothing more is done here: the jobs stay queued, the
// stale-claim recovery returns or fails interrupted ones at the next tick, and the next tick comes from a new search, the daily
// backstop or an operator. This cannot loop: depth is bounded, attempts are bounded and each tick has a hard deadline.

export const WORKER_ROUTE = '/api/internal/cron/commercial-intelligence'
// One acknowledgement is quick (the route answers 202 before doing any work). A few bounded attempts cover a transient network
// error or a platform 5xx/429; they cannot loop, and the worst case (3 x 8 s + 3 s of waiting) leaves the invoking tick well
// inside its 300 s limit even after a full 240 s of work.
const ACK_TIMEOUT_MS = 8_000
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [1_000, 2_000]

/** The secret is only ever sent over https (or to localhost while developing), and never to a missing origin. */
export function isSafeDispatchOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  } catch {
    return false
  }
}

/** The depth a request claims, as a whole number from 0 up to the chain maximum; anything else is treated as 0. */
export function parseDepth(value: string | null | undefined): number {
  const depth = Number(value)
  return Number.isInteger(depth) && depth >= 0 ? Math.min(depth, RESEARCH_HARD_LIMITS.maxContinuations) : 0
}

/** Whether a finished tick at `depth` may hand over to another: research is on, work may remain, and the chain has room. */
export function shouldContinue(input: { depth: number; moreWork: boolean; disabled?: boolean }): boolean {
  return !input.disabled && input.moreWork === true && input.depth < RESEARCH_HARD_LIMITS.maxContinuations
}

/**
 * Asks the worker route to run one tick in the background. True only when the route accepted it (HTTP 202). A refusal that
 * retrying cannot fix (401 wrong secret, 200 research off) ends at once; only a network error, a timeout, a 5xx or a 429 is
 * tried again, up to three attempts in all.
 */
export async function dispatchResearchTick(
  origin: string,
  options: { depth?: number; secret?: string; enabled?: boolean; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}
): Promise<boolean> {
  const secret = options.secret ?? process.env.CRON_SECRET
  if (!(options.enabled ?? isResearchEnabled()) || !secret || !origin || !isSafeDispatchOrigin(origin)) return false
  const depth = parseDepth(String(options.depth ?? 0))
  const call = options.fetcher ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await call(`${origin}${WORKER_ROUTE}?async=1&depth=${depth}`, {
        headers: { authorization: `Bearer ${secret}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(ACK_TIMEOUT_MS),
      })
      if (response.status === 202) return true
      if (response.status < 500 && response.status !== 429) return false
    } catch {
      // network error or timeout: try again below
    }
    if (attempt < MAX_ATTEMPTS - 1) await sleep(BACKOFF_MS[attempt] ?? 2_000)
  }
  // Nothing more to do here. The jobs stay queued and untouched; the next tick (a new search, the daily backstop or an
  // operator) recovers interrupted claims and continues.
  return false
}

/** Starts the first tick of a chain (depth 0) once a run has been authorized. Never throws. */
export async function kickResearch(
  origin: string,
  options: { secret?: string; enabled?: boolean; fetcher?: typeof fetch } = {}
): Promise<{ accepted: boolean }> {
  return { accepted: await dispatchResearchTick(origin, { ...options, depth: 0 }) }
}
