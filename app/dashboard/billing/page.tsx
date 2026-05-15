import Link from 'next/link'
import { redirect } from 'next/navigation'

import UsageCard from '@/components/billing/UsageCard'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { isAdmin, isFree, isPaid } from '@/lib/auth/access'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function getPlanLeadLimit(plan: string) {
  if (plan === 'admin') return 1000
  if (plan === 'prospector') return 120
  if (plan === 'starter') return 300
  return 25
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
      .select('plan, subscription_status, current_period_end')
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
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .or('email.not.is.null,phone.not.is.null'),
  ])

  const usagePlan = profileData?.plan ?? user.plan
  const isPaidUsagePlan = usagePlan === 'admin' || usagePlan === 'prospector' || usagePlan === 'starter'
  const usageStatus = usagePlan === 'free' ? 'free' : 'active'
  const usageStarted = isPaidUsagePlan ? usageData?.period_start ?? null : null
  const usageRenewal = isPaidUsagePlan ? usageData?.period_end ?? null : null
  const usageLimit = getPlanLeadLimit(usagePlan)
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
      ? 'Pro Plan'
      : user.plan === 'prospector'
        ? 'Prospector Plan'
        : userIsPaid
          ? 'Starter Plan'
          : 'Free Plan'
  const currentPlanDescription = userIsAdmin
    ? 'Unlimited access across all ALPA features.'
    : user.plan === 'pro'
      ? 'Paid access across prospecting, outreach, and workflow tools.'
      : user.plan === 'prospector'
        ? '120 verified business leads per month with website and contact details.'
        : userIsPaid
          ? 'Up to 300 verified leads per month'
          : 'Access to 25 verified leads'
  const currentPlanBadge = userIsAdmin
    ? 'Admin access'
    : user.plan === 'pro'
      ? 'Pro access'
      : user.plan === 'prospector'
        ? 'Prospector access'
        : userIsPaid
          ? 'Starter access'
          : 'Free access'

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
          Plan &amp; Billing
        </h1>
        <p className="text-base text-slate-400">Manage your plan and track your usage</p>
      </header>

      <UsageCard
        plan={usagePlan}
        subscriptionStatus={usageStatus}
        currentPeriodStart={usageStarted}
        currentPeriodEnd={usageRenewal}
        leadsUsed={usageUsed}
        leadsLimit={usageLimit}
        usageWarning={usageWarning}
      />

      <section className="glass rounded-3xl p-8">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Current Plan
        </div>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
          {currentPlanName}
        </h2>
        <p className="mt-3 max-w-xl text-base leading-7 text-slate-300">
          {currentPlanDescription}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            {user.email}
          </span>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
            {currentPlanBadge}
          </span>
        </div>
      </section>

      <section className="glass rounded-3xl p-8">
        {userIsFree ? (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                Upgrade
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
                Ready to unlock more?
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                Upgrade to Starter to generate more leads and start outreach.
              </p>
            </div>

            <Link
              href="/plans"
              className="inline-flex min-h-[54px] items-center justify-center rounded-2xl border border-sky-300/30 bg-[linear-gradient(to_right,#3B82F6,#06B6D4)] px-6 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:brightness-110"
            >
              Upgrade to Starter
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Active Plan
            </div>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white">
              Your plan is active
            </h2>
            <p className="max-w-2xl text-base leading-7 text-slate-300">
              Your workspace has paid access enabled. Billing controls and future plan actions will land here in the next phase.
            </p>
            <button
              type="button"
              className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              Cancel my plan
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
