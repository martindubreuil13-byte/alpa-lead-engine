'use client'

import { Pause, Pencil, Play, Square } from 'lucide-react'

export type FloatingMission = {
  id: string
  status: string
  name: string | null
  audience_input: string | null
  location_input: string | null
  location: string
}

function missionLabel(m: FloatingMission): string {
  if (m.name) return m.name.slice(0, 28)
  const parts = [m.audience_input, m.location_input || m.location].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ').slice(0, 28) : 'Lead Mission'
}

type Props = {
  mission: FloatingMission
  actioning: boolean
  onToggle: () => void
  onStop: () => void
  onEdit: () => void
}

export function FloatingControls({ mission, actioning, onToggle, onStop, onEdit }: Props) {
  const isActive = mission.status === 'active'
  const isPaused = mission.status === 'paused'
  const canToggle = isActive || isPaused

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {/* Mission label */}
      <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[rgba(10,10,18,0.90)] px-3 py-1.5 backdrop-blur-xl">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isActive ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'
          }`}
        />
        <span className="text-[11px] font-medium text-slate-400">{missionLabel(mission)}</span>
      </div>

      {/* Control buttons */}
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-[rgba(10,10,18,0.90)] p-2 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        {/* Edit */}
        <button
          type="button"
          onClick={onEdit}
          title="Edit mission"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-500 transition hover:bg-white/[0.07] hover:text-slate-200"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>

        {/* Pause / Resume */}
        {canToggle && (
          <button
            type="button"
            disabled={actioning}
            onClick={onToggle}
            title={isActive ? 'Pause mission' : 'Resume mission'}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-400 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
          >
            {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* Stop */}
        {isActive && (
          <button
            type="button"
            disabled={actioning}
            onClick={onStop}
            title="Stop mission"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/15 bg-red-500/[0.06] text-red-500/60 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
