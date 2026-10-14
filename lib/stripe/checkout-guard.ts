// Pure ownership and duplicate-subscription rules for Stripe checkout. No network, no database: the routes gather the facts
// (the Stripe session, the signed-in user's profile, who else holds the customer) and these functions decide.

export type GuardSession = {
  mode?: string | null
  status?: string | null
  payment_status?: string | null
  customer?: string | { id: string } | null
  subscription?: string | { id: string } | null
  metadata?: Record<string, string | null | undefined> | null
}

export type GuardProfile = {
  plan?: string | null
  plan_status?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
} | null

export type GuardRefusal = { ok: false; status: 401 | 403 | 404 | 409; code: string; message: string }
export type GuardOk<T = object> = { ok: true } & T

// The same message for "no such session" and "somebody else's session", so a session id cannot be probed for existence.
const NOT_FOUND: GuardRefusal = { ok: false, status: 404, code: 'session_not_found', message: 'Checkout session not found' }

function idOf(value: string | { id: string } | null | undefined) {
  if (!value) return ''
  return (typeof value === 'string' ? value : value.id).trim()
}

/** The Stripe customer id of a session, or '' when it has none. */
export function sessionCustomerId(session: GuardSession) {
  return idOf(session.customer)
}

/** The Stripe subscription id of a session, or '' when it has none. */
export function sessionSubscriptionId(session: GuardSession) {
  return idOf(session.subscription)
}

export function isSessionComplete(session: GuardSession) {
  return session.mode === 'subscription' && session.status === 'complete' && session.payment_status !== 'unpaid'
}

/**
 * A checkout session belongs to the signed-in user only when ALL of these hold:
 *  - the session was created for that user (our checkout route stamps `metadata.user_id` from the authenticated session),
 *  - the session's Stripe customer is the customer recorded on that user's own profile,
 *  - no other profile holds that customer.
 * Sessions without an owner (legacy guest checkouts) never match: they cannot be claimed by whoever shows up with the id.
 */
export function checkSessionOwnership(
  session: GuardSession,
  input: { userId: string; profileCustomerId?: string | null; otherProfileHoldsCustomer?: boolean }
): GuardOk | GuardRefusal {
  const userId = String(input.userId || '').trim()
  const owner = String(session.metadata?.user_id || '').trim()
  const customerId = sessionCustomerId(session)
  const profileCustomerId = String(input.profileCustomerId || '').trim()

  if (!userId || !owner || owner !== userId) return NOT_FOUND
  if (!customerId || !profileCustomerId || customerId !== profileCustomerId) return NOT_FOUND
  if (input.otherProfileHoldsCustomer) return NOT_FOUND
  return { ok: true }
}

/**
 * Whether a verified-owner session may update the profile. Re-activating the same subscription is harmless (the sync reads
 * Stripe's current state). What is refused is a stale or superseded session overwriting a newer subscription.
 */
export function decideActivation(input: {
  session: GuardSession
  subscription: { id: string; customer?: string | { id: string } | null } | null
  subscriptionUsable: boolean
  profile: GuardProfile
}): GuardOk | GuardRefusal {
  const { session, subscription, subscriptionUsable, profile } = input
  if (!isSessionComplete(session)) {
    return { ok: false, status: 409, code: 'checkout_incomplete', message: 'Checkout is not complete' }
  }
  if (!subscription) {
    return { ok: false, status: 409, code: 'no_subscription', message: 'This checkout has no subscription to activate' }
  }
  // The subscription must belong to the same customer the session was created for.
  if (idOf(subscription.customer) !== sessionCustomerId(session)) return NOT_FOUND

  const current = String(profile?.stripe_subscription_id || '').trim()
  if (current === subscription.id) return { ok: true }

  if (!subscriptionUsable) {
    return { ok: false, status: 409, code: 'session_expired', message: 'This checkout no longer grants access' }
  }
  if (current && hasLiveLocalSubscription(profile)) {
    return { ok: false, status: 409, code: 'session_superseded', message: 'A different subscription is already active on this account' }
  }
  return { ok: true }
}

const LIVE_LOCAL_STATUSES = new Set(['active', 'trialing', 'canceling', 'past_due', 'paused', 'unpaid', 'incomplete'])

function hasLiveLocalSubscription(profile: GuardProfile) {
  if (!profile) return false
  return Boolean(String(profile.stripe_subscription_id || '').trim()) && LIVE_LOCAL_STATUSES.has(String(profile.plan_status || '').trim())
}

/**
 * Whether the signed-in user may start a new subscription checkout. Administrators have no subscription, and anyone who
 * already holds a live one (including one set to end at the period) manages it instead of buying a second.
 * `liveSubscription` is Stripe's own view (the usable subscription for this customer), `profile` the local record.
 */
export function decideNewCheckout(input: {
  profile: GuardProfile
  liveSubscription: { id: string } | null
}): GuardOk | GuardRefusal {
  const { profile, liveSubscription } = input
  if (String(profile?.plan || '').trim() === 'admin') {
    return { ok: false, status: 409, code: 'admin_account', message: 'Administrator accounts do not use subscriptions' }
  }
  if (liveSubscription || hasLiveLocalSubscription(profile)) {
    return {
      ok: false,
      status: 409,
      code: 'already_subscribed',
      message: 'You already have a subscription. Manage it from Plan & Billing instead of starting another.',
    }
  }
  return { ok: true }
}

/**
 * An existing Stripe customer is reused only for the user it already belongs to. A customer whose metadata names a
 * different user is never adopted or rewritten.
 */
export function customerBelongsToUser(customerMetadataUserId: string | null | undefined, userId: string) {
  const owner = String(customerMetadataUserId || '').trim()
  return !owner || owner === String(userId || '').trim()
}
