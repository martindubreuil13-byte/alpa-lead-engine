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
  const safeLimit = Math.max(0, Number(leadsLimit ?? 0))
  const remainingLeads = Math.max(safeLimit - safeUsed, 0)
  const usagePercent =
    safeLimit > 0 && Number.isFinite(safeLimit)
      ? Math.min(100, (safeUsed / safeLimit) * 100)
      : 0
  const startedLabel = formatRenewalDate(currentPeriodStart)
  const renewalLabel = formatRenewalDate(currentPeriodEnd)
  void usageWarning
  void subscriptionStatus

  return (
    <section aria-labelledby="usage-title" className="rounded-sm bg-[#f7f5ef] px-5 py-6 text-[#0b1a33] sm:px-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-title" className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7a5f27]">Your Usage</h2>
        <p className="text-xs text-[#5b6372]">{isFreePlan ? 'Free allowance · no monthly reset' : renewalLabel ? `Usage resets ${renewalLabel}` : 'Usage reset date unavailable'}</p>
      </div>
      <div className="my-6 grid grid-cols-3 divide-x divide-[#d9d3c4]">
        {[[safeUsed, 'Businesses used'], [safeLimit, 'Allowance'], [remainingLeads, 'Remaining']].map(([value, label], index) => (
          <div key={label} className={index === 0 ? 'pr-2' : 'px-3 sm:px-6'}>
            <p className="font-display text-3xl tabular-nums tracking-tight sm:text-4xl">{Number(value).toLocaleString('en-US')}</p>
            <p className="mt-2 text-[11px] text-[#5b6372] sm:text-xs">{label}</p>
          </div>
        ))}
      </div>
      <div role="progressbar" aria-label="Business allowance used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usagePercent} aria-valuetext={`${safeUsed} of ${safeLimit} businesses used`} className="h-1.5 overflow-hidden rounded-full bg-[#ded9cb]">
        <div className="h-full rounded-full bg-[#a08343]" style={{ width: `${usagePercent}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-[#5b6372]">
        <p>{safeUsed >= safeLimit ? 'Allowance reached' : `${remainingLeads.toLocaleString('en-US')} businesses available`}</p>
        {!isFreePlan && startedLabel && <p>Usage period began {startedLabel}</p>}
      </div>
    </section>
  )
}
