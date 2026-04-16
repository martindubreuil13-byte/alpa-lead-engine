'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, Mail, Pause, Play, Square, Trash2, Zap } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'

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
  completed_at: string | null
  next_run_at: string | null
  created_at: string
}

type StatusData = {
  mission: MissionData
  leadsToday: number
  totalLeads: number
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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SEARCH_MESSAGES = [
  'Searching new sources...',
  'Checking opportunities...',
  'Analyzing contact data...',
  'Processing new leads...',
  'Building your pipeline...',
  'Scanning directories...',
]

const IDLE_MESSAGES = [
  'Searching new sources...',
  'Enriching company data...',
  'Analyzing websites...',
  'Writing personalized outreach...',
  'Scanning directories...',
  'Processing new leads...',
]

const GEN_TASK_MESSAGES = [
  'Analyzing website…',
  'Extracting positioning…',
  'Crafting opening line…',
  'Personalizing message…',
  'Finalizing draft…',
  'Checking tone…',
]

const ADMIN_LEAD_LIMIT = 10_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatNextRun(isoDate: string): string {
  const d = new Date(isoDate)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  if (diffMs <= 0) return 'soon'

  const diffH = diffMs / 3_600_000
  if (diffH < 20) return `in ${Math.round(diffH)}h`

  const timeStr = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d)

  const diffDays = Math.round(diffH / 24)
  if (diffDays === 1) return `tomorrow at ${timeStr}`
  return `in ${diffDays} days at ${timeStr}`
}

function getMissionTitle(mission: MissionData): string {
  if (mission.name) return mission.name
  const parts = [mission.audience_input, mission.location_input || mission.location].filter(Boolean)
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
  const [running, setRunning] = useState(false)
  const [round, setRound] = useState(0)
  const [roundPhase, setRoundPhase] = useState<'searching' | 'complete' | 'idle'>('idle')
  const [msgIndex, setMsgIndex] = useState(0)
  const runningRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const msgRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Feed state
  const [feed, setFeed] = useState<FeedLine[]>([])
  const prevActivityIds = useRef(new Set<string>())
  const prevOutreachIds = useRef(new Set<string>())

  // ── UX enhancement state
  const [displayedEmails, setDisplayedEmails] = useState(0)
  const [idleIndex, setIdleIndex] = useState(0)
  const [genTaskIndex, setGenTaskIndex] = useState(0)
  const [genCompanyIndex, setGenCompanyIndex] = useState(0)
  // Optimistic "1 generating" shown immediately when run starts, before backend confirms
  const [optimisticGenerating, setOptimisticGenerating] = useState(false)
  const idleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const emailCounterRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const genTaskRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const genCompanyRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isGeneratingRef = useRef(false)

  // ── Control state
  const [toggling, setToggling] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // ── Search message rotation (while running)
  useEffect(() => {
    if (running) {
      msgRef.current = setInterval(() => {
        setMsgIndex((i) => (i + 1) % SEARCH_MESSAGES.length)
      }, 2500)
    } else {
      if (msgRef.current) clearInterval(msgRef.current)
    }
    return () => {
      if (msgRef.current) clearInterval(msgRef.current)
    }
  }, [running])

  // ── Idle message rotation (active but not currently running a batch)
  useEffect(() => {
    const isActive = status?.mission.status === 'active'
    if (isActive && !running) {
      idleRef.current = setInterval(() => {
        setIdleIndex((i) => (i + 1) % IDLE_MESSAGES.length)
      }, 2000)
    } else {
      if (idleRef.current) clearInterval(idleRef.current)
    }
    return () => {
      if (idleRef.current) clearInterval(idleRef.current)
    }
  }, [running, status?.mission.status])

  // ── Generation task rotation (while isGenerating)
  useEffect(() => {
    const totalOutreach =
      (status?.emailsReady ?? 0) + (status?.emailsApproved ?? 0) + (status?.emailsRejected ?? 0)
    const generating =
      (status?.leadsToday ?? 0) > 0 &&
      (status?.mission.status === 'active' || status?.mission.status === 'needs_review') &&
      (status?.leadsToday ?? 0) >= (status?.mission.daily_target ?? 1) &&
      totalOutreach < (status?.leadsToday ?? 0)

    isGeneratingRef.current = generating

    if (generating) {
      genTaskRef.current = setInterval(() => {
        setGenTaskIndex((i) => (i + 1) % GEN_TASK_MESSAGES.length)
      }, 2000)
      genCompanyRef.current = setInterval(() => {
        setGenCompanyIndex((i) => i + 1)
      }, 1500)
    } else {
      if (genTaskRef.current) clearInterval(genTaskRef.current)
      if (genCompanyRef.current) clearInterval(genCompanyRef.current)
    }
    return () => {
      if (genTaskRef.current) clearInterval(genTaskRef.current)
      if (genCompanyRef.current) clearInterval(genCompanyRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status?.emailsReady,
    status?.emailsApproved,
    status?.emailsRejected,
    status?.leadsToday,
    status?.mission.status,
    status?.mission.daily_target,
  ])

  // ── Progressive email counter — counts up to emailsReady over time
  useEffect(() => {
    const target = status?.emailsReady ?? 0
    if (emailCounterRef.current) clearInterval(emailCounterRef.current)

    // Snap down immediately if target decreased (e.g. user approved some)
    setDisplayedEmails((prev) => (target < prev ? target : prev))

    emailCounterRef.current = setInterval(() => {
      setDisplayedEmails((prev) => {
        if (prev >= target) {
          if (emailCounterRef.current) {
            clearInterval(emailCounterRef.current)
            emailCounterRef.current = null
          }
          return target
        }
        return prev + 1
      })
    }, 800)

    return () => {
      if (emailCounterRef.current) clearInterval(emailCounterRef.current)
    }
  }, [status?.emailsReady])

  // ── Fetch status from API
  const fetchStatus = useCallback(async (): Promise<StatusData | null> => {
    try {
      const res = await fetch(`/api/agent/mission-status?missionId=${missionId}`)
      if (!res.ok) {
        console.log('Mission load failed', { missionId, status: res.status })
        if (res.status === 404) {
          if (pollRef.current) clearInterval(pollRef.current)
          router.push('/agent')
          return null
        }
        setFetchError('Mission not found.')
        return null
      }
      const data = (await res.json()) as StatusData

      // Stop polling if mission was deleted
      if (!data.mission || data.mission.status === 'deleted') {
        if (pollRef.current) clearInterval(pollRef.current)
        router.push('/agent')
        return null
      }

      setStatus(data)
      setFetchError(null)

      // Detect new lead activity items and add to feed
      const newLeads = (data.recentActivity || []).filter(
        (item) => !prevActivityIds.current.has(item.id)
      )
      if (newLeads.length > 0) {
        const leadLines: FeedLine[] = newLeads.flatMap((item) => {
          const lines: FeedLine[] = [
            {
              id: `lead-${item.id}`,
              text: `Found: ${item.business_name || item.website || 'Unknown business'}${item.location ? ` · ${item.location}` : ''}`,
              kind: 'lead' as const,
            },
          ]
          if (item.email) {
            lines.push({
              id: `email-${item.id}`,
              text: 'Email detected',
              kind: 'email' as const,
            })
          }
          return lines
        })
        setFeed((prev) => [...leadLines, ...prev].slice(0, 50))
        newLeads.forEach((item) => prevActivityIds.current.add(item.id))
      }

      // Detect new outreach events and add to feed
      const newOutreach = (data.recentOutreach || []).filter(
        (item) => !prevOutreachIds.current.has(item.id)
      )
      if (newOutreach.length > 0) {
        const outreachLines: FeedLine[] = newOutreach.map((item) => {
          if (item.review_status === 'approved') {
            return {
              id: `oq-${item.id}`,
              text: `✔ Approved${item.company_name ? ` · ${item.company_name}` : ''}`,
              kind: 'email' as const,
            }
          }
          if (item.review_status === 'rejected') {
            return {
              id: `oq-${item.id}`,
              text: `✖ Rejected${item.company_name ? ` · ${item.company_name}` : ''}`,
              kind: 'system' as const,
            }
          }
          return {
            id: `oq-${item.id}`,
            text: `✉ Draft created for ${item.company_name || 'lead'}`,
            kind: 'email' as const,
          }
        })
        setFeed((prev) => [...outreachLines, ...prev].slice(0, 50))
        newOutreach.forEach((item) => prevOutreachIds.current.add(item.id))
      }

      // Inject synthetic "generating draft for…" feed events for leads without outreach yet
      const pendingLeads = (data.recentActivity || []).filter(
        (a) => a.business_name && !prevOutreachIds.current.has(`synth-${a.id}`)
      )
      const outreachCompanySet = new Set(
        (data.recentOutreach || []).map((o) => o.company_name).filter(Boolean)
      )
      const leadsNeedingDraft = pendingLeads.filter(
        (a) => a.business_name && !outreachCompanySet.has(a.business_name)
      )
      if (leadsNeedingDraft.length > 0 && isGeneratingRef.current) {
        const synthLines: FeedLine[] = leadsNeedingDraft.slice(0, 3).map((a) => ({
          id: `synth-${a.id}`,
          text: `✉ Generating draft for ${a.business_name}…`,
          kind: 'email' as const,
        }))
        setFeed((prev) => {
          // Only add synth lines that aren't already in the feed
          const existingIds = new Set(prev.map((l) => l.id))
          const newSynth = synthLines.filter((l) => !existingIds.has(l.id))
          return newSynth.length > 0 ? [...newSynth, ...prev].slice(0, 50) : prev
        })
        leadsNeedingDraft.slice(0, 3).forEach((a) => {
          prevOutreachIds.current.add(`synth-${a.id}`)
        })
      }

      return data
    } catch {
      setFetchError('Connection error.')
      return null
    } finally {
      setLoading(false)
    }
  }, [missionId])

  // ── Trigger one run-mission batch
  const triggerMission = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setOptimisticGenerating(true)
    setRound((r) => {
      const next = r + 1
      setRoundPhase('searching')
      setFeed((prev) => [
        { id: `round-${next}-start`, text: `Round ${next} in progress`, kind: 'round' as const },
        ...prev,
      ].slice(0, 50))
      return next
    })

    try {
      const res = await fetch('/api/agent/run-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      })
      const data = await res.json() as { found?: number; error?: string; status?: string }

      if (data.error === 'MISSION_NOT_ACTIVE' || (data.status && data.status !== 'active')) {
        // Let fetchStatus handle the UI update
      }
    } catch {
      // Fire-and-forget; errors are non-blocking
    } finally {
      runningRef.current = false
      setRunning(false)
      setRoundPhase('complete')
      const data = await fetchStatus()
      setOptimisticGenerating(false)

      setRound((r) => {
        setFeed((prev) => [
          { id: `round-${r}-done`, text: `Round ${r} complete`, kind: 'round' as const },
          ...prev,
        ].slice(0, 50))
        return r
      })

      if (
        data?.mission &&
        data.mission.status !== 'deleted' &&
        data.mission.status === 'active' &&
        data.leadsToday < data.mission.daily_target &&
        !runningRef.current
      ) {
        setFeed((prev) => [
          { id: `next-search-${Date.now()}`, text: 'Starting next search...', kind: 'system' as const },
          ...prev,
        ].slice(0, 50))
        setTimeout(() => {
          if (!runningRef.current) void triggerMission()
        }, 3000)
      }
    }
  }, [missionId, fetchStatus])

  // ── Bootstrap: fetch status, start loop if active (or scheduled run is due)
  useEffect(() => {
    void (async () => {
      const data = await fetchStatus()
      if (!data) return

      const isActive = data.mission.status === 'active'
      const isScheduled =
        data.mission.status === 'completed' &&
        !!data.mission.next_run_at &&
        new Date() >= new Date(data.mission.next_run_at)

      if ((isActive && data.leadsToday < data.mission.daily_target) || isScheduled) {
        void triggerMission()
      }
    })()

    pollRef.current = setInterval(() => {
      void fetchStatus()
    }, 15000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [missionId, fetchStatus, triggerMission])

  // ── Pause / Resume
  async function handleToggleStatus() {
    if (!status || toggling) return
    const newStatus = status.mission.status === 'active' ? 'paused' : 'active'
    setToggling(true)
    setActionError(null)
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
      setActionError('Action failed. Try again.')
    } finally {
      setToggling(false)
    }
  }

  // ── Stop mission
  async function handleStop() {
    if (!status || toggling) return
    setToggling(true)
    setActionError(null)
    try {
      const res = await fetch('/api/agent/missions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, status: 'stopped' }),
      })
      if (res.ok) {
        setStatus((prev) =>
          prev ? { ...prev, mission: { ...prev.mission, status: 'stopped' } } : prev
        )
        setConfirmStop(false)
      }
    } catch {
      setActionError('Action failed. Try again.')
    } finally {
      setToggling(false)
    }
  }

  // ── Delete mission
  async function handleDelete() {
    if (toggling) return
    setToggling(true)
    setActionError(null)
    try {
      const res = await fetch('/api/agent/missions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: missionId }),
      })
      if (res.ok) {
        router.push('/agent')
      } else {
        setActionError('Failed to delete mission.')
        setToggling(false)
      }
    } catch {
      setActionError('Action failed. Try again.')
      setToggling(false)
    }
  }

  // ─── Derived state ───────────────────────────────────────────────────────

  const mission = status?.mission
  const isActive = mission?.status === 'active'
  const isPaused = mission?.status === 'paused'
  const isStopped = mission?.status === 'stopped'
  const isNeedsReview = mission?.status === 'needs_review'
  const isCompleted = mission?.status === 'completed'
  const targetReached =
    status !== null &&
    mission !== undefined &&
    status.leadsToday >= mission.daily_target

  const emailsApproved = status?.emailsApproved ?? 0
  const emailsRejected = status?.emailsRejected ?? 0
  const totalOutreach = (status?.emailsReady ?? 0) + emailsApproved + emailsRejected
  // Generating: target hit but emails haven't all been generated yet
  const isGenerating =
    targetReached &&
    totalOutreach < (status?.leadsToday ?? 0) &&
    (isActive || isNeedsReview)
  // Complete: all leads have outreach generated
  const isOutreachComplete =
    targetReached && totalOutreach >= (status?.leadsToday ?? 0) && totalOutreach > 0

  // emailsGenerating: leads that don't have an outreach entry yet
  // Show at least 1 optimistically when a run just started
  const rawGenerating = Math.max((status?.leadsToday ?? 0) - totalOutreach, 0)
  const emailsGenerating =
    optimisticGenerating && rawGenerating === 0 && (status?.leadsToday ?? 0) > 0
      ? 1
      : rawGenerating

  // Rotating company name for "Currently writing to:" line
  const genCompanies = (status?.recentActivity ?? [])
    .map((a) => a.business_name)
    .filter(Boolean) as string[]
  const currentGenCompany =
    genCompanies.length > 0
      ? genCompanies[genCompanyIndex % genCompanies.length]
      : null

  const progress = mission
    ? Math.min(100, Math.round((status!.leadsToday / Math.max(1, mission.daily_target)) * 100))
    : 0

  // ─── Loading / Error ─────────────────────────────────────────────────────

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

  if (fetchError || !status || !mission) {
    return (
      <DashboardShell adminEmail={null}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <p className="text-sm text-slate-400">{fetchError ?? 'Mission not found.'}</p>
          <button
            type="button"
            onClick={() => router.replace('/agent')}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 transition hover:text-white"
          >
            Back to missions
          </button>
        </div>
      </DashboardShell>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <DashboardShell adminEmail={null}>
      <div className="mx-auto w-full max-w-2xl space-y-5 py-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            {/* Status badges row */}
            <div className="flex flex-wrap items-center gap-2">
              {isActive && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  Active
                </span>
              )}
              {isPaused && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Paused
                </span>
              )}
              {isStopped && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-slate-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                  Stopped
                </span>
              )}
              {isNeedsReview && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                  Needs Review
                </span>
              )}
              {isCompleted && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  Completed
                </span>
              )}
              {running && !isCompleted && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-300">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-blue-400" />
                  Searching
                </span>
              )}
            </div>

            <h1 className="text-xl font-semibold tracking-tight text-white">
              {getMissionTitle(mission)}
            </h1>

            {(mission.audience_input || mission.location_input) && (
              <p className="text-sm text-slate-500">
                {[mission.audience_input, mission.location_input].filter(Boolean).join(' · ')}
              </p>
            )}

            {/* Live agent running indicator — hidden when completed */}
            {isActive && !isCompleted && (
              <div className="flex items-center gap-2 pt-0.5">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs text-slate-400">Live Agent Running</span>
                <span className="hidden text-[10px] text-slate-600 sm:inline">
                  · Scanning · Enriching · Writing
                </span>
              </div>
            )}

          </div>

          {/* Primary action: Pause / Resume */}
          {!isStopped && !isNeedsReview && !isCompleted && (
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
              {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isActive ? 'Pause' : 'Resume'}
            </button>
          )}
        </div>

        {/* ── Mission complete banner ── */}
        {isCompleted && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-400/15 bg-blue-500/[0.06] px-4 py-3">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400/80" />
            <span className="text-sm text-slate-300">
              Mission complete for today
              {mission.next_run_at && (
                <>
                  {' '}·{' '}
                  <span className="text-slate-400">
                    Next run: {formatNextRun(mission.next_run_at)}
                  </span>
                </>
              )}
            </span>
          </div>
        )}

        {/* ── Round indicator (when actively running a batch) ── */}
        {(isActive || running) && !isCompleted && round > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-400/12 bg-blue-500/[0.06] px-4 py-3">
            <span className="flex h-2 w-2 shrink-0 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.9)]" />
            <span className="text-sm text-slate-300">
              {running
                ? `Round ${round} — ${SEARCH_MESSAGES[msgIndex]}`
                : roundPhase === 'complete'
                  ? `Round ${round} complete`
                  : IDLE_MESSAGES[idleIndex]}
            </span>
          </div>
        )}

        {/* ── Idle pulse (active, no round yet) ── */}
        {isActive && !isCompleted && round === 0 && !running && (
          <div className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-3">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-slate-500" />
            <span className="text-sm text-slate-500">{IDLE_MESSAGES[idleIndex]}</span>
          </div>
        )}

        {/* ── Generating outreach state ── */}
        {!isCompleted && (isGenerating || (optimisticGenerating && !isOutreachComplete)) && (
          <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.07] px-4 py-4 space-y-2.5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="h-2 w-2 animate-ping rounded-full bg-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-violet-200">⚙ Generating outreach messages…</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Crafting personalized emails from discovered leads
                </p>
              </div>
            </div>
            {/* Rotating task line */}
            <div className="ml-8 space-y-1">
              <p className="text-xs text-slate-400">
                {GEN_TASK_MESSAGES[genTaskIndex % GEN_TASK_MESSAGES.length]}
              </p>
              {currentGenCompany && (
                <p className="text-xs text-slate-500">
                  Currently writing to:{' '}
                  <span className="text-slate-300">{currentGenCompany}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Outreach complete state ── */}
        {isOutreachComplete && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.07] p-5 space-y-4 shadow-[0_0_30px_rgba(16,185,129,0.08)]">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-white">✔ Outreach ready</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  You have {displayedEmails} message{displayedEmails !== 1 ? 's' : ''} ready to review
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push('/dashboard/outreach')}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/12 px-5 py-3 text-sm font-semibold text-emerald-200 shadow-[0_0_24px_rgba(16,185,129,0.15)] transition hover:bg-emerald-500/20 hover:text-white"
            >
              Review &amp; Send Emails
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Needs review fallback CTA (no emails yet generated) ── */}
        {isNeedsReview && !isOutreachComplete && (
          <div className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.08] p-5 space-y-4 shadow-[0_0_30px_rgba(139,92,246,0.1)]">
            <div>
              <p className="text-base font-semibold text-white">Mission complete</p>
              <p className="mt-1 text-sm text-slate-400">
                Your agent reached its daily target. Check the outreach queue for ready drafts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push('/dashboard/outreach')}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/12 px-5 py-2.5 text-sm font-semibold text-violet-200 shadow-[0_0_20px_rgba(139,92,246,0.18)] transition hover:bg-violet-500/20 hover:text-white"
            >
              Open Outreach Queue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

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
              <span className="text-base text-slate-500">/ {mission.daily_target}</span>
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Emails Ready
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              {displayedEmails === 0 && emailsGenerating > 0 ? (
                <span className="text-sm text-slate-400">⚙ Preparing first messages…</span>
              ) : (
                <>
                  <span className="text-3xl font-semibold tabular-nums text-white">
                    {displayedEmails}
                  </span>
                  <span className="text-base text-slate-500">drafts</span>
                </>
              )}
            </div>
            {displayedEmails > 0 && (
              <button
                type="button"
                onClick={() => router.push('/dashboard/outreach')}
                className="mt-2 flex items-center gap-1 text-xs text-blue-400 transition hover:text-blue-200"
              >
                Review queue <ArrowRight className="h-3 w-3" />
              </button>
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
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{status.leadsToday} leads today · {status.totalLeads} total</span>
            <span className="text-slate-600">
              {status.totalLeads.toLocaleString()} / {ADMIN_LEAD_LIMIT.toLocaleString()}
            </span>
          </div>
        </div>

        {/* ── Outreach Engine ── */}
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Outreach Engine
              </span>
            </div>
            {displayedEmails > 0 && (
              <span className="inline-flex animate-pulse items-center rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                Action needed
              </span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <div className="text-xl font-semibold tabular-nums text-white">
                {displayedEmails}
              </div>
              <div className="text-[10px] text-slate-500">✉ ready</div>
            </div>
            <div className="space-y-1">
              <div
                className={`text-xl font-semibold tabular-nums ${
                  emailsGenerating > 0 ? 'animate-pulse text-violet-300' : 'text-slate-500'
                }`}
              >
                {emailsGenerating}
              </div>
              <div className="text-[10px] text-slate-500">⚙ generating</div>
            </div>
            <div className="space-y-1">
              <div className="text-xl font-semibold tabular-nums text-emerald-400">
                {emailsApproved}
              </div>
              <div className="text-[10px] text-slate-500">✔ approved</div>
            </div>
            <div className="space-y-1">
              <div className="text-xl font-semibold tabular-nums text-red-400/80">
                {emailsRejected}
              </div>
              <div className="text-[10px] text-slate-500">✖ rejected</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push('/dashboard/outreach')}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
              displayedEmails > 0
                ? 'border-violet-400/30 bg-violet-500/12 text-violet-200 shadow-[0_0_20px_rgba(139,92,246,0.2)] hover:bg-violet-500/20 hover:text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
            }`}
          >
            <Mail className="h-4 w-4" />
            Review Emails
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* ── Activity Feed ── */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Activity Feed
            </div>
            {(feed.length > 0 || status.recentActivity.length > 0) && (
              <span className="text-[11px] text-slate-600">
                {status.recentActivity.length} leads · {totalOutreach} emails
              </span>
            )}
          </div>

          {/* Live feed lines (client-side events) */}
          {feed.length > 0 && (
            <div className="border-b border-white/[0.04] divide-y divide-white/[0.03]">
              {feed.slice(0, 8).map((line, index) => (
                <div key={`${line.id}-${index}`} className="flex items-center gap-2.5 px-5 py-2.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      line.kind === 'round'
                        ? 'bg-blue-400/60'
                        : line.kind === 'email'
                          ? 'bg-emerald-400/70'
                          : line.kind === 'system'
                            ? 'bg-slate-500'
                            : 'bg-slate-400/50'
                    }`}
                  />
                  <span
                    className={`text-xs ${
                      line.kind === 'round'
                        ? 'font-semibold text-blue-300/80'
                        : line.kind === 'email'
                          ? 'text-emerald-400/80'
                          : line.kind === 'system'
                            ? 'italic text-slate-600'
                            : 'text-slate-400'
                    }`}
                  >
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {status.recentActivity.length === 0 && feed.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <div className="text-sm text-slate-500">
                {isActive
                  ? running
                    ? 'Searching for leads now...'
                    : IDLE_MESSAGES[idleIndex]
                  : isPaused
                    ? 'Resume the mission to continue searching.'
                    : isStopped
                      ? 'This mission has been stopped.'
                      : 'No leads found yet.'}
              </div>
            </div>
          ) : (
            /* Server-side activity (historical leads) */
            <div className="divide-y divide-white/[0.04]">
              {status.recentActivity.slice(0, 10).map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-slate-500">
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

        {/* ── Mission Controls ── */}
        <div className="glass rounded-2xl p-5 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Mission Controls
          </div>

          {actionError && (
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {actionError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Pause / Resume */}
            {!isStopped && !isNeedsReview && !isCompleted && (
              <button
                type="button"
                onClick={() => void handleToggleStatus()}
                disabled={toggling}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
              >
                {isActive ? (
                  <><Pause className="h-3.5 w-3.5" /> Pause Mission</>
                ) : (
                  <><Play className="h-3.5 w-3.5" /> Resume Mission</>
                )}
              </button>
            )}

            {/* Stop */}
            {!isStopped && !isCompleted && (
              confirmStop ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Stop permanently?</span>
                  <button
                    type="button"
                    onClick={() => void handleStop()}
                    disabled={toggling}
                    className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/18 disabled:opacity-40"
                  >
                    Confirm Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmStop(false)}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-400 transition hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmStop(true)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-red-400/20 hover:text-red-300"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop Mission
                </button>
              )
            )}

            {/* Delete */}
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Delete forever?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={toggling}
                  className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/18 disabled:opacity-40"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-400 transition hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-red-400/20 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Mission
              </button>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between text-sm">
          <Link href="/agent" className="text-slate-500 transition hover:text-slate-300">
            ← All missions
          </Link>
          <Link href="/agent/setup" className="text-slate-500 transition hover:text-slate-300">
            New mission
          </Link>
        </div>
      </div>
    </DashboardShell>
  )
}
