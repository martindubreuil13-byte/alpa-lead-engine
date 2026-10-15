// A fake Stripe and database for running the REAL lib/auth/resolve-user-subscription.ts (and everything above it) offline. Unlike
// world.mjs it does not replace the resolver, so it reproduces the decisions the real one makes (when it asks Stripe, when it trusts the
// stored profile). Stripe errors are the real Stripe error classes: a 404 for an unknown id, a connection error during an outage.
import Stripe from 'stripe'

export const w = { profiles: new Map(), users: new Map(), customers: new Map(), subscriptions: new Map(), down: false, calls: 0, synced: [] }
export const reset = () => { w.profiles.clear(); w.users.clear(); w.customers.clear(); w.subscriptions.clear(); w.down = false; w.calls = 0; w.synced.length = 0 }
const outage = () => new Stripe.errors.StripeConnectionError({ message: 'An error occurred with our connection to Stripe.' })
const notFound = (what) => new Stripe.errors.StripeInvalidRequestError({ message: `No such ${what}`, type: 'invalid_request_error', statusCode: 404 })
const asked = () => { w.calls += 1; if (w.down) throw outage() }

export const addAccount = (id, profile = {}) => {
  w.profiles.set(id, { id, plan: 'free', stripe_customer_id: null, stripe_subscription_id: null, subscription_status: 'free', plan_status: 'free', cancel_at_period_end: false, current_period_end: null, canceled_at: null, subscription_tier: 'free', ...profile })
  w.users.set(id, { id, email: `${id}@test.example`, plan: profile.plan === 'admin' ? 'admin' : 'free' })
}
export const addSubscription = (sub) => { const full = { cancel_at_period_end: false, canceled_at: null, items: { data: [{ price: { id: 'price_starter' } }] }, ...sub }; w.subscriptions.set(full.id, full); return full }
export const days = (n) => Math.floor(Date.now() / 1000) + n * 86400

const builder = (map) => {
  let list = [...map.values()]
  const q = {
    select: () => q,
    eq: (c, v) => { list = list.filter((r) => r[c] === v); return q },
    maybeSingle: async () => ({ data: list[0] ?? null, error: null }),
    update: (patch) => ({ eq: async (c, v) => { for (const r of map.values()) if (r[c] === v) Object.assign(r, patch); return { error: null } } }),
    then: (resolve) => resolve({ data: list, error: null }),
  }
  return q
}
export const createSupabaseAdminClient = () => ({ from: (t) => builder(t === 'profiles' ? w.profiles : w.users) })

export const stripe = {
  subscriptions: {
    retrieve: async (id) => { asked(); const s = w.subscriptions.get(id); if (!s) throw notFound('subscription'); return s },
    list: async ({ customer }) => { asked(); return { data: [...w.subscriptions.values()].filter((s) => s.customer === customer) } },
  },
  customers: {
    retrieve: async (id) => { asked(); const c = w.customers.get(id); if (!c) throw notFound('customer'); return c },
    search: async () => { asked(); return { data: [] } },
    list: async () => { asked(); return { data: [] } },
  },
}
export const getStripeCustomerId = (c) => (!c ? '' : typeof c === 'string' ? c.trim() : c.id.trim())
export const getCurrentPeriodEnd = (s) => (s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null)
export const syncSubscriptionToDatabase = async (subscription, { userId, customerId }) => {
  w.synced.push(subscription.id)
  const p = w.profiles.get(userId); if (!p) return null
  Object.assign(p, { stripe_customer_id: customerId, stripe_subscription_id: subscription.id, plan_status: subscription.status, subscription_status: subscription.status, current_period_end: getCurrentPeriodEnd(subscription) })
  return { stripe_customer_id: customerId }
}
export const getPlanFromSubscription = (s) => (s.items.data[0]?.price?.id === 'price_prospector' ? 'prospector' : 'starter')
