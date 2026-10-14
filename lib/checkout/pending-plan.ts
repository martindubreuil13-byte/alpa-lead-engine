// The plan a visitor chose before they had an account, carried through sign-up or sign-in to the Stripe checkout.
//
// Checkout belongs to an account, so a visitor who is not signed in is sent to create (or open) one first. The chosen plan must not
// be lost on the way: it travels in the address (?plan=...) and is also kept in the browser for a day, so it survives the
// confirm-your-email round trip and a later sign-in. It is only a choice of plan, never a price or an identity; the server decides
// everything about the checkout (see app/api/checkout/route.ts).
export type CheckoutPlan = 'starter' | 'prospector'

export const PENDING_CHECKOUT_KEY = 'alpa_pending_checkout'
export const PENDING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type PendingCheckout = { plan: CheckoutPlan; source: string }

export function parseCheckoutPlan(value: unknown): CheckoutPlan | null {
  return value === 'starter' || value === 'prospector' ? value : null
}

/** A short analytics label; anything unexpected becomes the default so it can never carry markup or a path. */
export function parseCheckoutSource(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,60}$/i.test(value) ? value : 'upgrade'
}

/** The only place a signed-in visitor may be sent back to after signing in, besides the checkout start: finishing their own payment. */
export function safeNextPath(value: unknown): string | null {
  return typeof value === 'string' && /^\/post-checkout\?session_id=[A-Za-z0-9_]{1,200}$/.test(value) ? value : null
}

export function signupHref(plan: CheckoutPlan, source: string): string {
  return `/login?mode=signup&plan=${plan}&source=${encodeURIComponent(parseCheckoutSource(source))}`
}

export function loginHref(plan: CheckoutPlan, source: string): string {
  return `/login?plan=${plan}&source=${encodeURIComponent(parseCheckoutSource(source))}`
}

export function loginForPaymentHref(postCheckoutPath: string): string {
  const next = safeNextPath(postCheckoutPath)
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login'
}

export function checkoutStartHref(plan: CheckoutPlan, source: string): string {
  return `/checkout/start?plan=${plan}&source=${encodeURIComponent(parseCheckoutSource(source))}`
}

export function savePendingCheckout(storage: StorageLike | null, pending: PendingCheckout, now = Date.now()) {
  try {
    storage?.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({ ...pending, at: now }))
  } catch {
    // storage can be blocked; the address still carries the plan
  }
}

export function readPendingCheckout(storage: StorageLike | null, now = Date.now()): PendingCheckout | null {
  try {
    const raw = storage?.getItem(PENDING_CHECKOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { plan?: unknown; source?: unknown; at?: unknown }
    const plan = parseCheckoutPlan(parsed.plan)
    if (!plan || typeof parsed.at !== 'number' || now - parsed.at > PENDING_CHECKOUT_TTL_MS || parsed.at > now + 60_000) return null
    return { plan, source: parseCheckoutSource(parsed.source) }
  } catch {
    return null
  }
}

export function clearPendingCheckout(storage: StorageLike | null) {
  try {
    storage?.removeItem(PENDING_CHECKOUT_KEY)
  } catch {
    // nothing to clear
  }
}

/** Where to go once the visitor is signed in: finish a payment, continue to checkout with the chosen plan, or the default page. */
export function destinationAfterAuth(input: { next: string | null; pending: PendingCheckout | null; fallback: string }): string {
  if (input.next) return input.next
  if (input.pending) return checkoutStartHref(input.pending.plan, input.pending.source)
  return input.fallback
}
