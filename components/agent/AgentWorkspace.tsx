'use client'

import { useState } from 'react'
import { Crosshair, Inbox, SendHorizonal, SlidersHorizontal } from 'lucide-react'

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
const NO_TARGET_SUMMARY = 'No active target profile yet.'

export default function AgentWorkspace({
  initialSavedIcps,
  initialActiveIcp,
  initialMissions,
  initialActiveMission,
}: AgentWorkspaceProps) {
  const [savedIcps] = useState(initialSavedIcps)
  const [activeIcp] = useState(initialActiveIcp)
  const [missions] = useState(initialMissions)
  const [activeMission] = useState(initialActiveMission)
  const [activeView, setActiveView] = useState<'mission' | 'icp'>(
    initialActiveMission ? 'mission' : 'icp'
  )
  const [icpMode, setIcpMode] = useState<'view' | 'edit'>('view')
  const [missionMode, setMissionMode] = useState<'view' | 'edit'>('view')

  const hasActiveIcp = activeIcp !== null
  const hasMission = activeMission !== null && missions.length > 0
  const activeIcpId = activeIcp ? activeIcp.id : null
  const activeIcpData = activeIcp ? activeIcp.data : null
  const missionName =
    activeMission && activeMission.name ? activeMission.name : NO_MISSION_LABEL
  const missionLocation =
    activeMission && activeMission.location ? activeMission.location : NO_LOCATION_LABEL
  const missionDetails =
    activeMission !== null
      ? `${activeMission.leadsPerDay} leads/day • ${activeMission.contactMode}`
      : '0 leads/day • email'
  const icpSummary = activeIcpData ? activeIcpData.summary : NO_TARGET_SUMMARY
  const icpLocation =
    activeIcpData && activeIcpData.location.length > 0
      ? activeIcpData.location.join(' • ')
      : NO_LOCATION_LABEL

  function focusIcpView() {
    setActiveView('icp')
    setIcpMode('view')
  }

  function focusMissionView() {
    setActiveView('mission')
    setMissionMode('view')
  }

  const flowSegments = [
    {
      key: 'icp',
      label: 'Target',
      description: hasActiveIcp ? 'Configured' : 'Required',
      configured: hasActiveIcp,
      focused: activeView === 'icp',
      disabled: false,
      icon: Crosshair,
      onClick: focusIcpView,
    },
    {
      key: 'mission',
      label: 'Mission',
      description: hasMission ? 'Configured' : 'Next step',
      configured: hasMission,
      focused: activeView === 'mission',
      disabled: false,
      icon: SlidersHorizontal,
      onClick: focusMissionView,
    },
    {
      key: 'queue',
      label: 'Queue',
      description: 'Soon',
      configured: false,
      focused: false,
      disabled: true,
      icon: Inbox,
      onClick: undefined,
    },
    {
      key: 'output',
      label: 'Output',
      description: 'Soon',
      configured: false,
      focused: false,
      disabled: true,
      icon: SendHorizonal,
      onClick: undefined,
    },
  ] as const

  return (
    <div className="space-y-6">
      <section className="sticky top-4 z-20">
        <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.94),rgba(4,10,20,0.9))] p-3 shadow-[0_20px_60px_rgba(2,8,23,0.28),0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-xl">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {flowSegments.map((segment) => {
              const Icon = segment.icon
              const baseClassName = `group flex min-h-[84px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-200 ${
                segment.disabled
                  ? 'cursor-default border-white/6 bg-white/[0.02] text-slate-500'
                  : segment.focused
                    ? 'border-blue-400/30 bg-blue-500/12 text-white shadow-[0_0_24px_rgba(59,130,246,0.14)] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(59,130,246,0.16)]'
                    : segment.configured
                      ? 'cursor-pointer border-emerald-300/18 bg-emerald-400/8 text-slate-100 hover:-translate-y-0.5 hover:bg-emerald-400/12 hover:shadow-[0_10px_28px_rgba(34,197,94,0.12)]'
                      : 'cursor-pointer border-white/10 bg-white/[0.03] text-slate-300 hover:-translate-y-0.5 hover:bg-white/[0.05] hover:shadow-[0_10px_28px_rgba(15,23,42,0.22)]'
              }`

              const content = (
                <>
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition ${
                      segment.disabled
                        ? 'border-white/8 bg-white/[0.03] text-slate-500'
                        : segment.focused
                          ? 'border-blue-300/24 bg-blue-500/16 text-blue-100'
                          : segment.configured
                            ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100'
                            : 'border-white/10 bg-white/[0.04] text-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{segment.label}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-current/70">
                      {segment.description}
                    </div>
                  </div>
                </>
              )

              if (segment.disabled || !segment.onClick) {
                return (
                  <div key={segment.key} className={baseClassName}>
                    {content}
                  </div>
                )
              }

              return (
                <button
                  key={segment.key}
                  type="button"
                  onClick={segment.onClick}
                  className={baseClassName}
                >
                  {content}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4 transition-all duration-300">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                Current Task
              </div>
              <div className="mt-1 text-sm text-slate-400">
                {hasActiveIcp && !hasMission && activeView === 'icp'
                  ? 'Target is configured. Mission is the next step when you are ready.'
                  : 'Work through one focused step at a time.'}
              </div>
            </div>
          </div>

          {!hasActiveIcp ? <ICPInput initialSavedIcps={savedIcps} /> : null}

          {activeView === 'icp' && hasActiveIcp && icpMode === 'view' ? (
            <section className="glass overflow-hidden p-5 shadow-[0_18px_50px_rgba(2,8,23,0.28)] transition-all duration-300 sm:p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-green-300">
                    Target Profile
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">
                    Review or adjust your targeting
                  </h2>
                </div>

                <div className="rounded-[28px] border border-green-400/18 bg-[linear-gradient(180deg,rgba(20,83,45,0.18),rgba(6,95,70,0.1))] p-1 shadow-[0_0_36px_rgba(34,197,94,0.12)]">
                  <div className="rounded-[24px] border border-white/6 bg-[#04110b]/80 p-4 sm:p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="rounded-full border border-green-400/18 bg-green-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-green-100">
                        Agent Decision
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-r from-green-400/20 to-transparent" />
                    </div>
                    {activeIcpData ? <ICPPreview data={activeIcpData} /> : null}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setIcpMode('edit')}
                    className="btn-secondary min-h-[48px] rounded-2xl px-5"
                  >
                    Replace
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeView === 'icp' && hasActiveIcp && icpMode === 'edit' ? (
            <div className="space-y-4 transition-all duration-300">
              <ICPInput initialSavedIcps={savedIcps} builderOnly />

              <button
                type="button"
                onClick={() => setIcpMode('view')}
                className="text-sm text-slate-400 transition hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          ) : null}

          {activeView === 'mission' && hasActiveIcp && !hasMission && activeIcpId ? (
            <section className="glass overflow-hidden p-5 shadow-[0_18px_50px_rgba(2,8,23,0.28)] transition-all duration-300 sm:p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-300">
                    Current Task
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">Launch Mission</h2>
                  <p className="text-sm leading-6 text-slate-400">
                    Define what the agent should do daily.
                  </p>
                </div>

                <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.72),rgba(5,10,18,0.92))] p-1">
                  <div className="rounded-[24px] border border-white/6 bg-[#050d18]/90 p-4 sm:p-5">
                    <MissionBuilder icpId={activeIcpId} embedded />
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activeView === 'mission' && hasMission && missionMode === 'view' ? (
            <section className="glass overflow-hidden p-5 shadow-[0_18px_50px_rgba(2,8,23,0.28)] transition-all duration-300 sm:p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-300">
                    Mission
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">{missionName}</h2>
                  <p className="text-sm leading-6 text-slate-400">
                    The mission is configured and ready for the next execution step.
                  </p>
                </div>

                <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,29,0.72),rgba(5,10,18,0.92))] p-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DetailPill label="Throughput" value={`${activeMission.leadsPerDay} leads/day`} />
                    <DetailPill label="Mode" value={activeMission.contactMode} />
                    <DetailPill label="Location" value={missionLocation} />
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button type="button" className="btn-primary min-h-[48px] rounded-2xl px-5 sm:flex-1">
                    Run Mission
                  </button>
                  <button
                    type="button"
                    onClick={() => setMissionMode('edit')}
                    className="btn-secondary min-h-[48px] rounded-2xl px-5"
                  >
                    Edit Mission
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {activeView === 'mission' && hasMission && missionMode === 'edit' && activeIcpId ? (
            <div className="space-y-4 transition-all duration-300">
              <MissionBuilder icpId={activeIcpId} />

              <button
                type="button"
                onClick={() => setMissionMode('view')}
                className="text-sm text-slate-400 transition hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-28">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
            Agent Stack
          </div>

          {hasActiveIcp ? (
            <button
              type="button"
              onClick={focusIcpView}
              className={`glass w-full space-y-3 rounded-[26px] p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.04] ${
                activeView === 'icp'
                  ? 'border border-green-400/28 shadow-[0_0_24px_rgba(34,197,94,0.14)]'
                  : ''
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-green-300">
                Active ICP
              </div>
              <p className="line-clamp-4 text-sm leading-6 text-slate-300">{icpSummary}</p>
              <div className="truncate text-xs text-slate-400">{icpLocation}</div>
            </button>
          ) : null}

          {hasMission ? (
            <button
              type="button"
              onClick={focusMissionView}
              className={`glass w-full space-y-3 rounded-[26px] p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.04] ${
                activeView === 'mission'
                  ? 'border border-blue-400/28 shadow-[0_0_24px_rgba(59,130,246,0.14)]'
                  : ''
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
                Active Mission
              </div>
              <p className="truncate text-sm font-medium text-white">{missionName}</p>
              <div className="text-xs text-slate-400">{missionDetails}</div>
              <div className="truncate text-xs text-slate-400">{missionLocation}</div>
            </button>
          ) : null}

          {!hasActiveIcp ? (
            <div className="glass rounded-[26px] p-4 text-sm leading-6 text-slate-400">
              Start by creating a target profile.
            </div>
          ) : null}
        </aside>
      </div>
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
