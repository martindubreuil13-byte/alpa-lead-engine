'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowRight, LayoutGrid, Plus, RefreshCw, X, Zap } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { MissionStrip, type MissionStripItem } from '@/components/agent/MissionStrip'
import { NarrativeFeed, type NarrativeLine } from '@/components/agent/NarrativeFeed'
import { FloatingControls, type FloatingMission } from '@/components/agent/FloatingControls'
import { isAdmin } from '@/lib/auth/access'
import { supabase } from '@/lib/supabase'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'

// ─── Types ────────────────────────────────────────────────────────────────────

type MissionSummary = {
  id: string
  name: string | null
  status: string
  daily_target: number
  audience_input: string | null
  location_input: string | null
  location: string
  created_at: string
  next_run_at: string | null
  leadsToday: number
  emailsReady: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  needs_review: 0,
  active: 1,
  paused: 2,
  completed: 3,
  stopped: 4,
  exhausted: 5,
}

const LOADING_TIMEOUT_MS = 3000
const IS_DEV = process.env.NODE_ENV === 'development'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RawLead = { id: string; business_name: string | null; location: string | null; created_at: string }
type RawEmail = { id: string; company_name: string | null; mission_id: string | null; created_at: string }

function buildNarrative(leads: RawLead[], emails: RawEmail[]): NarrativeLine[] {
  const lines: NarrativeLine[] = []
  for (const l of leads) {
    const who = l.business_name ?? 'A new contact'
    const where = l.location ? ` in ${l.location}` : ''
    lines.push({ id: `lead-${l.id}`, text: `${who} discovered${where}`, kind: 'lead', ts: new Date(l.created_at).getTime() })
  }
  for (const e of emails) {
    lines.push({ id: `email-${e.id}`, text: `Draft email written for ${e.company_name ?? 'a company'}`, kind: 'email', ts: new Date(e.created_at).getTime() })
  }
  lines.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  return lines.slice(0, 40)
}

function missionTitle(m: MissionSummary): string {
  if (m.name) return m.name.slice(0, 40)
  const parts = [m.audience_input, m.location_input ?? m.location].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ').slice(0, 40) : 'Lead Mission'
}

// ─── Inline warning banner ────────────────────────────────────────────────────

function FetchWarningBanner({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  return (
    <div className="mx-auto mb-5 flex w-full max-w-6xl items-center gap-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.06] px-4 py-3">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
      <p className="flex-1 text-xs text-amber-300/70">
        Could not load missions. Showing default view. You can still create a new mission.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 rounded-lg border border-amber-400/15 bg-amber-500/[0.08] px-2.5 py-1 text-[11px] font-medium text-amber-300/70 transition hover:text-amber-200"
      >
        <RefreshCw className="h-2.5 w-2.5" />
        Retry
      </button>
      <button type="button" onClick={onDismiss} className="text-slate-700 transition hover:text-slate-500">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Dev debug overlay ────────────────────────────────────────────────────────

function DevOverlay({
  authOk, loading, fetchError, missionCount,
}: { authOk: boolean | null; loading: boolean; fetchError: boolean; missionCount: number }) {
  if (!IS_DEV) return null
  return (
    <div className="fixed bottom-24 left-4 z-[100] rounded-lg border border-white/[0.08] bg-black/80 px-3 py-2 font-mono text-[10px] text-slate-500 backdrop-blur">
      <div>auth: {authOk === null ? '…' : authOk ? 'yes' : 'NO'}</div>
      <div>loading: {String(loading)}</div>
      <div>fetchError: {String(fetchError)}</div>
      <div>missions: {missionCount}</div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentEntryPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [missions, setMissions] = useState<MissionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [fetchErrorDismissed, setFetchErrorDismissed] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [narrativeItems, setNarrativeItems] = useState<NarrativeLine[]>([])
  const [authOk, setAuthOk] = useState<boolean | null>(null)
  const didRedirect = useRef(false)
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Guard: admins only
  useEffect(() => {
    if (!profileLoading && profile && !isAdmin(profile)) {
      router.replace('/dashboard')
    }
  }, [profile, profileLoading, router])

  // ── Safety timeout: if loading is still true after LOADING_TIMEOUT_MS, fail open
  useEffect(() => {
    if (!loading) {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
      return
    }
    loadingTimerRef.current = setTimeout(() => {
      console.warn('[agent] loading timed out after', LOADING_TIMEOUT_MS, 'ms — failing open')
      setLoading(false)
    }, LOADING_TIMEOUT_MS)
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
    }
  }, [loading])

  // ── Fetch narrative feed (non-critical)
  const fetchNarrative = useCallback(async (userId: string, missionIds: string[]) => {
    if (missionIds.length === 0) return
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    try {
      const [leadsRes, emailsRes] = await Promise.all([
        supabase
          .from('agent_lead_queue')
          .select('id, business_name, location, created_at')
          .eq('user_id', userId)
          .in('mission_id', missionIds)
          .gte('created_at', todayStart.toISOString())
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('outreach_queue')
          .select('id, company_name, mission_id, created_at')
          .eq('user_id', userId)
          .in('mission_id', missionIds)
          .gte('created_at', todayStart.toISOString())
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      setNarrativeItems(buildNarrative(leadsRes.data ?? [], emailsRes.data ?? []))
    } catch (err) {
      console.warn('[agent] narrative fetch failed (non-critical):', err)
    }
  }, [])

  // ── Fetch all missions
  const fetchMissions = useCallback(async () => {
    console.log('[agent] fetchMissions:start')
    setFetchError(false)
    setFetchErrorDismissed(false)

    try {
      // Step 1: resolve auth — always go to the source, not React state
      const { data: userData, error: authError } = await supabase.auth.getUser()
      const userId = userData?.user?.id ?? null
      console.log('[agent] auth user:', userId ?? 'null', authError ? `err=${authError.message}` : 'ok')
      setAuthOk(!!userId)

      if (!userId) {
        console.warn('[agent] no authenticated user — cannot load missions')
        // Not a data error, just not logged in. Don't set fetchError.
        return
      }

      // Step 2: query missions
      const { data: rawData, error: queryError } = await supabase
        .from('agent_missions')
        .select('id, name, status, daily_target, audience_input, location_input, location, created_at, next_run_at')
        .eq('user_id', userId)
        .neq('status', 'draft')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })

      console.log('[agent] missions raw data:', rawData?.length ?? 'null', 'rows')
      console.log('[agent] missions raw error:', queryError ? `${queryError.code}: ${queryError.message}` : 'none')

      if (queryError) {
        // Real DB error — show inline warning but don't block the page
        console.warn('[agent] setting fetchError: true (query error)')
        setFetchError(true)
        return
      }

      // Step 3: normalize — null without error means empty, not an error
      const safeMissions: typeof rawData = Array.isArray(rawData) ? rawData : []
      const valid = safeMissions.filter((m) => m.id && m.status)
      console.log('[agent] normalized missions count:', valid.length)

      if (valid.length === 0) {
        setMissions([])
        console.log('[agent] setting fetchError: false (empty but ok)')
        return
      }

      // Step 4: enrich with today's lead/email counts
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
        if (r.mission_id) emailsByMission.set(r.mission_id, (emailsByMission.get(r.mission_id) ?? 0) + 1)
      })

      const built: MissionSummary[] = valid.map((m) => ({
        ...m,
        leadsToday: leadsByMission.get(m.id) ?? 0,
        emailsReady: emailsByMission.get(m.id) ?? 0,
      }))
      built.sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))

      console.log('[agent] setting fetchError: false (success,', built.length, 'missions)')
      setMissions(built)
      void fetchNarrative(userId, missionIds)
    } catch (err) {
      console.warn('[agent] fetchMissions exception:', err)
      console.log('[agent] setting fetchError: true (exception)')
      setFetchError(true)
    } finally {
      console.log('[agent] fetchMissions:done')
      setLoading(false)
    }
  }, [fetchNarrative])

  // Trigger fetch once profile resolves
  useEffect(() => {
    if (!profileLoading && profile && isAdmin(profile)) {
      void fetchMissions()
    } else if (!profileLoading && !profile) {
      // Profile resolved but no user — stop loading, show empty hero
      setLoading(false)
    }
  }, [profileLoading, profile, fetchMissions])

  // ── Auto-redirect: only when the single active mission is the only non-terminal one
  useEffect(() => {
    if (loading || didRedirect.current || missions.length === 0) return
    const active = missions.filter((m) => m.status === 'active')
    const nonTerminal = missions.filter((m) => !['stopped', 'completed', 'exhausted'].includes(m.status))
    if (active.length === 1 && nonTerminal.length === 1) {
      didRedirect.current = true
      router.replace(`/agent/dashboard/${active[0].id}`)
    }
  }, [loading, missions, router])

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function handleToggle(mission: MissionSummary | MissionStripItem) {
    if (actioning === mission.id) return
    const newStatus = mission.status === 'active' ? 'paused' : 'active'
    setActioning(mission.id)
    try {
      await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: mission.id, status: newStatus }),
      })
      setMissions((prev) =>
        prev.map((m) => (m.id === mission.id ? { ...m, status: newStatus } : m))
      )
    } finally {
      setActioning(null)
    }
  }

  async function handleStop(mission: MissionSummary | MissionStripItem) {
    if (actioning === mission.id) return
    setActioning(mission.id)
    try {
      await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: mission.id, status: 'stopped' }),
      })
      setMissions((prev) =>
        prev.map((m) => (m.id === mission.id ? { ...m, status: 'stopped' } : m))
      )
    } finally {
      setActioning(null)
    }
  }

  async function handleDelete(mission: MissionSummary, e: React.MouseEvent) {
    e.stopPropagation()
    if (actioning === mission.id) return
    if (!window.confirm('Delete this mission?')) return
    setActioning(mission.id)
    try {
      await fetch('/api/agent/missions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mission.id }),
      })
      setMissions((prev) => prev.filter((m) => m.id !== mission.id))
    } finally {
      setActioning(null)
    }
  }

  function handleRetry() {
    setFetchError(false)
    setFetchErrorDismissed(false)
    setLoading(true)
    void fetchMissions()
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  const hasMissions = Array.isArray(missions) && missions.length > 0
  const activeMissions = missions.filter((m) => ['active', 'paused', 'needs_review'].includes(m.status))
  const primaryMission = activeMissions.find((m) => m.status === 'active') ?? activeMissions[0] ?? null
  const totalLeadsToday = missions.reduce((s, m) => s + m.leadsToday, 0)
  const totalEmailsReady = missions.reduce((s, m) => s + m.emailsReady, 0)
  const showWarning = fetchError && !fetchErrorDismissed

  // ─── Render ───────────────────────────────────────────────────────────────

  // Only block while the profile hook itself is resolving (very brief)
  if (profileLoading) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        </div>
        <DevOverlay authOk={authOk} loading={loading} fetchError={fetchError} missionCount={missions.length} />
      </DashboardShell>
    )
  }

  return (
    <DashboardShell adminEmail={null}>
      {/* Sticky mission strip — only when missions are loaded and active */}
      {hasMissions && activeMissions.length > 0 && (
        <MissionStrip
          missions={activeMissions}
          actioning={actioning}
          onToggle={(m) => void handleToggle(m)}
          onStop={(m) => void handleStop(m)}
        />
      )}

      {loading ? (
        // Subtle loading state — profile resolved, waiting on data
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        </div>
      ) : (
        // ── MAIN CONTENT — always renders after loading resolves ──────────────
        <div className="px-4 sm:px-6">
          {/* Non-blocking warning banner */}
          {showWarning && (
            <div className="mx-auto max-w-6xl pt-6">
              <FetchWarningBanner
                onRetry={handleRetry}
                onDismiss={() => setFetchErrorDismissed(true)}
              />
            </div>
          )}

          {hasMissions ? (
            // ── Mission Control
            <div className="relative mx-auto w-full max-w-6xl py-8">
              {/* Ambient glow */}
              <div className="pointer-events-none absolute -top-24 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(59,130,246,0.06),transparent_65%)] blur-[90px]" />

              {/* Header */}
              <div className="relative mb-8 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    {activeMissions.some((m) => m.status === 'active') && (
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                    )}
                    <h1 className="text-2xl font-semibold tracking-tight text-white">Mission Control</h1>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {missions.length} mission{missions.length !== 1 ? 's' : ''} ·{' '}
                    {totalLeadsToday} leads today ·{' '}
                    {totalEmailsReady} emails ready
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href="/agent/missions"
                    className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-300"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    All missions
                  </Link>
                  <button
                    type="button"
                    onClick={() => router.push('/agent/setup')}
                    className="flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2 text-xs font-semibold text-blue-100 shadow-[0_0_20px_rgba(59,130,246,0.10)] transition hover:bg-blue-500/18 hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Mission
                  </button>
                </div>
              </div>

              {/* 12-col grid */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* Left: live activity feed */}
                <div className="lg:col-span-8">
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-6">
                    <NarrativeFeed
                      items={narrativeItems}
                      label="Today's Activity"
                      empty="No activity yet today — the agent will run soon."
                    />
                  </div>
                </div>

                {/* Right: stats + quick mission links */}
                <div className="space-y-4 lg:col-span-4">
                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5">
                    <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Today</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
                        <p className="text-2xl font-bold tabular-nums text-white">{totalLeadsToday}</p>
                        <p className="mt-0.5 text-[10px] text-slate-600">Leads found</p>
                      </div>
                      <div className="rounded-xl border border-violet-400/10 bg-violet-500/[0.04] p-3">
                        <p className="text-2xl font-bold tabular-nums text-white">{totalEmailsReady}</p>
                        <p className="mt-0.5 text-[10px] text-slate-600">Emails ready</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
                        <p className="text-2xl font-bold tabular-nums text-white">
                          {activeMissions.filter((m) => m.status === 'active').length}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-600">Running now</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
                        <p className="text-2xl font-bold tabular-nums text-white">{missions.length}</p>
                        <p className="mt-0.5 text-[10px] text-slate-600">Total missions</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {missions.slice(0, 5).map((m) => {
                      const isActive = m.status === 'active'
                      const isNeedsReview = m.status === 'needs_review'
                      const title = missionTitle(m)
                      const busy = actioning === m.id
                      const isTerminal = ['stopped', 'completed', 'exhausted'].includes(m.status)
                      return (
                        <div
                          key={m.id}
                          onClick={() => router.push(`/agent/dashboard/${m.id}`)}
                          className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 transition hover:bg-white/[0.04]"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              isActive ? 'animate-pulse bg-emerald-400'
                              : isNeedsReview ? 'bg-violet-400'
                              : m.status === 'paused' ? 'bg-amber-400'
                              : 'bg-slate-600'
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-300">
                            {title}
                          </span>
                          {m.emailsReady > 0 && (
                            <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-violet-300">
                              {m.emailsReady}
                            </span>
                          )}
                          {!isTerminal && !isActive && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={(e) => void handleDelete(m, e)}
                              className="ml-1 shrink-0 text-[11px] text-slate-700 transition hover:text-red-400 disabled:opacity-40"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      )
                    })}

                    {missions.length > 5 && (
                      <Link
                        href="/agent/missions"
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.04] py-2.5 text-[11px] text-slate-700 transition hover:text-slate-500"
                      >
                        +{missions.length - 5} more missions
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // ── Empty hero — renders whether missions are empty OR fetch failed ──
            <div className="relative flex min-h-[80vh] flex-col items-center justify-center px-4">
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.10),transparent_65%)] blur-[100px]" />
                <div
                  className="agent-grid-shift absolute inset-0"
                  style={{
                    backgroundImage: 'radial-gradient(circle, rgba(59,130,246,0.12) 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                  }}
                />
              </div>

              <div className="relative flex w-full max-w-md flex-col items-center gap-8 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-[28px] border border-blue-400/20 bg-blue-500/[0.08] shadow-[0_0_50px_rgba(59,130,246,0.18)]">
                  <Zap className="h-9 w-9 text-blue-300" strokeWidth={1.5} />
                </div>
                <div className="space-y-3">
                  <h1 className="text-4xl font-semibold tracking-tight text-white">
                    Your next clients are already being found.
                  </h1>
                  <p className="text-base leading-relaxed text-slate-400">
                    Define it once. The agent runs daily.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/agent/setup')}
                  className="group flex items-center gap-3 rounded-2xl border border-blue-400/25 bg-blue-500/10 px-8 py-4 text-base font-semibold text-blue-100 shadow-[0_0_40px_rgba(59,130,246,0.18)] transition-all hover:bg-blue-500/18 hover:text-white hover:shadow-[0_0_50px_rgba(59,130,246,0.24)]"
                >
                  <Zap className="h-4 w-4" />
                  Create Mission
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </button>
                <div className="w-full space-y-2 pt-4">
                  {[
                    { step: '01', text: 'Define your audience' },
                    { step: '02', text: 'Agent runs and finds contacts' },
                    { step: '03', text: 'Messages are ready to send' },
                  ].map(({ step, text }) => (
                    <div
                      key={step}
                      className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-3.5"
                    >
                      <span className="text-[11px] font-bold tabular-nums tracking-[0.2em] text-blue-500/60">{step}</span>
                      <span className="text-sm text-slate-400">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating controls — only when missions loaded and a primary mission exists */}
      {!loading && hasMissions && primaryMission && (
        <FloatingControls
          mission={primaryMission as FloatingMission}
          actioning={actioning === primaryMission.id}
          onToggle={() => void handleToggle(primaryMission)}
          onStop={() => void handleStop(primaryMission)}
          onEdit={() => router.push(`/agent/dashboard/${primaryMission.id}`)}
        />
      )}

      {/* Dev debug overlay */}
      <DevOverlay authOk={authOk} loading={loading} fetchError={fetchError} missionCount={missions.length} />
    </DashboardShell>
  )
}
