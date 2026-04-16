'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, Pause, Play, Zap } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'

type ActivityItem = {
  id: string
  business_name: string | null
  website: string | null
  email: string | null
  location: string | null
  created_at: string
}

type MissionData = {
  id: string
  status: string
  daily_target: number
  offer_input: string | null
  audience_input: string | null
  location_input: string | null
  location: string
  name: string | null
  created_at: string
}

type StatusData = {
  mission: MissionData
  leadsToday: number
  totalLeads: number
  emailsReady: number
  recentActivity: ActivityItem[]
}

function formatRelativeTime(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function MissionDashboardPage() {
  const params = useParams()
  const missionId = String(params.missionId)

  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState(false)
  const runningRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async (): Promise<StatusData | null> => {
    try {
      const res = await fetch(`/api/agent/mission-status?missionId=${missionId}`)
      if (!res.ok) {
        setError('Failed to load mission.')
        return null
      }
      const data = (await res.json()) as StatusData
      setStatus(data)
      setError(null)
      return data
    } catch {
      setError('Connection error.')
      return null
    } finally {
      setLoading(false)
    }
  }, [missionId])

  const triggerMission = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    try {
      await fetch('/api/agent/run-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      })
    } catch {
      // Fire-and-forget; errors are non-blocking
    } finally {
      runningRef.current = false
      setRunning(false)
      void fetchStatus()
    }
  }, [missionId, fetchStatus])

  useEffect(() => {
    void (async () => {
      const data = await fetchStatus()
      if (
        data?.mission.status === 'active' &&
        data.leadsToday < data.mission.daily_target
      ) {
        void triggerMission()
      }
    })()

    pollRef.current = setInterval(async () => {
      const data = await fetchStatus()
      if (
        data?.mission.status === 'active' &&
        data.leadsToday < data.mission.daily_target &&
        !runningRef.current
      ) {
        void triggerMission()
      }
    }, 25000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [missionId, fetchStatus, triggerMission])

  async function handleToggleStatus() {
    if (!status || toggling) return
    const newStatus = status.mission.status === 'active' ? 'paused' : 'active'
    setToggling(true)
    try {
      const res = await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, status: newStatus }),
      })
      if (res.ok) {
        setStatus((prev) =>
          prev ? { ...prev, mission: { ...prev.mission, status: newStatus } } : prev
        )
        if (newStatus === 'active') {
          const data = await fetchStatus()
          if (data && data.leadsToday < data.mission.daily_target) {
            void triggerMission()
          }
        }
      }
    } catch {
      // Ignore
    } finally {
      setToggling(false)
    }
  }

  const isActive = status?.mission.status === 'active'
  const progress = status
    ? Math.min(100, Math.round((status.leadsToday / Math.max(1, status.mission.daily_target)) * 100))
    : 0

  const missionTitle =
    status?.mission.offer_input ||
    status?.mission.name ||
    'Your Lead Engine'

  const locationLabel =
    status?.mission.location_input || status?.mission.location || ''

  if (loading) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex items-center gap-3 text-slate-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            <span className="text-sm">Loading mission...</span>
          </div>
        </div>
      </DashboardShell>
    )
  }

  if (error || !status) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-sm text-red-400">{error || 'Mission not found.'}</p>
          <Link href="/agent" className="text-sm text-blue-300 hover:text-white">
            Back to Agent
          </Link>
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell adminEmail={null}>
      <div className="mx-auto w-full max-w-2xl space-y-6 px-0 py-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {/* Status badge */}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                  isActive
                    ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                    : 'border border-amber-400/20 bg-amber-500/10 text-amber-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {isActive ? 'Active' : status.mission.status === 'paused' ? 'Paused' : status.mission.status}
              </span>

              {running && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-300">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-blue-400" />
                  Searching
                </span>
              )}
            </div>

            <h1 className="truncate text-xl font-semibold tracking-tight text-white">
              {missionTitle}
            </h1>

            {(status.mission.audience_input || locationLabel) && (
              <p className="text-sm text-slate-500">
                {[status.mission.audience_input, locationLabel].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          {/* Pause / Resume */}
          <button
            type="button"
            onClick={() => void handleToggleStatus()}
            disabled={toggling}
            className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
              isActive
                ? 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/18 hover:text-white'
            }`}
          >
            {isActive ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Resume
              </>
            )}
          </button>
        </div>

        {/* ── Metrics ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-2xl p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Leads Today
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tabular-nums text-white">
                {status.leadsToday}
              </span>
              <span className="text-base text-slate-500">/ {status.mission.daily_target}</span>
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Emails Ready
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tabular-nums text-white">
                {status.emailsReady}
              </span>
              <span className="text-base text-slate-500">drafts</span>
            </div>
            {status.emailsReady > 0 && (
              <Link
                href="/dashboard/outreach"
                className="mt-2 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-200"
              >
                Review queue
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div className="glass rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em]">
            <span className="text-slate-500">Daily Progress</span>
            <span className="text-slate-400">{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#3b82f6,#60a5fa)] transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-slate-500">
            {status.leadsToday} leads found today · {status.totalLeads} total leads
          </div>
        </div>

        {/* ── Activity Feed ── */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Recent Activity
            </div>
            {status.recentActivity.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <Zap className="h-3 w-3" />
                {status.recentActivity.length} leads
              </div>
            )}
          </div>

          {status.recentActivity.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <div className="text-sm text-slate-500">
                {isActive
                  ? running
                    ? 'Searching for leads now...'
                    : 'No leads found yet. The agent will search shortly.'
                  : 'Resume the mission to start finding leads.'}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {status.recentActivity.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-slate-400">
                    <Zap className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-white">
                        {item.business_name || item.website || 'Unknown business'}
                      </span>
                      {item.location && (
                        <span className="shrink-0 text-xs text-slate-600">{item.location}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      {item.email && (
                        <span className="rounded-md border border-emerald-400/15 bg-emerald-500/[0.07] px-1.5 py-0.5 text-[11px] text-emerald-400">
                          email
                        </span>
                      )}
                      {item.website && (
                        <span className="truncate text-xs text-slate-600">{item.website}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-slate-600">
                    {formatRelativeTime(item.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <div className="flex items-center justify-between">
          <Link
            href="/agent"
            className="text-sm text-slate-500 hover:text-slate-300 transition"
          >
            ← All missions
          </Link>
          <Link
            href="/agent/setup"
            className="text-sm text-slate-500 hover:text-slate-300 transition"
          >
            New mission
          </Link>
        </div>
      </div>
    </DashboardShell>
  )
}
