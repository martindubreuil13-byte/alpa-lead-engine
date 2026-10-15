// What the webhook route imports, with the real Stripe signature code (offline) and everything else recorded.
import Stripe from 'stripe'
export const hook = { headers: new Headers(), syncs: [], customerSyncs: [], analytics: [], subscriptions: new Map() }
export const reset = () => { hook.headers = new Headers(); hook.syncs.length = 0; hook.customerSyncs.length = 0; hook.analytics.length = 0; hook.subscriptions.clear() }
export const headers = async () => hook.headers
export const stripe = new Stripe('sk_test_offline_fixture')
stripe.subscriptions.retrieve = async (id) => { const s = hook.subscriptions.get(id); if (!s) throw new Error('no such subscription'); return s }
export const getStripeCustomerId = (c) => (!c ? '' : typeof c === 'string' ? c : c.id)
export const getStripeSubscriptionId = (s) => (!s ? '' : typeof s === 'string' ? s : s.id)
export const syncSubscriptionToDatabase = async (subscription, options = {}) => { hook.syncs.push({ id: subscription.id, ...options }); return {} }
export const syncCustomerSubscriptionState = async (customerId) => { hook.customerSyncs.push(customerId) }
export const createClient = () => ({
  from: () => ({
    insert: async (row) => { hook.analytics.push(row); return { error: null } },
    select: () => {
      const filters = {}
      const q = {
        eq: (c, v) => { filters[c] = v; return q },
        limit: async () => ({ data: hook.analytics.filter((r) => Object.entries(filters).every(([c, v]) => r[c] === v)).map((r, i) => ({ id: i })), error: null }),
      }
      return q
    },
  }),
})
