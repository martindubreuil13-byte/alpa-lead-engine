import Stripe from 'stripe'

export const STRIPE_API_VERSION = '2026-02-25.clover'

// Maps known Stripe price IDs to internal plan keys.
// Add new plans here; unknown price IDs fall back to 'starter'.
export function getPlanFromPriceId(priceId: string | null | undefined): 'prospector' | 'starter' {
  if (!priceId) return 'starter'
  if (priceId === process.env.STRIPE_PROSPECTOR_PRICE_ID) return 'prospector'
  return 'starter'
}

export function getPlanFromSubscription(subscription: Stripe.Subscription): 'prospector' | 'starter' {
  const priceId = subscription.items.data[0]?.price?.id ?? null
  return getPlanFromPriceId(priceId)
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

function getStarterPriceId() {
  const priceId = process.env.STRIPE_STARTER_PRICE_ID

  if (!priceId) {
    throw new Error('STRIPE_STARTER_PRICE_ID is not configured')
  }

  return priceId
}

function getProspectorPriceId() {
  const priceId = process.env.STRIPE_PROSPECTOR_PRICE_ID

  if (!priceId) {
    throw new Error('STRIPE_PROSPECTOR_PRICE_ID is not configured')
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
  })

  if (!session.url) {
    throw new Error('Stripe checkout did not return a redirect URL')
  }

  return session
}

type PublicCheckoutParams = Omit<CheckoutSessionParams, 'priceId'>

export async function createStarterCheckoutSession(params: PublicCheckoutParams) {
  return createSubscriptionCheckoutSession({ ...params, priceId: getStarterPriceId() })
}

export async function createProspectorCheckoutSession(params: PublicCheckoutParams) {
  return createSubscriptionCheckoutSession({ ...params, priceId: getProspectorPriceId() })
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
