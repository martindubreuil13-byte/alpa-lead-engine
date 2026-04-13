'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Crosshair,
  Inbox,
  SendHorizonal,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react'

import ICPInput from '@/components/agent/ICPInput'
import ICPPreview from '@/components/agent/ICPPreview'
import MissionBuilder from '@/components/agent/MissionBuilder'
import type { ICPData } from '@/lib/ai/icp'

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

const NO_MISSION_LABEL = 'No mission yet'
const NO_LOCATION_LABEL = 'Global'

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

  const hasActiveIcp = activeIcp !== null
  const hasMission = activeMission !== null && missions.length > 0
  const activeIcpId = activeIcp ? activeIcp.id : null
  const activeIcpData = activeIcp ? activeIcp.data : null
  const missionName =
    activeMission && activeMission.name ? activeMission.name : NO_MISSION_LABEL
  const missionLocation =
    activeMission && activeMission.location ? activeMission.location : NO_LOCATION_LABEL

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

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to delete target')
      }

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

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to delete mission')
      }

      focusMissionView()
      router.refresh()
    } catch (error) {
      console.error(error)
      setActionState('idle')
    }
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
    <div className="mx-auto w-full max-w-5xl space-y-5 px-0 sm:space-y-6">
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
                  className="btn-primary min-h-[48px] rounded-2xl px-5 shadow-[0_12px_28px_rgba(59,130,246,0.2)] transition hover:-translate-y-0.5"
                >
                  Run Mission
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
                    <span>{actionState === 'deleting-mission' ? 'Deleting...' : 'Delete Mission'}</span>
                  </button>
                </div>
              </div>
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
