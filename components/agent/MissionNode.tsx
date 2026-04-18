'use client'

export type NodeMission = {
  id: string
  name: string | null
  status: string
  audience_input: string | null
  location_input: string | null
  location: string
  daily_target: number
  leadsToday: number
}

function nodeTitle(m: NodeMission): string {
  if (m.name) return m.name.slice(0, 22)
  const parts = [m.audience_input, m.location_input ?? m.location].filter(Boolean)
  return (parts.join(' · ') || 'Lead Mission').slice(0, 22)
}

function nodeStat(m: NodeMission): string {
  if (m.status === 'needs_review') return 'review ready'
  if (m.status === 'paused') return 'paused'
  if (m.status === 'exhausted') return 'exhausted'
  if (m.leadsToday > 0) return `${m.leadsToday} lead${m.leadsToday !== 1 ? 's' : ''} today`
  return 'scanning…'
}

function dotColor(status: string): string {
  if (status === 'active') return 'bg-emerald-400'
  if (status === 'needs_review') return 'bg-violet-400'
  if (status === 'paused') return 'bg-amber-400'
  if (status === 'exhausted') return 'bg-orange-400'
  return 'bg-slate-500'
}

type Props = {
  mission: NodeMission
  onClick: () => void
  width: number
}

export function MissionNode({ mission, onClick, width }: Props) {
  const isActive = mission.status === 'active'

  return (
    <button
      type="button"
      onClick={onClick}
      className="ai-node-float flex cursor-pointer flex-col gap-1 rounded-full border px-5 py-2.5 text-left transition-all hover:border-blue-400/40 hover:bg-[rgba(15,23,42,0.88)] hover:shadow-[0_0_24px_rgba(59,130,246,0.20)] active:scale-95"
      style={{
        width,
        background: 'rgba(15,23,42,0.65)',
        border: '1px solid rgba(59,130,246,0.20)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dotColor(mission.status)} ${isActive ? 'animate-pulse' : ''}`}
        />
        <span
          className="truncate text-[12px] font-semibold leading-none"
          style={{ color: 'rgba(255,255,255,0.90)' }}
        >
          {nodeTitle(mission)}
        </span>
      </div>
      <span
        className="truncate pl-4 text-[10px] leading-none"
        style={{ color: 'rgba(255,255,255,0.40)', letterSpacing: '0.05em' }}
      >
        {nodeStat(mission)}
      </span>
    </button>
  )
}
