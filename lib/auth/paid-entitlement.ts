// Live confirmation of what an account is entitled to, for PAID ACTIONS: starting a search, authorizing automatic research, a customer's
// research retry, and every background research job.
//
// Ordinary pages (My Leads, the dashboard) keep working from the stored plan when Stripe is unreachable; they are display only and grant
// nothing (see subscription-display.ts). A paid action is different: Stripe decides, the stored plan is never reused as a substitute, and if
// Stripe cannot be reached the action is refused ("unavailable"), never allowed. The first launch prefers security over availability; a
// short-lived server-verified cache can be added later if the Stripe dependency proves too costly.
import type { ResolvedUserSubscription } from './stored-subscription.ts'

export const ENTITLEMENT_TIMEOUT_MS = 8_000

export type EntitlementCheck =
  | { ok: true; subscription: ResolvedUserSubscription }
  | { ok: false; reason: 'unavailable' }

export async function verifyEntitlementLive(
  resolve: () => Promise<ResolvedUserSubscription>,
  options: { timeoutMs?: number } = {}
): Promise<EntitlementCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      resolve(),
      new Promise<'timeout'>((done) => {
        timer = setTimeout(() => done('timeout'), options.timeoutMs ?? ENTITLEMENT_TIMEOUT_MS)
      }),
    ])
    return result === 'timeout' ? { ok: false, reason: 'unavailable' } : { ok: true, subscription: result }
  } catch {
    return { ok: false, reason: 'unavailable' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const ENTITLEMENT_UNAVAILABLE_MESSAGE =
  'We could not verify your subscription right now, so no search was started and nothing was used. Please try again in a moment.'
