'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import UsageCard from '@/components/billing/UsageCard'
import { isAdmin, isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import { supabase } from '@/lib/supabase'
import { getGuestLeads } from '@/lib/guest-session'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'

/**
 * Only ACTIVE pipeline stages
 */
const PIPELINE_STATUSES = ['pipeline', 'contacted', 'followup_due'] as const

type LeadStatusRow = {
  status: string | null
  email?: string | null
  phone?: string | null
}

type Stats = {
  saved: number
  inbox: number
  found: number
  ready: number
}

type DateRange = '7d' | '30d' | '90d' | 'month' | 'all'

type UsageSummary = {
  plan: string
  subscriptionStatus: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  leadsUsed: number
  leadsLimit: number
  usageWarning: 'none' | 'warning' | 'critical'
}

function getPlanLeadLimit(plan: string) {
  if (plan === 'admin') return 1000
  if (plan === 'starter') return 300
  return 25
}

function hasContactDetails(lead: Pick<LeadStatusRow, 'email' | 'phone'>) {
  return Boolean(String(lead.email || '').trim() || String(lead.phone || '').trim())
}

function getRangeStart(dateRange: DateRange) {
  const now = new Date()

  if (dateRange === 'all') return null
  if (dateRange === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }

  const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90
  const start = new Date(now)
  start.setDate(start.getDate() - days)
  return start.toISOString()
}

export default function Page() {
  const { profile, loading: profileLoading } = useClientUserProfile()
  const plan = profile?.plan ?? null
  const isFree = plan === 'free'
  const [stats, setStats] = useState<Stats>({
    saved: 0,
    inbox: 0,
    found: 0,
    ready: 0,
  })

  const [pipelineBreakdown, setPipelineBreakdown] = useState<Record<string, number>>({})
  const [isGuest, setIsGuest] = useState(false)
  const [hasAnyLeads, setHasAnyLeads] = useState(false)
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRange>('month')

  useEffect(() => {
    if (profileLoading) return

    loadDashboard()

    const refreshGuest = () => {
      loadGuestStats(dateRange)
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    }
  }, [dateRange, profileLoading, profile?.id, profile?.plan])

  async function loadDashboard() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsGuest(true)
      const guestLeads = getGuestLeads()
      setHasAnyLeads(guestLeads.length > 0)
      loadGuestStats(dateRange)
      setUsageSummary({
        plan: 'free',
        subscriptionStatus: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        leadsUsed: 0,
        leadsLimit: getPlanLeadLimit('free'),
        usageWarning: 'none',
      })
      setUsageLoading(false)
      return
    }

    setIsGuest(false)
    const { count } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    setHasAnyLeads((count ?? 0) > 0)
    if (!plan) return
    await Promise.all([
      loadStats(user.id, dateRange),
      loadPipeline(user.id, dateRange),
      loadUsage(user.id, plan),
    ])
  }

  function loadGuestStats(selectedRange: DateRange) {
    const guestLeads = getGuestLeads()
    const rangeStart = getRangeStart(selectedRange)
    const filteredGuestLeads = rangeStart
      ? guestLeads.filter((lead) => new Date(lead.created_at).getTime() >= new Date(rangeStart).getTime())
      : guestLeads
    const inbox = filteredGuestLeads.filter((lead) => lead.status === 'inbox').length
    const ready = filteredGuestLeads.filter((lead) => hasContactDetails(lead)).length

    setStats({
      saved: filteredGuestLeads.length,
      inbox,
      found: filteredGuestLeads.length,
      ready,
    })

    const counts: Record<string, number> = {}
    filteredGuestLeads.forEach((lead) => {
      const key = lead.status || 'pipeline'
      counts[key] = (counts[key] || 0) + 1
    })
    setPipelineBreakdown(counts)
  }

  /**
   * STATS
   */
  async function loadStats(currentUserId: string, selectedRange: DateRange) {
    try {
      const rangeStart = getRangeStart(selectedRange)
      let query = supabase
        .from('leads')
        .select('status, email, phone')
        .eq('user_id', currentUserId)

      if (rangeStart) {
        query = query.gte('created_at', rangeStart)
      }

      const { data } = await query

      const inbox = data?.filter((l) => l.status === 'inbox').length || 0
      const saved = data?.length || 0
      const ready = data?.filter((lead) => hasContactDetails(lead)).length || 0

      setStats({
        saved,
        inbox,
        found: saved,
        ready,
      })

    } catch (err) {
      console.error('Stats error:', err)
    }
  }

  /**
   * PIPELINE
   */
  async function loadPipeline(currentUserId: string, selectedRange: DateRange) {
    try {
      const rangeStart = getRangeStart(selectedRange)
      let query = supabase
        .from('leads')
        .select('status')
        .eq('user_id', currentUserId)
        .in('status', [...PIPELINE_STATUSES])

      if (rangeStart) {
        query = query.gte('created_at', rangeStart)
      }

      const { data, error } = await query

      if (error) throw error

      const counts: Record<string, number> = {}

      data?.forEach((row) => {
        const key = row.status || 'pipeline'
        counts[key] = (counts[key] || 0) + 1
      })

      setPipelineBreakdown(counts)

    } catch (err) {
      console.error('Pipeline error:', err)
    }
  }

  async function loadUsage(currentUserId: string, loadedPlan: string) {
    try {
      setUsageLoading(true)
      const nowIso = new Date().toISOString()

      const [{ data: profileData }, { data: usageData }, { count: freeLeadCount }] = await Promise.all([
        supabase
          .from('profiles')
          .select('plan, subscription_status, current_period_end')
          .eq('id', currentUserId)
          .maybeSingle(),
        supabase
          .from('usage')
          .select('leads_used, leads_limit, period_start, period_end')
          .eq('user_id', currentUserId)
          .lte('period_start', nowIso)
          .gte('period_end', nowIso)
          .order('period_start', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', currentUserId)
          .or('email.not.is.null,phone.not.is.null'),
      ])

      const plan = profileData?.plan ?? loadedPlan
      const isPaidUsagePlan = plan === 'admin' || plan === 'starter'
      const leadsLimit = getPlanLeadLimit(plan)
      const leadsUsed = isPaidUsagePlan ? usageData?.leads_used ?? 0 : freeLeadCount ?? 0

      setUsageSummary({
        plan,
        subscriptionStatus: plan === 'free' ? 'free' : 'active',
        currentPeriodStart: isPaidUsagePlan ? usageData?.period_start ?? null : null,
        currentPeriodEnd: isPaidUsagePlan ? usageData?.period_end ?? null : null,
        leadsUsed,
        leadsLimit,
        usageWarning:
          isPaidUsagePlan && leadsLimit > 0
            ? leadsUsed / leadsLimit >= 0.9
              ? 'critical'
              : leadsUsed / leadsLimit >= 0.8
                ? 'warning'
                : 'none'
            : 'none',
      })
    } catch (err) {
      console.error('Usage error:', err)
      setUsageSummary({
        plan: loadedPlan,
        subscriptionStatus: loadedPlan === 'free' ? 'free' : 'active',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        leadsUsed: 0,
        leadsLimit: getPlanLeadLimit(loadedPlan),
        usageWarning: 'none',
      })
    } finally {
      setUsageLoading(false)
    }
  }

  /**
   * METRICS
   */
  const pipeline = pipelineBreakdown['pipeline'] || 0
  const contacted = pipelineBreakdown['contacted'] || 0
  const followups = pipelineBreakdown['followup_due'] || 0

  const activePipeline = pipeline + contacted + followups

  const contactRate =
    activePipeline > 0
      ? Math.round((contacted / activePipeline) * 100)
      : 0
  const isFreeViewer = isGuest || (!profileLoading && isFree)
  const freeLeadLimit = usageSummary?.leadsLimit ?? getPlanLeadLimit('free')

  if (!isGuest && !plan) {
    return null
  }

  if (!hasAnyLeads) {
    return (
      <div className="space-y-10">
        <div className="glass rounded-[28px] p-10">
          <h2 className="text-3xl font-semibold text-white">Your system is ready.</h2>
          <p className="mt-4 text-slate-400">Run your first search and start building your pipeline.</p>
          <div className="mt-6 space-y-2 text-sm text-slate-300">
            <div>• Find leads</div>
            <div>• Contact them</div>
            <div>• Close clients</div>
          </div>
          <div className="mt-8">
            <Link
              href="/dashboard/scraper"
              className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-sky-300/30 bg-[linear-gradient(to_right,#3B82F6,#06B6D4)] px-6 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:brightness-110"
            >
              Start Prospecting
            </Link>
          </div>
        </div>
        <UsageCard
          loading={usageLoading}
          plan={usageSummary?.plan}
          subscriptionStatus={usageSummary?.subscriptionStatus}
          currentPeriodStart={usageSummary?.currentPeriodStart}
          currentPeriodEnd={usageSummary?.currentPeriodEnd}
          leadsUsed={usageSummary?.leadsUsed}
          leadsLimit={usageSummary?.leadsLimit}
          usageWarning={usageSummary?.usageWarning}
        />
      </div>
    )
  }

  if (isFreeViewer) {
    return (
      <div className="space-y-8">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(8,15,29,0.98))] p-10 shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
          <div className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
            Progress checkpoint
          </div>
          <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            You&apos;ve reached your free limit
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
            You found {stats.saved} {stats.saved === 1 ? 'lead' : 'leads'}. {stats.ready} {stats.ready === 1 ? 'is' : 'are'} ready to contact right now.
          </p>
          <p className="mt-3 text-sm text-cyan-100">
            Free plan: {Math.min(stats.saved, freeLeadLimit)} / {freeLeadLimit} leads used
          </p>
          <div className="mt-8">
            <div className="flex flex-col gap-3 sm:flex-row">
              <StartCheckoutButton
                label="Unlock outreach + 300 leads/month"
                email={profile?.email ?? ''}
                source="dashboard_free_limit"
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] px-6 text-base font-semibold text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]"
              />
              <Link
                href="/dashboard/leads"
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-6 text-base font-semibold text-slate-100 transition hover:bg-white/[0.08]"
              >
                Go to my leads
              </Link>
            </div>
          </div>
        </div>

        <UsageCard
          loading={usageLoading}
          plan={usageSummary?.plan}
          subscriptionStatus={usageSummary?.subscriptionStatus}
          currentPeriodStart={usageSummary?.currentPeriodStart}
          currentPeriodEnd={usageSummary?.currentPeriodEnd}
          leadsUsed={usageSummary?.leadsUsed}
          leadsLimit={usageSummary?.leadsLimit}
          usageWarning={usageSummary?.usageWarning}
        />

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-white">Date range</div>
            <div className="mt-1 text-xs text-slate-500">Based on selected time range</div>
          </div>
          <select
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value as DateRange)}
            className="rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-sm text-slate-200 focus:outline-none"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="Leads found (this period)"
            value={stats.saved}
            caption="Based on selected time range"
          />
          <SummaryCard
            title="Ready to contact"
            value={stats.ready}
            caption="Based on selected time range"
          />
          <SummaryCard
            title="Next step"
            value="Review leads"
            caption="Based on selected time range"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-16">

      {/* HEADER */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-4">
            <h1 className="text-5xl font-bold">
              <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-blue-500 bg-clip-text text-transparent">
                ALPA Command Center
              </span>
            </h1>

            <p className="text-slate-400">
              {isGuest ? 'Your free trial workspace at a glance.' : 'Your prospecting system at a glance.'}
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="text-sm font-medium text-white">Date range</div>
            <select
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value as DateRange)}
              className="mt-2 rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-sm text-slate-200 focus:outline-none"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="month">This month</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>
      </div>

      <UsageCard
        loading={usageLoading}
        plan={usageSummary?.plan}
        subscriptionStatus={usageSummary?.subscriptionStatus}
        currentPeriodStart={usageSummary?.currentPeriodStart}
        currentPeriodEnd={usageSummary?.currentPeriodEnd}
        leadsUsed={usageSummary?.leadsUsed}
        leadsLimit={usageSummary?.leadsLimit}
        usageWarning={usageSummary?.usageWarning}
      />

      <div className="text-sm text-slate-500">Based on selected time range</div>

      {/* METRICS */}
      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        <Metric title="Leads found (this period)" value={stats.found} />
        <Metric title="Saved Leads" value={stats.saved} />
        <Metric title="Inbox" value={stats.inbox} highlight />

        <Metric title="Active Pipeline" value={activePipeline} />
        <Metric title="Contacted" value={contacted} />
        <Metric title="Follow-ups Due" value={followups} highlight />

        <Metric title="Contact Rate" value={`${contactRate}%`} />
      </div>

      {/* PANELS */}
      <div className="grid gap-8 lg:grid-cols-2">
        <PipelinePanel pipeline={pipelineBreakdown} />
        <SystemPanel />
      </div>

    </div>
  )
}

/**
 * METRIC CARD
 */
function Metric({ title, value, highlight }: any) {
  return (
    <div className={`glass p-8 rounded-2xl ${highlight ? 'ring-1 ring-emerald-400/40' : ''}`}>
      <div className="text-xs uppercase text-slate-500">{title}</div>
      <div className="text-5xl font-bold mt-4 text-white">{value}</div>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  caption,
}: {
  title: string
  value: number | string
  caption: string
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-6 shadow-[0_18px_40px_rgba(2,8,23,0.18)]">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <div className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-400">{caption}</div>
    </div>
  )
}

/**
 * PIPELINE PANEL
 */
function PipelinePanel({ pipeline }: any) {
  const order = ['pipeline', 'contacted', 'followup_due']

  return (
    <div className="glass p-9 rounded-2xl">
      <h2 className="text-xl font-semibold text-white mb-6">
        Pipeline Snapshot
      </h2>

      <div className="space-y-4">
        {order.map(key => (
          <div key={key} className="flex justify-between">
            <span className="text-slate-300 capitalize">
              {key.replace('_', ' ')}
            </span>
            <span className="text-white font-semibold">
              {pipeline[key] || 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * SYSTEM PANEL
 */
function SystemPanel() {
  return (
    <div className="glass p-9 rounded-2xl">
      <h2 className="text-xl font-semibold text-white mb-4">
        System Flow
      </h2>

      <div className="text-slate-400 text-sm space-y-2">
        <p>• Leads enter Inbox</p>
        <p>• Moved to Pipeline when ready</p>
        <p>• First contact sent</p>
        <p>• Follow-up triggered after delay</p>
        <p>• No response leads exit pipeline</p>
      </div>
    </div>
  )
}
