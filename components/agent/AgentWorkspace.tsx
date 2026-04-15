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

const NO_MISSION_LABEL = 'No mission yet'
const NO_LOCATION_LABEL = 'Global'
const LAST_MISSION_RUN_STORAGE_KEY = 'alpa:last-mission-run'

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
  const [missionRunState, setMissionRunState] = useState<'idle' | 'running'>('idle')
  const [missionRunResult, setMissionRunResult] = useState<MissionRunResult | null>(null)
  const [missionRunError, setMissionRunError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [visibleLeads, setVisibleLeads] = useState<TrialLead[]>([])
  const [runPhase, setRunPhase] = useState<'idle' | 'scanning' | 'done'>('idle')

  const elapsedRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const revealedForKeyRef = useRef<string | null>(null)

  const hasActiveIcp = activeIcp !== null
  const hasMission = activeMission !== null && missions.length > 0
  const activeIcpId = activeIcp ? activeIcp.id : null
  const activeIcpData = activeIcp ? activeIcp.data : null
  const missionName =
    activeMission && activeMission.name ? activeMission.name : NO_MISSION_LABEL
  const missionLocation =
    activeMission && activeMission.location ? activeMission.location : NO_LOCATION_LABEL
  const showExecutionPanel =
    missionRunState === 'running' ||
    runPhase !== 'idle' ||
    missionRunResult !== null ||
    missionRunError !== null
  const isScanning = runPhase === 'scanning'
  const isDone = runPhase === 'done'

  // Restore last result on page reload
  useEffect(() => {
    if (typeof window === 'undefined') return

    const navigationEntry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined

    if (navigationEntry?.type !== 'reload') {
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

      // Mark as already revealed so the reveal effect skips animation
      revealedForKeyRef.current = parsed.runKey || parsed.missionId
      setMissionRunResult(parsed)
      setVisibleLeads(parsed.leads || [])
      setElapsed(parsed.elapsedSeconds ?? 0)
      setRunPhase('done')
    } catch {
      window.sessionStorage.removeItem(LAST_MISSION_RUN_STORAGE_KEY)
    }
  }, [activeMission?.id])

  // Persist last result to sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!missionRunResult) {
      window.sessionStorage.removeItem(LAST_MISSION_RUN_STORAGE_KEY)
      return
    }
    window.sessionStorage.setItem(LAST_MISSION_RUN_STORAGE_KEY, JSON.stringify(missionRunResult))
  }, [missionRunResult])

  // Keep elapsed ref in sync for capturing in run result
  useEffect(() => {
    elapsedRef.current = elapsed
  }, [elapsed])

  // Elapsed timer while running
  useEffect(() => {
    if (missionRunState !== 'running') return
    const intervalId = window.setInterval(() => {
      setElapsed((current) => current + 1)
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [missionRunState])

  // Lead reveal animation — runs once per result, skips restored results
  useEffect(() => {
    if (!missionRunResult) return

    const key = missionRunResult.runKey
    if (revealedForKeyRef.current === key) return
    revealedForKeyRef.current = key

    const leads = missionRunResult.leads
    if (!leads.length) {
      setRunPhase('done')
      return
    }

    setVisibleLeads([leads[0]])
    let i = 1

    if (i >= leads.length) {
      setRunPhase('done')
      return
    }

    const id = window.setInterval(() => {
      if (i < leads.length) {
        const lead = leads[i]
        setVisibleLeads((prev) => [...prev, lead])
        i++
      }
      if (i >= leads.length) {
        window.clearInterval(id)
        setRunPhase('done')
      }
    }, 150)

    return () => window.clearInterval(id)
  }, [missionRunResult])

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

    setMissionRunState('running')
    setMissionRunError(null)
    setMissionRunResult(null)
    setVisibleLeads([])
    setRunPhase('scanning')
    setElapsed(0)
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
          ? data.leads.filter(
              (l: unknown): l is TrialLead => typeof l === 'object' && l !== null
            )
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
        setRunPhase('idle')
        setVisibleLeads([])
        setMissionRunResult(null)
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

  return (
    <div className="w-full space-y-6 px-4 sm:space-y-8 sm:px-6 lg:px-10 xl:px-12">
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
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border transition ${
                    segment.dormant
                      ? 'border-white/8 bg-white/[0.03] text-slate-500'
                      : segment.focused
                        ? 'border-blue-300/24 bg-blue-500/15 text-blue-100 shadow-[0_0_18px_rgba(96,165,250,0.2)]'
                        : segment.configured
                          ? 'border-emerald-300/16 bg-emerald-500/10 text-emerald-100'
                          : 'border-white/10 bg-white/[0.04] text-slate-300'
                  }`}
                >
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
              return (
                <div key={segment.key} className={className}>
                  {content}
                </div>
              )
            }

            return (
              <button
                key={segment.key}
                type="button"
                onClick={segment.onClick}
                className={className}
              >
                {content}
              </button>
            )
          })}
        </div>
      </section>

      <section className="glass relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.92),rgba(4,10,20,0.95))] p-4 shadow-[0_20px_70px_rgba(2,8,23,0.3)] transition-all duration-300 sm:p-6">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="agent-breath absolute inset-x-[-10%] top-[-20%] h-40 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1),transparent_65%)] blur-2xl" />
          <div className="absolute bottom-[-10%] right-[-8%] h-44 w-44 rounded-full bg-emerald-500/8 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:28px_28px]" />
        </div>

        <div className="relative space-y-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
              <Sparkles className="h-3.5 w-3.5 text-blue-200" />
              Current Task
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
              {activeView === 'icp'
                ? hasActiveIcp
                  ? 'Target Profile'
                  : 'Define your target'
                : hasMission
                  ? 'Mission Control'
                  : 'Launch Mission'}
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

          {activeView === 'icp' && !hasActiveIcp ? <ICPInput initialSavedIcps={savedIcps} /> : null}

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
                  <button
                    type="button"
                    onClick={() => setIcpMode('edit')}
                    className="btn-secondary min-h-[46px] rounded-[14px] border-0 bg-transparent px-4 text-slate-100 hover:bg-white/[0.06]"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDeleteTarget()
                    }}
                    disabled={actionState === 'deleting-target'}
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:text-rose-200/60"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{actionState === 'deleting-target' ? 'Deleting...' : 'Delete Target'}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeView === 'icp' && hasActiveIcp && icpMode === 'edit' ? (
            <div className="space-y-4 transition-all duration-300">
              <ICPInput initialSavedIcps={savedIcps} builderOnly />
              <button
                type="button"
                onClick={() => setIcpMode('view')}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl px-1 text-sm text-slate-400 transition hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {activeView === 'mission' && !hasActiveIcp ? (
            <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.58),rgba(5,10,18,0.82))] p-6 shadow-[0_16px_36px_rgba(2,8,23,0.18)] transition-all duration-300 sm:p-8">
              <div className="flex min-h-[260px] flex-col items-start justify-center gap-5 text-left">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Mission Blocked
                  </div>
                  <h3 className="text-2xl font-semibold tracking-tight text-white">
                    Mission requires a target
                  </h3>
                  <p className="max-w-xl text-sm leading-7 text-slate-400">
                    Define who you&apos;re targeting before launching a mission.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={focusIcpView}
                  className="btn-primary min-h-[48px] rounded-2xl px-5 shadow-[0_12px_28px_rgba(59,130,246,0.18)] transition hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  Go to Target
                </button>
              </div>
            </div>
          ) : null}

          {activeView === 'mission' && hasActiveIcp && !hasMission && activeIcpId ? (
            <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.72),rgba(5,10,18,0.92))] p-1 transition-all duration-300">
              <div className="rounded-[24px] border border-white/6 bg-[#050d18]/92 p-4 sm:p-5">
                <MissionBuilder icpId={activeIcpId} embedded />
              </div>
            </div>
          ) : null}

          {activeView === 'mission' && hasMission && missionMode === 'view' ? (
            <div className="space-y-5 transition-all duration-300">
              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.72),rgba(5,10,18,0.92))] p-5 shadow-[0_18px_40px_rgba(2,8,23,0.2)]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-300">
                      Mission
                    </div>
                    <h3 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                      {missionName}
                    </h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DetailPill label="Throughput" value={`${activeMission.leadsPerDay} leads/day`} />
                    <DetailPill label="Mode" value={activeMission.contactMode} />
                    <DetailPill label="Location" value={missionLocation} />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    void handleRunMission()
                  }}
                  disabled={missionRunState === 'running'}
                  className="btn-primary min-h-[48px] rounded-2xl px-5 shadow-[0_12px_28px_rgba(59,130,246,0.2)] transition hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                >
                  {missionRunState === 'running' ? 'Running mission...' : 'Run Mission'}
                </button>

                <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
                  <button
                    type="button"
                    onClick={() => setMissionMode('edit')}
                    className="btn-secondary min-h-[46px] rounded-[14px] border-0 bg-transparent px-4 text-slate-100 hover:bg-white/[0.06]"
                  >
                    Edit Mission
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDeleteMission()
                    }}
                    disabled={actionState === 'deleting-mission'}
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:text-rose-200/60"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>
                      {actionState === 'deleting-mission' ? 'Deleting...' : 'Delete Mission'}
                    </span>
                  </button>
                </div>
              </div>

              {showExecutionPanel ? (
                <div className="space-y-5">
                  {/* Scanning state */}
                  {isScanning ? (
                    <div className="relative overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(8,15,29,0.9),rgba(4,10,20,0.96))] p-6 shadow-[0_20px_60px_rgba(2,8,23,0.3)] backdrop-blur-xl sm:p-8">
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(96,165,250,0.14),transparent_60%)]" />
                      <div className="relative space-y-6">
                        <div className="flex items-start justify-between gap-6">
                          <div className="space-y-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-100">
                              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-300" />
                              Live Market Scan
                            </div>
                            <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                              Scanning the market
                            </h3>
                            <p className="text-sm leading-7 text-slate-400">
                              Searching {missionName} in {missionLocation}&nbsp;&mdash;&nbsp;this takes about 20–30 seconds.
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-3">
                            <div className="text-sm font-semibold tabular-nums text-slate-400">
                              ⏱ {elapsed}s
                            </div>
                            <button
                              type="button"
                              onClick={handleStopMission}
                              className="inline-flex items-center gap-2 rounded-[14px] border border-rose-400/22 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:border-rose-400/35 hover:bg-rose-500/16 active:scale-[0.97]"
                            >
                              <X className="h-3.5 w-3.5" />
                              Stop
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                          {[0, 1, 2, 3, 4, 5].map((i) => (
                            <div
                              key={i}
                              className="h-[140px] animate-pulse rounded-[22px] border border-white/8 bg-white/[0.03]"
                              style={{ animationDelay: `${i * 110}ms` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Results state */}
                  {isDone && missionRunResult ? (
                    <div className="space-y-5">
                      {/* Metrics */}
                      <div className="grid gap-3 sm:grid-cols-3">
                        <MetricTile label="Leads Found" value={String(missionRunResult.found)} />
                        <MetricTile label="With Email" value={String(missionRunResult.withEmail)} />
                        <MetricTile
                          label="Ready to Contact"
                          value={String(missionRunResult.readyToContact)}
                        />
                      </div>

                      {/* Leads grid */}
                      <div>
                        <div className="mb-5 flex items-end justify-between gap-4">
                          <div>
                            <h4 className="text-lg font-semibold tracking-tight text-white">
                              Live opportunities
                            </h4>
                            <p className="mt-1 text-sm text-slate-400">
                              {missionRunResult.query}
                              {missionRunResult.location
                                ? ` · ${missionRunResult.location}`
                                : null}
                            </p>
                          </div>
                          <div className="shrink-0 text-xs font-medium text-slate-500">
                            ⏱ {missionRunResult.elapsedSeconds ?? elapsed}s
                          </div>
                        </div>

                        {visibleLeads.length > 0 ? (
                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {visibleLeads.map((lead, index) => {
                              const hasEmail = Boolean(String(lead.email || '').trim())
                              return (
                                <LeadCard
                                  key={lead.email || lead.website || lead.company_name || index}
                                  lead={lead}
                                  hasEmail={hasEmail}
                                />
                              )
                            })}
                          </div>
                        ) : (
                          <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-10 text-center">
                            <p className="text-sm text-slate-400">
                              No leads found for this mission. Try adjusting your target profile or
                              location.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/dashboard/leads?mission_id=${missionRunResult.missionId}`
                            )
                          }
                          className="btn-primary min-h-[48px] rounded-2xl px-5 shadow-[0_12px_28px_rgba(59,130,246,0.18)] transition hover:-translate-y-0.5 active:scale-[0.98]"
                        >
                          View Leads
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleRunMission()
                          }}
                          className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] px-5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
                        >
                          Generate more leads
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Error state */}
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

          {activeView === 'mission' && hasMission && missionMode === 'edit' && activeIcpId ? (
            <div className="space-y-4 transition-all duration-300">
              <MissionBuilder icpId={activeIcpId} />
              <button
                type="button"
                onClick={() => setMissionMode('view')}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl px-1 text-sm text-slate-400 transition hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.045] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  )
}

function LeadCard({ lead, hasEmail }: { lead: TrialLead; hasEmail: boolean }) {
  const websiteDisplay = lead.website
    ? lead.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    : null

  return (
    <div
      className={`rounded-[24px] border p-5 transition-all duration-300 ${
        hasEmail
          ? 'border-blue-300/20 bg-[linear-gradient(160deg,rgba(59,130,246,0.12),rgba(8,15,29,0.82))] shadow-[0_8px_28px_rgba(59,130,246,0.1)]'
          : 'border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.04),rgba(5,10,18,0.72))]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold leading-snug tracking-tight text-white">
            {lead.company_name || 'Unknown company'}
          </div>
          {lead.city ? (
            <div className="mt-1 text-[13px] text-slate-400">{lead.city}</div>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${
            hasEmail
              ? 'border border-blue-300/22 bg-blue-500/15 text-blue-100'
              : 'border border-white/10 bg-white/[0.05] text-slate-400'
          }`}
        >
          {hasEmail ? 'Email' : 'Website'}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {lead.email ? (
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-[11px]">
              ✉
            </span>
            <span className="truncate font-medium text-blue-200">{lead.email}</span>
          </div>
        ) : null}
        {!lead.email && websiteDisplay ? (
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px]">
              🌐
            </span>
            <span className="truncate text-slate-300">{websiteDisplay}</span>
          </div>
        ) : null}
        {lead.phone ? (
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[11px]">
              📞
            </span>
            <span className="text-slate-400">{lead.phone}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
