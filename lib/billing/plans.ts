// Versioned entitlement key avoids changing existing Starter (500) subscriptions.
export const PLANS = {
  free: { name: 'ALPA Free', priceCents: 0, businesses: 25, monthly: false },
  starter_100: { name: 'ALPA Starter', priceCents: 999, businesses: 100, monthly: true },
  pro: { name: 'ALPA Pro', priceCents: 2499, businesses: 500, monthly: true },
  prospector: { name: 'Legacy Prospector', priceCents: 999, businesses: 120, monthly: true },
  starter: { name: 'Legacy Starter', priceCents: 2999, businesses: 500, monthly: true },
} as const
export type PublicPaidPlan = 'starter' | 'pro'
export function publicPlan(value: unknown): PublicPaidPlan | null {
  return value === 'starter' || value === 'pro' ? value : null
}
export function entitlementForCheckout(plan: PublicPaidPlan) {
  return plan === 'starter' ? 'starter_100' as const : 'pro' as const
}
