'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  Clock3,
  Lock,
  Radio,
  Sparkles,
} from 'lucide-react'

import UsageCard from '@/components/billing/UsageCard'
import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import { isAdmin, isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { DAILY_EMAIL_LIMIT, type EmailUsageSnapshot } from '@/lib/email/send-limits'
import { getGuestLeads } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'
import { getBrowserTimeZone } from '@/lib/timezone'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'

const PIPELINE_STATUSES = [
  'pipeline',
  'new',
  'contacted',
  'ready_followup',
  'followup_due',
  'final_attempt',
  'followup_sent',
  'closed',
] as const

const DASHBOARD_PIPELINE_SELECT =
  'status, pipeline_stage, first_contact_at, followup_sent_at, updated_at, created_at'
const DASHBOARD_LEGACY_PIPELINE_SELECT =
  'status, first_contact_at, followup_sent_at, created_at'
const DASHBOARD_MINIMAL_PIPELINE_SELECT = 'status, created_at'

type LeadStatusRow = {
  status: string | null
  pipeline_stage?: string | null
  email?: string | null
  phone?: string | null
  created_at?: string | null
  updated_at?: string | null
  first_contact_at?: string | null
  followup_sent_at?: string | null
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

type ActivityItem = {
  label: string
  detail: string
  tone: 'blue' | 'cyan' | 'amber' | 'emerald'
}

function getPlanLeadLimit(plan: string) {
  if (plan === 'admin') return 10000
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

function getClientUsageDate(timeZone = getBrowserTimeZone(), now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function normalizeUsageSnapshot(usage: Partial<EmailUsageSnapshot> | null): EmailUsageSnapshot | null {
  if (!usage) return null

  const limit = Number.isFinite(usage.limit) ? Number(usage.limit) : DAILY_EMAIL_LIMIT
  const sent = Math.min(Math.max(Number.isFinite(usage.sent) ? Number(usage.sent) : 0, 0), limit)
  const timeZone = usage.timeZone || getBrowserTimeZone()

  return {
    sent,
    limit,
    remaining: Math.max(limit - sent, 0),
    date: usage.date || getClientUsageDate(timeZone),
    timeZone,
  }
}

function getStage(row: LeadStatusRow) {
  return row.pipeline_stage || row.status || 'pipeline'
}

function getFollowupsRecommended(pipeline: Record<string, number>) {
  return (pipeline.ready_followup || 0) + (pipeline.followup_due || 0)
}

function getFinalAttempts(pipeline: Record<string, number>) {
  return (pipeline.final_attempt || 0) + (pipeline.followup_sent || 0)
}

function formatSupabaseError(error: any) {
  return {
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    raw: error,
  }
}

function isMissingOptionalPipelineField(error: any) {
  const message = String(error?.message || '').toLowerCase()
  return (
    error?.code === '42703' ||
    message.includes('pipeline_stage') ||
    message.includes('first_contact_at') ||
    message.includes('followup_sent_at') ||
    message.includes('updated_at')
  )
}

export default function Page() {
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const plan = profile?.plan ?? null
  const [stats, setStats] = useState<Stats>({
    saved: 0,
    inbox: 0,
    found: 0,
    ready: 0,
  })

  const [pipelineBreakdown, setPipelineBreakdown] = useState<Record<string, number>>({})
  const [emailUsage, setEmailUsage] = useState<EmailUsageSnapshot | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRange>('month')

  const paidViewer = !isGuest && !profileLoading && Boolean(profile && (isPaid(profile) || isAdmin(profile)))
  const freeViewer = isGuest || (!profileLoading && !paidViewer)
  const freeLeadLimit = usageSummary?.leadsLimit ?? getPlanLeadLimit('free')

  useEffect(() => {
    if (userLoading || profileLoading) return

    void loadDashboard()

    const refreshGuest = () => {
      loadGuestStats(dateRange)
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    }
  }, [dateRange, profileLoading, profile?.id, profile?.plan, user, userLoading])

  async function loadDashboard() {
    if (!user) {
      setIsGuest(true)
      const guestLeads = getGuestLeads()
      loadGuestStats(dateRange)
      setEmailUsage(null)
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
    if (!plan) return
    await Promise.all([
      loadStats(user.id, dateRange),
      loadPipeline(user.id, dateRange),
      loadUsage(user.id, plan),
      loadEmailUsage(),
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

  async function loadPipeline(currentUserId: string, selectedRange: DateRange) {
    try {
      const rangeStart = getRangeStart(selectedRange)
      const buildPipelineQuery = (selectFields: string) => {
        let query = supabase
          .from('leads')
          .select(selectFields)
          .eq('user_id', currentUserId)

        if (rangeStart) {
          query = query.gte('created_at', rangeStart)
        }

        return query
      }

      let result = await buildPipelineQuery(DASHBOARD_PIPELINE_SELECT)
      let data = result.data as LeadStatusRow[] | null
      let error = result.error

      if (error && isMissingOptionalPipelineField(error)) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[dashboard] retrying pipeline query with legacy lifecycle fields', formatSupabaseError(error))
        }

        result = await buildPipelineQuery(DASHBOARD_LEGACY_PIPELINE_SELECT)
        data = result.data as LeadStatusRow[] | null
        error = result.error
      }

      if (error && isMissingOptionalPipelineField(error)) {
        if (process.env.NODE_ENV === 'development') {
          console.debug('[dashboard] retrying pipeline query with minimal legacy fields', formatSupabaseError(error))
        }

        result = await buildPipelineQuery(DASHBOARD_MINIMAL_PIPELINE_SELECT)
        data = result.data as LeadStatusRow[] | null
        error = result.error
      }

      if (error) throw error

      const counts: Record<string, number> = {}

      data?.forEach((row) => {
        const stage = getStage(row)
        if ([...PIPELINE_STATUSES].includes(stage as (typeof PIPELINE_STATUSES)[number])) {
          counts[stage] = (counts[stage] || 0) + 1
        }
      })

      setPipelineBreakdown(counts)
    } catch (err) {
      console.error('Pipeline error:', formatSupabaseError(err))
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

  async function loadEmailUsage() {
    try {
      const timeZone = getBrowserTimeZone()
      const response = await fetch(`/api/send-email?timeZone=${encodeURIComponent(timeZone)}`, {
        cache: 'no-store',
        headers: {
          'x-alpa-time-zone': timeZone,
        },
      })
      const result = await response.json().catch(() => null)

      if (response.ok && result?.usage) {
        const nextUsage = normalizeUsageSnapshot(result.usage)
        setEmailUsage(nextUsage)
        if (process.env.NODE_ENV === 'development') {
          console.debug('[dashboard] email usage snapshot', {
            detectedTimeZone: timeZone,
            localBusinessDate: getClientUsageDate(timeZone),
            fetchedUsageDate: nextUsage?.date,
            reconciledSent: nextUsage?.sent,
          })
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('[dashboard] email usage unavailable', error)
      }
    }
  }

  const pipeline = pipelineBreakdown.pipeline || 0
  const newLeads = pipelineBreakdown.new || 0
  const contacted = pipelineBreakdown.contacted || 0
  const followups = getFollowupsRecommended(pipelineBreakdown)
  const finalAttempts = getFinalAttempts(pipelineBreakdown)
  const contactedToday = emailUsage?.sent
  const emailsRemaining = emailUsage?.remaining
  const contactedTodayLabel = typeof contactedToday === 'number' ? contactedToday : '—'
  const emailsRemainingLabel = typeof emailsRemaining === 'number' ? emailsRemaining : '—'
  const activityItems = useMemo<ActivityItem[]>(
    () => [
      {
        label:
          typeof contactedToday === 'number'
            ? `${contactedToday} sends completed today`
            : 'Sends today unavailable',
        detail: 'Successful sends.',
        tone: 'cyan',
      },
      {
        label: followups > 0 ? `${followups} follow-ups due` : 'Follow-up queue is clear',
        detail: 'Ready for Follow-up.',
        tone: 'amber',
      },
      {
        label: 'Outreach limit resets tomorrow',
        detail: 'Local account day.',
        tone: 'blue',
      },
    ],
    [contactedToday, followups]
  )

  if (!isGuest && !plan) {
    return null
  }

  return (
    <div className="space-y-6 pb-10 lg:-mt-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            Operational command
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
            ALPA Command Center
          </h1>
        </div>

        <select
          value={dateRange}
          onChange={(event) => setDateRange(event.target.value as DateRange)}
          className="h-11 rounded-2xl border border-white/10 bg-[#07111f]/90 px-4 text-sm text-slate-200 shadow-[0_14px_40px_rgba(2,8,23,0.22)] outline-none transition focus:border-cyan-300/30 focus:ring-4 focus:ring-cyan-300/10"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
      </div>

      <OperationalHero
        isFreeViewer={freeViewer}
        stats={stats}
        contactedToday={contactedTodayLabel}
        followups={followups}
        emailsRemaining={emailsRemainingLabel}
        freeLeadLimit={freeLeadLimit}
        email={profile?.email ?? ''}
      />

      <LiveActivityFeed isFreeViewer={freeViewer} items={activityItems} />

      <div className="grid gap-5 lg:grid-cols-[1fr_0.86fr]">
        <OperationalStatusStrip
          newReady={pipeline + newLeads}
          contactedWaiting={contacted}
          readyFollowup={followups}
          finalAttempt={finalAttempts}
          isFreeViewer={freeViewer}
        />
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
    </div>
  )
}

function OperationalHero({
  isFreeViewer,
  stats,
  contactedToday,
  followups,
  emailsRemaining,
  freeLeadLimit,
  email,
}: {
  isFreeViewer: boolean
  stats: Stats
  contactedToday: number | string
  followups: number
  emailsRemaining: number | string
  freeLeadLimit: number
  email: string
}) {
  return (
    <section className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.20),transparent_34%),radial-gradient(circle_at_84%_18%,rgba(59,130,246,0.18),transparent_36%),linear-gradient(145deg,rgba(5,12,26,0.98),rgba(8,18,34,0.94)_52%,rgba(2,8,23,0.98))] p-5 shadow-[0_32px_120px_rgba(2,8,23,0.48)] transition duration-500 hover:border-cyan-200/20 sm:p-7 lg:p-8">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent" />
      <div className="pointer-events-none absolute right-8 top-8 h-24 w-24 rounded-full bg-cyan-300/10 blur-3xl transition duration-700 group-hover:bg-cyan-300/16" />

      <div className="relative grid gap-8 lg:grid-cols-[1fr_0.82fr] lg:items-end">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-medium text-slate-300">
            {isFreeViewer ? <Lock className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5 text-cyan-200" />}
            {isFreeViewer ? 'Preview' : 'Operational state'}
          </div>

          <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.055em] text-white sm:text-5xl lg:text-6xl">
            {isFreeViewer ? 'Operational Intelligence activates after upgrade.' : 'Your outreach pipeline is active.'}
          </h2>
          {isFreeViewer ? (
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              {Math.min(stats.saved, freeLeadLimit)} of {freeLeadLimit} trial leads found.
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/dashboard/kanban" className="btn-primary min-h-[50px] rounded-2xl px-5 text-sm font-semibold">
              Open Pipeline
            </Link>
            {isFreeViewer ? (
              <StartCheckoutButton
                label="Activate command center"
                email={email}
                source="dashboard_command_center"
                className="btn-secondary min-h-[50px] rounded-2xl px-5 text-sm font-semibold text-white"
              />
            ) : (
              <Link href="/dashboard/scraper" className="btn-secondary min-h-[50px] rounded-2xl px-5 text-sm font-semibold text-white">
                Find more leads
              </Link>
            )}
          </div>
        </div>

        <div className={`grid gap-3 sm:grid-cols-3 lg:grid-cols-1 ${isFreeViewer ? 'select-none' : ''}`}>
          <HeroMetric label="Contacted today" value={isFreeViewer ? 'Preview' : contactedToday} locked={isFreeViewer} />
          <HeroMetric label="Follow-ups due" value={isFreeViewer ? 'Preview' : followups} locked={isFreeViewer} accent />
          <HeroMetric label="Emails remaining" value={isFreeViewer ? 'Preview' : emailsRemaining} locked={isFreeViewer} />
        </div>
      </div>
    </section>
  )
}

function HeroMetric({
  label,
  value,
  locked,
  accent,
}: {
  label: string
  value: number | string
  locked?: boolean
  accent?: boolean
}) {
  return (
    <div className="relative min-h-[126px] overflow-hidden rounded-3xl border border-white/10 bg-white/[0.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-cyan-200/18 hover:bg-white/[0.075]">
      <div className={`flex h-full min-h-[94px] flex-col justify-between ${locked ? 'blur-[3px]' : ''}`}>
        <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className={`mt-4 text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums ${accent ? 'text-cyan-100' : 'text-white'}`}>{value}</div>
      </div>
      {locked ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#020617]/10">
          <div className="rounded-full border border-white/10 bg-[#081120]/80 p-2 text-cyan-100 shadow-[0_18px_50px_rgba(2,8,23,0.35)]">
            <Lock className="h-4 w-4" />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LiveActivityFeed({ isFreeViewer, items }: { isFreeViewer: boolean; items: ActivityItem[] }) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.025))] p-5 shadow-[0_22px_70px_rgba(2,8,23,0.22)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.035em] text-white">Live activity</h2>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-300/12 bg-emerald-300/8 px-3 py-1 text-xs text-emerald-100">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
          {isFreeViewer ? 'Preview' : 'Live'}
        </div>
      </div>

      <div className="relative mt-6 space-y-4">
        <div className="absolute bottom-5 left-[19px] top-5 w-px bg-gradient-to-b from-cyan-200/40 via-white/10 to-transparent" />
        {items.map((item, index) => (
          <div
            key={item.label}
            className={`relative flex gap-4 rounded-3xl border border-white/0 p-2 transition duration-300 hover:border-white/8 hover:bg-white/[0.035] ${isFreeViewer ? 'blur-[2px]' : ''}`}
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${getFeedTone(item.tone)}`}>
              <Clock3 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">{isFreeViewer ? 'Premium activity signal' : item.label}</div>
              <div className="mt-1 text-sm leading-6 text-slate-500">{isFreeViewer ? 'Operational movement appears here after activation.' : item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function getFeedTone(tone: ActivityItem['tone']) {
  if (tone === 'cyan') return 'border-cyan-300/16 bg-cyan-300/8 text-cyan-100'
  if (tone === 'amber') return 'border-amber-300/16 bg-amber-300/8 text-amber-100'
  if (tone === 'emerald') return 'border-emerald-300/16 bg-emerald-300/8 text-emerald-100'
  return 'border-blue-300/16 bg-blue-300/8 text-blue-100'
}

function OperationalStatusStrip({
  newReady,
  contactedWaiting,
  readyFollowup,
  finalAttempt,
  isFreeViewer,
}: {
  newReady: number
  contactedWaiting: number
  readyFollowup: number
  finalAttempt: number
  isFreeViewer: boolean
}) {
  const metrics = [
    ['New / Ready', newReady],
    ['Contacted / Waiting', contactedWaiting],
    ['Ready for Follow-up', readyFollowup],
    ['Final Attempt', finalAttempt],
  ]

  return (
    <section className="rounded-[28px] border border-white/8 bg-white/[0.022] px-4 py-3 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="flex min-h-[76px] flex-col justify-center rounded-2xl px-3 py-2 transition hover:bg-white/[0.03]"
          >
            <div className="text-3xl font-semibold leading-none tracking-[-0.045em] text-white tabular-nums">
              {isFreeViewer ? '—' : value}
            </div>
            <div className="mt-2 text-xs font-medium leading-4 text-slate-500">{label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
