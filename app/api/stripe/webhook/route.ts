import Stripe from 'stripe'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16' as Stripe.LatestApiVersion,
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function toIsoDate(timestamp: number | null | undefined) {
  if (!timestamp) {
    return null
  }

  return new Date(timestamp * 1000).toISOString()
}

function isUUID(value: string) {
  return /^[0-9a-fA-F-]{36}$/.test(value)
}

function getCurrentPeriodEnd(
  subscription: Stripe.Subscription | (Stripe.Subscription & { current_period_end?: number | null })
) {
  return toIsoDate(
    (subscription as Stripe.Subscription & { current_period_end?: number | null }).current_period_end
  )
}

function getSubscriptionId(subscription: string | Stripe.Subscription | null | undefined) {
  if (!subscription) {
    return ''
  }

  return typeof subscription === 'string' ? subscription.trim() : subscription.id.trim()
}

async function resolveProfileByUserId(userId: string | null | undefined) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) {
    return null
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, stripe_customer_id')
    .eq('id', normalizedUserId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data ?? null
}

async function resolveProfileByStripeCustomerId(customerId: string | null | undefined) {
  const normalizedCustomerId = String(customerId || '').trim()
  if (!normalizedCustomerId) {
    return null
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, stripe_customer_id')
    .eq('stripe_customer_id', normalizedCustomerId)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data ?? null
}

function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) {
  if (!customer) {
    return ''
  }

  return typeof customer === 'string' ? customer.trim() : customer.id.trim()
}

async function retrieveSubscription(
  subscription: string | Stripe.Subscription | null | undefined
): Promise<Stripe.Subscription | null> {
  const subscriptionId = getSubscriptionId(subscription)

  if (!subscriptionId) {
    return null
  }

  return stripe.subscriptions.retrieve(subscriptionId)
}

async function updateSubscriptionRecords(
  userId: string,
  customerId: string | null | undefined,
  updates: {
    plan: 'free' | 'starter'
    subscription_status: string
    current_period_end: string | null
  }
) {
  const normalizedCustomerId = String(customerId || '').trim()

  const { error: usersError } = await supabase
    .from('users')
    .update({ plan: updates.plan })
    .eq('id', userId)

  if (usersError) {
    throw new Error(usersError.message)
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      plan: updates.plan,
      subscription_status: updates.subscription_status,
      current_period_end: updates.current_period_end,
      stripe_customer_id: normalizedCustomerId || null,
    })
    .eq('id', userId)

  if (profileError) {
    throw new Error(profileError.message)
  }
}

async function updateProfileByStripeCustomerId(
  customerId: string | null | undefined,
  updates: {
    plan?: 'free' | 'starter'
    subscription_status?: string
    current_period_end?: string | null
  }
) {
  const normalizedCustomerId = String(customerId || '').trim()

  if (!normalizedCustomerId) {
    return
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      ...(updates.plan ? { plan: updates.plan } : {}),
      ...(updates.subscription_status ? { subscription_status: updates.subscription_status } : {}),
      ...(updates.current_period_end !== undefined
        ? { current_period_end: updates.current_period_end }
        : {}),
    })
    .eq('stripe_customer_id', normalizedCustomerId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.text()
    const headerStore = await headers()
    const sig = headerStore.get('stripe-signature')

    if (!sig) {
      return new Response('Missing stripe signature', { status: 400 })
    }

    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
    console.log('Stripe event:', event.type)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = String(session.metadata?.user_id || '').trim()
        const customerId = getCustomerId(
          session.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
        )
        let profile = null

        if (userId && isUUID(userId)) {
          profile = await resolveProfileByUserId(userId)
        }

        if (!profile) {
          profile = await resolveProfileByStripeCustomerId(customerId)
        }

        if (!profile) {
          if (userId && isUUID(userId)) {
            console.warn('User not found yet, retrying later:', userId, {
              eventId: event.id,
              customerId: customerId || null,
            })
            return new Response('OK', { status: 200 })
          }

          console.warn('No user found for Stripe customer:', customerId || null, {
            eventId: event.id,
          })
          break
        }

        const subscription = await retrieveSubscription(
          session.subscription as string | Stripe.Subscription | null
        )

        await updateSubscriptionRecords(profile.id, customerId, {
          plan: 'starter',
          subscription_status: subscription?.status || 'active',
          current_period_end: subscription ? getCurrentPeriodEnd(subscription) : null,
        })
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const invoiceSubscription = (
          invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }
        ).subscription
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        const subscriptionId =
          typeof invoiceSubscription === 'string'
            ? invoiceSubscription
            : invoiceSubscription?.id

        console.log('INVOICE EVENT', {
          customerId: customerId || null,
          subscriptionId: subscriptionId || null,
          eventId: event.id,
        })

        if (!customerId || !subscriptionId) {
          console.warn('Skipping invoice.payment_succeeded without subscription linkage', {
            eventId: event.id,
            customerId: customerId || null,
            subscriptionId: subscriptionId || null,
          })
          return new Response('OK', { status: 200 })
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)

        await updateProfileByStripeCustomerId(customerId, {
          plan: 'starter',
          subscription_status: subscription.status,
          current_period_end: getCurrentPeriodEnd(subscription),
        })
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = getCustomerId(
          invoice.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
        )

        await updateProfileByStripeCustomerId(customerId, {
          subscription_status: 'past_due',
        })
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = getCustomerId(
          subscription.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
        )

        await updateProfileByStripeCustomerId(customerId, {
          plan: 'free',
          subscription_status: 'canceled',
          current_period_end: null,
        })
        break
      }

      default:
        break
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Stripe webhook failed:', error)
    return new Response('Webhook Error', { status: 400 })
  }
}
