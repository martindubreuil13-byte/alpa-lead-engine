'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Pause, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { isAdmin } from '@/lib/auth/access'
import { supabase } from '@/lib/supabase'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { safeFetch } from '@/lib/utils/safeFetch'

// ─── Types ────────────────────────────────────────────────────────────────────

type MissionRow = {
  id: string
  name: string | null
  status: string
  daily_target: number
  audience_input: string | null
  location_input: string | null
  location: string
  created_at: string
  last_run_at: string | null
  next_run_at: string | null
  leadsToday: number
  totalLeads: number
  emailsReady: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMissionTitle(m: MissionRow): string {
  if (m.name) return m.name.slice(0, 60)
  const parts = [m.audience_input, m.location_input || m.location].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ').slice(0, 60) : 'Lead Mission'
}

function relativeDate(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const STATUS_GROUPS = {
  live: ['active', 'scheduled'],
  paused: ['paused'],
  inactive: ['archived'],
}

type StatusBadgeProps = { status: string }
function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<string, { label: string; cls: string }> = {
    active:        { label: 'Active',        cls: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300' },
    scheduled:     { label: 'Scheduled',     cls: 'border-blue-400/20 bg-blue-500/10 text-blue-300' },
    paused:        { label: 'Paused',         cls: 'border-amber-400/20 bg-amber-500/10 text-amber-300' },
    archived:      { label: 'Archived',      cls: 'border-slate-600/30 bg-slate-500/10 text-slate-500' },
  }
  const cfg = map[status] ?? { label: status, cls: 'border-white/10 bg-white/[0.04] text-slate-400' }

  const dotMap: Record<string, string> = {
    active:       'bg-emerald-400 animate-pulse',
    scheduled:    'bg-blue-400',
    paused:       'bg-amber-400',
    archived:     'bg-slate-600',
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${cfg.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotMap[status] ?? 'bg-slate-500'}`} />
      {cfg.label}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MissionsListPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [missions, setMissions] = useState<MissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

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
      .select('id, name, status, daily_target, audience_input, location_input, location, created_at, last_run_at, next_run_at')
      .eq('user_id', userId)
      .neq('status', 'draft')
      .order('created_at', { ascending: false })

    const valid = (rawMissions ?? []).filter((m) => m.id && m.status)
    if (valid.length === 0) {
      setMissions([])
      setLoading(false)
      return
    }

    const missionIds = valid.map((m) => m.id)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [todayCounts, totalCounts, emailCounts] = await Promise.all([
      supabase
        .from('agent_lead_queue')
        .select('mission_id')
        .eq('user_id', userId)
        .in('mission_id', missionIds)
        .gte('created_at', todayStart.toISOString()),
      supabase
        .from('agent_lead_queue')
        .select('mission_id')
        .eq('user_id', userId)
        .in('mission_id', missionIds),
      supabase
        .from('outreach_queue')
        .select('mission_id')
        .eq('user_id', userId)
        .in('mission_id', missionIds)
        .eq('review_status', 'draft'),
    ])

    const todayByMission = new Map<string, number>()
    todayCounts.data?.forEach((r) => {
      todayByMission.set(r.mission_id, (todayByMission.get(r.mission_id) ?? 0) + 1)
    })

    const totalByMission = new Map<string, number>()
    totalCounts.data?.forEach((r) => {
      totalByMission.set(r.mission_id, (totalByMission.get(r.mission_id) ?? 0) + 1)
    })

    const emailsByMission = new Map<string, number>()
    emailCounts.data?.forEach((r) => {
      if (r.mission_id) emailsByMission.set(r.mission_id, (emailsByMission.get(r.mission_id) ?? 0) + 1)
    })

    const built: MissionRow[] = valid.map((m) => ({
      ...m,
      leadsToday: todayByMission.get(m.id) ?? 0,
      totalLeads: totalByMission.get(m.id) ?? 0,
      emailsReady: emailsByMission.get(m.id) ?? 0,
    }))

    setMissions(built)
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    if (profile?.id && isAdmin(profile)) void fetchMissions()
  }, [profile?.id, fetchMissions, profile])

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function doUpdate(id: string, payload: Record<string, unknown>) {
    if (!id || id === 'undefined') {
      console.warn('[MISSION BLOCKED] invalid missionId', id)
      return false
    }

    const url = '/api/agent/missions/update'
    console.log('[FETCH CALL]', { url, missionId: id })

    try {
      await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: id, ...payload }),
      })
      return true
    } catch (err) {
      console.error('[agent] fetch failed', { url, missionId: id, err })
      return false
    }
  }

  async function handleToggle(m: MissionRow) {
    if (actioning === m.id) return
    const newStatus =
      m.status === 'active' || m.status === 'scheduled'
        ? 'paused'
        : 'active'
    setActioning(m.id)
    try {
      const ok = await doUpdate(m.id, { status: newStatus })
      if (ok) setMissions((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: newStatus } : x)))
    } finally {
      setActioning(null)
    }
  }

  async function handleStop(m: MissionRow) {
    if (actioning === m.id) return
    setActioning(m.id)
    setConfirmStop(null)
    try {
      const ok = await doUpdate(m.id, { status: 'archived' })
      if (ok) setMissions((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: 'archived' } : x)))
    } finally {
      setActioning(null)
    }
  }

  async function handleRelaunch(m: MissionRow) {
    if (actioning === m.id) return
    setActioning(m.id)
    try {
      const ok = await doUpdate(m.id, { status: 'active', next_run_at: new Date().toISOString() })
      if (ok) {
        setMissions((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: 'active' } : x)))
        router.push(`/agent/dashboard/${m.id}`)
      }
    } finally {
      setActioning(null)
    }
  }

  async function handleDelete(m: MissionRow) {
    if (!m.id || m.id === 'undefined') {
      console.warn('[MISSION BLOCKED] invalid missionId', m.id)
      return
    }
    if (actioning === m.id) return
    setActioning(m.id)
    setConfirmDelete(null)
    // Optimistic remove — UI responds immediately
    setMissions((prev) => prev.filter((x) => x.id !== m.id))
    try {
      const url = '/api/agent/missions/delete'
      console.log('[FETCH CALL]', { url, missionId: m.id })
      await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id }),
      })
      router.push('/agent')
    } catch (err) {
      console.error('[agent] fetch failed', { url: '/api/agent/missions/delete', missionId: m.id, err })
      void fetchMissions()
    } finally {
      setActioning(null)
    }
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (profileLoading || (loading && isAdmin(profile))) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        </div>
      </DashboardShell>
    )
  }

  // Group missions by state for display
  const live = missions.filter((m) => STATUS_GROUPS.live.includes(m.status))
  const paused = missions.filter((m) => STATUS_GROUPS.paused.includes(m.status))
  const inactive = missions.filter((m) => STATUS_GROUPS.inactive.includes(m.status))

  return (
    <DashboardShell adminEmail={null}>
      <div className="relative mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-0">

        {/* Ambient glow */}
        <div className="pointer-events-none absolute -top-20 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(59,130,246,0.07),transparent_65%)] blur-[80px]" />

        {/* ── Header ── */}
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/agent"
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-500 transition hover:text-slate-300"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">All Missions</h1>
              <p className="mt-0.5 text-xs text-slate-600">
                {missions.length} total
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/agent/setup')}
            className="flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2.5 text-sm font-semibold text-blue-100 shadow-[0_0_24px_rgba(59,130,246,0.12)] transition hover:bg-blue-500/18 hover:text-white"
          >
            <Plus className="h-4 w-4" />
            New Mission
          </button>
        </div>

        {/* Empty state */}
        {missions.length === 0 && (
          <div className="glass rounded-2xl px-5 py-14 text-center">
            <p className="text-sm text-slate-500">No missions yet.</p>
            <button
              type="button"
              onClick={() => router.push('/agent/setup')}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-5 py-2.5 text-sm font-semibold text-blue-200 transition hover:text-white"
            >
              Create your first mission
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Live ── */}
        {live.length > 0 && (
          <Section label="Running" count={live.length}>
            {live.map((m) => (
              <MissionCard
                key={m.id}
                mission={m}
                busy={actioning === m.id}
                confirmStop={confirmStop === m.id}
                confirmDelete={confirmDelete === m.id}
                onOpen={() => router.push(`/agent/dashboard/${m.id}`)}
                onToggle={() => void handleToggle(m)}
                onStop={() => void handleStop(m)}
                onRelaunch={() => void handleRelaunch(m)}
                onDelete={() => void handleDelete(m)}
                onAskStop={() => setConfirmStop(m.id)}
                onCancelStop={() => setConfirmStop(null)}
                onAskDelete={() => setConfirmDelete(m.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
          </Section>
        )}

        {/* ── Paused ── */}
        {paused.length > 0 && (
          <Section label="Paused" count={paused.length}>
            {paused.map((m) => (
              <MissionCard
                key={m.id}
                mission={m}
                busy={actioning === m.id}
                confirmStop={confirmStop === m.id}
                confirmDelete={confirmDelete === m.id}
                onOpen={() => router.push(`/agent/dashboard/${m.id}`)}
                onToggle={() => void handleToggle(m)}
                onStop={() => void handleStop(m)}
                onRelaunch={() => void handleRelaunch(m)}
                onDelete={() => void handleDelete(m)}
                onAskStop={() => setConfirmStop(m.id)}
                onCancelStop={() => setConfirmStop(null)}
                onAskDelete={() => setConfirmDelete(m.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
          </Section>
        )}

        {/* ── Inactive ── */}
        {inactive.length > 0 && (
          <Section label="Inactive" count={inactive.length} muted>
            {inactive.map((m) => (
              <MissionCard
                key={m.id}
                mission={m}
                busy={actioning === m.id}
                confirmStop={confirmStop === m.id}
                confirmDelete={confirmDelete === m.id}
                onOpen={() => router.push(`/agent/dashboard/${m.id}`)}
                onToggle={() => void handleToggle(m)}
                onStop={() => void handleStop(m)}
                onRelaunch={() => void handleRelaunch(m)}
                onDelete={() => void handleDelete(m)}
                onAskStop={() => setConfirmStop(m.id)}
                onCancelStop={() => setConfirmStop(null)}
                onAskDelete={() => setConfirmDelete(m.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
          </Section>
        )}
      </div>
    </DashboardShell>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  label,
  count,
  muted = false,
  children,
}: {
  label: string
  count: number
  muted?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${muted ? 'text-slate-700' : 'text-slate-500'}`}>
          {label}
        </span>
        <span className={`text-[10px] tabular-nums ${muted ? 'text-slate-800' : 'text-slate-700'}`}>
          {count}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

// ─── Mission card ─────────────────────────────────────────────────────────────

type CardProps = {
  mission: MissionRow
  busy: boolean
  confirmStop: boolean
  confirmDelete: boolean
  onOpen: () => void
  onToggle: () => void
  onStop: () => void
  onRelaunch: () => void
  onDelete: () => void
  onAskStop: () => void
  onCancelStop: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
}

function MissionCard({
  mission: m,
  busy,
  confirmStop,
  confirmDelete,
  onOpen,
  onToggle,
  onStop,
  onRelaunch,
  onDelete,
  onAskStop,
  onCancelStop,
  onAskDelete,
  onCancelDelete,
}: CardProps) {
  const isActive = m.status === 'active'
  const isScheduled = m.status === 'scheduled'
  const isPaused = m.status === 'paused'
  const isArchived = m.status === 'archived'
  const canToggle = isActive || isPaused || isScheduled
  const canRelaunch = isArchived

  const progress = Math.min(100, Math.round((m.leadsToday / Math.max(1, m.daily_target)) * 100))
  const lastRunStr = relativeDate(m.last_run_at ?? m.created_at)

  return (
    <div
      className="glass cursor-pointer overflow-hidden rounded-2xl p-4 transition hover:bg-white/[0.04]"
      onClick={onOpen}
    >
      <div className="flex items-start gap-4">
        {/* Left: info */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Status + badges */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={m.status} />
            {m.emailsReady > 0 && (
              <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                {m.emailsReady} ready
              </span>
            )}
          </div>

          {/* Title */}
          <p className="truncate text-[15px] font-semibold leading-snug text-white">
            {getMissionTitle(m)}
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="tabular-nums">
              <span className="font-semibold text-slate-400">{m.totalLeads}</span> total leads
            </span>
            <span className="tabular-nums">
              <span className="font-semibold text-slate-400">{m.leadsToday}</span> today
            </span>
            <span>Last run {lastRunStr}</span>
          </div>

          {/* Progress (only for active/paused) */}
          {(isActive || isPaused || isScheduled) && (
            <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#3b82f6,#818cf8)] transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div
          className="flex shrink-0 flex-col items-end gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Open */}
          <button
            type="button"
            onClick={onOpen}
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:text-white"
          >
            Open
          </button>

          {/* Pause / Resume — ALWAYS shown for active */}
          {canToggle && (
            <button
              type="button"
              disabled={busy}
              onClick={onToggle}
              className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:text-white disabled:opacity-40"
            >
              {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {isActive ? 'Pause' : 'Resume'}
            </button>
          )}

          {/* Relaunch for inactive */}
          {canRelaunch && (
            <button
              type="button"
              disabled={busy}
              onClick={onRelaunch}
              className="flex items-center gap-1 rounded-xl border border-blue-400/20 bg-blue-500/[0.07] px-3 py-1.5 text-xs font-medium text-blue-400 transition hover:text-white disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" />
              Relaunch
            </button>
          )}

          {/* Stop — ALWAYS shown for active */}
          {isActive && (
            confirmStop ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onStop}
                  className="rounded-xl border border-red-400/25 bg-red-500/[0.08] px-2 py-1 text-[10px] font-semibold text-red-300 transition hover:text-white disabled:opacity-40"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={onCancelStop}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-[10px] text-slate-600 transition hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={onAskStop}
                className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-red-400/20 hover:text-red-400 disabled:opacity-40"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            )
          )}

          {/* Delete for inactive */}
          {isArchived && (
            confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onDelete}
                  className="rounded-xl border border-red-400/25 bg-red-500/[0.08] px-2 py-1 text-[10px] font-semibold text-red-300 transition hover:text-white disabled:opacity-40"
                >
                  Delete permanently
                </button>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-[10px] text-slate-600 transition hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={onAskDelete}
                className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-red-400/20 hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
