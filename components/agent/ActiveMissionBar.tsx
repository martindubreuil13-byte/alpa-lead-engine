'use client'

import { Pause, Play, Square } from 'lucide-react'
import { useRouter } from 'next/navigation'

export type MissionBarItem = {
  id: string
  name: string | null
  status: string
  audience_input: string | null
  location_input: string | null
  location: string
  daily_target: number
  leadsToday: number
}

function missionTitle(m: MissionBarItem): string {
  if (m.name) return m.name.slice(0, 40)
  const parts = [m.audience_input, m.location_input || m.location].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ').slice(0, 40) : 'Lead Mission'
}

type Props = {
  missions: MissionBarItem[]
  actioning: string | null
  onToggle: (mission: MissionBarItem) => void
  onStop: (mission: MissionBarItem) => void
}

export function ActiveMissionBar({ missions, actioning, onToggle, onStop }: Props) {
  const router = useRouter()

  if (missions.length === 0) return null

  return (
    <div className="glass overflow-hidden rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Active Missions
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-slate-700">{missions.length}</span>
      </div>

      {/* Scrollable mission list */}
      <div className="flex gap-3 overflow-x-auto p-4 pb-3">
        {missions.map((m) => {
          const title = missionTitle(m)
          const progress = Math.min(100, Math.round((m.leadsToday / Math.max(1, m.daily_target)) * 100))
          const isActive = m.status === 'active'
          const isNeedsReview = m.status === 'needs_review'
          const busy = actioning === m.id

          return (
            <div
              key={m.id}
              className="flex min-w-[200px] max-w-[224px] shrink-0 flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3"
            >
              {/* Status + title */}
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    isActive
                      ? 'animate-pulse bg-emerald-400'
                      : isNeedsReview
                      ? 'bg-violet-400'
                      : 'bg-amber-400'
                  }`}
                />
                <span className="line-clamp-2 text-xs font-medium leading-snug text-slate-300">
                  {title}
                </span>
              </div>

              {/* Progress bar */}
              <div>
                <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      isActive
                        ? 'bg-[linear-gradient(90deg,#34d399,#3b82f6)]'
                        : 'bg-[linear-gradient(90deg,#3b82f6,#818cf8)]'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] tabular-nums text-slate-700">
                  {m.leadsToday} / {m.daily_target} leads
                </p>
              </div>

              {/* Actions — always visible for active missions */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => router.push(`/agent/dashboard/${m.id}`)}
                  className="flex-1 rounded-lg border border-white/[0.07] bg-white/[0.02] py-1.5 text-[10px] font-medium text-slate-400 transition hover:border-white/10 hover:text-white"
                >
                  Open
                </button>

                {/* Pause / Resume — always shown */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onToggle(m)}
                  title={isActive ? 'Pause' : 'Resume'}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.02] text-slate-500 transition hover:border-white/10 hover:text-slate-300 disabled:opacity-40"
                >
                  {isActive ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
                </button>

                {/* Stop — always shown for active */}
                {isActive && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onStop(m)}
                    title="Stop mission"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-slate-600 transition hover:border-red-400/25 hover:text-red-400 disabled:opacity-40"
                  >
                    <Square className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
