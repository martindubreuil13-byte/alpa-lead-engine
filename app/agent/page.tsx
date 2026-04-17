'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Plus, RefreshCw, X } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { OrbitSystem } from '@/components/agent/OrbitSystem'
import { SignalEffects } from '@/components/agent/SignalEffects'
import { isAdmin } from '@/lib/auth/access'
import { supabase } from '@/lib/supabase'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import type { NodeMission } from '@/components/agent/MissionNode'

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
  leadsToday: number
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

const IS_DEV = process.env.NODE_ENV === 'development'
const LOAD_TIMEOUT_MS = 3000

// ─── Sub-components ───────────────────────────────────────────────────────────

function FetchWarningBanner({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  return (
    <div className="absolute top-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-400/15 bg-[rgba(10,10,18,0.90)] px-4 py-2.5 backdrop-blur">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400/60" />
      <p className="text-[11px] text-amber-300/60">Could not load missions. You can still create one.</p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 text-[11px] text-amber-300/60 transition hover:text-amber-200"
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

function DevOverlay({ authOk, loading, fetchError, count }: {
  authOk: boolean | null; loading: boolean; fetchError: boolean; count: number
}) {
  if (!IS_DEV) return null
  return (
    <div className="fixed bottom-24 left-4 z-[100] rounded-lg border border-white/[0.07] bg-black/80 px-3 py-2 font-mono text-[10px] text-slate-600 backdrop-blur">
      <div>auth: {authOk === null ? '…' : authOk ? 'yes' : 'NO'}</div>
      <div>loading: {String(loading)}</div>
      <div>error: {String(fetchError)}</div>
      <div>missions: {count}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentCorePage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [missions, setMissions] = useState<MissionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [fetchErrorDismissed, setFetchErrorDismissed] = useState(false)
  const [authOk, setAuthOk] = useState<boolean | null>(null)
  const didRedirect = useRef(false)
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Guard: admins only
  useEffect(() => {
    if (!profileLoading && profile && !isAdmin(profile)) {
      router.replace('/dashboard')
    }
  }, [profile, profileLoading, router])

  // ── Safety timeout: never stay on spinner indefinitely
  useEffect(() => {
    if (!loading) {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
      return
    }
    loadTimerRef.current = setTimeout(() => {
      console.warn('[agent] loading timeout — failing open')
      setLoading(false)
    }, LOAD_TIMEOUT_MS)
    return () => { if (loadTimerRef.current) clearTimeout(loadTimerRef.current) }
  }, [loading])

  // ── Fetch missions
  const fetchMissions = useCallback(async () => {
    console.log('[agent] fetchMissions:start')
    setFetchError(false)
    setFetchErrorDismissed(false)
    try {
      const { data: userData, error: authErr } = await supabase.auth.getUser()
      const userId = userData?.user?.id ?? null
      console.log('[agent] auth user:', userId ?? 'null', authErr ? `err=${authErr.message}` : 'ok')
      setAuthOk(!!userId)

      if (!userId) return // not logged in — show empty core

      const { data: raw, error: qErr } = await supabase
        .from('agent_missions')
        .select('id, name, status, daily_target, audience_input, location_input, location, created_at')
        .eq('user_id', userId)
        .neq('status', 'draft')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })

      console.log('[agent] missions raw:', raw?.length ?? 'null', 'rows, err:', qErr?.message ?? 'none')

      if (qErr) {
        console.warn('[agent] query error:', qErr.code, qErr.message)
        setFetchError(true)
        return
      }

      const valid = Array.isArray(raw) ? raw.filter((m) => m.id && m.status) : []
      if (valid.length === 0) { setMissions([]); return }

      const missionIds = valid.map((m) => m.id)
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

      const { data: leadCounts } = await supabase
        .from('agent_lead_queue')
        .select('mission_id')
        .eq('user_id', userId)
        .in('mission_id', missionIds)
        .gte('created_at', todayStart.toISOString())

      const leadsByMission = new Map<string, number>()
      leadCounts?.forEach((r) => leadsByMission.set(r.mission_id, (leadsByMission.get(r.mission_id) ?? 0) + 1))

      const built: MissionSummary[] = valid.map((m) => ({
        ...m,
        leadsToday: leadsByMission.get(m.id) ?? 0,
      }))
      built.sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))

      console.log('[agent] setting missions:', built.length)
      setMissions(built)
    } catch (err) {
      console.warn('[agent] fetchMissions exception:', err)
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Trigger fetch once profile resolves
  useEffect(() => {
    if (!profileLoading && profile && isAdmin(profile)) void fetchMissions()
    else if (!profileLoading && !profile) setLoading(false)
  }, [profileLoading, profile, fetchMissions])

  // ── Auto-redirect: only when single active mission is the only non-terminal one
  useEffect(() => {
    if (loading || didRedirect.current || missions.length === 0) return
    const active = missions.filter((m) => m.status === 'active')
    const nonTerminal = missions.filter((m) => !['stopped', 'completed', 'exhausted'].includes(m.status))
    if (active.length === 1 && nonTerminal.length === 1) {
      didRedirect.current = true
      router.replace(`/agent/dashboard/${active[0].id}`)
    }
  }, [loading, missions, router])

  function handleRetry() {
    setFetchError(false)
    setFetchErrorDismissed(false)
    setLoading(true)
    void fetchMissions()
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const visibleMissions = missions
    .filter((m) => !['stopped', 'completed'].includes(m.status))
    .slice(0, 5) as NodeMission[]

  const isRunning = missions.some((m) => m.status === 'active')
  const locationHint = missions.find((m) => m.location_input)?.location_input
    ?? missions.find((m) => m.location)?.location
    ?? null
  const showWarning = fetchError && !fetchErrorDismissed

  // ─── Render ───────────────────────────────────────────────────────────────

  if (profileLoading) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell adminEmail={null}>
      {/*
        Full-bleed container: negates DashboardShell's inner padding so the
        core can be truly centered in the content area.
      */}
      <div
        className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-10 lg:-mt-8"
        style={{
          position: 'relative',
          minHeight: 'calc(100vh - 64px)',
          background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(59,130,246,0.07) 0%, transparent 70%), #020617',
          overflow: 'hidden',
        }}
      >
        {/* New Mission CTA — top-right */}
        <button
          type="button"
          onClick={() => router.push('/agent/setup')}
          className="absolute right-6 top-6 z-10 flex cursor-pointer items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/15 px-5 py-2 text-[13px] font-medium text-white/90 transition-all hover:scale-[1.03] hover:bg-blue-500/25 hover:shadow-[0_0_24px_rgba(59,130,246,0.28)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New Mission
        </button>

        {/* Loading state — core area shows spinner */}
        {loading ? (
          <div className="flex h-full min-h-[inherit] items-center justify-center">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400/60" />
          </div>
        ) : (
          <>
            {/* Orbit system — fills entire container, positioned absolutely */}
            <OrbitSystem
              missions={visibleMissions}
              onNodeClick={(id) => router.push(`/agent/dashboard/${id}`)}
            />

            {/* Signal effects — floating logs + pulse rings */}
            <SignalEffects active={isRunning} locationHint={locationHint} />

            {/* Empty state CTA — below core, only when no missions */}
            {missions.length === 0 && !fetchError && (
              <div
                className="pointer-events-none absolute left-1/2 -translate-x-1/2"
                style={{ top: 'calc(50% + 200px)' }}
              >
                <button
                  type="button"
                  className="pointer-events-auto cursor-pointer rounded-full border border-blue-500/25 bg-blue-500/10 px-6 py-2.5 text-[13px] font-medium text-blue-200/80 transition hover:bg-blue-500/18 hover:text-blue-100"
                  onClick={() => router.push('/agent/setup')}
                >
                  Create your first mission
                </button>
              </div>
            )}

            {/* Fetch warning banner */}
            {showWarning && (
              <FetchWarningBanner
                onRetry={handleRetry}
                onDismiss={() => setFetchErrorDismissed(true)}
              />
            )}
          </>
        )}
      </div>

      <DevOverlay authOk={authOk} loading={loading} fetchError={fetchError} count={missions.length} />
    </DashboardShell>
  )
}
