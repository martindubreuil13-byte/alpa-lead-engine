import { redirect } from 'next/navigation'

import BillingPlanActions from '@/components/billing/BillingPlanActions'
import UsageCard from '@/components/billing/UsageCard'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { isAdmin, isFree, isPaid } from '@/lib/auth/access'
import { getLeadLimit } from '@/lib/usage/usage'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export default async function BillingPage() {
  const user = await getUserProfile()
  if (!user) {
    console.warn('[billing] no user resolved, redirecting to /plans')
    redirect('/plans')
  }

  console.info('[billing] user resolved', {
    userId: user.id,
    plan: user.plan,
    role: user.role,
  })

  const userIsFree = isFree(user) || !user
  const userIsAdmin = isAdmin(user)
  const userIsPaid = isPaid(user)
  const supabase = await createSupabaseServerClient()
  const nowIso = new Date().toISOString()
  const [{ data: profileData }, { data: usageData }, { count: freeLeadCount }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'plan, subscription_status, plan_status, stripe_subscription_id, cancel_at_period_end, current_period_end, canceled_at, subscription_tier'
      )
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('usage')
      .select('leads_used, leads_limit, period_start, period_end')
      .eq('user_id', user.id)
      .lte('period_start', nowIso)
      .gte('period_end', nowIso)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('business_allowance_ledger')
      .select('lead_id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  const usagePlan = user.plan
  const billingStatus =
    user.plan_status ?? profileData?.plan_status ?? profileData?.subscription_status ?? user.subscription_status ?? null
  const cancelAtPeriodEnd = Boolean(user.cancel_at_period_end ?? profileData?.cancel_at_period_end)
  const billingPeriodEnd = user.current_period_end ?? profileData?.current_period_end ?? null
  const hasStripeSubscription = Boolean(user.stripe_subscription_id ?? profileData?.stripe_subscription_id)
  const hasStripeCustomer = Boolean(user.stripe_customer_id)
  const isPaidUsagePlan = usagePlan === 'starter_100' || usagePlan === 'admin' || usagePlan === 'prospector' || usagePlan === 'starter' || usagePlan === 'pro'
  const usageStatus = usagePlan === 'free' ? 'free' : billingStatus ?? 'active'
  const usageStarted = isPaidUsagePlan ? usageData?.period_start ?? null : null
  const usageRenewal = isPaidUsagePlan ? usageData?.period_end ?? null : null
  const usageLimit = getLeadLimit(usagePlan)
  const usageUsed = isPaidUsagePlan ? usageData?.leads_used ?? 0 : freeLeadCount ?? 0
  const usageWarning =
    isPaidUsagePlan && usageLimit > 0
      ? usageUsed / usageLimit >= 0.9
        ? 'critical'
        : usageUsed / usageLimit >= 0.8
          ? 'warning'
          : 'none'
      : 'none'

  const currentPlanName = userIsAdmin
    ? 'Admin Access'
    : user.plan === 'pro'
      ? 'ALPA Pro'
      : user.plan === 'starter_100'
        ? 'ALPA Starter'
        : user.plan === 'prospector'
          ? 'Legacy Prospector'
          : userIsPaid
            ? 'Legacy Starter'
            : 'Free Plan'
  const statusLabel = userIsAdmin ? 'Administrator access' : userIsFree ? 'Free access' : cancelAtPeriodEnd ? 'Cancellation scheduled' : billingStatus ? billingStatus.replaceAll('_', ' ') : 'Status unavailable'
  const billingDate = hasStripeSubscription && !userIsAdmin ? formatDate(billingPeriodEnd) : null

  return (
    <div className="mx-auto max-w-6xl space-y-7 pb-8">
      <header className="space-y-3">
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.24em] text-[#d8c28a]">
          <span aria-hidden="true" className="h-px w-10 bg-[#d8c28a]" /> Workspace / Account
        </div>
        <h1 className="font-display text-4xl tracking-[-0.03em] text-[#f7f5ef] sm:text-5xl">Plan &amp; Billing</h1>
        <p className="text-sm text-slate-400">Your access, business allowance and subscription in one place.</p>
      </header>

      <section aria-labelledby="plan-title" className="border-y border-white/10 py-5">
        <div className="grid gap-5 sm:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <h2 id="plan-title" className="text-[10px] uppercase tracking-[0.22em] text-[#d8c28a]">Your Plan</h2>
            <p className="mt-2 font-display text-2xl text-[#f7f5ef]">{currentPlanName}</p>
            <p className="mt-1 break-all text-xs text-slate-400">{user.email}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Access status</p>
            <p className="mt-2 text-sm capitalize text-[#f7f5ef]">{statusLabel}</p>
            {userIsAdmin && <p className="mt-1 text-xs text-slate-400">Administrative access with a numerical usage allowance.</p>}
          </div>
          <div>
            <p className="text-xs text-slate-400">{isPaidUsagePlan ? 'Monthly business allowance' : 'Business allowance'}</p>
            <p className="mt-2 text-xl tabular-nums text-[#f7f5ef]">{usageLimit.toLocaleString('en-US')}</p>
            {billingDate && <p className="mt-1 text-xs text-slate-400">{cancelAtPeriodEnd ? 'Billing period ends' : 'Next billing date'}: {billingDate}</p>}
          </div>
        </div>
      </section>

      <UsageCard plan={usagePlan} subscriptionStatus={usageStatus} currentPeriodStart={usageStarted} currentPeriodEnd={usageRenewal} leadsUsed={usageUsed} leadsLimit={usageLimit} usageWarning={usageWarning} />

      <section aria-labelledby="management-title" className="border-b border-white/10 pb-6">
        <h2 id="management-title" className="text-[10px] uppercase tracking-[0.22em] text-[#d8c28a]">Subscription Management</h2>
        <div className="mt-4">
          {userIsAdmin ? <p className="text-sm text-slate-400">This workspace has administrator access. It is not a paid subscription.</p> : userIsFree ? <p className="text-sm text-slate-400">Your workspace has free access. There is no paid subscription to manage.</p> : <BillingPlanActions planChangesEnabled={process.env.ALPA_PLAN_CHANGES_ENABLED === 'true'} initialState={{ planStatus: billingStatus, cancelAtPeriodEnd, currentPeriodEnd: billingPeriodEnd, subscriptionTier: user.subscription_tier ?? profileData?.subscription_tier ?? usagePlan, hasStripeSubscription, hasStripeCustomer, subscriptionActive: Boolean(user.subscription_active) }} />}
        </div>
      </section>

      <section aria-labelledby="options-title" className="flex flex-col justify-between gap-2 sm:flex-row sm:items-baseline">
        <h2 id="options-title" className="font-display text-xl text-[#f7f5ef]">Future Plan Options</h2>
        <p className="text-xs text-slate-400">Additional plans and business packages will appear here when available.</p>
      </section>
    </div>
  )
}
