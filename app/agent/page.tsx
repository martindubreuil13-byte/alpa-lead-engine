'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Zap } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { supabase } from '@/lib/supabase'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'

type MissionSummary = {
  id: string
  name: string | null
  status: string
  daily_target: number
  audience_input: string | null
  location_input: string | null
  location: string
  created_at: string
  leadsToday: number
  emailsReady: number
}

function getMissionTitle(m: MissionSummary): string {
  if (m.name) return m.name.slice(0, 60)
  const parts = [m.audience_input, m.location_input || m.location].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ').slice(0, 60) : 'Lead Mission'
}

const STATUS_ORDER: Record<string, number> = {
  needs_review: 0,
  active: 1,
  paused: 2,
  completed: 3,
  stopped: 4,
}

function statusConfig(status: string) {
  switch (status) {
    case 'needs_review':
      return {
        label: 'Needs Review',
        dot: 'bg-violet-400',
        badge: 'border-violet-400/25 bg-violet-500/10 text-violet-300',
        card: 'border-violet-400/20 shadow-[0_0_30px_rgba(139,92,246,0.12)]',
      }
    case 'active':
      return {
        label: 'Active',
        dot: 'bg-emerald-400 animate-pulse',
        badge: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
        card: '',
      }
    case 'paused':
      return {
        label: 'Paused',
        dot: 'bg-amber-400',
        badge: 'border-amber-400/20 bg-amber-500/10 text-amber-300',
        card: '',
      }
    case 'completed':
      return {
        label: 'Completed',
        dot: 'bg-blue-400',
        badge: 'border-blue-400/20 bg-blue-500/10 text-blue-300',
        card: '',
      }
    default:
      return {
        label: status.charAt(0).toUpperCase() + status.slice(1),
        dot: 'bg-slate-500',
        badge: 'border-white/10 bg-white/[0.04] text-slate-400',
        card: '',
      }
  }
}

export default function AgentEntryPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [summaries, setSummaries] = useState<MissionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState<string | null>(null)

  // Redirect non-admins after profile resolves
  useEffect(() => {
    if (!profileLoading && profile && !isAdmin(profile)) {
      router.replace('/dashboard')
    }
  }, [profile, profileLoading, router])

  const fetchMissions = useCallback(async () => {
    const userId = profile?.id
    if (!userId) return

    const { data: rawMissions } = await supabase
      .from('agent_missions')
      .select('id, name, status, daily_target, audience_input, location_input, location, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    // Filter out drafts and invalid entries
    const valid = (rawMissions ?? []).filter(
      (m) => m.id && m.status && m.status !== 'draft'
    )

    if (valid.length === 0) {
      setSummaries([])
      setLoading(false)
      return
    }

    const missionIds = valid.map((m) => m.id)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [leadCounts, emailCounts] = await Promise.all([
      supabase
        .from('agent_lead_queue')
        .select('mission_id')
        .eq('user_id', userId)
        .in('mission_id', missionIds)
        .gte('created_at', todayStart.toISOString()),
      supabase
        .from('outreach_queue')
        .select('mission_id')
        .eq('user_id', userId)
        .in('mission_id', missionIds)
        .eq('review_status', 'draft'),
    ])

    const leadsByMission = new Map<string, number>()
    leadCounts.data?.forEach((r) => {
      leadsByMission.set(r.mission_id, (leadsByMission.get(r.mission_id) ?? 0) + 1)
    })

    const emailsByMission = new Map<string, number>()
    emailCounts.data?.forEach((r) => {
      if (r.mission_id) {
        emailsByMission.set(r.mission_id, (emailsByMission.get(r.mission_id) ?? 0) + 1)
      }
    })

    const built: MissionSummary[] = valid.map((m) => ({
      ...m,
      leadsToday: leadsByMission.get(m.id) ?? 0,
      emailsReady: emailsByMission.get(m.id) ?? 0,
    }))

    built.sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
    setSummaries(built)
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    if (profile?.id && isAdmin(profile)) void fetchMissions()
  }, [profile?.id, fetchMissions, profile])

  async function handleToggle(mission: MissionSummary, e: React.MouseEvent) {
    e.stopPropagation()
    if (actioning === mission.id) return
    const newStatus = mission.status === 'active' ? 'paused' : 'active'
    setActioning(mission.id)
    try {
      await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: mission.id, status: newStatus }),
      })
      setSummaries((prev) =>
        prev.map((m) => (m.id === mission.id ? { ...m, status: newStatus } : m))
      )
    } finally {
      setActioning(null)
    }
  }

  async function handleDelete(mission: MissionSummary, e: React.MouseEvent) {
    e.stopPropagation()
    if (actioning === mission.id) return
    if (!window.confirm(`Delete "${getMissionTitle(mission)}"?`)) return
    setActioning(mission.id)
    try {
      const res = await fetch('/api/agent/missions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mission.id }),
      })
      // Optimistic removal + refetch to sync any server state
      setSummaries((prev) => prev.filter((m) => m.id !== mission.id))
      if (res.ok) void fetchMissions()
    } finally {
      setActioning(null)
    }
  }

  // ── Loading
  if (profileLoading || (loading && summaries.length === 0 && isAdmin(profile))) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
        </div>
      </DashboardShell>
    )
  }

  // ── Empty state
  if (!loading && summaries.length === 0) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[76vh] flex-col items-center justify-center px-4">
          <div className="relative w-full max-w-md text-center">
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.12),transparent_68%)] blur-[80px]" />
            <div className="relative space-y-6">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-blue-400/20 bg-blue-500/10 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
                <Zap className="h-7 w-7 text-blue-300" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-white">
                  Give me a mission
                </h1>
                <p className="text-base text-slate-400">
                  Tell me what you want. I'll handle the rest.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push('/agent/setup')}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/12 px-6 py-3.5 text-sm font-semibold text-blue-100 shadow-[0_0_28px_rgba(59,130,246,0.18)] transition hover:bg-blue-500/20 hover:text-white"
              >
                <Zap className="h-4 w-4" />
                Create Mission
              </button>
            </div>
          </div>
        </div>
      </DashboardShell>
    )
  }

  // ── Mission list
  return (
    <DashboardShell adminEmail={null}>
      <div className="mx-auto w-full max-w-2xl space-y-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">Agent</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {summaries.length} mission{summaries.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/agent/setup')}
            className="flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/12 px-4 py-2.5 text-sm font-semibold text-blue-100 shadow-[0_0_20px_rgba(59,130,246,0.14)] transition hover:bg-blue-500/20 hover:text-white"
          >
            <Plus className="h-4 w-4" />
            New Mission
          </button>
        </div>

        {/* Mission cards */}
        <div className="space-y-3">
          {summaries.map((mission) => {
            const cfg = statusConfig(mission.status)
            const title = getMissionTitle(mission)
            const progress = Math.min(
              100,
              Math.round((mission.leadsToday / Math.max(1, mission.daily_target)) * 100)
            )
            const canToggle = mission.status === 'active' || mission.status === 'paused'
            const busy = actioning === mission.id

            return (
              <div
                key={mission.id}
                onClick={() => router.push(`/agent/dashboard/${mission.id}`)}
                className={`glass cursor-pointer rounded-2xl p-4 transition hover:bg-white/[0.06] ${cfg.card}`}
              >
                <div className="flex items-start gap-3">
                  {/* Left: info */}
                  <div className="min-w-0 flex-1 space-y-2.5">
                    {/* Status badge + emails ready */}
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${cfg.badge}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                      {mission.emailsReady > 0 && (
                        <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                          {mission.emailsReady} ready
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <p className="truncate text-sm font-semibold text-white">{title}</p>

                    {/* Progress */}
                    <div className="space-y-1">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#3b82f6,#60a5fa)]"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500">
                        {mission.leadsToday} / {mission.daily_target} leads today
                      </p>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div
                    className="flex shrink-0 flex-col gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canToggle && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => void handleToggle(mission, e)}
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                      >
                        {mission.status === 'active' ? 'Pause' : 'Resume'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => void handleDelete(mission, e)}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-red-400/20 hover:text-red-400 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </DashboardShell>
  )
}
