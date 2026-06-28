'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Inbox,
  Loader2,
  Mail,
  RotateCcw,
  Search,
} from 'lucide-react'

import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { getDailyEmailLimit, type EmailUsageSnapshot } from '@/lib/email/send-limits'
import { getGuestLeads } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'
import { getBrowserTimeZone } from '@/lib/timezone'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'
import { getLeadLimit } from '@/lib/usage/usage'

type QueueStatus = 'draft' | 'approved' | 'sent' | 'rejected'

type OutreachQueueRow = {
  id: string
  review_status: QueueStatus | null
  updated_at: string | null
}

type LeadUsageSnapshot = {
  leadsUsed: number
  leadsLimit: number
}

type RecentSearch = {
  id: string
  query: string
  location: string | null
  createdAt: string | null
  leadsCount: number | null
}

type DashboardData = {
  loading: boolean
  leadsUsedThisMonth: number
  leadsLimit: number
  myLeads: number
  emailSentToday: number | null
  emailLimit: number | null
  campaignDrafts: number | null
  approvedCampaigns: number | null
  sentCampaigns: number | null
  recentSearches: RecentSearch[]
  recentSearchesAvailable: boolean
}

const EMPTY_DASHBOARD: DashboardData = {
  loading: true,
  leadsUsedThisMonth: 0,
  leadsLimit: 25,
  myLeads: 0,
  emailSentToday: null,
  emailLimit: null,
  campaignDrafts: null,
  approvedCampaigns: null,
  sentCampaigns: null,
  recentSearches: [],
  recentSearchesAvailable: true,
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function getFirstName(userName: string | null | undefined, email: string | null | undefined) {
  const name = userName?.trim()
  if (name) return name.split(/\s+/)[0]
  const localPart = email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  if (!localPart) return null
  return localPart.charAt(0).toUpperCase() + localPart.slice(1)
}

function getUsageDateForTimeZone(timeZone = getBrowserTimeZone(), date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function formatDate(value: string | null) {
  if (!value) return 'Recent'
  try {
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value))
  } catch {
    return 'Recent'
  }
}

function clampPercent(value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(Math.max((value / max) * 100, 0), 100)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en').format(value)
}

function getDefaultLeadLimit(plan: string | null | undefined, isGuest: boolean) {
  if (isGuest) return 25
  return getLeadLimit(plan || 'free')
}

function getNextBestStep(data: DashboardData) {
  const readyCampaigns = (data.campaignDrafts || 0) + (data.approvedCampaigns || 0)

  if (data.myLeads === 0) {
    return {
      title: 'Start by discovering your first prospects.',
      detail: 'Run a focused search, review the results, and save the leads worth contacting.',
      href: '/dashboard/scraper',
      cta: 'Find leads',
    }
  }

  if (readyCampaigns > 0) {
    return {
      title: 'You have emails ready for review.',
      detail: 'Drafts or approved messages already exist. Review them before sending.',
      href: '/dashboard/leads',
      cta: 'Review leads',
    }
  }

  if ((data.sentCampaigns || 0) > 0) {
    return {
      title: 'Review recent campaign activity.',
      detail: 'Some outreach has already been sent. Check your saved leads and recent results.',
      href: '/dashboard/leads',
      cta: 'My Leads',
    }
  }

  return {
    title: 'You have leads ready. Export them or create a campaign.',
    detail: 'Use your saved leads to prepare the next outreach step.',
    href: '/dashboard/leads',
    cta: 'Open leads',
  }
}

async function fetchEmailUsageSnapshot() {
  const timeZone = getBrowserTimeZone()
  // TODO: Route every email send path, including Outreach Queue sends, into one usage source.
  const response = await fetch(`/api/send-email?timeZone=${encodeURIComponent(timeZone)}`, {
    cache: 'no-store',
    headers: { 'x-alpa-time-zone': timeZone },
  })
  const result = await response.json().catch(() => null)
  return response.ok ? (result?.usage as EmailUsageSnapshot | null) : null
}

async function fetchCurrentLeadUsage(
  userId: string,
  plan: string | null | undefined
): Promise<LeadUsageSnapshot> {
  const fallbackLimit = getDefaultLeadLimit(plan, false)
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('usage')
    .select('leads_used, leads_limit, period_start, period_end')
    .eq('user_id', userId)
    .lte('period_start', nowIso)
    .gte('period_end', nowIso)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return {
    leadsUsed: data?.leads_used ?? 0,
    leadsLimit: data?.leads_limit ?? fallbackLimit,
  }
}

async function fetchRecentSearches(userId: string): Promise<{ searches: RecentSearch[]; available: boolean }> {
  const searchAnalytics = await supabase
    .from('search_analytics')
    .select('id, search_query, business_type, location, number_of_results_returned, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (!searchAnalytics.error) {
    const searches = (searchAnalytics.data || [])
      .map((row) => ({
        id: row.id,
        query: row.search_query || row.business_type || '',
        location: row.location,
        createdAt: row.created_at,
        leadsCount: row.number_of_results_returned,
      }))
      .filter((row) => row.query.trim())

    return { searches, available: true }
  }

  const activityLogs = await supabase
    .from('activity_logs')
    .select('id, query, location, leads_count, created_at')
    .eq('user_id', userId)
    .in('event', ['search_performed', 'first_search_performed', 'scrape_completed'])
    .order('created_at', { ascending: false })
    .limit(5)

  if (activityLogs.error) {
    console.warn('[dashboard] recent searches unavailable:', {
      searchAnalytics: searchAnalytics.error.message,
      activityLogs: activityLogs.error.message,
    })
    return { searches: [], available: false }
  }

  const searches = (activityLogs.data || [])
    .map((row) => ({
      id: row.id,
      query: row.query || '',
      location: row.location,
      createdAt: row.created_at,
      leadsCount: row.leads_count,
    }))
    .filter((row) => row.query.trim())

  return { searches, available: true }
}

export default function Page() {
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [data, setData] = useState<DashboardData>(EMPTY_DASHBOARD)
  const [isGuest, setIsGuest] = useState(false)

  const userName = user?.user_metadata?.full_name as string | undefined
  const displayName =
    userLoading || profileLoading
      ? null
      : getFirstName(userName, profile?.email || user?.email)
  const nextStep = useMemo(() => getNextBestStep(data), [data])
  const leadProgress = clampPercent(data.leadsUsedThisMonth, data.leadsLimit)
  const emailProgress =
    data.emailSentToday !== null && data.emailLimit
      ? clampPercent(data.emailSentToday, data.emailLimit)
      : null

  useEffect(() => {
    if (userLoading || profileLoading) return
    void loadDashboard()

    const refreshGuest = () => {
      if (!user) loadGuestDashboard()
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    return () => window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
  }, [profileLoading, profile?.id, profile?.plan, user, userLoading])

  async function loadDashboard() {
    if (!user) {
      loadGuestDashboard()
      return
    }

    setIsGuest(false)
    setData((current) => ({ ...current, loading: true }))

    try {
      const timeZone = getBrowserTimeZone()
      const today = getUsageDateForTimeZone(timeZone)
      const [leadUsageResult, myLeadsResult, queueResult, usageSnapshot, recentSearchesResult] = await Promise.all([
        fetchCurrentLeadUsage(user.id, profile?.plan),
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('outreach_queue')
          .select('id, review_status, updated_at')
          .eq('user_id', user.id),
        fetchEmailUsageSnapshot(),
        fetchRecentSearches(user.id),
      ])

      if (myLeadsResult.error) throw myLeadsResult.error

      const queueRows = queueResult.error ? [] : ((queueResult.data || []) as OutreachQueueRow[])
      const todaySent = usageSnapshot?.date === today ? usageSnapshot.sent : usageSnapshot?.sent ?? null
      const emailLimit = usageSnapshot?.limit ?? getDailyEmailLimit(profile?.plan)

      setData({
        loading: false,
        leadsUsedThisMonth: leadUsageResult.leadsUsed,
        leadsLimit: leadUsageResult.leadsLimit,
        myLeads: myLeadsResult.count ?? 0,
        emailSentToday: todaySent,
        emailLimit,
        campaignDrafts: queueResult.error ? null : queueRows.filter((row) => row.review_status === 'draft').length,
        approvedCampaigns: queueResult.error ? null : queueRows.filter((row) => row.review_status === 'approved').length,
        sentCampaigns: queueResult.error ? null : queueRows.filter((row) => row.review_status === 'sent').length,
        recentSearches: recentSearchesResult.searches,
        recentSearchesAvailable: recentSearchesResult.available,
      })
    } catch (error) {
      console.error('[dashboard] command center load failed:', error)
      setData((current) => ({ ...current, loading: false }))
    }
  }

  function loadGuestDashboard() {
    const guestLeads = getGuestLeads()
    const leadLimit = getDefaultLeadLimit(null, true)
    const guestLeadCount = guestLeads.length

    setIsGuest(true)
    setData({
      ...EMPTY_DASHBOARD,
      loading: false,
      leadsUsedThisMonth: guestLeadCount,
      leadsLimit: leadLimit,
      myLeads: guestLeadCount,
      emailSentToday: null,
      emailLimit: null,
      campaignDrafts: null,
      approvedCampaigns: null,
      sentCampaigns: null,
      recentSearches: [],
      recentSearchesAvailable: false,
    })
  }

  if (!isGuest && !profile && !profileLoading) {
    return null
  }

  return (
    <div className="space-y-6 pb-10 lg:-mt-2">
      <HeroSection displayName={displayName} loading={data.loading} />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.82fr)_minmax(220px,0.82fr)]">
        <UsageCard
          label="Leads used this month"
          value={data.leadsUsedThisMonth}
          detail={`of ${formatNumber(data.leadsLimit)} this month`}
          percent={leadProgress}
          icon={BarChart3}
        />
        <SnapshotCard
          label="My Leads"
          value={data.myLeads}
          detail="Saved in your workspace"
          icon={Inbox}
        />
        <SnapshotCard
          label="Emails sent today"
          value={data.emailSentToday ?? '—'}
          detail={data.emailLimit ? `Daily limit ${data.emailLimit}` : 'Not available yet'}
          icon={Mail}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-5 sm:p-6">
          <SectionHeader eyebrow="Progress" title="Usage this cycle" />
          <div className="mt-5 space-y-5">
            <ProgressBar
              label="Leads used this month"
              percent={leadProgress}
              detail={`${formatNumber(data.leadsUsedThisMonth)} of ${formatNumber(data.leadsLimit)} this month`}
            />
            {emailProgress !== null && data.emailLimit ? (
              <ProgressBar
                label="Emails sent today"
                percent={emailProgress}
                detail={`${formatNumber(data.emailSentToday || 0)} of ${formatNumber(data.emailLimit)} today`}
              />
            ) : null}
          </div>
        </div>

        <div className="rounded-[28px] border border-cyan-200/14 bg-cyan-300/[0.055] p-5 sm:p-6">
          <SectionHeader eyebrow="Next Best Step" title="What should I do next?" />
          <h3 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-white">
            {nextStep.title}
          </h3>
          <p className="mt-3 text-sm leading-6 text-cyan-50/80">{nextStep.detail}</p>
          <Link href={nextStep.href} className="btn-primary-gold mt-5">
            {nextStep.cta}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <RecentSearches searches={data.recentSearches} available={data.recentSearchesAvailable} />
    </div>
  )
}

function HeroSection({
  displayName,
  loading,
}: {
  displayName: string | null
  loading: boolean
}) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(145deg,rgba(2,8,23,0.98),rgba(8,18,34,0.94)_56%,rgba(4,10,22,0.98))] p-5 shadow-[0_32px_120px_rgba(2,8,23,0.42)] sm:p-7">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/55 to-transparent" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
            Command Center
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
            {displayName ? `${getGreeting()} ${displayName}.` : `${getGreeting()}.`}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
            ALPA helps you find fresh business leads and turn them into outreach-ready opportunities.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
          <Link href="/dashboard/scraper" className="btn-primary-gold">
            Find new leads
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/dashboard/leads"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-5 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.075]"
          >
            My Leads
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="relative mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Updating dashboard
        </div>
      ) : null}
    </section>
  )
}

function SnapshotCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: number | string
  detail: string
  icon: typeof Search
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.025] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-slate-400">{label}</div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-cyan-100">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-6 text-4xl font-semibold tracking-[-0.055em] text-white tabular-nums">
        {typeof value === 'number' ? formatNumber(value) : value}
      </div>
      <div className="mt-2 text-sm text-slate-500">{detail}</div>
    </div>
  )
}

function UsageCard({
  label,
  value,
  detail,
  percent,
  icon: Icon,
}: {
  label: string
  value: number
  detail: string
  percent: number
  icon: typeof Search
}) {
  return (
    <div className="rounded-[26px] border border-cyan-200/12 bg-cyan-300/[0.045] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-cyan-50/70">{label}</div>
          <div className="mt-5 text-5xl font-semibold tracking-[-0.06em] text-white tabular-nums">
            {formatNumber(value)}
          </div>
          <div className="mt-2 text-sm text-cyan-50/60">{detail}</div>
        </div>
        <div className="rounded-2xl border border-cyan-200/14 bg-cyan-200/[0.08] p-2 text-cyan-50">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-100 via-emerald-100 to-amber-100"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-cyan-50/45">{Math.round(percent)}% used</div>
    </div>
  )
}

function ProgressBar({
  label,
  percent,
  detail,
}: {
  label: string
  percent: number
  detail: string
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-300">{label}</span>
        <span className="text-slate-500 tabular-nums">{Math.round(percent)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/[0.065]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-200 via-emerald-200 to-amber-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-slate-500">{detail}</div>
    </div>
  )
}

function RecentSearches({
  searches,
  available,
}: {
  searches: RecentSearch[]
  available: boolean
}) {
  if (!available) return null

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader eyebrow="Recent Searches" title="Run a search again" />
        <Link
          href="/dashboard/scraper"
          className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.075]"
        >
          New search
        </Link>
      </div>

      {searches.length > 0 ? (
        <div className="mt-5 divide-y divide-white/8 overflow-hidden rounded-2xl border border-white/8">
          {searches.map((search) => (
            <div
              key={search.id}
              className="grid gap-3 bg-slate-950/24 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-white">{search.query}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  {search.location ? <span>{search.location}</span> : null}
                  <span>{formatDate(search.createdAt)}</span>
                  {search.leadsCount !== null ? (
                    <span>{search.leadsCount} leads</span>
                  ) : null}
                </div>
              </div>
              <Link
                href="/dashboard/scraper"
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-2xl border border-cyan-200/16 bg-cyan-300/[0.07] px-4 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/[0.11]"
              >
                <RotateCcw className="h-4 w-4" />
                Run again
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-white/8 bg-slate-950/24 p-4 text-sm leading-6 text-slate-400">
          Recent searches will appear here after you run lead discovery.
        </div>
      )}
    </section>
  )
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/60">
        {eyebrow}
      </div>
      <h2 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-white">
        {title}
      </h2>
    </div>
  )
}
