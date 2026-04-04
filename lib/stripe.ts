import Stripe from 'stripe'

export const STRIPE_API_VERSION = '2026-02-25.clover'

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

export async function createStarterCheckoutSession({
  origin,
  customerId,
  userId,
  userEmail,
  source,
}: {
  origin: string
  customerId: string
  userId?: string | null
  userEmail?: string | null
  source?: string | null
}) {
  const normalizedUserId = userId?.trim() ?? null
  const normalizedEmail = String(userEmail || '').trim().toLowerCase()
  const normalizedSource = String(source || '').trim()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || origin

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [
      {
        price: getStarterPriceId(),
        quantity: 1,
      },
    ],
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
