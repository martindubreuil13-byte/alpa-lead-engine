// The plan to SHOW on ordinary pages, even when Stripe cannot be reached.
//
// The live subscription (Stripe) is the authority for anything a person is allowed to do. Ordinary navigation (My Leads, the
// dashboard, billing pages) must not fail just because Stripe is slow or down, so it asks Stripe for a short, bounded time and
// otherwise falls back to the plan stored in the database. That fallback is marked `verified: false` and is for display only:
//
//   - `subscription_active` is forced to false, and the profile carries `plan_verified: false`, which makes `isPaid()` false, so no
//     paid feature (and no paid research, which also asks Stripe live in the discovery route) is granted from a stored plan;
//   - a plan that was only ever stored (never verified in this request) therefore cannot be used to unlock anything.
//
// Pure: the live lookup and the stored read are injected, so timeouts, connection failures and cancellations are tested offline.
import type { ResolvedUserSubscription } from './stored-subscription.ts'

export const NAVIGATION_STRIPE_TIMEOUT_MS = 2_500

export type DisplaySubscription = ResolvedUserSubscription & {
  /** True only when this request's plan came from a live Stripe check (or needed none). */
  verified: boolean
}

export type DisplayDeps = {
  resolveLive: () => Promise<ResolvedUserSubscription>
  readStored: () => Promise<ResolvedUserSubscription>
  timeoutMs?: number
  /** Called with a short reason code when the fallback is used; never the error text. */
  onFallback?: (reason: 'timeout' | 'error') => void
}

export async function resolveSubscriptionForNavigation(deps: DisplayDeps): Promise<DisplaySubscription> {
  const timeoutMs = deps.timeoutMs ?? NAVIGATION_STRIPE_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const live = await Promise.race([
      deps.resolveLive(),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      }),
    ])
    if (live !== 'timeout') return { ...live, verified: true }
    deps.onFallback?.('timeout')
  } catch {
    deps.onFallback?.('error')
  } finally {
    if (timer) clearTimeout(timer)
  }
  // The live check did not answer. Show what is stored, and grant nothing from it.
  const stored = await deps.readStored()
  return { ...stored, subscription_active: false, verified: false }
}
