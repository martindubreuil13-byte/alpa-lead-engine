type UsageCardProps = {
  loading?: boolean
  plan?: string | null
  subscriptionStatus?: string | null
  currentPeriodStart?: string | null
  currentPeriodEnd?: string | null
  leadsUsed?: number | null
  leadsLimit?: number | null
  usageWarning?: 'none' | 'warning' | 'critical' | null
}

function formatPlanLabel(plan: string | null | undefined) {
  if (plan === 'prospector') return 'Prospector'
  if (plan === 'starter') return 'Starter'
  if (plan === 'pro') return 'Pro'
  if (plan === 'admin') return 'Admin'
  return 'Free'
}

function getPlanLeadLimit(plan: string) {
  if (plan === 'admin') return 1000
  if (plan === 'prospector') return 120
  if (plan === 'starter') return 500
  return 25
}

function formatRenewalDate(value: string | null | undefined) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function getProgressTone(percent: number) {
  if (percent > 90) return 'bg-red-400'
  if (percent >= 70) return 'bg-amber-400'
  return 'bg-sky-400'
}

export default function UsageCard({
  loading = false,
  plan = null,
  subscriptionStatus = null,
  currentPeriodStart = null,
  currentPeriodEnd = null,
  leadsUsed = 0,
  leadsLimit = null,
  usageWarning = null,
}: UsageCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0b1220] p-6 text-slate-300">
        Loading usage...
      </div>
    )
  }

  if (!plan) return null

  const normalizedPlan = String(plan).toLowerCase()
  const isFreePlan = normalizedPlan === 'free'
  const safeUsed = Math.max(0, Number(leadsUsed || 0))
  const safeLimit = Math.max(0, Number(leadsLimit ?? getPlanLeadLimit(normalizedPlan)))
  const remainingLeads = Math.max(safeLimit - safeUsed, 0)
  const usagePercent =
    safeLimit > 0 && Number.isFinite(safeLimit)
      ? Math.min(100, (safeUsed / safeLimit) * 100)
      : 0
  const startedLabel = formatRenewalDate(currentPeriodStart)
  const renewalLabel = formatRenewalDate(currentPeriodEnd)
  void usageWarning
  const statusLabel =
    subscriptionStatus === 'canceling'
      ? 'Canceling'
      : subscriptionStatus === 'trialing'
        ? 'Trialing'
        : subscriptionStatus === 'past_due'
          ? 'Past due'
          : subscriptionStatus === 'canceled'
            ? 'Canceled'
            : 'Active'

  return (
    <section className="rounded-xl border border-white/10 bg-[#0b1220] p-6 shadow-[0_18px_40px_rgba(2,8,23,0.24)]">
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Usage
          </div>
          {isFreePlan ? (
            <div className="text-lg font-semibold tracking-[-0.02em] text-white">
              Free plan — {getPlanLeadLimit(normalizedPlan)} leads max
            </div>
          ) : (
            <>
              <div className="text-sm text-slate-300">
                Plan: <span className="font-semibold text-white">{formatPlanLabel(normalizedPlan)}</span>
              </div>
              <div className="text-sm text-slate-300">
                Status: <span className="font-semibold text-white">{statusLabel}</span>
              </div>
              {startedLabel ? (
                <div className="text-sm text-slate-400">Started on {startedLabel}</div>
              ) : null}
              {renewalLabel ? (
                <div className="text-sm text-slate-400">
                  {subscriptionStatus === 'canceling'
                    ? `Access until ${renewalLabel}`
                    : `Renews on ${renewalLabel}`}
                </div>
              ) : null}
            </>
          )}
        </div>

        {!isFreePlan ? (
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Monthly usage
            </div>
            <div className="text-lg font-semibold tracking-[-0.02em] text-white">
              {safeUsed} / {safeLimit} leads used
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-300 ${getProgressTone(usagePercent)}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <div className="text-sm text-slate-400">
              You have {remainingLeads} {remainingLeads === 1 ? 'lead' : 'leads'} left this month
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
