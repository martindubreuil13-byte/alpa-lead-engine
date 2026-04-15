'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Crosshair,
  Inbox,
  SendHorizonal,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import ICPInput from '@/components/agent/ICPInput'
import ICPPreview from '@/components/agent/ICPPreview'
import MissionBuilder from '@/components/agent/MissionBuilder'
import type { ICPData } from '@/lib/ai/icp'
import type { TrialLead } from '@/lib/trial'

// ─── Types ────────────────────────────────────────────────────────────────────

type SavedIcpRecord = {
  id: string
  data: ICPData
  isActive: boolean
  status: string
  createdAt: string
}

type AgentMissionRecord = {
  id: string
  name: string | null
  status: string
  leadsPerDay: number
  contactMode: string
  location: string
}

type AgentWorkspaceProps = {
  initialSavedIcps: SavedIcpRecord[]
  initialActiveIcp: SavedIcpRecord | null
  initialMissions: AgentMissionRecord[]
  initialActiveMission: AgentMissionRecord | null
}

type MissionRunResult = {
  runKey: string
  missionId: string
  leads: TrialLead[]
  found: number
  withEmail: number
  readyToContact: number
  query: string
  location: string
  elapsedSeconds?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NO_MISSION_LABEL = 'No mission yet'
const NO_LOCATION_LABEL = 'Global'
const LAST_MISSION_RUN_STORAGE_KEY = 'alpa:last-mission-run'

// Shown during the rotating phase (after 5s boot sequence)
const SCAN_MESSAGES = [
  'Scanning active business directories...',
  'Matching profiles to your target criteria...',
  'Analyzing contact availability...',
  'Cross-referencing business signals...',
  'Filtering high-quality opportunities...',
  'Validating business profiles...',
  'Ranking contact quality...',
  'Scanning location-based data...',
  'Checking website signals...',
  'Aggregating discovery results...',
]

// ─── Helpers (pure, outside component) ────────────────────────────────────────

function getFeedEntryColor(entry: string): string {
  if (entry.startsWith('Email found')) return 'text-blue-300'
  if (entry.startsWith('Opportunity detected') || entry.startsWith('Signal confirmed'))
    return 'text-emerald-300'
  if (entry.startsWith('Website verified')) return 'text-slate-300'
  if (entry.startsWith('Receiving') || entry.startsWith('First opportunity'))
    return 'text-blue-200'
  return 'text-slate-400'
}

function getFeedIcon(entry: string): string {
  if (entry.startsWith('Email found')) return '✓'
  if (entry.startsWith('Opportunity detected') || entry.startsWith('Signal confirmed')) return '◎'
  if (entry.startsWith('Website verified')) return '◌'
  if (entry.startsWith('Checking contact') || entry.startsWith('Extracting')) return '⋯'
  if (entry.startsWith('Receiving')) return '→'
  if (entry.startsWith('Verifying') || entry.startsWith('Compiling') || entry.startsWith('Preparing'))
    return '⋯'
  return '·'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentWorkspace({
  initialSavedIcps,
  initialActiveIcp,
  initialMissions,
  initialActiveMission,
}: AgentWorkspaceProps) {
  const router = useRouter()
  const [savedIcps] = useState(initialSavedIcps)
  const [activeIcp] = useState(initialActiveIcp)
  const [missions] = useState(initialMissions)
  const [activeMission] = useState(initialActiveMission)
  const [activeView, setActiveView] = useState<'mission' | 'icp'>(
    initialActiveMission ? 'mission' : 'icp'
  )
  const [icpMode, setIcpMode] = useState<'view' | 'edit'>('view')
  const [missionMode, setMissionMode] = useState<'view' | 'edit'>('view')
  const [actionState, setActionState] = useState<'idle' | 'deleting-target' | 'deleting-mission'>(
    'idle'
  )

  // ── Mission run state ──────────────────────────────────────────────────────
  const [missionRunState, setMissionRunState] = useState<'idle' | 'running'>('idle')
  const [missionRunResult, setMissionRunResult] = useState<MissionRunResult | null>(null)
  const [missionRunError, setMissionRunError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [visibleLeads, setVisibleLeads] = useState<TrialLead[]>([])
  const [runPhase, setRunPhase] = useState<'idle' | 'scanning' | 'done'>('idle')

  // ── Live UX state ─────────────────────────────────────────────────────────
  const [systemMessage, setSystemMessage] = useState(
    'Connecting to live data sources...'
  )
  const [activityFeed, setActivityFeed] = useState<string[]>([])
  const [sourceCount, setSourceCount] = useState(0)
  const [firstLeadFlash, setFirstLeadFlash] = useState(false)

  // ── Refs ───────────────────────────────────────────────────────────────────
  const elapsedRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const revealedForKeyRef = useRef<string | null>(null)
  const msgTimeoutRef = useRef<number | null>(null)        // self-scheduling message timeout
  const revealTimeoutRef = useRef<number | null>(null)     // self-scheduling reveal timeout
  const sourceCounterRef = useRef<number | null>(null)     // setInterval for source counter
  const fakeEventTimersRef = useRef<number[]>([])          // array of setTimeout IDs for fake events
  const firstLeadFlashTimerRef = useRef<number | null>(null)
  const activityFeedEndRef = useRef<HTMLDivElement | null>(null)

  // ─── Derived ────────────────────────────────────────────────────────────────

  const hasActiveIcp = activeIcp !== null
  const hasMission = activeMission !== null && missions.length > 0
  const activeIcpId = activeIcp ? activeIcp.id : null
  const activeIcpData = activeIcp ? activeIcp.data : null
  const missionName = activeMission?.name ?? NO_MISSION_LABEL
  const missionLocation = activeMission?.location ?? NO_LOCATION_LABEL

  const showExecutionPanel =
    missionRunState === 'running' ||
    runPhase !== 'idle' ||
    missionRunResult !== null ||
    missionRunError !== null

  const showSkeletons = runPhase === 'scanning' && missionRunResult === null
  const showLeads = missionRunResult !== null
  const isDone = runPhase === 'done'

  // ─── Effects ────────────────────────────────────────────────────────────────

  // Restore last result on page reload
  useEffect(() => {
    if (typeof window === 'undefined') return
    const navEntry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (navEntry?.type !== 'reload') {
      window.sessionStorage.removeItem(LAST_MISSION_RUN_STORAGE_KEY)
      return
    }
    const stored = window.sessionStorage.getItem(LAST_MISSION_RUN_STORAGE_KEY)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as MissionRunResult
      if (!parsed?.missionId || !Array.isArray(parsed.leads)) {
        window.sessionStorage.removeItem(LAST_MISSION_RUN_STORAGE_KEY)
        return
      }
      if (activeMission?.id && parsed.missionId !== activeMission.id) {
        window.sessionStorage.removeItem(LAST_MISSION_RUN_STORAGE_KEY)
        return
      }
      revealedForKeyRef.current = parsed.runKey || parsed.missionId
      setMissionRunResult(parsed)
      setVisibleLeads(parsed.leads || [])
      setElapsed(parsed.elapsedSeconds ?? 0)
      setRunPhase('done')
    } catch {
      window.sessionStorage.removeItem(LAST_MISSION_RUN_STORAGE_KEY)
    }
  }, [activeMission?.id])

  // Persist result to sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!missionRunResult) {
      window.sessionStorage.removeItem(LAST_MISSION_RUN_STORAGE_KEY)
      return
    }
    window.sessionStorage.setItem(LAST_MISSION_RUN_STORAGE_KEY, JSON.stringify(missionRunResult))
  }, [missionRunResult])

  // Keep elapsed ref in sync
  useEffect(() => {
    elapsedRef.current = elapsed
  }, [elapsed])

  // Elapsed counter while running
  useEffect(() => {
    if (missionRunState !== 'running') return
    const id = window.setInterval(() => setElapsed((c) => c + 1), 1000)
    return () => window.clearInterval(id)
  }, [missionRunState])

  // ── Boot sequence → rotating messages (self-scheduling setTimeout) ─────────
  useEffect(() => {
    // Clear any pending message timer first
    if (msgTimeoutRef.current !== null) {
      window.clearTimeout(msgTimeoutRef.current)
      msgTimeoutRef.current = null
    }

    if (runPhase !== 'scanning') return

    // When results arrive during scanning, freeze on "Receiving"
    if (missionRunResult !== null) {
      setSystemMessage('Receiving results...')
      return
    }

    // Boot phases — staged, then hand off to rotating
    const bootTimers: number[] = []

    bootTimers.push(
      window.setTimeout(() => {
        setSystemMessage(`Scanning market signals in ${missionLocation}...`)
      }, 1500)
    )
    bootTimers.push(
      window.setTimeout(() => {
        setSystemMessage('Identifying active businesses...')
      }, 3200)
    )

    // After 5s, begin organic rotation with 2200–2800ms random gaps
    let rotIdx = 0

    function scheduleNextMsg() {
      const delay = 2200 + Math.random() * 600
      msgTimeoutRef.current = window.setTimeout(() => {
        rotIdx = (rotIdx + 1) % SCAN_MESSAGES.length
        setSystemMessage(SCAN_MESSAGES[rotIdx])
        scheduleNextMsg()
      }, delay)
    }

    bootTimers.push(
      window.setTimeout(() => {
        scheduleNextMsg()
      }, 5000)
    )

    return () => {
      bootTimers.forEach((id) => window.clearTimeout(id))
      if (msgTimeoutRef.current !== null) {
        window.clearTimeout(msgTimeoutRef.current)
        msgTimeoutRef.current = null
      }
    }
  }, [runPhase, missionRunResult, missionLocation])

  // ── Source counter — increments every ~1.6s while scanning ────────────────
  useEffect(() => {
    if (runPhase !== 'scanning' || missionRunResult !== null) {
      if (sourceCounterRef.current !== null) {
        window.clearInterval(sourceCounterRef.current)
        sourceCounterRef.current = null
      }
      return
    }

    setSourceCount(80)
    sourceCounterRef.current = window.setInterval(() => {
      setSourceCount((prev) => Math.min(520, prev + Math.floor(38 + Math.random() * 34)))
    }, 1600)

    return () => {
      if (sourceCounterRef.current !== null) {
        window.clearInterval(sourceCounterRef.current)
        sourceCounterRef.current = null
      }
    }
  }, [runPhase, missionRunResult])

  // ── Fake discovery events — injected before real data arrives ─────────────
  useEffect(() => {
    fakeEventTimersRef.current.forEach(window.clearTimeout)
    fakeEventTimersRef.current = []

    if (runPhase !== 'scanning' || missionRunResult !== null) return

    const bizType = activeIcpData?.industries?.[0]?.trim() || 'local business'
    const loc = missionLocation

    const fakeEvents: { delay: number; entry: string }[] = [
      { delay: 3400, entry: `Opportunity detected: ${bizType} in ${loc}` },
      { delay: 6000, entry: 'Checking contact availability...' },
      { delay: 9200, entry: `Signal confirmed: active ${bizType} profile` },
      { delay: 13000, entry: 'Extracting contact details...' },
      { delay: 17500, entry: `Verifying ${bizType} listings...` },
      { delay: 21500, entry: 'Compiling contact database...' },
      { delay: 25500, entry: 'Preparing results for delivery...' },
    ]

    fakeEvents.forEach(({ delay, entry }) => {
      const id = window.setTimeout(() => {
        setActivityFeed((prev) => [...prev, entry])
      }, delay)
      fakeEventTimersRef.current.push(id)
    })

    return () => {
      fakeEventTimersRef.current.forEach(window.clearTimeout)
      fakeEventTimersRef.current = []
    }
  }, [runPhase, missionRunResult, missionLocation, activeIcpData])

  // ── Auto-scroll activity feed to bottom ────────────────────────────────────
  useEffect(() => {
    activityFeedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activityFeed])

  // ── Progressive lead reveal — email-first, randomized pacing ──────────────
  useEffect(() => {
    if (!missionRunResult) return
    const key = missionRunResult.runKey
    if (revealedForKeyRef.current === key) return
    revealedForKeyRef.current = key

    // Sort email-ready leads first
    const sorted = [...missionRunResult.leads].sort((a, b) => {
      const aE = Boolean(String(a.email || '').trim())
      const bE = Boolean(String(b.email || '').trim())
      if (aE && !bE) return -1
      if (!aE && bE) return 1
      return 0
    })

    if (!sorted.length) {
      setRunPhase('done')
      return
    }

    // First lead immediately — with flash label
    const firstLead = sorted[0]
    const firstHasEmail = Boolean(String(firstLead.email || '').trim())
    setVisibleLeads([firstLead])
    setActivityFeed((prev) => [
      ...prev,
      firstHasEmail ? 'Email found — ready for outreach' : 'Website verified — potential lead',
    ])
    setFirstLeadFlash(true)
    firstLeadFlashTimerRef.current = window.setTimeout(() => {
      setFirstLeadFlash(false)
      firstLeadFlashTimerRef.current = null
    }, 1400)

    let i = 1
    if (i >= sorted.length) {
      setRunPhase('done')
      return
    }

    // Self-scheduling timeout with 180–260ms randomized gaps
    function revealNext() {
      if (i >= sorted.length) {
        setRunPhase('done')
        return
      }
      const delay = 180 + Math.floor(Math.random() * 80)
      revealTimeoutRef.current = window.setTimeout(() => {
        const lead = sorted[i]
        const hasEmailFlag = Boolean(String(lead.email || '').trim())
        setVisibleLeads((prev) => [...prev, lead])
        setActivityFeed((prev) => [
          ...prev,
          hasEmailFlag ? 'Email found — ready for outreach' : 'Website verified — potential lead',
        ])
        i++
        revealNext()
      }, delay)
    }

    revealNext()

    return () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current)
        revealTimeoutRef.current = null
      }
    }
  }, [missionRunResult])

  // ─── Helpers that clear every timer (used by stop and abort) ────────────────

  function clearAllTimers() {
    if (msgTimeoutRef.current !== null) {
      window.clearTimeout(msgTimeoutRef.current)
      msgTimeoutRef.current = null
    }
    if (revealTimeoutRef.current !== null) {
      window.clearTimeout(revealTimeoutRef.current)
      revealTimeoutRef.current = null
    }
    if (sourceCounterRef.current !== null) {
      window.clearInterval(sourceCounterRef.current)
      sourceCounterRef.current = null
    }
    fakeEventTimersRef.current.forEach(window.clearTimeout)
    fakeEventTimersRef.current = []
    if (firstLeadFlashTimerRef.current !== null) {
      window.clearTimeout(firstLeadFlashTimerRef.current)
      firstLeadFlashTimerRef.current = null
    }
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function focusIcpView() {
    setActiveView('icp')
    setIcpMode('view')
  }

  function focusMissionView() {
    setActiveView('mission')
    setMissionMode('view')
  }

  async function handleDeleteTarget() {
    if (!activeIcpId) return
    setActionState('deleting-target')
    try {
      const response = await fetch('/api/agent/icp/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeIcpId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Failed to delete target')
      focusIcpView()
      router.refresh()
    } catch (error) {
      console.error(error)
      setActionState('idle')
    }
  }

  async function handleDeleteMission() {
    if (!activeMission) return
    setActionState('deleting-mission')
    try {
      const response = await fetch('/api/agent/missions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeMission.id }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Failed to delete mission')
      focusMissionView()
      router.refresh()
    } catch (error) {
      console.error(error)
      setActionState('idle')
    }
  }

  async function handleRunMission() {
    if (!activeMission || missionRunState === 'running') return

    const controller = new AbortController()
    abortControllerRef.current = controller

    // Full clean state before starting
    clearAllTimers()
    setMissionRunState('running')
    setMissionRunError(null)
    setMissionRunResult(null)
    setVisibleLeads([])
    setActivityFeed([])
    setSourceCount(0)
    setFirstLeadFlash(false)
    setRunPhase('scanning')
    setElapsed(0)
    setSystemMessage('Connecting to live data sources...')
    revealedForKeyRef.current = null

    try {
      const response = await fetch('/api/agent/run-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: activeMission.id }),
        signal: controller.signal,
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Mission failed')
      }

      const nextResult: MissionRunResult = {
        runKey: `${activeMission.id}:${Date.now()}`,
        missionId: activeMission.id,
        leads: Array.isArray(data.leads)
          ? data.leads.filter((l: unknown): l is TrialLead => typeof l === 'object' && l !== null)
          : [],
        found: Number(data.found ?? 0),
        withEmail: Number(data.withEmail ?? 0),
        readyToContact: Number(data.readyToContact ?? 0),
        query: String(data.query || ''),
        location: String(data.location || missionLocation),
        elapsedSeconds: elapsedRef.current,
      }

      setMissionRunResult(nextResult)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        clearAllTimers()
        setRunPhase('idle')
        setVisibleLeads([])
        setMissionRunResult(null)
        setActivityFeed([])
        setSourceCount(0)
        setFirstLeadFlash(false)
        return
      }
      console.error(error)
      setMissionRunError(error instanceof Error ? error.message : 'Failed to run mission')
      setRunPhase('idle')
    } finally {
      setMissionRunState('idle')
      abortControllerRef.current = null
    }
  }

  function handleStopMission() {
    abortControllerRef.current?.abort()
  }

  // ─── Flow segments ───────────────────────────────────────────────────────────

  const flowSegments = [
    {
      key: 'icp',
      label: 'Target',
      description: hasActiveIcp ? 'Configured' : 'Required',
      configured: hasActiveIcp,
      focused: activeView === 'icp',
      dormant: false,
      icon: Crosshair,
      onClick: focusIcpView,
    },
    {
      key: 'mission',
      label: 'Mission',
      description: hasMission ? 'Configured' : 'Next',
      configured: hasMission,
      focused: activeView === 'mission',
      dormant: false,
      icon: SlidersHorizontal,
      onClick: focusMissionView,
    },
    {
      key: 'queue',
      label: 'Queue',
      description: 'Dormant',
      configured: false,
      focused: false,
      dormant: true,
      icon: Inbox,
      onClick: undefined,
    },
    {
      key: 'output',
      label: 'Output',
      description: 'Dormant',
      configured: false,
      focused: false,
      dormant: true,
      icon: SendHorizonal,
      onClick: undefined,
    },
  ] as const

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes leadEnter {
          from { opacity: 0; transform: translateY(14px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes leadEnterBounce {
          from  { opacity: 0; transform: translateY(16px) scale(0.96); }
          70%   { transform: translateY(-3px) scale(1.01); }
          to    { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes leadPulse {
          0%   { box-shadow: 0 0 0 0   rgba(96,165,250,0.4); }
          65%  { box-shadow: 0 0 0 18px rgba(96,165,250,0); }
          100% { box-shadow: 0 0 0 18px rgba(96,165,250,0); }
        }
        @keyframes flashFade {
          0%   { opacity: 0; transform: translateY(-3px); }
          12%  { opacity: 1; transform: translateY(0); }
          72%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes msgFade {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmerSweep {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        @keyframes bgDrift {
          0%   { transform: translate(0%,   0%)   scale(1);    opacity: 0.08; }
          33%  { transform: translate(7%,   4%)   scale(1.08); opacity: 0.12; }
          66%  { transform: translate(-4%,  8%)   scale(1.05); opacity: 0.07; }
          100% { transform: translate(0%,   0%)   scale(1);    opacity: 0.08; }
        }
        @keyframes feedEntry {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div className="w-full space-y-6 px-4 sm:space-y-8 sm:px-6 lg:px-10 xl:px-12">

        {/* Flow bar */}
        <section className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-3 pr-1">
            {flowSegments.map((segment) => {
              const Icon = segment.icon
              const className = `group flex min-w-[170px] snap-start items-center gap-3 rounded-[22px] border px-4 py-3 text-left transition duration-200 ${
                segment.dormant
                  ? 'cursor-default border-white/6 bg-white/[0.025] text-slate-500'
                  : segment.focused
                    ? 'border-transparent bg-[linear-gradient(135deg,rgba(59,130,246,0.18),rgba(96,165,250,0.08))] text-white shadow-[0_12px_36px_rgba(59,130,246,0.18),inset_0_0_0_1px_rgba(96,165,250,0.28)] hover:-translate-y-0.5'
                    : segment.configured
                      ? 'cursor-pointer border-emerald-300/16 bg-[linear-gradient(135deg,rgba(16,185,129,0.1),rgba(255,255,255,0.03))] text-slate-100 shadow-[0_8px_24px_rgba(16,185,129,0.08)] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(16,185,129,0.12)]'
                      : 'cursor-pointer border-white/10 bg-white/[0.035] text-slate-300 hover:-translate-y-0.5 hover:bg-white/[0.05] hover:shadow-[0_12px_28px_rgba(15,23,42,0.22)]'
              }`
              const content = (
                <>
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border transition ${
                    segment.dormant
                      ? 'border-white/8 bg-white/[0.03] text-slate-500'
                      : segment.focused
                        ? 'border-blue-300/24 bg-blue-500/15 text-blue-100 shadow-[0_0_18px_rgba(96,165,250,0.2)]'
                        : segment.configured
                          ? 'border-emerald-300/16 bg-emerald-500/10 text-emerald-100'
                          : 'border-white/10 bg-white/[0.04] text-slate-300'
                  }`}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-5">{segment.label}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-current/70">
                      {segment.description}
                    </div>
                  </div>
                </>
              )
              if (!segment.onClick) {
                return <div key={segment.key} className={className}>{content}</div>
              }
              return (
                <button key={segment.key} type="button" onClick={segment.onClick} className={className}>
                  {content}
                </button>
              )
            })}
          </div>
        </section>

        {/* Main panel */}
        <section className="glass relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.92),rgba(4,10,20,0.95))] p-4 shadow-[0_20px_70px_rgba(2,8,23,0.3)] transition-all duration-300 sm:p-6">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="agent-breath absolute inset-x-[-10%] top-[-20%] h-40 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1),transparent_65%)] blur-2xl" />
            <div className="absolute bottom-[-10%] right-[-8%] h-44 w-44 rounded-full bg-emerald-500/8 blur-3xl" />
            <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:28px_28px]" />
          </div>

          <div className="relative space-y-5">
            {/* Section header */}
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
                <Sparkles className="h-3.5 w-3.5 text-blue-200" />
                Current Task
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
                {activeView === 'icp'
                  ? hasActiveIcp ? 'Target Profile' : 'Define your target'
                  : hasMission ? 'Mission Control' : 'Launch Mission'}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-400">
                {activeView === 'icp'
                  ? 'Shape the targeting logic your agent will operate from.'
                  : !hasActiveIcp
                    ? 'Mission execution stays locked until the target profile is defined.'
                    : hasMission
                    ? 'Run or refine the operational layer that turns your target into execution.'
                    : 'Define what the agent should do daily once the target is locked.'}
              </p>
            </div>

            {/* ICP: create */}
            {activeView === 'icp' && !hasActiveIcp ? <ICPInput initialSavedIcps={savedIcps} /> : null}

            {/* ICP: view */}
            {activeView === 'icp' && hasActiveIcp && icpMode === 'view' ? (
              <div className="space-y-5 transition-all duration-300">
                <div className="rounded-[28px] border border-green-400/18 bg-[linear-gradient(180deg,rgba(20,83,45,0.2),rgba(6,78,59,0.1))] p-1 shadow-[0_0_40px_rgba(34,197,94,0.12)]">
                  <div className="rounded-[24px] border border-white/6 bg-[#03100b]/88 p-4 sm:p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="relative rounded-full border border-green-400/18 bg-green-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-green-100">
                        Agent Decision
                        <span className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white/10 to-transparent opacity-60" />
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-green-400/18 via-white/8 to-transparent" />
                    </div>
                    {activeIcpData ? <ICPPreview data={activeIcpData} /> : null}
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
                    <button type="button" onClick={() => setIcpMode('edit')}
                      className="btn-secondary min-h-[46px] rounded-[14px] border-0 bg-transparent px-4 text-slate-100 hover:bg-white/[0.06]">
                      Replace
                    </button>
                    <button type="button" onClick={() => { void handleDeleteTarget() }}
                      disabled={actionState === 'deleting-target'}
                      className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:text-rose-200/60">
                      <Trash2 className="h-4 w-4" />
                      <span>{actionState === 'deleting-target' ? 'Deleting...' : 'Delete Target'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ICP: edit */}
            {activeView === 'icp' && hasActiveIcp && icpMode === 'edit' ? (
              <div className="space-y-4 transition-all duration-300">
                <ICPInput initialSavedIcps={savedIcps} builderOnly />
                <button type="button" onClick={() => setIcpMode('view')}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-2xl px-1 text-sm text-slate-400 transition hover:text-slate-200">
                  Cancel
                </button>
              </div>
            ) : null}

            {/* Mission: no ICP */}
            {activeView === 'mission' && !hasActiveIcp ? (
              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.58),rgba(5,10,18,0.82))] p-6 shadow-[0_16px_36px_rgba(2,8,23,0.18)] transition-all duration-300 sm:p-8">
                <div className="flex min-h-[260px] flex-col items-start justify-center gap-5 text-left">
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Mission Blocked</div>
                    <h3 className="text-2xl font-semibold tracking-tight text-white">Mission requires a target</h3>
                    <p className="max-w-xl text-sm leading-7 text-slate-400">Define who you&apos;re targeting before launching a mission.</p>
                  </div>
                  <button type="button" onClick={focusIcpView}
                    className="btn-primary min-h-[48px] rounded-2xl px-5 shadow-[0_12px_28px_rgba(59,130,246,0.18)] transition hover:-translate-y-0.5 active:scale-[0.98]">
                    Go to Target
                  </button>
                </div>
              </div>
            ) : null}

            {/* Mission: create */}
            {activeView === 'mission' && hasActiveIcp && !hasMission && activeIcpId ? (
              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.72),rgba(5,10,18,0.92))] p-1 transition-all duration-300">
                <div className="rounded-[24px] border border-white/6 bg-[#050d18]/92 p-4 sm:p-5">
                  <MissionBuilder icpId={activeIcpId} embedded />
                </div>
              </div>
            ) : null}

            {/* Mission: view + execution */}
            {activeView === 'mission' && hasMission && missionMode === 'view' ? (
              <div className="space-y-5 transition-all duration-300">
                {/* Mission card */}
                <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.72),rgba(5,10,18,0.92))] p-5 shadow-[0_18px_40px_rgba(2,8,23,0.2)]">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-300">Mission</div>
                      <h3 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{missionName}</h3>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <DetailPill label="Throughput" value={`${activeMission.leadsPerDay} leads/day`} />
                      <DetailPill label="Mode" value={activeMission.contactMode} />
                      <DetailPill label="Location" value={missionLocation} />
                    </div>
                  </div>
                </div>

                {/* Run + edit */}
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button type="button" onClick={() => { void handleRunMission() }}
                    disabled={missionRunState === 'running'}
                    className="btn-primary min-h-[48px] rounded-2xl px-5 shadow-[0_12px_28px_rgba(59,130,246,0.2)] transition hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0">
                    {missionRunState === 'running' ? 'Running mission...' : 'Run Mission'}
                  </button>
                  <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
                    <button type="button" onClick={() => setMissionMode('edit')}
                      className="btn-secondary min-h-[46px] rounded-[14px] border-0 bg-transparent px-4 text-slate-100 hover:bg-white/[0.06]">
                      Edit Mission
                    </button>
                    <button type="button" onClick={() => { void handleDeleteMission() }}
                      disabled={actionState === 'deleting-mission'}
                      className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:text-rose-200/60">
                      <Trash2 className="h-4 w-4" />
                      <span>{actionState === 'deleting-mission' ? 'Deleting...' : 'Delete Mission'}</span>
                    </button>
                  </div>
                </div>

                {/* ── Execution panel ── */}
                {showExecutionPanel ? (
                  <div className="space-y-5">

                    {/* ── Scanning header ── */}
                    {runPhase === 'scanning' ? (
                      <div className="relative overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(7,13,27,0.94),rgba(3,8,18,0.98))] shadow-[0_20px_64px_rgba(2,8,23,0.35)] backdrop-blur-xl">
                        {/* Animated background drift — subtle, 10s cycle */}
                        <div className="pointer-events-none absolute inset-[-15%]" style={{ animation: 'bgDrift 10s ease-in-out infinite' }}>
                          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_40%_30%,rgba(96,165,250,0.09),transparent_60%)]" />
                        </div>

                        <div className="relative p-6 sm:p-7">
                          {/* Top row: status + timer + stop */}
                          <div className="flex items-start justify-between gap-6">
                            <div className="min-w-0 space-y-3">
                              <div className="inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                                Live Market Scan
                              </div>
                              <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-[1.7rem]">
                                Scanning the market
                              </h3>
                              {/* Rotating message — key triggers remount for animation replay */}
                              <p
                                key={systemMessage}
                                className="max-w-lg text-sm leading-relaxed text-slate-300"
                                style={{ animation: 'msgFade 300ms ease-out both' }}
                              >
                                {systemMessage}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-3 pt-0.5">
                              <div className="text-sm font-semibold tabular-nums text-slate-400">
                                ⏱ {elapsed}s
                              </div>
                              <button type="button" onClick={handleStopMission}
                                className="inline-flex items-center gap-2 rounded-[14px] border border-rose-400/22 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:border-rose-400/35 hover:bg-rose-500/16 active:scale-[0.97]">
                                <X className="h-3.5 w-3.5" />
                                Stop
                              </button>
                            </div>
                          </div>

                          {/* Source counter */}
                          {sourceCount > 0 ? (
                            <div className="mt-4 text-[13px] font-medium text-slate-500">
                              Scanning {sourceCount}+ sources...
                            </div>
                          ) : null}

                          {/* Activity feed */}
                          {activityFeed.length > 0 ? (
                            <div className="mt-5 border-t border-white/[0.06] pt-4">
                              <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-600">
                                Activity
                              </div>
                              <div className="max-h-[172px] space-y-1.5 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {activityFeed.map((entry, i) => (
                                  <div
                                    key={i}
                                    className={`flex items-center gap-2.5 text-[13px] ${getFeedEntryColor(entry)}`}
                                    style={{ animation: 'feedEntry 280ms ease-out both' }}
                                  >
                                    <span className="shrink-0 w-3 text-center text-[10px] opacity-60">
                                      {getFeedIcon(entry)}
                                    </span>
                                    <span className="leading-snug">{entry}</span>
                                  </div>
                                ))}
                                <div ref={activityFeedEndRef} />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {/* ── Done summary ── */}
                    {isDone && missionRunResult ? (
                      <div className="rounded-[24px] border border-emerald-400/16 bg-[linear-gradient(160deg,rgba(6,78,59,0.18),rgba(4,10,20,0.88))] p-5 shadow-[0_0_32px_rgba(16,185,129,0.08)]">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                              Your next clients are ready.
                            </h4>
                            <p className="mt-1.5 text-sm text-slate-300">
                              {missionRunResult.found} opportunit{missionRunResult.found === 1 ? 'y' : 'ies'} found
                              {missionRunResult.location ? ` in ${missionRunResult.location}` : ''}
                              {missionRunResult.withEmail > 0
                                ? ` · ${missionRunResult.withEmail} ready to contact`
                                : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-xs font-medium text-slate-500">
                            ⏱ {missionRunResult.elapsedSeconds ?? elapsed}s
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <MetricTile label="Found" value={String(missionRunResult.found)} />
                          <MetricTile label="With Email" value={String(missionRunResult.withEmail)} />
                          <MetricTile label="Ready to Contact" value={String(missionRunResult.readyToContact)} />
                        </div>
                      </div>
                    ) : null}

                    {/* ── Skeleton grid ── */}
                    {showSkeletons ? (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <SkeletonLeadCard key={i} index={i} />
                        ))}
                      </div>
                    ) : null}

                    {/* ── Real leads ── */}
                    {showLeads ? (
                      <div>
                        {visibleLeads.length > 0 ? (
                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {visibleLeads.map((lead, index) => {
                              const hasEmail = Boolean(String(lead.email || '').trim())
                              const isNew = index === visibleLeads.length - 1
                              return (
                                <LeadCard
                                  key={lead.email || lead.website || lead.company_name || index}
                                  lead={lead}
                                  hasEmail={hasEmail}
                                  isNew={isNew}
                                  showFirstFlash={index === 0 && firstLeadFlash}
                                />
                              )
                            })}
                          </div>
                        ) : isDone ? (
                          <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-10 text-center">
                            <p className="text-sm text-slate-400">
                              No leads found. Try adjusting your target profile or location.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* ── Action buttons ── */}
                    {isDone && missionRunResult ? (
                      <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                        <button type="button"
                          onClick={() => router.push(`/dashboard/leads?mission_id=${missionRunResult.missionId}`)}
                          className="btn-primary min-h-[48px] rounded-2xl px-5 shadow-[0_12px_28px_rgba(59,130,246,0.18)] transition hover:-translate-y-0.5 active:scale-[0.98]">
                          View Leads
                        </button>
                        <button type="button" onClick={() => { void handleRunMission() }}
                          className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] px-5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]">
                          Generate more leads
                        </button>
                      </div>
                    ) : null}

                    {/* ── Error ── */}
                    {missionRunError ? (
                      <div className="rounded-2xl border border-rose-400/18 bg-rose-500/8 p-4 text-sm leading-6 text-rose-100">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-200/80">
                          Mission Error
                        </div>
                        <div className="mt-2">Mission failed. Please try again.</div>
                        <div className="mt-1 text-rose-100/70">{missionRunError}</div>
                      </div>
                    ) : null}

                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Mission: edit */}
            {activeView === 'mission' && hasMission && missionMode === 'edit' && activeIcpId ? (
              <div className="space-y-4 transition-all duration-300">
                <MissionBuilder icpId={activeIcpId} />
                <button type="button" onClick={() => setMissionMode('view')}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-2xl px-1 text-sm text-slate-400 transition hover:text-slate-200">
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">{label}</div>
      <div className="mt-2.5 text-2xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  )
}

function SkeletonLeadCard({ index }: { index: number }) {
  const delay = `${index * 130}ms`
  const shimmer: React.CSSProperties = {
    background:
      'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%)',
    backgroundSize: '200% 100%',
    animation: `shimmerSweep 1.9s linear ${delay} infinite`,
  }
  return (
    <div
      className="rounded-[24px] border border-white/8 bg-[linear-gradient(160deg,rgba(255,255,255,0.03),rgba(5,10,18,0.7))] p-5"
      style={{ animation: `pulse 2.2s ease-in-out ${delay} infinite` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-[18px] w-3/4 rounded-lg" style={shimmer} />
          <div className="h-3 w-1/3 rounded-md" style={{ ...shimmer, opacity: 0.65 }} />
        </div>
        <div className="h-6 w-16 shrink-0 rounded-full" style={{ ...shimmer, opacity: 0.55 }} />
      </div>
      <div className="mt-5 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-5 shrink-0 rounded-full" style={{ ...shimmer, opacity: 0.5 }} />
          <div className="h-3.5 w-2/3 rounded-md" style={shimmer} />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-5 shrink-0 rounded-full" style={{ ...shimmer, opacity: 0.4 }} />
          <div className="h-3.5 w-1/2 rounded-md" style={{ ...shimmer, opacity: 0.65 }} />
        </div>
      </div>
    </div>
  )
}

function LeadCard({
  lead,
  hasEmail,
  isNew,
  showFirstFlash,
}: {
  lead: TrialLead
  hasEmail: boolean
  isNew: boolean
  showFirstFlash: boolean
}) {
  const websiteDisplay = lead.website
    ? lead.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    : null

  // Email leads get a bouncy entrance + pulse glow; others get a clean slide
  const entryAnimation = isNew
    ? hasEmail
      ? 'leadEnterBounce 420ms cubic-bezier(0.34,1.56,0.64,1) both, leadPulse 900ms 380ms ease-out forwards'
      : 'leadEnter 320ms ease-out both'
    : undefined

  return (
    <div
      className={`group rounded-[24px] border p-5 transition-all duration-300 hover:scale-[1.015] ${
        hasEmail
          ? 'border-blue-300/22 bg-[linear-gradient(160deg,rgba(59,130,246,0.14),rgba(8,15,29,0.84))] shadow-[0_8px_28px_rgba(59,130,246,0.1)] hover:border-blue-300/38 hover:shadow-[0_16px_44px_rgba(59,130,246,0.22)]'
          : 'border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.04),rgba(5,10,18,0.72))] hover:border-white/16 hover:shadow-[0_12px_32px_rgba(0,0,0,0.28)]'
      }`}
      style={entryAnimation ? { animation: entryAnimation } : undefined}
    >
      {/* First lead flash label */}
      {showFirstFlash ? (
        <div
          className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/28 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-200"
          style={{ animation: 'flashFade 1400ms ease-out forwards' }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          First opportunity found
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold leading-snug tracking-tight text-white">
            {lead.company_name || 'Unknown company'}
          </div>
          {lead.city ? (
            <div className="mt-1 text-[13px] text-slate-400">{lead.city}</div>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors ${
          hasEmail
            ? 'border border-blue-300/28 bg-blue-500/15 text-blue-100'
            : 'border border-white/10 bg-white/[0.05] text-slate-400'
        }`}>
          {hasEmail ? 'Ready to contact' : 'Potential lead'}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {lead.email ? (
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-[11px]">✉</span>
            <span className="truncate font-medium text-blue-200">{lead.email}</span>
          </div>
        ) : null}
        {hasEmail ? (
          <div className="text-[12px] text-slate-500 pl-[29px]">Direct contact available</div>
        ) : null}
        {!lead.email && websiteDisplay ? (
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px]">🌐</span>
            <span className="truncate text-slate-300">{websiteDisplay}</span>
          </div>
        ) : null}
        {lead.phone ? (
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[11px]">📞</span>
            <span className="text-slate-400">{lead.phone}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
