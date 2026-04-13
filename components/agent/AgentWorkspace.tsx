'use client'

import { useState } from 'react'

import type { ICPData } from '@/lib/ai/icp'
import ICPInput from '@/components/agent/ICPInput'
import ICPPreview from '@/components/agent/ICPPreview'
import MissionBuilder from '@/components/agent/MissionBuilder'

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
  activeIcp: SavedIcpRecord | null
  activeMission: AgentMissionRecord | null
}

export default function AgentWorkspace({
  initialSavedIcps,
  activeIcp,
  activeMission,
}: AgentWorkspaceProps) {
  const [activeView, setActiveView] = useState<'mission' | 'icp'>(activeMission ? 'mission' : 'icp')
  const [icpMode, setIcpMode] = useState<'view' | 'edit'>('view')
  const [missionMode, setMissionMode] = useState<'view' | 'edit'>('view')

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {!activeIcp ? <ICPInput initialSavedIcps={initialSavedIcps} /> : null}

        {activeView === 'icp' && activeIcp && icpMode === 'view' ? (
            <div className="glass p-6 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-green-300">
                ICP Configuration
              </div>

              <ICPPreview data={activeIcp.data} />

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIcpMode('edit')}
                  className="btn-secondary"
                >
                  Replace
                </button>
              </div>
            </div>
        ) : null}

        {activeView === 'icp' && icpMode === 'edit' ? (
          <div className="space-y-4">
            <ICPInput initialSavedIcps={initialSavedIcps} builderOnly />

            <button
              type="button"
              onClick={() => setIcpMode('view')}
              className="text-sm text-slate-400"
            >
              Cancel
            </button>
          </div>
        ) : null}

        {activeView === 'mission' && activeIcp && !activeMission ? (
          <div className="glass p-6 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
              Current Task
            </div>
            <h2 className="text-xl font-semibold text-white">
              Launch Mission
            </h2>
            <p className="text-sm text-slate-400">
              Define what the agent should do daily
            </p>

            <MissionBuilder icpId={activeIcp.id} embedded />
          </div>
        ) : null}

        {activeView === 'mission' && activeMission && missionMode === 'view' ? (
          <div className="glass p-6 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
              Mission Active
            </div>

            <h2 className="text-xl font-semibold text-white">
              {activeMission.name || 'Untitled mission'}
            </h2>

            <div className="text-sm text-slate-400">
              {activeMission.leadsPerDay} leads/day • {activeMission.contactMode}
            </div>

            <div className="text-sm text-slate-400">
              {activeMission.location}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMissionMode('edit')}
                className="btn-secondary"
              >
                Edit Mission
              </button>

              <button className="btn-primary flex-1">
                Run Mission
              </button>
            </div>
          </div>
        ) : null}

        {activeView === 'mission' && activeMission && missionMode === 'edit' && activeIcp ? (
          <div className="space-y-4">
            <MissionBuilder icpId={activeIcp.id} />

            <button
              type="button"
              onClick={() => setMissionMode('view')}
              className="text-sm text-slate-400"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        {activeIcp ? (
          <div
            onClick={() => {
              setActiveView('icp')
              setIcpMode('view')
            }}
            className={`glass cursor-pointer p-4 space-y-3 transition hover:bg-white/[0.03] ${
              activeView === 'icp'
                ? 'border border-green-400/30 shadow-[0_0_24px_rgba(34,197,94,0.12)]'
                : ''
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-green-300">
              Active ICP
            </div>

            <p className="text-sm text-slate-300">
              {activeIcp.data.summary}
            </p>

            <div className="text-xs text-slate-400">
              {activeIcp.data.location.join(' • ')}
            </div>
          </div>
        ) : null}

        {activeMission ? (
          <div
            onClick={() => {
              setActiveView('mission')
              setMissionMode('view')
            }}
            className={`glass cursor-pointer p-4 space-y-3 transition hover:bg-white/[0.03] ${
              activeView === 'mission'
                ? 'border border-blue-400/30 shadow-[0_0_24px_rgba(59,130,246,0.12)]'
                : ''
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
              Active Mission
            </div>

            <p className="text-sm text-white">
              {activeMission.name || 'Untitled mission'}
            </p>

            <div className="text-xs text-slate-400">
              {activeMission.leadsPerDay} leads/day • {activeMission.contactMode}
            </div>

            <div className="text-xs text-slate-400">
              {activeMission.location}
            </div>
          </div>
        ) : null}

        {!activeIcp ? (
          <div className="glass p-4 text-sm text-slate-500">
            Start by creating an ICP
          </div>
        ) : null}
      </div>
    </div>
  )
}
