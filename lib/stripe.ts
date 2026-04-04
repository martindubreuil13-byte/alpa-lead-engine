const STRIPE_API_BASE = 'https://api.stripe.com/v1'
export const STRIPE_API_VERSION = '2026-02-25.clover'

type StripeCheckoutSession = {
  id: string
  url?: string | null
  mode?: string | null
  status?: string | null
  payment_status?: string | null
  customer_email?: string | null
  customer_details?: {
    email?: string | null
  } | null
}

function getStripeSecretKey() {
  const secretKey = process.env.STRIPE_SECRET_KEY

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }

  return secretKey
}

function getStarterPriceId() {
  const priceId = process.env.STRIPE_STARTER_PRICE_ID

  if (!priceId) {
    throw new Error('STRIPE_STARTER_PRICE_ID is not configured')
  }

  return priceId
}

async function stripeRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      'Stripe-Version': STRIPE_API_VERSION,
      ...(init?.headers || {}),
    },
  })

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null

  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Stripe request failed')
  }

  if (!payload) {
    throw new Error('Stripe returned an empty response')
  }

  return payload as T
}

export async function createStarterCheckoutSession({
  origin,
  email,
  source,
}: {
  origin: string
  email?: string | null
  source?: string | null
}) {
  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('success_url', `${origin}/post-checkout?session_id={CHECKOUT_SESSION_ID}`)
  params.set('cancel_url', `${origin}/plans?checkout=cancelled`)
  params.set('allow_promotion_codes', 'true')
  params.set('line_items[0][price]', getStarterPriceId())
  params.set('line_items[0][quantity]', '1')

  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (normalizedEmail) {
    params.set('customer_email', normalizedEmail)
  }

  const normalizedSource = String(source || '').trim()
  if (normalizedSource) {
    params.set('client_reference_id', normalizedSource)
    params.set('metadata[source]', normalizedSource)
  }

  const session = await stripeRequest<StripeCheckoutSession>('/checkout/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!session.url) {
    throw new Error('Stripe checkout did not return a redirect URL')
  }

  return session
}

export async function getCheckoutSession(sessionId: string) {
  const normalizedSessionId = sessionId.trim()

  if (!normalizedSessionId) {
    throw new Error('Missing checkout session id')
  }

  return stripeRequest<StripeCheckoutSession>(
    `/checkout/sessions/${encodeURIComponent(normalizedSessionId)}`
  )
}

export function getCheckoutEmail(session: StripeCheckoutSession) {
  return (
    session.customer_email?.trim().toLowerCase() ||
    session.customer_details?.email?.trim().toLowerCase() ||
    ''
  )
}

export function isCheckoutUnlocked(session: StripeCheckoutSession) {
  return (
    session.mode === 'subscription' &&
    session.status === 'complete' &&
    session.payment_status !== 'unpaid'
  )
}
