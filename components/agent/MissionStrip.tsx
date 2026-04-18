'use client'

import { Pause, Play, Square } from 'lucide-react'
import { useRouter } from 'next/navigation'

export type MissionStripItem = {
  id: string
  name: string | null
  status: string
  audience_input: string | null
  location_input: string | null
  location: string
  daily_target: number
  leadsToday: number
}

function stripTitle(m: MissionStripItem): string {
  if (m.name) return m.name.slice(0, 32)
  const parts = [m.audience_input, m.location_input || m.location].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ').slice(0, 32) : 'Lead Mission'
}

function statusDot(status: string): string {
  if (status === 'active') return 'bg-emerald-400 animate-pulse'
  if (status === 'scheduled') return 'bg-blue-400'
  if (status === 'paused') return 'bg-amber-400'
  return 'bg-slate-500'
}

type Props = {
  missions: MissionStripItem[]
  actioning: string | null
  onToggle: (mission: MissionStripItem) => void
  onStop: (mission: MissionStripItem) => void
}

export function MissionStrip({ missions, actioning, onToggle, onStop }: Props) {
  const router = useRouter()

  if (missions.length === 0) return null

  return (
    <div className="sticky top-[64px] z-40 -mx-4 overflow-hidden border-b border-white/[0.05] bg-[rgba(10,10,18,0.85)] px-4 py-3 backdrop-blur-xl sm:-mx-0 sm:px-6">
      <div className="flex gap-3 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden">
        {missions.map((m) => {
          const title = stripTitle(m)
          const progress = Math.min(100, Math.round((m.leadsToday / Math.max(1, m.daily_target)) * 100))
          const isActive = m.status === 'active'
          const busy = actioning === m.id

          return (
            <div
              key={m.id}
              className="flex h-[64px] w-[240px] shrink-0 cursor-pointer flex-col justify-between rounded-xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.06]"
              onClick={() => router.push(`/agent/dashboard/${m.id}`)}
            >
              {/* Top row: status dot + title + buttons */}
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(m.status)}`} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-none text-white">
                  {title}
                </span>
                {/* Inline controls — stop propagation */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onToggle(m)}
                    title={isActive ? 'Pause' : 'Resume'}
                    className="flex h-5 w-5 items-center justify-center rounded-md border border-white/[0.07] text-slate-500 transition hover:border-white/12 hover:text-slate-300 disabled:opacity-30"
                  >
                    {isActive ? <Pause className="h-2 w-2" /> : <Play className="h-2 w-2" />}
                  </button>
                  {isActive && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onStop(m)}
                      title="Stop"
                      className="flex h-5 w-5 items-center justify-center rounded-md border border-white/[0.06] text-slate-600 transition hover:border-red-400/25 hover:text-red-400 disabled:opacity-30"
                    >
                      <Square className="h-2 w-2" />
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-auto space-y-0.5">
                <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      isActive
                        ? 'bg-[linear-gradient(90deg,#34d399,#3b82f6)]'
                        : 'bg-white/20'
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[9px] tabular-nums text-slate-700">
                  {m.leadsToday} / {m.daily_target}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
