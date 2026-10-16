import * as billing from '../billing/world.mjs'
import * as guest from '../guest/server.mjs'
import * as live from '../billing/stripe-world.mjs'
export * from '../billing/world.mjs'
export { cookies, after, guestSession, loadGuestSession } from '../guest/server.mjs'
export { stripe, getStripeCustomerId, getCurrentPeriodEnd } from '../billing/stripe-world.mjs'
export const createSupabaseAdminClient = () => billing.adminClient
export const getPlanFromSubscription = sub => sub.metadata?.plan ?? 'starter_100'
export const createAdminClient = () => { throw new Error('No allowance read/write may occur before an unsuccessful entitlement check') }
export function createServerClient() {
  guest.state.user = billing.world.currentUser
  guest.state.existingLeads = billing.world.leads
  return guest.createServerClient()
}
export function guestDb() {
  const db = guest.guestDb()
  return { ...db, rpc: async (name,args) => {
    guest.state.existingLeads = billing.world.leads
    const result = await db.rpc(name,args)
    if (!result.error && guest.state.claimed) billing.world.leads.push(...guest.state.claimed.map((r,i) => ({...r,id:`import-${i}`})))
    guest.state.claimed = undefined
    return result
  } }
}
export async function syncSubscriptionToDatabase(sub, args) {
  const result = await billing.syncSubscriptionToDatabase(sub,args)
  live.addAccount(args.userId,billing.world.profiles.get(args.userId))
  return result
}
