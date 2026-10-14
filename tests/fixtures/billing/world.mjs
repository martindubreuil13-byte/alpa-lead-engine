// An offline model of Stripe plus the database, for running the REAL checkout, session, activation and subscription routes without any
// network. It is NOT Stripe test mode: it checks ALPA's logic (ownership, idempotency, outage behaviour), not Stripe itself.
export const world = {
  currentUser: null, // { id, email } of the signed-in caller, or null
  profiles: new Map(), leads: [], customers: new Map(), sessions: new Map(), subscriptions: new Map(),
  syncCalls: [], stripeSessionsCreated: 0, stripeDown: false, seq: 0,
}
export function resetWorld() {
  Object.assign(world, { currentUser: null, leads: [], syncCalls: [], stripeSessionsCreated: 0, stripeDown: false, seq: 0 })
  world.profiles.clear(); world.customers.clear(); world.sessions.clear(); world.subscriptions.clear()
}
export const addUser = (id, over = {}) => { world.profiles.set(id, { id, email: `${id}@test.example`, plan: 'free', plan_status: 'free', subscription_status: 'free', stripe_customer_id: null, stripe_subscription_id: null, cancel_at_period_end: false, current_period_end: null, canceled_at: null, subscription_tier: 'free', created_at: '2026-10-01T00:00:00Z', ...over }); return id }
export const signIn = (id) => { world.currentUser = id ? { id, email: world.profiles.get(id).email } : null }
const unavailable = () => Object.assign(new Error('An error occurred with our connection to Stripe.'), { type: 'StripeConnectionError' })

// ---- a tiny query builder over arrays
function builder(rows, table) {
  let list = [...rows]; let single = false; let patch = null
  const q = {
    select: () => q,
    eq: (c, v) => { list = list.filter((r) => r[c] === v); return q },
    neq: (c, v) => { list = list.filter((r) => r[c] !== v); return q },
    limit: (n) => { list = list.slice(0, n); return q },
    maybeSingle: async () => ({ data: list[0] ?? null, error: null }),
    upsert: async (row) => { const cur = world.profiles.get(row.id) ?? {}; world.profiles.set(row.id, { ...cur, ...row }); return { error: null } },
    then: (resolve) => resolve({ data: list, error: null }),
  }
  return q
}
export const adminClient = { from: (table) => builder(table === 'profiles' ? [...world.profiles.values()] : table === 'leads' ? world.leads : [], table) }

// ---- '@supabase/supabase-js'
export const createClient = () => adminClient
// ---- '@/lib/supabase/server'
export async function createSupabaseServerClient() {
  return { from: (table) => builder(table === 'profiles' ? [...world.profiles.values()] : world.leads, table), auth: { getUser: async () => ({ data: { user: world.currentUser ? { id: world.currentUser.id, email: world.currentUser.email } : null }, error: null }) } }
}
export const createServerClient = createSupabaseServerClient
// ---- '@/lib/stripe'
const customerOf = (s) => (typeof s.customer === 'string' ? s.customer : s.customer?.id)
export async function getCheckoutSession(id) {
  if (world.stripeDown) throw unavailable()
  const s = world.sessions.get(id); if (!s) throw new Error('No such checkout.session')
  return { ...s }
}
export async function createStripeCustomer({ customerId, email, userId }) {
  if (world.stripeDown) throw unavailable()
  const existing = customerId ? world.customers.get(customerId) : null
  if (existing && (!existing.metadata.user_id || existing.metadata.user_id === userId)) return existing
  const customer = { id: `cus_${++world.seq}`, email, metadata: { user_id: userId ?? '' } }
  world.customers.set(customer.id, customer); return customer
}
async function newSession({ customerId, userId, userEmail, source }, plan) {
  if (world.stripeDown) throw unavailable()
  const id = `cs_${++world.seq}`; world.stripeSessionsCreated += 1
  const session = { id, mode: 'subscription', status: 'open', payment_status: 'unpaid', customer: customerId, subscription: null, metadata: { user_id: userId ?? '', email: userEmail, plan, ...(source ? { source } : {}) }, url: `https://checkout.stripe.test/${id}` }
  world.sessions.set(id, session); return session
}
export const createStarterCheckoutSession = (p) => newSession(p, 'starter')
export const createProspectorCheckoutSession = (p) => newSession(p, 'prospector')
export const STRIPE_API_VERSION = 'test'
// the customer pays: the session completes with a live subscription for its customer
export function pay(sessionId, over = {}) {
  const s = world.sessions.get(sessionId)
  const sub = { id: `sub_${++world.seq}`, customer: s.customer, status: 'active', cancel_at_period_end: false, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, metadata: { plan: s.metadata.plan }, ...over }
  world.subscriptions.set(sub.id, sub); Object.assign(s, { status: 'complete', payment_status: 'paid', subscription: sub.id }); return sub
}
// ---- '@/lib/stripe/subscription'
export const stripe = { subscriptions: { retrieve: async (id) => { if (world.stripeDown) throw unavailable(); const s = world.subscriptions.get(id); if (!s) throw Object.assign(new Error('no such subscription'), { statusCode: 404 }); return { ...s } } } }
export const createSupabaseAdminClient = () => adminClient
export async function getActiveSubscription(userId) {
  if (world.stripeDown) throw unavailable()
  const profile = world.profiles.get(userId) ?? null
  const sub = profile?.stripe_subscription_id ? world.subscriptions.get(profile.stripe_subscription_id) : null
  return { profile, subscription: sub && ['active', 'trialing'].includes(sub.status) ? sub : null }
}
export async function syncSubscriptionToDatabase(subscription, { userId, customerId }) {
  world.syncCalls.push({ subscriptionId: subscription.id, userId, customerId })
  const cur = world.profiles.get(userId); if (!cur) return null
  const plan = subscription.metadata?.plan === 'prospector' ? 'prospector' : 'starter'
  world.profiles.set(userId, { ...cur, plan, subscription_tier: plan, plan_status: subscription.status, subscription_status: subscription.status, stripe_customer_id: customerId, stripe_subscription_id: subscription.id })
  return { userId }
}
// ---- '@/lib/auth/resolve-user-subscription' (what the subscription pages call)
const storedOf = (id) => { const p = world.profiles.get(id); return { plan: p.plan, plan_status: p.plan_status, subscription_active: p.plan_status === 'active', cancel_at_period_end: false, current_period_end: p.current_period_end, stripe_customer_id: p.stripe_customer_id, stripe_subscription_id: p.stripe_subscription_id, subscription_tier: p.subscription_tier } }
export async function resolveUserSubscription(userId) { if (world.stripeDown) throw unavailable(); return storedOf(userId) }
export async function readStoredSubscription(userId) { return storedOf(userId) }

export const NextResponse = { json: (data, init) => new Response(JSON.stringify(data), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }) }
