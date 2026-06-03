'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Clock3,
  Inbox,
  Layers3,
  Loader2,
  MailCheck,
  Radio,
  Search,
  Send,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react'

import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import { isAdmin, isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { getDailyEmailLimit, type EmailUsageSnapshot } from '@/lib/email/send-limits'
import { getGuestLeads } from '@/lib/guest-session'
import { getPipelineLifecycleStatus, type Lead, type PipelineStage } from '@/lib/pipeline/lifecycle'
import { supabase } from '@/lib/supabase'
import { getBrowserTimeZone } from '@/lib/timezone'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'

type QueueStatus = 'draft' | 'approved' | 'sent' | 'rejected'
type DashboardLead = Lead & {
  user_id?: string | null
}
type OutreachQueueRow = {
  id: string
  source: string | null
  review_status: QueueStatus | null
  automation_step: string | null
  company_name: string | null
  updated_at: string | null
  created_at: string | null
}
type EmailUsageRow = {
  date: string
  emails_sent: number
}
type ActivityRow = {
  id?: string | null
  lead_id: string | null
  event_type: string
  metadata: Record<string, unknown> | null
  created_at: string
}
type ActivityItem = {
  id: string
  label: string
  detail: string
  time: string
  tone: 'cyan' | 'amber' | 'emerald' | 'blue'
}
type Insight = {
  label: string
  value: string
  detail: string
}
type DashboardData = {
  loading: boolean
  pipeline: Record<PipelineStage, number>
  actionCounts: {
    newReady: number
    followupsDue: number
    approvedQueue: number
    repliesAwaitingReview: number | null
  }
  outreach: {
    sentToday: number
    sentThisWeek: number
    remaining: number | null
    limit: number | null
    draftQueue: number
    approvedQueue: number
    pipelineAutomationDrafts: number
  }
  recentActivity: ActivityItem[]
  insights: Insight[]
}

const EMPTY_PIPELINE: Record<PipelineStage, number> = {
  ready: 0,
  contacted: 0,
  ready_followup: 0,
  final_attempt: 0,
  closed: 0,
}

const EMPTY_DASHBOARD: DashboardData = {
  loading: true,
  pipeline: EMPTY_PIPELINE,
  actionCounts: {
    newReady: 0,
    followupsDue: 0,
    approvedQueue: 0,
    repliesAwaitingReview: null,
  },
  outreach: {
    sentToday: 0,
    sentThisWeek: 0,
    remaining: null,
    limit: null,
    draftQueue: 0,
    approvedQueue: 0,
    pipelineAutomationDrafts: 0,
  },
  recentActivity: [],
  insights: [],
}

const LEAD_SELECT =
  'id, user_id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, created_at, date_added, status_updated_at, last_activity_at'
const QUEUE_SELECT = 'id, source, review_status, automation_step, company_name, updated_at, created_at'
const LEAD_PAGE_SIZE = 1000
const ACTIVE_LEAD_FILTER =
  'status.in.(pipeline,contacted,followup_due,followup_sent,interested,closed_no_response,no_response,rejected,invalid,inbox,new),pipeline_stage.in.(ready,contacted,followup,ready_followup,final_attempt,closed)'

function getLocalDate(timeZone = getBrowserTimeZone(), date = new Date()) {
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

function getStartOfLocalDay(timeZone = getBrowserTimeZone()) {
  return new Date(`${getLocalDate(timeZone)}T00:00:00`).toISOString()
}

function getWeekStartDate(timeZone = getBrowserTimeZone()) {
  const now = new Date()
  const localDate = getLocalDate(timeZone, now)
  const start = new Date(`${localDate}T00:00:00`)
  start.setDate(start.getDate() - 6)
  return getLocalDate(timeZone, start)
}

function normalizeUsageSnapshot(usage: Partial<EmailUsageSnapshot> | null): EmailUsageSnapshot | null {
  if (!usage) return null
  const limit = Number.isFinite(usage.limit) ? Number(usage.limit) : 100
  const sent = Math.max(Number.isFinite(usage.sent) ? Number(usage.sent) : 0, 0)
  const timeZone = usage.timeZone || getBrowserTimeZone()

  return {
    sent,
    limit,
    remaining: Math.max(limit - sent, 0),
    date: usage.date || getLocalDate(timeZone),
    timeZone,
  }
}

function formatTimeAgo(value: string | null | undefined) {
  if (!value) return 'Just now'
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return 'Just now'
  const minutes = Math.max(0, Math.floor(diffMs / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getFirstName(userName: string | null | undefined, email: string | null | undefined) {
  const name = userName?.trim()
  if (name) return name.split(/\s+/)[0]
  const localPart = email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  if (!localPart) return null
  return localPart.charAt(0).toUpperCase() + localPart.slice(1)
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function getHighestPriority(data: DashboardData) {
  if (data.actionCounts.followupsDue > 0) {
    return 'Review follow-ups first. They represent the warmest open opportunities today.'
  }
  if (data.actionCounts.approvedQueue > 0) {
    return 'Send approved emails next. They are already reviewed and waiting on execution.'
  }
  if (data.actionCounts.newReady > 0) {
    return 'Start with new ready leads. Fresh leads lose value when they sit idle.'
  }
  return 'No urgent queue is blocking the operation. Use the next block to create more opportunities.'
}

function getOperationalState(data: DashboardData) {
  if (data.actionCounts.followupsDue || data.actionCounts.approvedQueue || data.actionCounts.newReady) {
    return 'Your outreach engine is active.'
  }
  return 'Your outreach engine is stable.'
}

async function fetchAllLeads(userId: string) {
  const rows: DashboardLead[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select(LEAD_SELECT)
      .eq('user_id', userId)
      .or(ACTIVE_LEAD_FILTER)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .range(from, from + LEAD_PAGE_SIZE - 1)

    if (error) throw error

    const page = (data || []) as DashboardLead[]
    rows.push(...page)
    if (page.length < LEAD_PAGE_SIZE) break
    from += LEAD_PAGE_SIZE
  }

  return rows
}

async function fetchEmailUsageRows(userId: string, weekStartDate: string) {
  const { data, error } = await supabase
    .from('email_usage')
    .select('date, emails_sent')
    .eq('user_id', userId)
    .gte('date', weekStartDate)

  if (error) throw error
  return (data || []) as EmailUsageRow[]
}

async function fetchEmailUsageSnapshot() {
  const timeZone = getBrowserTimeZone()
  const response = await fetch(`/api/send-email?timeZone=${encodeURIComponent(timeZone)}`, {
    cache: 'no-store',
    headers: { 'x-alpa-time-zone': timeZone },
  })
  const result = await response.json().catch(() => null)
  return response.ok ? normalizeUsageSnapshot(result?.usage) : null
}

async function fetchQueueRows(userId: string, weekStartIso: string) {
  const [allQueue, weekSentQueue] = await Promise.all([
    supabase.from('outreach_queue').select(QUEUE_SELECT).eq('user_id', userId),
    supabase
      .from('outreach_queue')
      .select(QUEUE_SELECT)
      .eq('user_id', userId)
      .eq('review_status', 'sent')
      .gte('updated_at', weekStartIso),
  ])

  if (allQueue.error) throw allQueue.error
  if (weekSentQueue.error) throw weekSentQueue.error

  return {
    all: (allQueue.data || []) as OutreachQueueRow[],
    sentThisWeek: (weekSentQueue.data || []) as OutreachQueueRow[],
  }
}

async function fetchRecentEvents(userId: string) {
  const [eventsResult, leadsResult] = await Promise.all([
    supabase
      .from('lead_activity_events')
      .select('id, lead_id, event_type, metadata, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('leads')
      .select('id, company_name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  if (eventsResult.error) throw eventsResult.error
  if (leadsResult.error) throw leadsResult.error

  const events = (eventsResult.data || []) as ActivityRow[]
  const leadIds = Array.from(new Set(events.map((event) => event.lead_id).filter(Boolean))) as string[]
  const namesByLeadId = new Map<string, string>()

  if (leadIds.length > 0) {
    const { data: leadRows } = await supabase
      .from('leads')
      .select('id, company_name')
      .eq('user_id', userId)
      .in('id', leadIds)

    for (const lead of leadRows || []) {
      namesByLeadId.set(lead.id, lead.company_name || 'Unknown lead')
    }
  }

  const mappedEvents = events.map((event, index) => {
    const company = event.lead_id ? namesByLeadId.get(event.lead_id) : null
    const queueId = typeof event.metadata?.queue_id === 'string' ? event.metadata.queue_id : null
    const automationStep = typeof event.metadata?.automation_step === 'string' ? event.metadata.automation_step : null

    if (event.event_type === 'email_sent') {
      return {
        id: event.id || `${event.created_at}-${index}`,
        label: `Email sent${company ? ` to ${company}` : ''}`,
        detail: queueId ? `Outreach queue item ${queueId.slice(0, 8)} confirmed.` : 'Delivery confirmed by send route.',
        time: formatTimeAgo(event.created_at),
        tone: 'emerald' as const,
      }
    }

    if (event.event_type === 'draft_generated') {
      return {
        id: event.id || `${event.created_at}-${index}`,
        label: `${automationStep ? formatAutomationStep(automationStep) : 'Draft'} generated${company ? ` for ${company}` : ''}`,
        detail: 'Pipeline Automation prepared a draft for review.',
        time: formatTimeAgo(event.created_at),
        tone: 'cyan' as const,
      }
    }

    return {
      id: event.id || `${event.created_at}-${index}`,
      label: event.event_type.replace(/_/g, ' '),
      detail: company || 'Lead activity recorded.',
      time: formatTimeAgo(event.created_at),
      tone: 'blue' as const,
    }
  })

  const imported = (leadsResult.data || [])
    .slice(0, 3)
    .map((lead, index) => ({
      id: `lead-${lead.id || index}`,
      label: `Lead added${lead.company_name ? `: ${lead.company_name}` : ''}`,
      detail: 'New record entered the operator workspace.',
      time: formatTimeAgo(lead.created_at),
      tone: 'blue' as const,
    }))

  return [...mappedEvents, ...imported].slice(0, 8)
}

function formatAutomationStep(step: string) {
  if (step === 'first_outreach' || step === 'firstOutreach') return 'First outreach'
  if (step === 'follow_up' || step === 'followUp') return 'Follow-up'
  if (step === 'final_attempt' || step === 'finalAttempt') return 'Final attempt'
  return 'Draft'
}

function buildInsights(leads: DashboardLead[], pipeline: Record<PipelineStage, number>) {
  const insights: Insight[] = []
  const followupByIndustry = new Map<string, number>()

  for (const lead of leads) {
    if (getPipelineLifecycleStatus(lead) !== 'ready_followup') continue
    const industry = lead.industry?.trim()
    if (!industry) continue
    followupByIndustry.set(industry, (followupByIndustry.get(industry) || 0) + 1)
  }

  const highestFollowup = [...followupByIndustry.entries()].sort((a, b) => b[1] - a[1])[0]
  if (highestFollowup) {
    insights.push({
      label: 'Highest follow-up volume',
      value: highestFollowup[0],
      detail: `${highestFollowup[1]} follow-ups are waiting in this niche.`,
    })
  }

  const bottleneck = (Object.entries(pipeline) as Array<[PipelineStage, number]>)
    .filter(([stage]) => stage !== 'closed')
    .sort((a, b) => b[1] - a[1])[0]

  if (bottleneck && bottleneck[1] > 0) {
    insights.push({
      label: 'Pipeline bottleneck',
      value: formatPipelineLabel(bottleneck[0]),
      detail: `${bottleneck[1]} leads are concentrated here.`,
    })
  }

  return insights
}

function formatPipelineLabel(stage: PipelineStage) {
  if (stage === 'ready') return 'Ready'
  if (stage === 'contacted') return 'Contacted'
  if (stage === 'ready_followup') return 'Follow-Up Due'
  if (stage === 'final_attempt') return 'Final Attempt'
  return 'Closed'
}

function getStageTone(stage: PipelineStage) {
  if (stage === 'ready_followup') return 'bg-amber-300'
  if (stage === 'final_attempt') return 'bg-fuchsia-300'
  if (stage === 'closed') return 'bg-slate-500'
  if (stage === 'contacted') return 'bg-cyan-300'
  return 'bg-emerald-300'
}

export default function Page() {
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [data, setData] = useState<DashboardData>(EMPTY_DASHBOARD)
  const [isGuest, setIsGuest] = useState(false)

  const paidViewer = !isGuest && !profileLoading && Boolean(profile && (isPaid(profile) || isAdmin(profile)))
  const userName = user?.user_metadata?.full_name as string | undefined
  const displayName =
    userLoading || profileLoading
      ? null
      : getFirstName(userName, profile?.email || user?.email)

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
      const todayDate = getLocalDate(timeZone)
      const todayStartIso = getStartOfLocalDay(timeZone)
      const weekStartDate = getWeekStartDate(timeZone)
      const weekStartIso = new Date(`${weekStartDate}T00:00:00`).toISOString()

      const [leads, queue, usageRows, usageSnapshot, recentActivity] = await Promise.all([
        fetchAllLeads(user.id),
        fetchQueueRows(user.id, weekStartIso),
        fetchEmailUsageRows(user.id, weekStartDate),
        fetchEmailUsageSnapshot(),
        fetchRecentEvents(user.id),
      ])

      const pipeline = { ...EMPTY_PIPELINE }
      for (const lead of leads) {
        const stage = getPipelineLifecycleStatus(lead)
        pipeline[stage] += 1
      }

      const draftQueue = queue.all.filter((row) => row.review_status === 'draft').length
      const approvedQueue = queue.all.filter((row) => row.review_status === 'approved').length
      const pipelineAutomationDrafts = queue.all.filter(
        (row) => row.source === 'pipeline_automation' && row.review_status === 'draft'
      ).length
      const queueSentToday = queue.sentThisWeek.filter((row) => row.updated_at && row.updated_at >= todayStartIso).length
      const queueSentWeek = queue.sentThisWeek.length
      const manualSentToday = usageRows.find((row) => row.date === todayDate)?.emails_sent || usageSnapshot?.sent || 0
      const manualSentWeek = usageRows.reduce((sum, row) => sum + (row.emails_sent || 0), 0)
      const limit = usageSnapshot?.limit ?? getDailyEmailLimit(profile?.plan)
      const sentToday = manualSentToday + queueSentToday
      const sentThisWeek = manualSentWeek + queueSentWeek

      const nextData: DashboardData = {
        loading: false,
        pipeline,
        actionCounts: {
          newReady: pipeline.ready,
          followupsDue: pipeline.ready_followup,
          approvedQueue,
          repliesAwaitingReview: null,
        },
        outreach: {
          sentToday,
          sentThisWeek,
          remaining: Math.max(limit - sentToday, 0),
          limit,
          draftQueue,
          approvedQueue,
          pipelineAutomationDrafts,
        },
        recentActivity,
        insights: buildInsights(leads, pipeline),
      }

      setData(nextData)
    } catch (error) {
      console.error('[dashboard] command center load failed:', error)
      setData((current) => ({ ...current, loading: false }))
    }
  }

  function loadGuestDashboard() {
    const guestLeads = getGuestLeads()
    const ready = guestLeads.filter((lead) => lead.email || lead.phone).length

    setIsGuest(true)
    setData({
      ...EMPTY_DASHBOARD,
      loading: false,
      pipeline: { ...EMPTY_PIPELINE, ready },
      actionCounts: {
        newReady: ready,
        followupsDue: 0,
        approvedQueue: 0,
        repliesAwaitingReview: null,
      },
      recentActivity: guestLeads.slice(0, 5).map((lead, index) => ({
        id: lead.id || `guest-${index}`,
        label: `Lead found${lead.company_name ? `: ${lead.company_name}` : ''}`,
        detail: 'Trial lead captured locally.',
        time: formatTimeAgo(lead.created_at),
        tone: 'blue',
      })),
    })
  }

  if (!isGuest && !profile && !profileLoading) {
    return null
  }

  return (
    <div className="space-y-5 pb-10 lg:-mt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
          <Radio className="h-3.5 w-3.5 animate-pulse" />
          Operational Command Center
        </div>
        {data.loading ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Syncing live signals
          </div>
        ) : null}
      </div>

      <DailyCommandBrief
        data={data}
        displayName={displayName}
        isFreeViewer={!paidViewer}
        email={profile?.email || user?.email || ''}
      />

      <ActionRequired data={data} isFreeViewer={!paidViewer} email={profile?.email || user?.email || ''} />

      <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <OutreachEngineHealth data={data} isFreeViewer={!paidViewer} />
        <PipelineSnapshot data={data} isFreeViewer={!paidViewer} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.78fr]">
        <RecentActivity items={data.recentActivity} isFreeViewer={!paidViewer} />
        <div className="space-y-5">
          <AiInsights insights={data.insights} isFreeViewer={!paidViewer} />
          <QuickActions isFreeViewer={!paidViewer} email={profile?.email || user?.email || ''} />
        </div>
      </div>
    </div>
  )
}

function DailyCommandBrief({
  data,
  displayName,
  isFreeViewer,
  email,
}: {
  data: DashboardData
  displayName: string | null
  isFreeViewer: boolean
  email: string
}) {
  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_86%_20%,rgba(99,102,241,0.18),transparent_34%),linear-gradient(145deg,rgba(2,8,23,0.98),rgba(8,18,34,0.94)_54%,rgba(4,10,22,0.98))] p-5 shadow-[0_32px_120px_rgba(2,8,23,0.48)] sm:p-7">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
      <div className="relative grid gap-6 lg:grid-cols-[1fr_320px] lg:items-end">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-medium text-cyan-100">
            <Bot className="h-3.5 w-3.5" />
            Daily command brief
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
            {displayName ? `${getGreeting()} ${displayName}.` : `${getGreeting()}.`}
          </h1>
          <p className="mt-3 text-lg text-slate-300">{getOperationalState(data)}</p>

          <div className={`mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ${isFreeViewer ? 'blur-[2px]' : ''}`}>
            <BriefSignal label="Emails sent today" value={data.outreach.sentToday} />
            <BriefSignal label="Follow-ups due" value={data.actionCounts.followupsDue} />
            <BriefSignal label="New leads ready" value={data.actionCounts.newReady} />
            <BriefSignal label="Approved emails" value={data.actionCounts.approvedQueue} />
          </div>

          <div className="mt-6 rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.06] px-4 py-3 text-sm leading-6 text-cyan-50">
            <span className="font-semibold">Recommended action: </span>
            {isFreeViewer ? 'Activate ALPA to unlock live operational recommendations.' : getHighestPriority(data)}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Current focus</div>
          <div className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-white tabular-nums">
            {isFreeViewer ? 'Preview' : data.actionCounts.followupsDue || data.actionCounts.approvedQueue || data.actionCounts.newReady}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {isFreeViewer ? 'Live queue intelligence appears after activation.' : 'Highest-priority operator queue right now.'}
          </p>
          {isFreeViewer ? (
            <StartCheckoutButton
              label="Activate command center"
              email={email}
              source="dashboard_command_center"
              className="mt-4 inline-flex min-h-[42px] items-center justify-center rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}

function BriefSignal({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.045] px-3 py-3">
      <div className="text-2xl font-semibold text-white tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  )
}

function ActionRequired({ data, isFreeViewer, email }: { data: DashboardData; isFreeViewer: boolean; email: string }) {
  const actions = [
    data.actionCounts.followupsDue > 0
      ? {
          label: 'Follow-Ups Due',
          count: data.actionCounts.followupsDue,
          priority: 'Critical',
          href: '/dashboard/kanban',
          cta: 'Open Pipeline',
          icon: Clock3,
          tone: 'amber',
        }
      : null,
    data.actionCounts.newReady > 0
      ? {
          label: 'New Leads Ready',
          count: data.actionCounts.newReady,
          priority: 'High',
          href: '/dashboard/kanban',
          cta: 'Review Leads',
          icon: Target,
          tone: 'emerald',
        }
      : null,
    data.actionCounts.approvedQueue > 0
      ? {
          label: 'Approved Emails Waiting',
          count: data.actionCounts.approvedQueue,
          priority: 'High',
          href: '/dashboard/outreach?status=approved',
          cta: 'Send Now',
          icon: Send,
          tone: 'cyan',
        }
      : null,
    data.actionCounts.repliesAwaitingReview && data.actionCounts.repliesAwaitingReview > 0
      ? {
          label: 'Replies Awaiting Review',
          count: data.actionCounts.repliesAwaitingReview,
          priority: 'Critical',
          href: '/dashboard/outreach',
          cta: 'Open Inbox',
          icon: Inbox,
          tone: 'blue',
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string
    count: number
    priority: string
    href: string
    cta: string
    icon: typeof Clock3
    tone: string
  }>

  return (
    <section>
      <SectionHeader eyebrow="Action Required" title="What needs attention now" />
      {isFreeViewer ? (
        <LockedActionPanel email={email} />
      ) : actions.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <ActionCard key={action.label} {...action} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-emerald-300/14 bg-emerald-300/[0.055] p-5 text-sm text-emerald-50">
          No urgent operator queue is waiting. Generate drafts or find new leads to create the next action.
        </div>
      )}
    </section>
  )
}

function LockedActionPanel({ email }: { email: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
      <div className="text-lg font-semibold text-white">Live action queue is locked.</div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        Activate ALPA to see follow-ups, approved sends, and pipeline work ranked by urgency.
      </p>
      <StartCheckoutButton
        label="Activate command center"
        email={email}
        source="dashboard_action_required"
        className="mt-4 inline-flex min-h-[42px] items-center justify-center rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
      />
    </div>
  )
}

function ActionCard({
  label,
  count,
  priority,
  href,
  cta,
  icon: Icon,
  tone,
}: {
  label: string
  count: number
  priority: string
  href: string
  cta: string
  icon: typeof Clock3
  tone: string
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-300/18 bg-amber-300/[0.07] text-amber-100'
      : tone === 'emerald'
        ? 'border-emerald-300/18 bg-emerald-300/[0.07] text-emerald-100'
        : 'border-cyan-300/18 bg-cyan-300/[0.07] text-cyan-100'

  return (
    <Link
      href={href}
      className="group min-h-[172px] rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-5 shadow-[0_18px_60px_rgba(2,8,23,0.22)] transition hover:-translate-y-0.5 hover:border-cyan-200/18"
    >
      <div className="flex items-start justify-between gap-4">
        <div className={`rounded-2xl border p-2.5 ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-xs text-slate-300">
          {priority}
        </span>
      </div>
      <div className="mt-5 text-5xl font-semibold tracking-[-0.06em] text-white tabular-nums">{count}</div>
      <div className="mt-1 text-sm font-medium text-slate-300">{label}</div>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-100">
        {cta}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function OutreachEngineHealth({ data, isFreeViewer }: { data: DashboardData; isFreeViewer: boolean }) {
  const metrics = [
    { label: 'Emails Sent Today', value: data.outreach.sentToday, detail: 'Manual sends + queue sends' },
    { label: 'Emails Sent This Week', value: data.outreach.sentThisWeek, detail: 'Last 7 local days' },
    { label: 'Emails Remaining', value: data.outreach.remaining ?? '—', detail: data.outreach.limit ? `Daily limit ${data.outreach.limit}` : 'Limit unavailable' },
    { label: 'Draft Queue', value: data.outreach.draftQueue, detail: 'Needs review' },
    { label: 'Approved Queue', value: data.outreach.approvedQueue, detail: 'Ready to send' },
    { label: 'Pipeline Automation Drafts', value: data.outreach.pipelineAutomationDrafts, detail: 'Generated by automation' },
  ]

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <SectionHeader eyebrow="Outreach Engine Health" title="Execution capacity" compact />
      <div className={`mt-4 grid gap-2 sm:grid-cols-2 ${isFreeViewer ? 'blur-[2px]' : ''}`}>
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/8 bg-slate-950/32 px-4 py-3">
            <div className="text-2xl font-semibold text-white tabular-nums">{metric.value}</div>
            <div className="mt-1 text-xs font-medium text-slate-300">{metric.label}</div>
            <div className="mt-1 text-xs text-slate-600">{metric.detail}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function PipelineSnapshot({ data, isFreeViewer }: { data: DashboardData; isFreeViewer: boolean }) {
  const stages: PipelineStage[] = ['ready', 'contacted', 'ready_followup', 'final_attempt', 'closed']
  const max = Math.max(...stages.map((stage) => data.pipeline[stage]), 1)

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <SectionHeader eyebrow="Pipeline Snapshot" title="Lifecycle distribution" compact />
      <div className={`mt-5 space-y-4 ${isFreeViewer ? 'blur-[2px]' : ''}`}>
        {stages.map((stage) => {
          const value = data.pipeline[stage]
          const width = `${Math.max((value / max) * 100, value > 0 ? 8 : 2)}%`
          return (
            <div key={stage}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-300">{formatPipelineLabel(stage)}</span>
                <span className="font-semibold text-white tabular-nums">{value}</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.055]">
                <div className={`h-full rounded-full ${getStageTone(stage)}`} style={{ width }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RecentActivity({ items, isFreeViewer }: { items: ActivityItem[]; isFreeViewer: boolean }) {
  const visibleItems = items.length > 0 ? items : [{
    id: 'empty',
    label: 'No recent activity yet',
    detail: 'Activity will appear after drafts, sends, or new leads.',
    time: 'Now',
    tone: 'blue' as const,
  }]

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <SectionHeader eyebrow="Recent Activity" title="What happened" compact />
      <div className={`relative mt-5 space-y-3 ${isFreeViewer ? 'blur-[2px]' : ''}`}>
        <div className="absolute bottom-5 left-[17px] top-5 w-px bg-gradient-to-b from-cyan-200/35 via-white/10 to-transparent" />
        {visibleItems.map((item) => (
          <div key={item.id} className="relative flex gap-3 rounded-2xl p-1.5 transition hover:bg-white/[0.025]">
            <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${getActivityTone(item.tone)}`}>
              <Clock3 className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="truncate text-sm font-medium text-white">{item.label}</div>
                <div className="text-xs text-slate-600">{item.time}</div>
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-500">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function getActivityTone(tone: ActivityItem['tone']) {
  if (tone === 'cyan') return 'border-cyan-300/16 bg-cyan-300/8 text-cyan-100'
  if (tone === 'amber') return 'border-amber-300/16 bg-amber-300/8 text-amber-100'
  if (tone === 'emerald') return 'border-emerald-300/16 bg-emerald-300/8 text-emerald-100'
  return 'border-blue-300/16 bg-blue-300/8 text-blue-100'
}

function AiInsights({ insights, isFreeViewer }: { insights: Insight[]; isFreeViewer: boolean }) {
  if (!isFreeViewer && insights.length === 0) return null

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <SectionHeader eyebrow="AI Insights" title="Supported signals" compact />
      <div className={`mt-4 space-y-3 ${isFreeViewer ? 'blur-[2px]' : ''}`}>
        {(insights.length > 0 ? insights : [
          { label: 'Pipeline bottleneck', value: 'Preview', detail: 'Supported insights appear when data is available.' },
        ]).map((insight) => (
          <div key={insight.label} className="rounded-2xl border border-white/8 bg-slate-950/32 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{insight.label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{insight.value}</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">{insight.detail}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function QuickActions({ isFreeViewer, email }: { isFreeViewer: boolean; email: string }) {
  const actions = [
    { label: 'Generate Drafts', href: '/dashboard/kanban', icon: Sparkles },
    { label: 'Open Pipeline', href: '/dashboard/kanban', icon: Layers3 },
    { label: 'Open Outreach Queue', href: '/dashboard/outreach', icon: MailCheck },
    { label: 'Import Leads', href: '/dashboard/leads', icon: Zap },
    { label: 'Find Leads', href: '/dashboard/scraper', icon: Search },
  ]

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
      <SectionHeader eyebrow="Quick Actions" title="Operator shortcuts" compact />
      <div className="mt-4 grid gap-2">
        {isFreeViewer ? (
          <StartCheckoutButton
            label="Activate command center"
            email={email}
            source="dashboard_quick_actions"
            className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
          />
        ) : actions.map((action) => {
          const Icon = action.icon
          return (
            <Link
              key={action.label}
              href={action.href}
              className="group flex items-center justify-between rounded-2xl border border-white/8 bg-slate-950/32 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-cyan-200/18 hover:bg-white/[0.045] hover:text-white"
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4 text-cyan-200" />
                {action.label}
              </span>
              <ArrowRight className="h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-100" />
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function SectionHeader({ eyebrow, title, compact }: { eyebrow: string; title: string; compact?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/60">{eyebrow}</div>
      <h2 className={`${compact ? 'mt-1 text-xl' : 'mt-1 text-2xl'} font-semibold tracking-[-0.035em] text-white`}>
        {title}
      </h2>
    </div>
  )
}
