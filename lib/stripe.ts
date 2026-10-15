import Stripe from 'stripe'

import { customerBelongsToUser } from '@/lib/stripe/checkout-guard'

export const STRIPE_API_VERSION = '2026-02-25.clover'

// Legacy IDs retain their original entitlement; an unrecognized ID must never grant access.
export function getPlanFromPriceId(priceId: string | null | undefined): 'starter_100' | 'pro' | 'prospector' | 'starter' {
  if (priceId && priceId === process.env.STRIPE_ALPA_STARTER_PRICE_ID) return 'starter_100'
  if (priceId && priceId === process.env.STRIPE_ALPA_PRO_PRICE_ID) return 'pro'
  if (priceId && priceId === process.env.STRIPE_PROSPECTOR_PRICE_ID) return 'prospector'
  if (priceId && priceId === process.env.STRIPE_STARTER_PRICE_ID) return 'starter'
  throw new Error('Unrecognized Stripe price; subscriber audit required')
}
export function getPlanFromSubscription(subscription: Stripe.Subscription) {
  if (subscription.items.data.length !== 1) throw new Error('Expected one subscription item')
  return getPlanFromPriceId(subscription.items.data[0]?.price?.id)
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export async function getConfiguredPrice(plan: 'starter' | 'pro') {
  const priceId = process.env[plan === 'starter' ? 'STRIPE_ALPA_STARTER_PRICE_ID' : 'STRIPE_ALPA_PRO_PRICE_ID']
  if (!priceId) throw new Error('New ALPA prices are not configured')
  const legacy = [process.env.STRIPE_STARTER_PRICE_ID, process.env.STRIPE_PROSPECTOR_PRICE_ID]
  if (legacy.includes(priceId) || process.env.STRIPE_ALPA_STARTER_PRICE_ID === process.env.STRIPE_ALPA_PRO_PRICE_ID) {
    throw new Error('New and legacy prices must be distinct')
  }
  const price = await stripe.prices.retrieve(priceId)
  if (!price.active || price.currency !== 'usd' || price.unit_amount !== (plan === 'starter' ? 999 : 2499) ||
      price.type !== 'recurring' || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed') {
    throw new Error('Configured ALPA price does not match the advertised monthly plan')
  }
  return priceId
}

type CheckoutSessionParams = {
  origin: string
  customerId: string
  priceId: string
  userId?: string | null
  userEmail?: string | null
  source?: string | null
}

async function createSubscriptionCheckoutSession({
  origin,
  customerId,
  priceId,
  userId,
  userEmail,
  source,
}: CheckoutSessionParams) {
  const normalizedUserId = userId?.trim() ?? null
  const normalizedEmail = String(userEmail || '').trim().toLowerCase()
  const normalizedSource = String(source || '').trim()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || origin

  // One open session per user, plan and source within a short window: a double click or a retry gets the same session back
  // instead of a second one that could end in two subscriptions. (Stripe rejects a reused key only if the parameters differ.)
  const idempotencyKey = normalizedUserId
    ? `checkout:${normalizedUserId}:${priceId}:${normalizedSource || 'none'}:${Math.floor(Date.now() / 600_000)}`
    : undefined

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/post-checkout?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/plans`,
    allow_promotion_codes: true,
    ...(normalizedSource ? { client_reference_id: normalizedSource } : {}),
    metadata: {
      user_id: normalizedUserId ?? '',
      email: normalizedEmail,
      ...(normalizedSource ? { source: normalizedSource } : {}),
    },
  }, idempotencyKey ? { idempotencyKey } : undefined)

  if (!session.url) {
    throw new Error('Stripe checkout did not return a redirect URL')
  }

  return session
}

type PublicCheckoutParams = Omit<CheckoutSessionParams, 'priceId'>

export async function createStarterCheckoutSession(params: PublicCheckoutParams) {
  return createSubscriptionCheckoutSession({ ...params, priceId: await getConfiguredPrice('starter') })
}

export async function createProCheckoutSession(params: PublicCheckoutParams) {
  return createSubscriptionCheckoutSession({ ...params, priceId: await getConfiguredPrice('pro') })
}

export async function createStripeCustomer({
  customerId,
  email,
  userId,
  source,
}: {
  customerId?: string | null
  email?: string | null
  userId?: string | null
  source?: string | null
}) {
  const normalizedCustomerId = String(customerId || '').trim()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedUserId = userId?.trim() ?? null
  const normalizedSource = String(source || '').trim()

  if (normalizedCustomerId) {
    const existingCustomer = await stripe.customers.retrieve(normalizedCustomerId)

    if (!existingCustomer.deleted) {
      // Never adopt or rewrite a Stripe customer that was created for a different account.
      if (!customerBelongsToUser(existingCustomer.metadata?.user_id, normalizedUserId ?? '')) {
        throw new Error('This billing profile belongs to a different account')
      }

      if (
        (normalizedUserId && existingCustomer.metadata?.user_id !== normalizedUserId) ||
        (normalizedSource && existingCustomer.metadata?.source !== normalizedSource)
      ) {
        return stripe.customers.update(existingCustomer.id, {
          ...(normalizedEmail ? { email: normalizedEmail } : {}),
          metadata: {
            ...existingCustomer.metadata,
            user_id: normalizedUserId ?? existingCustomer.metadata?.user_id ?? '',
            ...(normalizedSource ? { source: normalizedSource } : {}),
          },
        })
      }

      return existingCustomer
    }
  }

  return stripe.customers.create({
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    metadata: {
      user_id: normalizedUserId ?? '',
      ...(normalizedSource ? { source: normalizedSource } : {}),
    },
  })
}

export async function getCheckoutSession(sessionId: string) {
  const normalizedSessionId = sessionId.trim()

  if (!normalizedSessionId) {
    throw new Error('Missing checkout session id')
  }

  return stripe.checkout.sessions.retrieve(normalizedSessionId)
}

export function getCheckoutEmail(session: Stripe.Checkout.Session) {
  return (
    session.customer_email?.trim().toLowerCase() ||
    session.customer_details?.email?.trim().toLowerCase() ||
    ''
  )
}

export function isCheckoutUnlocked(session: Stripe.Checkout.Session) {
  return (
    session.mode === 'subscription' &&
    session.status === 'complete' &&
    session.payment_status !== 'unpaid'
  )
}
