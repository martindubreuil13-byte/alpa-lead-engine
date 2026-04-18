'use client'

import { memo } from 'react'

export type MissionCardData = {
  id: string
  name: string | null
  status: string
  audience_input: string | null
  location_input: string | null
  location: string
  daily_target: number
  leadsToday: number
  created_at: string
  last_run_at?: string | null
}

type Props = {
  mission: MissionCardData
  onClick: () => void
  /** Temporarily true when a lead_found event targets this card (~400 ms). */
  highlighted?: boolean
}

const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  active:       { dot: '#34d399', label: 'Active'       },
  running:      { dot: '#34d399', label: 'Running'      },
  needs_review: { dot: '#a78bfa', label: 'Review ready' },
  paused:       { dot: '#fbbf24', label: 'Paused'       },
  exhausted:    { dot: '#fb923c', label: 'Exhausted'    },
  completed:    { dot: '#94a3b8', label: 'Completed'    },
  stopped:      { dot: '#475569', label: 'Stopped'      },
}

function cardTitle(m: MissionCardData): string {
  if (m.name) return m.name
  const parts = [m.audience_input, m.location_input ?? m.location].filter(Boolean)
  return parts.join(' · ') || 'Lead Mission'
}

function relativeTime(iso: string | null | undefined, fallback: string): string {
  const src = iso ?? fallback
  const diff = Date.now() - new Date(src).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export const MissionCard = memo(function MissionCard({ mission, onClick, highlighted = false }: Props) {
  const cfg = STATUS_CONFIG[mission.status] ?? { dot: '#64748b', label: mission.status }
  const isActive = mission.status === 'active' || mission.status === 'running'
  const isPaused = mission.status === 'paused'
  const isStopped = mission.status === 'stopped'

  // All visual state is CSS-driven — no JS animation loops.
  const edgeShadow =
    highlighted
      ? '0 0 0 1.5px rgba(96,165,250,0.50), 0 8px 32px rgba(59,130,246,0.18)'
      : isActive
        ? '0 0 0 1px rgba(52,211,153,0.12), 0 4px 20px rgba(2,6,23,0.38)'
        : '0 4px 20px rgba(2,6,23,0.32)'

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        textAlign: 'left',
        width: 210,
        flexShrink: 0,
        padding: '15px 17px',
        borderRadius: 17,
        background:
          'linear-gradient(148deg, rgba(15,23,42,0.82) 0%, rgba(8,13,28,0.90) 100%)',
        border: '1px solid rgba(59,130,246,0.12)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: edgeShadow,
        opacity: isStopped ? 0.42 : isPaused ? 0.68 : 1,
        // GPU-safe transitions only — no box-shadow, no blur animation
        transform: highlighted ? 'scale(1.02)' : 'scale(1)',
        transition: 'transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease',
        cursor: 'pointer',
      }}
    >
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            background: cfg.dot,
            // Active dot has a static halo — CSS only, no animation for paused/stopped
            boxShadow: isActive ? `0 0 6px ${cfg.dot}88` : undefined,
          }}
        />
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 500,
            letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.35)',
            textTransform: 'uppercase',
          }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Title */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.88)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          lineHeight: 1.35,
        }}
      >
        {cardTitle(mission)}
      </span>

      {/* Metrics footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: 'rgba(255,255,255,0.28)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: 10,
        }}
      >
        <span>
          {mission.leadsToday > 0
            ? `${mission.leadsToday} lead${mission.leadsToday !== 1 ? 's' : ''} today`
            : 'No leads today'}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.18)' }}>
          {relativeTime(mission.last_run_at, mission.created_at)}
        </span>
      </div>
    </button>
  )
})
