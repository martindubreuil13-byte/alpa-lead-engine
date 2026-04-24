'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, RefreshCw, X } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { Core } from '@/components/agent/Core'
import MissionStage from '@/components/agent/MissionStage'
import type { MissionCardData } from '@/components/agent/MissionCard'
import { isAdmin } from '@/lib/auth/access'
import { supabase } from '@/lib/supabase'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { safeFetch } from '@/lib/utils/safeFetch'

// ─── Types ────────────────────────────────────────────────────────────────────

type MissionSummary = MissionCardData

type AgentEventType = 'lead_found' | 'mission_started' | 'mission_paused'

type AgentEvent = {
  type: AgentEventType
  missionId?: string
  timestamp: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  scheduled: 1,
  paused: 2,
  archived: 3,
}

const IS_DEV = process.env.NODE_ENV === 'development'
// Timeout that starts only AFTER profile resolves and a fetch is in-flight.
// 3 s was too short: profileLoading itself can take 1-2 s before any fetch begins.
const FETCH_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 30_000   // re-fetch every 30s to detect new leads

/** Core diameter — 25 % smaller than original. */
function computeCoreSize(): number {
  if (typeof window === 'undefined') return 240
  if (window.innerWidth < 640) return 180
  if (window.innerWidth < 1024) return 225
  return 270
}

/** Real computed label — no fake rotation, driven purely by mission data. */
function computeCoreLabel(
  missions: MissionSummary[],
  newLeadActive: boolean,
): string {
  if (newLeadActive) return 'New match found'
  if (missions.length === 0) return 'No missions yet'
  const active = missions.filter((m) => m.status === 'active' || m.status === 'scheduled').length
  if (active === 0) return 'All missions paused'
  if (active === 1) return 'Running 1 mission'
  return `Running ${active} missions`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FetchWarningBanner({
  onRetry,
  onDismiss,
}: {
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div className="absolute top-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-400/15 bg-[rgba(10,10,18,0.90)] px-4 py-2.5 backdrop-blur">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400/60" />
      <p className="text-[11px] text-amber-300/60">
        Could not load missions. You can still create one.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 text-[11px] text-amber-300/60 transition hover:text-amber-200"
      >
        <RefreshCw className="h-2.5 w-2.5" />
        Retry
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-slate-700 transition hover:text-slate-500"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function DevOverlay({
  authOk,
  loading,
  fetchError,
  count,
  lastEvent,
}: {
  authOk: boolean | null
  loading: boolean
  fetchError: boolean
  count: number
  lastEvent: AgentEvent | null
}) {
  if (!IS_DEV) return null
  return (
    <div className="fixed bottom-24 left-4 z-[100] rounded-lg border border-white/[0.07] bg-black/80 px-3 py-2 font-mono text-[10px] text-slate-600 backdrop-blur">
      <div>auth: {authOk === null ? '…' : authOk ? 'yes' : 'NO'}</div>
      <div>loading: {String(loading)}</div>
      <div>error: {String(fetchError)}</div>
      <div>missions: {count}</div>
      {lastEvent && (
        <div>
          last: {lastEvent.type}
          {lastEvent.missionId ? ` (${lastEvent.missionId.slice(0, 6)})` : ''}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentCorePage() {
  const router = useRouter()
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [missions, setMissions] = useState<MissionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [fetchErrorDismissed, setFetchErrorDismissed] = useState(false)
  const [authOk, setAuthOk] = useState<boolean | null>(null)
  const [coreSize, setCoreSize] = useState(240)

  // Event system — latest event stored in ref, transient UI state in React state
  const lastEventRef = useRef<AgentEvent | null>(null)
  const [lastEventDisplay, setLastEventDisplay] = useState<AgentEvent | null>(null)
  const [pulseKey, setPulseKey] = useState(0)           // increment triggers core pulse
  const [newLeadActive, setNewLeadActive] = useState(false)  // drives 2s label override
  const [highlightedMissionId, setHighlightedMissionId] = useState<string | null>(null)

  // Previous lead counts per mission — used to detect new leads across polls
  const prevLeadCountsRef = useRef<Map<string, number>>(new Map())
  const prevStatusesRef = useRef<Map<string, string>>(new Map())

  const deletingMissionIdsRef = useRef<Set<string>>(new Set())
  const deletedMissionIdsRef = useRef<Set<string>>(new Set())
  const shouldAutoOpenRef = useRef(false)
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const newLeadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Responsive core size ──────────────────────────────────────────────────
  useEffect(() => {
    setCoreSize(computeCoreSize())
    const handler = () => setCoreSize(computeCoreSize())
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // ── Guard: admins only ────────────────────────────────────────────────────
  useEffect(() => {
    if (!profileLoading && profile && !isAdmin(profile)) {
      router.replace('/dashboard')
    }
  }, [profile, profileLoading, router])

  // ── Event emission ────────────────────────────────────────────────────────

  const emitEvent = useCallback((event: AgentEvent) => {
    lastEventRef.current = event
    setLastEventDisplay(event)

    if (event.type === 'lead_found') {
      // Core pulse — increment key; Core fires animation imperatively
      setPulseKey((k) => k + 1)

      // 2-second label override
      setNewLeadActive(true)
      if (newLeadTimerRef.current) clearTimeout(newLeadTimerRef.current)
      newLeadTimerRef.current = setTimeout(() => setNewLeadActive(false), 2000)

      // 400ms card highlight
      if (event.missionId) {
        setHighlightedMissionId(event.missionId)
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = setTimeout(
          () => setHighlightedMissionId(null),
          400,
        )
      }
    }
  }, [])

  // ── Fetch missions (+ diff for events) ────────────────────────────────────

  const fetchMissions = useCallback(
    async (isSilentPoll = false) => {
      if (!isSilentPoll) {
        console.log('[agent] fetchMissions:start')
        setFetchError(false)
        setFetchErrorDismissed(false)
      }
      try {
        const userId = user?.id ?? null
        if (!isSilentPoll)
          console.log(
            '[agent] auth user:',
            userId ?? 'null',
            userLoading ? 'loading' : 'ok',
          )
        setAuthOk(!!userId)
        if (!userId) return

        const { data: raw, error: qErr } = await supabase
          .from('agent_missions')
          .select(
            'id, name, status, daily_target, audience_input, location_input, location, created_at, last_run_at',
          )
          .eq('user_id', userId)
          .neq('status', 'draft')
          .neq('status', 'deleted')
          .order('created_at', { ascending: false })

        if (!isSilentPoll)
          console.log(
            '[agent] missions raw:',
            raw?.length ?? 'null',
            'rows, err:',
            qErr?.message ?? 'none',
          )

        if (qErr) {
          if (!isSilentPoll) setFetchError(true)
          return
        }

        const valid = Array.isArray(raw)
          ? raw.filter((m) => m.id && m.status && !deletedMissionIdsRef.current.has(m.id))
          : []
        if (valid.length === 0) {
          setMissions([])
          return
        }

        const missionIds = valid.map((m) => m.id)
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)

        const { data: leadCounts } = await supabase
          .from('agent_lead_queue')
          .select('mission_id')
          .eq('user_id', userId)
          .in('mission_id', missionIds)
          .gte('created_at', todayStart.toISOString())

        const leadsByMission = new Map<string, number>()
        leadCounts?.forEach((r) =>
          leadsByMission.set(r.mission_id, (leadsByMission.get(r.mission_id) ?? 0) + 1),
        )

        const built: MissionSummary[] = valid.map((m) => ({
          ...m,
          leadsToday: leadsByMission.get(m.id) ?? 0,
        }))
        built.sort(
          (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
        )

        // ── Event detection (runs on every poll) ──────────────────────────
        built.forEach((m) => {
          const prevLeads = prevLeadCountsRef.current.get(m.id) ?? -1
          const prevStatus = prevStatusesRef.current.get(m.id)

          if (prevLeads >= 0 && m.leadsToday > prevLeads) {
            emitEvent({ type: 'lead_found', missionId: m.id, timestamp: Date.now() })
          }
          if (
            prevStatus !== undefined &&
            prevStatus !== 'active' &&
            (m.status === 'active' || m.status === 'scheduled')
          ) {
            emitEvent({ type: 'mission_started', missionId: m.id, timestamp: Date.now() })
          }
          if (
            prevStatus !== undefined &&
            (prevStatus === 'active' || prevStatus === 'scheduled') &&
            m.status === 'paused'
          ) {
            emitEvent({ type: 'mission_paused', missionId: m.id, timestamp: Date.now() })
          }

          prevLeadCountsRef.current.set(m.id, m.leadsToday)
          prevStatusesRef.current.set(m.id, m.status)
        })

        if (!isSilentPoll)
          console.log('[agent] setting missions:', built.length)
        setMissions(built)
      } catch (err) {
        console.warn('[agent] fetchMissions exception:', err)
        if (!isSilentPoll) setFetchError(true)
      } finally {
        if (!isSilentPoll) {
          // Cancel the safety timeout so it never fires after data arrives
          if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
          setLoading(false)
        }
      }
    },
    [emitEvent, user, userLoading],
  )

  // ── Initial fetch + polling ───────────────────────────────────────────────
  // Waits for profileLoading to resolve before touching loading state or fetching.
  // Safety timeout starts HERE — after we know a fetch is actually in-flight.
  useEffect(() => {
    if (userLoading) return
    if (profileLoading) return  // not ready yet — don't start any timers

    if (!profile || !isAdmin(profile)) {
      setLoading(false)
      return
    }

    // Safety net: if the fetch hasn't finished after FETCH_TIMEOUT_MS, fail open
    loadTimerRef.current = setTimeout(() => {
      console.warn('[agent] fetch timeout — failing open')
      setLoading(false)
    }, FETCH_TIMEOUT_MS)

    void fetchMissions(false)

    pollTimerRef.current = setInterval(
      () => void fetchMissions(true),
      POLL_INTERVAL_MS,
    )

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current)
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [profileLoading, profile, fetchMissions, userLoading])

function handleRetry() {
  setFetchError(false)
  setFetchErrorDismissed(false)
  setLoading(true)
  void fetchMissions(false)
}

function handleNewMissionClick() {
  shouldAutoOpenRef.current = true
  if (shouldAutoOpenRef.current) {
    router.push('/agent/setup')
  }
}

function handleMissionSelect(id: string) {
  if (!id) return
  console.log('[AGENT] redirect triggered by user action')
  router.push(`/agent/dashboard/${id}`)
}

async function handleDeleteMission(id: string) {
  if (!id || id === 'undefined') {
    console.warn('[MISSION BLOCKED] invalid missionId', id)
    return
  }

  if (deletingMissionIdsRef.current.has(id)) return

  deletingMissionIdsRef.current.add(id)

  // optimistic UI update
  setMissions((prev) => prev.filter((m) => m.id !== id))

  try {
    const url = '/api/agent/missions/delete'
    console.log('[FETCH CALL]', { url, missionId: id })
    await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    deletedMissionIdsRef.current.add(id)
    setMissions((prev) => prev.filter((m) => m.id !== id))
    prevLeadCountsRef.current.delete(id)
    prevStatusesRef.current.delete(id)
    router.replace('/agent')
    router.refresh()
    await fetchMissions(false)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return
    }

    console.error('[agent] fetch failed', { url: '/api/agent/missions/delete', missionId: id, err })
    await fetchMissions(false)
  } finally {
    deletingMissionIdsRef.current.delete(id)
  }
}

  // ─── Derived ──────────────────────────────────────────────────────────────

  const carouselMissions = missions.filter(
    (m) => m.status !== 'archived',
  )

  const coreLabel = computeCoreLabel(missions, newLeadActive)
  const showWarning = fetchError && !fetchErrorDismissed

  // ─── Render ───────────────────────────────────────────────────────────────

  if (profileLoading) {
    return (
      <DashboardShell adminEmail={null} hideBottomNav>
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell adminEmail={null} hideBottomNav>
      <div
        className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-10 lg:-mt-8"
        style={{
          position: 'relative',
          minHeight: 'calc(100vh - 64px)',
          // Calm, static background — no animated gradients
          background:
            'radial-gradient(ellipse 65% 50% at 50% 36%, rgba(59,130,246,0.07) 0%, transparent 65%), #020617',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── New Mission CTA — top-right ───────────────────────────────── */}
        <button
          type="button"
          onClick={handleNewMissionClick}
          className="absolute right-6 top-6 z-20 flex cursor-pointer items-center gap-2 rounded-full border border-blue-500/22 bg-[rgba(8,13,28,0.80)] px-5 py-2 text-[12px] font-medium text-white/65 backdrop-blur transition-all hover:border-blue-400/38 hover:text-white/88 hover:shadow-[0_0_18px_rgba(59,130,246,0.14)]"
          style={{ letterSpacing: '0.04em' }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: '1px solid rgba(96,165,250,0.30)',
              fontSize: 14,
              lineHeight: 1,
              color: 'rgba(96,165,250,0.72)',
            }}
          >
            +
          </span>
          New Mission
        </button>

        {/* ── Loading ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400/50" />
          </div>
        ) : (
          <>
            {/* ── Core — centered vertically in upper portion ────────────── */}
            <div
              style={{
                position: 'absolute',
                top: carouselMissions.length > 0 ? '42%' : '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                transition: 'top 0.5s ease',
              }}
            >
              <Core
                size={coreSize}
                label={coreLabel}
                pulseKey={pulseKey}
              />
            </div>

            {/* ── Empty state CTA ───────────────────────────────────────── */}
            {missions.length === 0 && !fetchError && (
              <div
                style={{
                  position: 'absolute',
                  top: `calc(50% + ${coreSize / 2 + 28}px)`,
                  left: '50%',
                  transform: 'translateX(-50%)',
                }}
              >
                <button
                  type="button"
                  className="cursor-pointer rounded-full border border-blue-500/18 bg-blue-500/[0.06] px-6 py-2.5 text-[12px] font-medium text-blue-200/65 transition hover:border-blue-400/32 hover:text-blue-100/85"
                  style={{ letterSpacing: '0.06em', backdropFilter: 'blur(8px)' }}
                  onClick={handleNewMissionClick}
                >
                  Create your first mission
                </button>
              </div>
            )}

            {/* ── Fetch warning ─────────────────────────────────────────── */}
            {showWarning && (
              <FetchWarningBanner
                onRetry={handleRetry}
                onDismiss={() => setFetchErrorDismissed(true)}
              />
            )}

            {/* ── Mission stage — pinned to bottom ─────────────────────── */}
            {carouselMissions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'max(28px, calc(env(safe-area-inset-bottom) + 20px))',
                  left: 0,
                  right: 0,
                }}
              >
                <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
                  <p
                    style={{
                      textAlign: 'center',
                      fontSize: 9.5,
                      fontWeight: 500,
                      letterSpacing: '0.18em',
                      color: 'rgba(255,255,255,0.16)',
                      textTransform: 'uppercase',
                      marginBottom: 14,
                    }}
                  >
                    Mission Control Stage
                  </p>

                  <MissionStage
                    missions={carouselMissions}
                    onSelect={handleMissionSelect}
                    onCreateMission={handleNewMissionClick}
                    onDeleteMission={handleDeleteMission}
                    highlightedMissionId={highlightedMissionId}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DevOverlay
        authOk={authOk}
        loading={loading}
        fetchError={fetchError}
        count={missions.length}
        lastEvent={lastEventDisplay}
      />
    </DashboardShell>
  )
}
