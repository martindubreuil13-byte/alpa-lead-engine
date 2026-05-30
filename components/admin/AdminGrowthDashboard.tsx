'use client'

import { useMemo, useState } from 'react'

import type { LeadFollowUpRow } from '@/lib/admin/lead-follow-ups'
import type { Database } from '@/lib/supabase/types'

type ActivityLogRow = Database['public']['Tables']['activity_logs']['Row']
type UserRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'email' | 'plan' | 'created_at'>

type DateRange = 'today' | '7d' | '30d' | 'custom'

type SnapshotStats = {
  trialsStarted: number
  searchesCompleted: number
  leadsGenerated: number
  emailExports: number
  emailsCaptured: number
  pendingFollowUps: number
  followUpSent: number
  plansViewed: number
  checkoutStarted: number
  paidUsers: number
}

const RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'custom', label: 'Custom Range' },
]

function getTodayDateInput() {
  return new Date().toISOString().slice(0, 10)
}

function getRangeBounds(range: DateRange, startDate: string, endDate: string) {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()

  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
    return { start, end }
  }

  if (range === 'custom') {
    const customStart = startDate ? new Date(`${startDate}T00:00:00`) : new Date(0)
    const customEnd = endDate ? new Date(`${endDate}T23:59:59.999`) : end
    return { start: customStart, end: customEnd }
  }

  start.setDate(start.getDate() - (range === '7d' ? 7 : 30))
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

function inRange(value: string, start: Date, end: Date) {
  const time = new Date(value).getTime()
  return time >= start.getTime() && time <= end.getTime()
}

function normalizeEmail(value: string | null | undefined) {
  const trimmed = String(value || '').trim().toLowerCase()
  return trimmed || null
}

function getSnapshot(params: {
  logs: ActivityLogRow[]
  users: UserRow[]
  followUps: LeadFollowUpRow[]
  delayDays: number
  range: DateRange
  startDate: string
  endDate: string
}): SnapshotStats {
  const { start, end } = getRangeBounds(params.range, params.startDate, params.endDate)
  const filteredLogs = params.logs.filter((log) => inRange(log.created_at, start, end))
  const filteredFollowUps = params.followUps.filter((followUp) => inRange(followUp.created_at, start, end))
  const usersById = new Map(params.users.map((user) => [user.id, user]))
  const capturedEmails = new Map<string, string>()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - params.delayDays)

  for (const log of filteredLogs) {
    if (log.event !== 'email_export_sent') continue
    const user = log.user_id ? usersById.get(log.user_id) : null
    if (user?.plan === 'admin') continue
    const email = normalizeEmail(log.email) || normalizeEmail(user?.email)
    if (email && !capturedEmails.has(email)) {
      capturedEmails.set(email, log.created_at)
    }
  }

  const sentEmails = new Set(
    params.followUps
      .filter((followUp) => followUp.followup_sent || followUp.follow_up_sent_at || followUp.status === 'sent')
      .map((followUp) => followUp.email.toLowerCase())
  )
  const pendingFollowUps = [...capturedEmails.entries()].filter(([email, captureDate]) => {
    return !sentEmails.has(email) && new Date(captureDate).getTime() <= cutoff.getTime()
  }).length

  const paidUsers = new Set(
    filteredLogs
      .filter((log) => log.event === 'checkout_completed')
      .map((log) => normalizeEmail(log.email) || log.user_id || log.session_id)
      .filter(Boolean)
  ).size

  return {
    trialsStarted: filteredLogs.filter((log) => log.event === 'trial_started').length,
    searchesCompleted: filteredLogs.filter((log) => log.event === 'scrape_completed').length,
    leadsGenerated: filteredLogs
      .filter((log) => log.event === 'scrape_completed')
      .reduce((sum, log) => sum + (log.leads_count ?? 0), 0),
    emailExports: filteredLogs.filter((log) => log.event === 'email_export_sent').length,
    emailsCaptured: capturedEmails.size,
    pendingFollowUps,
    followUpSent: filteredFollowUps.filter(
      (followUp) => followUp.followup_sent || followUp.follow_up_sent_at || followUp.status === 'sent'
    ).length,
    plansViewed: filteredLogs.filter((log) => log.event === 'plans_viewed').length,
    checkoutStarted: filteredLogs.filter((log) => log.event === 'checkout_started').length,
    paidUsers,
  }
}

export default function AdminGrowthDashboard({
  initialLogs,
  users,
  followUps,
  delayDays,
}: {
  initialLogs: ActivityLogRow[]
  users: UserRow[]
  followUps: LeadFollowUpRow[]
  delayDays: number
}) {
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [startDate, setStartDate] = useState(getTodayDateInput())
  const [endDate, setEndDate] = useState(getTodayDateInput())

  const snapshot = useMemo(
    () =>
      getSnapshot({
        logs: initialLogs,
        users,
        followUps,
        delayDays,
        range: dateRange,
        startDate,
        endDate,
      }),
    [dateRange, delayDays, endDate, followUps, initialLogs, startDate, users]
  )

  return (
    <div className="space-y-8">
      <header className="rounded-[28px] bg-white/[0.04] p-7 shadow-[0_24px_80px_rgba(2,8,23,0.22)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/80">
          Admin
        </div>
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Analytics</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Funnel performance, lead capture, follow-up progress, and paid conversion at a glance.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDateRange(option.value)}
                className={`min-h-[40px] rounded-2xl px-4 text-sm font-medium transition ${
                  dateRange === option.value
                    ? 'bg-white text-slate-950'
                    : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {dateRange === 'custom' ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:max-w-lg">
            <DateInput label="Start Date" value={startDate} onChange={setStartDate} />
            <DateInput label="End Date" value={endDate} onChange={setEndDate} />
          </div>
        ) : null}
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Trials Started" value={snapshot.trialsStarted} />
        <KpiCard label="Searches Completed" value={snapshot.searchesCompleted} />
        <KpiCard label="Leads Generated" value={snapshot.leadsGenerated} />
        <KpiCard label="Email Exports" value={snapshot.emailExports} />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Captured Emails" value={snapshot.emailsCaptured} />
        <KpiCard label="Pending Follow-Ups" value={snapshot.pendingFollowUps} />
        <KpiCard label="Follow-Up Sent" value={snapshot.followUpSent} />
        <KpiCard label="Paid Users" value={snapshot.paidUsers} />
      </section>

      <section className="rounded-[28px] bg-white/[0.04] p-7 shadow-[0_24px_80px_rgba(2,8,23,0.18)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Conversion Funnel</h2>
            <p className="mt-1 text-sm text-slate-400">Drop-off from trial to paid conversion.</p>
          </div>
        </div>

        <div className="mt-7 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-center">
          <FunnelStep label="Trials Started" value={snapshot.trialsStarted} />
          <FunnelArrow />
          <FunnelStep label="Emails Captured" value={snapshot.emailsCaptured} />
          <FunnelArrow />
          <FunnelStep label="Plans Viewed" value={snapshot.plansViewed} />
          <FunnelArrow />
          <FunnelStep label="Checkout Started" value={snapshot.checkoutStarted} />
          <FunnelArrow />
          <FunnelStep label="Paid Users" value={snapshot.paidUsers} />
        </div>
      </section>
    </div>
  )
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border-0 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:bg-white/[0.09]"
      />
    </label>
  )
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-h-[148px] rounded-[24px] bg-white/[0.045] p-6 shadow-[0_22px_70px_rgba(2,8,23,0.2)]">
      <div className="text-sm font-medium text-slate-400">{label}</div>
      <div className="mt-6 text-4xl font-semibold tracking-tight text-white">{value.toLocaleString()}</div>
    </div>
  )
}

function FunnelStep({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-h-[116px] rounded-[22px] bg-slate-950/30 p-5">
      <div className="text-sm font-medium text-slate-400">{label}</div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-white">{value.toLocaleString()}</div>
    </div>
  )
}

function FunnelArrow() {
  return (
    <div className="flex justify-center text-2xl text-slate-500 lg:text-xl">
      <span className="lg:hidden">↓</span>
      <span className="hidden lg:inline">→</span>
    </div>
  )
}
