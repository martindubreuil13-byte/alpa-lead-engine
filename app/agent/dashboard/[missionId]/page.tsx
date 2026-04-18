'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronRight,
  Clock,
  Mail,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import { useSound } from '@/lib/sound/useSound'

// ─── Types ───────────────────────────────────────────────────────────────────

type ActivityItem = {
  id: string
  business_name: string | null
  website: string | null
  email: string | null
  location: string | null
  created_at: string
}

type OutreachItem = {
  id: string
  company_name: string | null
  review_status: 'draft' | 'approved' | 'sent' | 'rejected'
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
  cta: string | null
  sender_signature: string | null
  last_run_at: string | null
  last_run_status: string | null
  last_stop_reason: string | null
  next_run_at: string | null
  schedule_timezone: string
  schedule_local_time: string
  created_at: string
}

type MissionRunData = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  stop_reason: string | null
  accepted_count: number
  drafts_generated_count: number
  started_at: string | null
  finished_at: string | null
}

type StatusData = {
  mission: MissionData
  latestRun: MissionRunData | null
  leadsToday: number
  totalLeads: number
  leads_count: number
  emailsReady: number
  emailsApproved: number
  emailsRejected: number
  recentActivity: ActivityItem[]
  recentOutreach: OutreachItem[]
}

type FeedLine = {
  id: string
  text: string
  kind: 'round' | 'lead' | 'email' | 'system'
  ts?: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCAN_MESSAGES = [
  'Scanning directories...',
  'Discovering contacts...',
  'Enriching company data...',
  'Validating emails...',
  'Qualifying matches...',
  'Building your pipeline...',
]

const IDLE_MESSAGES = [
  'Analyzing new sources...',
  'Enriching profiles...',
  'Writing outreach...',
  'Processing leads...',
  'Scanning directories...',
]

const GEN_MESSAGES = [
  'Analyzing website...',
  'Crafting opening line...',
  'Personalizing message...',
  'Adjusting tone...',
  'Finalizing draft...',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function nextRunLabel(iso: string): string {
  const d = new Date(iso)
  const diffMs = d.getTime() - Date.now()
  if (diffMs <= 0) return 'soon'
  const h = diffMs / 3_600_000
  if (h < 20) return `in ${Math.round(h)}h`
  const timeStr = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
  const days = Math.round(h / 24)
  return days === 1 ? `tomorrow at ${timeStr}` : `in ${days}d`
}

function getMissionTitle(m: MissionData): string {
  if (m.name) return m.name
  const parts = [m.audience_input, m.location_input || m.location].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Lead Mission'
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MissionDashboardPage() {
  const params = useParams()
  const router = useRouter()
  const missionId = String(params.missionId)

  // ── Server state
  const [status, setStatus] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // ── Execution state
  // runInitiated: optimistic flag — set when user clicks Run, cleared when DB
  // confirms the run has started (queued/running) or failed to start.
  const [runInitiated, setRunInitiated] = useState(false)
  const [round, setRound] = useState(0)
  const [msgIndex, setMsgIndex] = useState(0)
  const [idleIndex, setIdleIndex] = useState(0)
  const [genIndex, setGenIndex] = useState(0)
  const [genCompanyIdx, setGenCompanyIdx] = useState(0)
  // triggerInFlightRef: prevents duplicate HTTP calls while one is in-flight
  const triggerInFlightRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const idleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const genRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const genCompRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isGeneratingRef = useRef(false)

  // ── Derived run state (computed early so effects below can reference it) ──
  // isRunActive drives: polling, Run button lock, animated messages.
  // It is true when the DB says a run is queued/running, OR when the user just
  // clicked Run but the first poll hasn't confirmed it yet (runInitiated).
  const latestRunStatus = status?.latestRun?.status ?? null
  const isRunActive = latestRunStatus === 'running' || latestRunStatus === 'queued' || runInitiated

  // ── Sound
  const sound = useSound()
  const prevMissionStatus = useRef<string | null>(null)

  // ── Feed state
  const [feed, setFeed] = useState<FeedLine[]>([])
  const prevActivityIds = useRef(new Set<string>())
  const prevOutreachIds = useRef(new Set<string>())

  // ── Animated email count
  const [displayedEmails, setDisplayedEmails] = useState(0)
  const emailCountRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Action state
  const [toggling, setToggling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ── Edit panel state
  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState('')
  const [editCta, setEditCta] = useState('')
  const [editSignature, setEditSignature] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // ── Message rotation
  useEffect(() => {
    if (isRunActive) {
      msgRef.current = setInterval(() => setMsgIndex((i) => (i + 1) % SCAN_MESSAGES.length), 2200)
    } else {
      if (msgRef.current) clearInterval(msgRef.current)
    }
    return () => { if (msgRef.current) clearInterval(msgRef.current) }
  }, [isRunActive])

  useEffect(() => {
    const missionActive = status?.mission.status === 'active' || status?.mission.status === 'scheduled'
    if (missionActive && !isRunActive) {
      idleRef.current = setInterval(() => setIdleIndex((i) => (i + 1) % IDLE_MESSAGES.length), 2000)
    } else {
      if (idleRef.current) clearInterval(idleRef.current)
    }
    return () => { if (idleRef.current) clearInterval(idleRef.current) }
  }, [isRunActive, status?.mission.status])

  useEffect(() => {
    const totalOutreach = (status?.emailsReady ?? 0) + (status?.emailsApproved ?? 0) + (status?.emailsRejected ?? 0)
    const isGen =
      (status?.leadsToday ?? 0) > 0 &&
      (status?.mission.status === 'active' || status?.mission.status === 'scheduled') &&
      totalOutreach < (status?.leadsToday ?? 0)

    isGeneratingRef.current = isGen

    if (isGen) {
      genRef.current = setInterval(() => setGenIndex((i) => (i + 1) % GEN_MESSAGES.length), 1800)
      genCompRef.current = setInterval(() => setGenCompanyIdx((i) => i + 1), 1500)
    } else {
      if (genRef.current) clearInterval(genRef.current)
      if (genCompRef.current) clearInterval(genCompRef.current)
    }
    return () => {
      if (genRef.current) clearInterval(genRef.current)
      if (genCompRef.current) clearInterval(genCompRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.emailsReady, status?.emailsApproved, status?.emailsRejected, status?.leadsToday, status?.mission.status])

  // ── Animated email counter
  useEffect(() => {
    const target = status?.emailsReady ?? 0
    if (emailCountRef.current) clearInterval(emailCountRef.current)
    setDisplayedEmails((prev) => (target < prev ? target : prev))
    emailCountRef.current = setInterval(() => {
      setDisplayedEmails((prev) => {
        if (prev >= target) {
          if (emailCountRef.current) clearInterval(emailCountRef.current)
          return target
        }
        return prev + 1
      })
    }, 600)
    return () => { if (emailCountRef.current) clearInterval(emailCountRef.current) }
  }, [status?.emailsReady])

  // ── Fetch status
  const fetchStatus = useCallback(async (): Promise<StatusData | null> => {
    try {
      const res = await fetch(`/api/agent/mission-status?missionId=${missionId}`)
      if (!res.ok) {
        if (res.status === 404) {
          if (pollRef.current) clearInterval(pollRef.current)
          router.push('/agent')
          return null
        }
        setFetchError('Mission unavailable.')
        return null
      }
      const data = (await res.json()) as StatusData

      if (!data.mission || data.mission.status === 'deleted') {
        if (pollRef.current) clearInterval(pollRef.current)
        router.push('/agent')
        return null
      }

      setStatus(data)
      setFetchError(null)

      // Clear optimistic initiated flag once DB confirms run is no longer active.
      // This ensures isRunActive drops to false when the run finishes, stopping polling.
      const dbRunStatus = data.latestRun?.status ?? null
      if (dbRunStatus !== 'running' && dbRunStatus !== 'queued') {
        setRunInitiated(false)
      }

      // Sound: latest run finished with useful output
      const newSt = data.latestRun?.status ?? data.mission.status
      const prevSt = prevMissionStatus.current
      if (
        (newSt === 'completed' || newSt === 'partial') &&
        prevSt !== 'completed' && prevSt !== 'partial'
      ) {
        sound.play('complete')
      }
      prevMissionStatus.current = newSt

      // Feed: new accepted leads
      const newLeads = (data.recentActivity || []).filter((a) => !prevActivityIds.current.has(a.id))
      if (newLeads.length > 0) {
        sound.play('lead')
        const now = Date.now()
        const lines: FeedLine[] = newLeads.flatMap((a) => {
          const base: FeedLine[] = [{
            id: crypto.randomUUID(),
            text: `${a.business_name || a.website || 'Contact discovered'}${a.location ? ` · ${a.location}` : ''}`,
            kind: 'lead',
            ts: now,
          }]
          if (a.email) base.push({ id: crypto.randomUUID(), text: 'Email verified', kind: 'email', ts: now })
          return base
        })
        setFeed((prev) => [...lines, ...prev].slice(0, 60))
        newLeads.forEach((a) => prevActivityIds.current.add(a.id))
      }

      // Feed: new outreach
      const newOut = (data.recentOutreach || []).filter((o) => !prevOutreachIds.current.has(o.id))
      if (newOut.length > 0) {
        const now = Date.now()
        const lines: FeedLine[] = newOut.map((o) => ({
          id: crypto.randomUUID(),
          text: o.review_status === 'approved'
            ? `Message approved · ${o.company_name ?? 'Lead'}`
            : `Message drafted for ${o.company_name ?? 'lead'}`,
          kind: 'email',
          ts: now,
        }))
        setFeed((prev) => [...lines, ...prev].slice(0, 60))
        newOut.forEach((o) => prevOutreachIds.current.add(o.id))
      }

      return data
    } catch {
      setFetchError('Connection error.')
      sound.play('error')
      return null
    } finally {
      setLoading(false)
    }
  }, [missionId, router, sound])

  // ── Trigger run
  // Fire-and-forget: we POST to run-mission and immediately mark the run as
  // initiated (runInitiated=true). This causes isRunActive→true, which starts
  // the polling interval (see smart-poll effect). The polling then tracks the
  // actual run status from the DB and stops when it finishes.
  const triggerMission = useCallback(async () => {
    // Prevent duplicate calls while one is in-flight or a run is already active
    if (triggerInFlightRef.current || isRunActive) return
    triggerInFlightRef.current = true

    setRunInitiated(true)
    setActionError(null)
    sound.play('start')
    setRound((r) => {
      const next = r + 1
      setFeed((prev) => [
        { id: crypto.randomUUID(), text: `Search round ${next} started`, kind: 'round' as const, ts: Date.now() },
        ...prev,
      ].slice(0, 60))
      return next
    })

    try {
      const res = await fetch('/api/agent/run-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      })
      if (!res.ok) {
        console.warn('[triggerMission] run-mission responded with', res.status)
        // Revert optimistic state on failure — polling will not start
        setRunInitiated(false)
        setActionError('Failed to start run. Please try again.')
      }
      // On success: isRunActive is true → smart-poll effect starts 5s interval.
      // fetchStatus will be called by that interval and will update status from DB.
    } catch (err) {
      console.warn('[triggerMission] fetch failed', err)
      setRunInitiated(false)
      setActionError('Connection error. Please try again.')
    } finally {
      triggerInFlightRef.current = false
    }
  }, [missionId, isRunActive, sound])

  // ── fetchStatusRef: always points to latest fetchStatus without being a dep
  const fetchStatusRef = useRef(fetchStatus)
  fetchStatusRef.current = fetchStatus

  // ── Initial fetch: once on mount / missionId change
  useEffect(() => {
    void fetchStatusRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId])

  // ── Smart polling: only active while isRunActive is true
  // When the run finishes, fetchStatus sets runInitiated=false → isRunActive
  // becomes false → this effect clears the interval automatically.
  // This prevents the infinite polling loop that occurred with unconditional polling.
  useEffect(() => {
    if (!isRunActive) {
      // Run is not active — ensure no stale interval is running
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    // Run is active — start polling every 5s
    if (pollRef.current) clearInterval(pollRef.current)   // clear any stale interval first
    pollRef.current = setInterval(() => void fetchStatusRef.current(), 5_000)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [isRunActive])

  // ── Seed edit fields when panel opens
  useEffect(() => {
    if (editOpen && status?.mission) {
      setEditTarget(String(status.mission.daily_target ?? ''))
      setEditCta(status.mission.cta ?? '')
      setEditSignature(status.mission.sender_signature ?? '')
    }
  }, [editOpen, status?.mission])

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function handleToggle() {
    if (!status || toggling) return
    const newStatus =
      status.mission.status === 'active' || status.mission.status === 'scheduled'
        ? 'paused'
        : 'active'
    setToggling(true)
    setActionError(null)
    try {
      const res = await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, status: newStatus }),
      })
      if (res.ok) {
        setStatus((prev) => prev ? { ...prev, mission: { ...prev.mission, status: newStatus } } : prev)
      }
    } catch {
      setActionError('Action failed.')
    } finally {
      setToggling(false)
    }
  }

  async function handleStop() {
    if (toggling) return
    setToggling(true)
    setActionError(null)
    try {
      const res = await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, status: 'archived' }),
      })
      if (res.ok) {
        setStatus((prev) => prev ? { ...prev, mission: { ...prev.mission, status: 'archived' } } : prev)
        setConfirmStop(false)
      }
    } catch {
      setActionError('Action failed.')
    } finally {
      setToggling(false)
    }
  }

  async function handleDelete() {
    if (toggling) return
    setToggling(true)
    setActionError(null)
    console.log('[MISSION DELETE]', missionId)
    try {
      const res = await fetch('/api/agent/missions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: missionId }),
      })
      if (res.ok) {
        router.push('/agent')
      } else {
        setActionError('Delete failed.')
        setToggling(false)
      }
    } catch {
      setActionError('Action failed.')
      setToggling(false)
    }
  }

  async function handleRelaunch() {
    if (toggling) return
    setToggling(true)
    setActionError(null)
    try {
      // Reactivate + clear completed state
      const res = await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, status: 'active', next_run_at: new Date().toISOString() }),
      })
      if (res.ok) {
        await fetchStatus()
      }
    } catch {
      setActionError('Relaunch failed.')
    } finally {
      setToggling(false)
    }
  }

  async function handleSaveEdit() {
    if (!status?.mission || editSaving) return
    const target = parseInt(editTarget, 10)
    if (isNaN(target) || target < 1) return

    setEditSaving(true)
    try {
      const res = await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId,
          daily_target: target,
          cta: editCta.trim() || null,
          sender_signature: editSignature.trim() || null,
        }),
      })
      if (res.ok) {
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                mission: {
                  ...prev.mission,
                  daily_target: target,
                  cta: editCta.trim() || null,
                  sender_signature: editSignature.trim() || null,
                },
              }
            : prev
        )
        setEditOpen(false)
      }
    } finally {
      setEditSaving(false)
    }
  }

  // ─── Derived ─────────────────────────────────────────────────────────────

  const mission = status?.mission
  // Note: latestRunStatus and isRunActive are declared early (after state) so effects can use them.
  const isActive = mission?.status === 'active'
  const isScheduled = mission?.status === 'scheduled'
  const isPaused = mission?.status === 'paused'
  const isArchived = mission?.status === 'archived'
  const isCompleted = latestRunStatus === 'completed'
  const isPartial = latestRunStatus === 'partial'
  const isFailed = latestRunStatus === 'failed'
  // isRunQueuedOrRunning = isRunActive (same value, kept for JSX readability)
  const isRunQueuedOrRunning = isRunActive

  // Authoritative lead count: real-time queue count > stale run field
  const displayedLeads = status?.leads_count ?? status?.latestRun?.accepted_count ?? 0

  const totalOutreach = (status?.emailsReady ?? 0) + (status?.emailsApproved ?? 0) + (status?.emailsRejected ?? 0)
  const targetReached = !!mission && (status?.leadsToday ?? 0) >= mission.daily_target
  const isGenerating = targetReached && totalOutreach < (status?.leadsToday ?? 0) && (isActive || isScheduled)
  const isOutreachComplete = targetReached && totalOutreach >= (status?.leadsToday ?? 0) && totalOutreach > 0
  const isReviewReady = displayedEmails > 0 || totalOutreach > 0
  const isNoResults = status?.latestRun?.stop_reason === 'no_accepted_leads'

  const rawGenerating = Math.max((status?.leadsToday ?? 0) - totalOutreach, 0)
  // Show optimistic "1 generating" only while runInitiated is true and no real count yet
  const emailsGenerating = runInitiated && rawGenerating === 0 && (status?.leadsToday ?? 0) > 0 ? 1 : rawGenerating

  const progress = mission
    ? Math.min(100, Math.round(((status?.leadsToday ?? 0) / Math.max(1, mission.daily_target)) * 100))
    : 0

  const genCompanies = (status?.recentActivity ?? []).map((a) => a.business_name).filter(Boolean) as string[]
  const currentGenCompany = genCompanies.length > 0 ? genCompanies[genCompanyIdx % genCompanies.length] : null

  // ─── Loading / Error ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
        </div>
      </DashboardShell>
    )
  }

  if (fetchError || !status || !mission) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-sm text-slate-400">{fetchError ?? 'Mission not found.'}</p>
          <button
            type="button"
            onClick={() => router.replace('/agent')}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 transition hover:text-white"
          >
            Back to Agent
          </button>
        </div>
      </DashboardShell>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <DashboardShell adminEmail={null}>
      <div className="relative mx-auto w-full max-w-2xl space-y-4 px-4 pb-32 pt-6 sm:pb-10">

        {/* Ambient glow */}
        <div className="pointer-events-none absolute -top-10 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(59,130,246,0.07),transparent_65%)] blur-[80px]" />

        {/* ── Back nav + sound toggle ── */}
        <div className="flex items-center justify-between">
          <Link
            href="/agent"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 transition hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All missions
          </Link>
          <button
            type="button"
            onClick={sound.toggle}
            title={sound.enabled ? 'Mute sound feedback' : 'Enable sound feedback'}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] text-slate-600 transition hover:border-white/10 hover:text-slate-400"
          >
            {sound.enabled
              ? <Volume2 className="h-3.5 w-3.5" />
              : <VolumeX className="h-3.5 w-3.5" />
            }
          </button>
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* MISSION CONTROL BANNER                                          */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div
          className={`relative overflow-hidden rounded-2xl border p-5 transition ${
            isActive || isScheduled
              ? 'border-emerald-400/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.05),rgba(59,130,246,0.04))]'
              : isCompleted
              ? 'border-blue-400/15 bg-blue-500/[0.04]'
              : isPartial
              ? 'border-violet-400/20 bg-violet-500/[0.05]'
              : isPaused
              ? 'border-amber-400/15 bg-amber-500/[0.04]'
              : isFailed
              ? 'border-orange-400/15 bg-orange-500/[0.04]'
              : 'border-white/[0.07] bg-white/[0.02]'
          }`}
        >
          {/* Breathing glow overlay (active only) */}
          {(isActive || isScheduled) && (
            <div className="mission-glow-breathe pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_50%_0%,rgba(16,185,129,0.12),transparent_65%)]" />
          )}

          {/* Live ping (active only) */}
          {(isActive || isScheduled) && (
            <div className="absolute right-5 top-5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
            </div>
          )}

          {/* Status label */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(isActive || isScheduled) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                {isScheduled ? 'Scheduled' : 'Active'}
              </span>
            )}
            {isPaused && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Paused
              </span>
            )}
            {isArchived && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/30 bg-slate-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                Archived
              </span>
            )}
            {isFailed && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                Last Run Failed
              </span>
            )}
            {isReviewReady && !isRunQueuedOrRunning && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                Review Ready
              </span>
            )}
            {isCompleted && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                Run Complete
              </span>
            )}
            {isRunQueuedOrRunning && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-blue-400" />
                Running
              </span>
            )}
          </div>

          {/* Mission title */}
          <h1 className="text-xl font-semibold tracking-tight text-white">
            {getMissionTitle(mission)}
          </h1>
          {(mission.audience_input || mission.location_input) && (
            <p className="mt-1 text-sm text-slate-500">
              {[mission.audience_input, mission.location_input || mission.location].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Live status line */}
          {(isActive || isScheduled) && !isCompleted && (
            <p className="mt-2.5 text-xs text-slate-500">
              {isRunQueuedOrRunning
                ? SCAN_MESSAGES[msgIndex]
                : IDLE_MESSAGES[idleIndex]}
            </p>
          )}
          {(isCompleted || isPartial || isFailed || isActive || isScheduled) && mission.next_run_at && (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3 w-3" />
              Next run {nextRunLabel(mission.next_run_at)}
            </p>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* MISSION FLOW — 4-step progress chain                           */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2">
          {[
            {
              label: 'Target set',
              sublabel: `${mission.daily_target} leads/day`,
              done: true,
              active: false,
            },
            {
              label: 'Discovered',
              sublabel: `${status.leadsToday} found`,
              done: (status.leadsToday ?? 0) > 0,
              active: isRunActive,
            },
            {
              label: 'Qualified',
              sublabel: `${displayedLeads} total`,
              done: displayedLeads > 0,
              active: isRunActive && (status.leadsToday ?? 0) > 0,
            },
            {
              label: 'Messages',
              sublabel: `${displayedEmails} ready`,
              done: displayedEmails > 0,
              active: isGenerating || (runInitiated && !isOutreachComplete),
            },
          ].map(({ label, sublabel, done, active }, i) => (
            <div
              key={label}
              className={`rounded-2xl border p-3 text-center transition ${
                active
                  ? 'border-blue-400/25 bg-blue-500/[0.07] shadow-[0_0_20px_rgba(59,130,246,0.08)]'
                  : done
                  ? 'border-white/[0.08] bg-white/[0.03]'
                  : 'border-white/[0.04] bg-white/[0.01]'
              }`}
            >
              {/* Step number + done check */}
              <div className="mb-1.5 flex justify-center">
                {done ? (
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${active ? 'bg-blue-400/20' : 'bg-emerald-400/20'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? 'animate-pulse bg-blue-400' : 'bg-emerald-400'}`} />
                  </span>
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/[0.04]">
                    <span className="text-[9px] font-bold text-slate-700">{i + 1}</span>
                  </span>
                )}
              </div>
              <div className={`text-[10px] font-semibold leading-none ${done ? 'text-slate-300' : 'text-slate-700'}`}>
                {label}
              </div>
              <div className={`mt-1 text-[10px] tabular-nums ${done ? 'text-slate-500' : 'text-slate-700'}`}>
                {sublabel}
              </div>
            </div>
          ))}
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* METRICS GRID                                                    */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Leads today */}
          <div className="glass rounded-2xl p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Today</div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tabular-nums text-white">{status.leadsToday}</span>
              <span className="text-sm text-slate-600">/ {mission.daily_target}</span>
            </div>
            {/* Micro progress */}
            <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#3b82f6,#818cf8)] transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Total leads */}
          <div className="glass rounded-2xl p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Total</div>
            <div className="mt-2">
              <span className="text-3xl font-semibold tabular-nums text-white">{displayedLeads}</span>
            </div>
            <div className="mt-2 text-[10px] text-slate-700">leads collected</div>
          </div>

          {/* Messages ready */}
          <div className={`glass rounded-2xl p-4 transition ${displayedEmails > 0 ? 'border-violet-400/15 shadow-[0_0_20px_rgba(139,92,246,0.07)]' : ''}`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Messages</div>
            <div className="mt-2">
              {emailsGenerating > 0 && displayedEmails === 0 ? (
                <span className="text-sm font-medium text-violet-400">Crafting...</span>
              ) : (
                <span className={`text-3xl font-semibold tabular-nums ${displayedEmails > 0 ? 'text-violet-300' : 'text-white'}`}>
                  {displayedEmails}
                </span>
              )}
            </div>
            <div className="mt-2 text-[10px] text-slate-700">ready to review</div>
          </div>

          {/* Approved */}
          <div className="glass rounded-2xl p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Approved</div>
            <div className="mt-2">
              <span className={`text-3xl font-semibold tabular-nums ${status.emailsApproved > 0 ? 'text-emerald-400' : 'text-white'}`}>
                {status.emailsApproved}
              </span>
            </div>
            <div className="mt-2 text-[10px] text-slate-700">messages sent/approved</div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* GENERATING STATE                                                */}
        {/* ─────────────────────────────────────────────────────────────── */}
        {(isGenerating || (runInitiated && !isOutreachComplete)) && (
          <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4">
            <div className="flex items-start gap-3">
              <span className="relative mt-0.5 flex h-4 w-4 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-40" />
                <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-400/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                </span>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-violet-200">Crafting conversations...</p>
                <p className="mt-0.5 text-xs text-slate-600">{GEN_MESSAGES[genIndex % GEN_MESSAGES.length]}</p>
                {currentGenCompany && (
                  <p className="mt-0.5 text-xs text-slate-600">
                    Writing to <span className="text-slate-400">{currentGenCompany}</span>
                  </p>
                )}
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-violet-300">
                {emailsGenerating}
              </span>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* OUTREACH CTA                                                    */}
        {/* ─────────────────────────────────────────────────────────────── */}
        {(isOutreachComplete || displayedEmails > 0) && (
          <div className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[linear-gradient(135deg,rgba(139,92,246,0.07),rgba(59,130,246,0.05))] shadow-[0_0_40px_rgba(139,92,246,0.10)]">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10">
                  <Mail className="h-4 w-4 text-violet-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {displayedEmails} message{displayedEmails !== 1 ? 's' : ''} ready
                  </p>
                  <p className="text-xs text-slate-500">Review, approve, and send</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push('/dashboard/outreach')}
                className="flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/12 px-4 py-2.5 text-sm font-semibold text-violet-200 shadow-[0_0_20px_rgba(139,92,246,0.18)] transition hover:bg-violet-500/20 hover:text-white"
              >
                Review
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Needs review fallback */}
        {isPartial && !isOutreachComplete && displayedEmails === 0 && (
          <div className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-5">
            <p className="text-sm font-semibold text-white">Run finished</p>
            <p className="mt-1 text-xs text-slate-500">
              This run collected leads but has not hit the full daily quota yet. Check the outreach queue for ready drafts.
            </p>
            <button
              type="button"
              onClick={() => router.push('/dashboard/outreach')}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 transition hover:text-white"
            >
              Open queue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Exhausted CTA */}
        {isNoResults && (
          <div className="overflow-hidden rounded-2xl border border-orange-400/20 bg-[linear-gradient(135deg,rgba(249,115,22,0.06),rgba(234,88,12,0.04))]">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-400/20 bg-orange-500/10">
                  <AlertTriangle className="h-4 w-4 text-orange-300" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white">No accepted leads this run</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    The deterministic pipeline ran, filtered to email-valid leads, and did not find enough new matches. Refine the audience, location, or ICP variants to widen the search pool.
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-orange-400/20 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-200 transition hover:bg-orange-500/18 hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Mission
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* ACTIVITY TIMELINE                                               */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className="glass overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.05] px-5 py-4">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Activity
            </span>
            {(feed.length > 0 || status.recentActivity.length > 0) && (
              <span className="text-[11px] text-slate-700">
                {status.recentActivity.length} leads
              </span>
            )}
          </div>

          {/* Live feed */}
          {feed.length > 0 && (
            <div className="divide-y divide-white/[0.03]">
              {feed.slice(0, 6).map((line, index) => (
                <div key={`${line.id}-${index}`} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      line.kind === 'round' ? 'bg-blue-400/50' :
                      line.kind === 'email' ? 'bg-violet-400/60' :
                      line.kind === 'lead' ? 'bg-emerald-400/50' :
                      'bg-slate-600'
                    }`}
                  />
                  <span
                    className={`flex-1 truncate text-xs ${
                      line.kind === 'round' ? 'font-medium text-blue-300/70' :
                      line.kind === 'email' ? 'text-violet-300/80' :
                      'text-slate-400'
                    }`}
                  >
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Historical leads */}
          {status.recentActivity.length > 0 ? (
            <div className="divide-y divide-white/[0.03]">
              {status.recentActivity.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.03]">
                    <Zap className="h-3 w-3 text-slate-600" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {item.business_name || item.website || 'Unknown'}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {item.email && (
                        <span className="rounded-md border border-emerald-400/15 bg-emerald-500/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                          email
                        </span>
                      )}
                      {item.location && (
                        <span className="text-[11px] text-slate-600">{item.location}</span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-700">
                    {relativeTime(item.created_at)}
                  </span>
                </div>
              ))}
            </div>
          ) : feed.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-slate-600">
                {isActive && isRunActive
                  ? 'Searching now...'
                  : isActive || isScheduled
                  ? IDLE_MESSAGES[idleIndex]
                  : isPaused
                  ? 'Resume to continue searching.'
                  : isArchived
                  ? 'This mission has been archived.'
                  : isNoResults
                  ? 'Last run finished without accepted leads.'
                  : 'Waiting to start.'}
              </p>
            </div>
          ) : null}
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* MISSION CONTROLS                                                */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-600">
            Controls
          </div>

          {actionError && (
            <div className="rounded-xl border border-red-400/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300">
              {actionError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {/* Run — explicit user-controlled trigger */}
            {(isActive || isScheduled) && !isRunQueuedOrRunning && (
              <button
                type="button"
                onClick={() => void triggerMission()}
                disabled={toggling}
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.09] px-4 py-2.5 text-sm font-semibold text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.10)] transition hover:text-white disabled:opacity-40"
              >
                <Zap className="h-3.5 w-3.5" />
                Run Now
              </button>
            )}
            {(isActive || isScheduled) && isRunQueuedOrRunning && (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] px-4 py-2.5 text-sm font-medium text-emerald-400/60">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Running…
              </div>
            )}

            {/* Pause / Resume — always shown when mission can be toggled */}
            {!isArchived && !isRunQueuedOrRunning && (
              <button
                type="button"
                onClick={() => void handleToggle()}
                disabled={toggling}
                className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:opacity-40 ${
                  isActive || isScheduled
                    ? 'border-white/[0.08] bg-white/[0.03] text-slate-300 hover:text-white'
                    : 'border-emerald-400/20 bg-emerald-500/[0.07] text-emerald-300 hover:text-white'
                }`}
              >
                {isActive || isScheduled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isActive || isScheduled ? 'Pause' : 'Resume'}
              </button>
            )}

            {/* Relaunch */}
            {isArchived && (
              <button
                type="button"
                onClick={() => void handleRelaunch()}
                disabled={toggling}
                className="flex items-center justify-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/[0.07] px-4 py-2.5 text-sm font-medium text-blue-300 transition hover:text-white disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Relaunch
              </button>
            )}

            {/* Edit */}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-slate-400 transition hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>

            {/* Review messages shortcut */}
            {displayedEmails > 0 && (
              <button
                type="button"
                onClick={() => router.push('/dashboard/outreach')}
                className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.07] px-4 py-2.5 text-sm font-medium text-violet-300 transition hover:text-white"
              >
                <Mail className="h-3.5 w-3.5" />
                Messages
              </button>
            )}

            {/* Stop — always shown when mission is running */}
            {!isArchived && !isRunQueuedOrRunning && (
              confirmStop ? (
                <div className="col-span-2 flex items-center gap-2 sm:col-span-2">
                  <span className="text-xs text-slate-500">Stop permanently?</span>
                  <button
                    type="button"
                    onClick={() => void handleStop()}
                    disabled={toggling}
                    className="rounded-xl border border-red-400/25 bg-red-500/[0.08] px-3 py-2 text-xs font-semibold text-red-300 transition hover:text-white disabled:opacity-40"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmStop(false)}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-slate-500 transition hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmStop(true)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-red-400/20 hover:text-red-400"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </button>
              )
            )}

            {/* Delete */}
            {confirmDelete ? (
              <div className="col-span-2 flex items-center gap-2 sm:col-span-2">
                <span className="text-xs text-slate-500">Delete forever?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={toggling}
                  className="rounded-xl border border-red-400/25 bg-red-500/[0.08] px-3 py-2 text-xs font-semibold text-red-300 transition hover:text-white disabled:opacity-40"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-slate-500 transition hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-red-400/20 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>

          {/* Automation indicator */}
          {(isActive || isScheduled || isCompleted || isPartial || isFailed) && mission.next_run_at && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-400/15 bg-blue-500/[0.05] px-4 py-3">
              <Calendar className="h-4 w-4 shrink-0 text-blue-400/60" />
              <div className="flex-1 text-xs text-slate-500">
                Scheduled to run {nextRunLabel(mission.next_run_at)}
              </div>
              <button
                type="button"
                onClick={async () => {
                  await fetch('/api/agent/missions/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ missionId, next_run_at: null }),
                  })
                  setStatus((prev) =>
                    prev ? { ...prev, mission: { ...prev.mission, next_run_at: null } } : prev
                  )
                }}
                className="text-[11px] text-slate-600 transition hover:text-red-400"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between pt-2 text-sm">
          <Link href="/agent" className="text-slate-600 transition hover:text-slate-400">
            ← Missions
          </Link>
          <Link href="/agent/setup" className="text-slate-600 transition hover:text-slate-400">
            New mission
          </Link>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* MOBILE STICKY BOTTOM BAR (active mission quick actions)           */}
      {/* ────────────────────────────────────────────────────────────────── */}
      {(isActive || isScheduled || isPaused) && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.06] bg-[rgba(8,12,24,0.92)] px-4 py-3 backdrop-blur-xl sm:hidden">
          <div className="mx-auto flex max-w-sm items-center justify-between gap-3">
            {/* Run button — explicit trigger, active missions only */}
            {(isActive || isScheduled) && !isRunQueuedOrRunning && (
              <button
                type="button"
                onClick={() => void triggerMission()}
                disabled={toggling}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.09] py-3 text-sm font-semibold text-emerald-300 transition disabled:opacity-40"
              >
                <Zap className="h-4 w-4" />
                Run
              </button>
            )}
            {(isActive || isScheduled) && isRunQueuedOrRunning && (
              <div className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] py-3 text-sm font-medium text-emerald-400/60">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Running…
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleToggle()}
              disabled={toggling}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition disabled:opacity-40 ${
                isActive || isScheduled
                  ? 'border-amber-400/20 bg-amber-500/[0.08] text-amber-300'
                  : 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300'
              }`}
            >
              {isActive || isScheduled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isActive || isScheduled ? 'Pause' : 'Resume'}
            </button>
            {displayedEmails > 0 && (
              <button
                type="button"
                onClick={() => router.push('/dashboard/outreach')}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/[0.08] py-3 text-sm font-semibold text-violet-300 transition"
              >
                <Mail className="h-4 w-4" />
                {displayedEmails} Ready
              </button>
            )}
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* EDIT PANEL (slide-in overlay)                                     */}
      {/* ────────────────────────────────────────────────────────────────── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setEditOpen(false)}
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl border border-white/[0.08] bg-[#0c1120] p-6 shadow-2xl sm:rounded-3xl">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Edit Mission</h2>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-400 transition hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Daily target */}
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Daily target
                </label>
                <input
                  type="number"
                  value={editTarget}
                  onChange={(e) => setEditTarget(e.target.value)}
                  min={1}
                  max={10000}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white outline-none focus:border-blue-400/40 transition"
                />
              </div>

              {/* CTA */}
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Call to action
                </label>
                <input
                  type="text"
                  value={editCta}
                  onChange={(e) => setEditCta(e.target.value)}
                  placeholder="e.g. Book a call — calendly.com/..."
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-700 outline-none focus:border-blue-400/40 transition"
                />
              </div>

              {/* Signature */}
              <div>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Email signature
                </label>
                <input
                  type="text"
                  value={editSignature}
                  onChange={(e) => setEditSignature(e.target.value)}
                  placeholder="e.g. Martin — ALPA"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-700 outline-none focus:border-blue-400/40 transition"
                />
              </div>

              {/* Save */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={editSaving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-5 py-3 text-sm font-semibold text-blue-100 shadow-[0_0_24px_rgba(59,130,246,0.14)] transition hover:bg-blue-500/18 hover:text-white disabled:opacity-40"
                >
                  {editSaving ? 'Saving...' : 'Save changes'}
                  {!editSaving && <ChevronRight className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-5 py-3 text-sm font-medium text-slate-400 transition hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </DashboardShell>
  )
}
