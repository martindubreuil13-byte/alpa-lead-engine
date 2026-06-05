import Stripe from 'stripe'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

import {
  getStripeCustomerId,
  getStripeSubscriptionId,
  stripe,
  syncCustomerSubscriptionState,
  syncSubscriptionToDatabase,
} from '@/lib/stripe/subscription'

function createAnalyticsClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function isUUID(value: string) {
  return /^[0-9a-fA-F-]{36}$/.test(value)
}

async function retrieveInvoiceSubscription(invoice: Stripe.Invoice) {
  const invoiceSubscription = (
    invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }
  ).subscription
  const subscriptionId = getStripeSubscriptionId(invoiceSubscription)

  if (!subscriptionId) return null

  return stripe.subscriptions.retrieve(subscriptionId)
}

async function trackPaymentCompleted(session: Stripe.Checkout.Session) {
  try {
    const userId = String(session.metadata?.user_id || '').trim()
    const email =
      String(session.metadata?.email || '').trim().toLowerCase() ||
      session.customer_details?.email?.trim().toLowerCase() ||
      session.customer_email?.trim().toLowerCase() ||
      null

    const supabase = createAnalyticsClient()
    const { error } = await supabase.from('activity_logs').insert({
      session_id: session.id,
      user_id: isUUID(userId) ? userId : null,
      email,
      event: 'payment_completed',
      metadata: {
        stripe_session_id: session.id,
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
        stripe_subscription_id: typeof session.subscription === 'string' ? session.subscription : null,
        source: session.metadata?.source || null,
      },
    })

    if (error) {
      console.error('[stripe.webhook] payment analytics failed', error)
    }
  } catch (error) {
    console.error('[stripe.webhook] payment analytics failed', error)
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

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = String(session.metadata?.user_id || '').trim()
        const customerId = getStripeCustomerId(
          session.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
        )
        const subscriptionId = getStripeSubscriptionId(
          session.subscription as string | Stripe.Subscription | null
        )

        if (!subscriptionId) {
          console.warn('[stripe.webhook] checkout completed without subscription', {
            eventId: event.id,
            customerId: customerId || null,
          })
          return new Response('OK', { status: 200 })
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        await syncSubscriptionToDatabase(subscription, {
          userId: userId && isUUID(userId) ? userId : null,
          customerId,
        })
        await trackPaymentCompleted(session)
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await syncSubscriptionToDatabase(subscription)
        break
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subscription = await retrieveInvoiceSubscription(invoice)

        if (subscription) {
          await syncSubscriptionToDatabase(subscription)
          break
        }

        const customerId = getStripeCustomerId(
          invoice.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
        )
        if (customerId) {
          await syncCustomerSubscriptionState(customerId)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscription = await retrieveInvoiceSubscription(invoice)

        if (subscription) {
          await syncSubscriptionToDatabase(subscription)
          break
        }

        const customerId = getStripeCustomerId(
          invoice.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
        )
        if (customerId) {
          await syncCustomerSubscriptionState(customerId)
        }
        break
      }

      default:
        break
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('[stripe.webhook] failed', error)
    return new Response('Webhook Error', { status: 400 })
  }
}
