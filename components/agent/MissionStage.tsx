'use client'

import { motion } from 'framer-motion'
import { Plus, Trash2 } from 'lucide-react'

type Mission = {
  id: string
  name: string | null
  status: string
  leadsToday: number
  daily_target?: number
  audience_input?: string | null
  location_input?: string | null
  location?: string | null
  last_run_at?: string | null
}

const STATUS_STYLES: Record<string, { label: string; tone: string; dot: string }> = {
  active: {
    label: 'Running',
    tone: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    dot: 'bg-emerald-400',
  },
  scheduled: {
    label: 'Scheduled',
    tone: 'border-blue-400/20 bg-blue-500/10 text-blue-200',
    dot: 'bg-blue-400',
  },
  paused: {
    label: 'Paused',
    tone: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
    dot: 'bg-amber-400',
  },
  archived: {
    label: 'Archived',
    tone: 'border-white/10 bg-white/[0.06] text-slate-300',
    dot: 'bg-slate-500',
  },
}

function missionTitle(mission: Mission) {
  if (mission.name) return mission.name
  const parts = [mission.audience_input, mission.location_input ?? mission.location]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  return parts.join(' · ') || 'Lead Mission'
}

function missionStatus(mission: Mission) {
  return STATUS_STYLES[mission.status] ?? {
    label: mission.status,
    tone: 'border-white/10 bg-white/[0.06] text-slate-300',
    dot: 'bg-slate-500',
  }
}

function relativeTime(value: string | null | undefined) {
  if (!value) return 'No recent run'
  const diff = Date.now() - new Date(value).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Updated just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function Metric({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="min-w-[84px] rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-white">
        {value}
      </div>
    </div>
  )
}

export default function MissionStage({
  missions,
  onSelect,
  onCreateMission,
  onDeleteMission,
  highlightedMissionId,
}: {
  missions: Mission[]
  onSelect: (id: string) => void
  onCreateMission: () => void
  onDeleteMission?: (id: string) => Promise<void> | void
  highlightedMissionId?: string | null
}) {
  if (!missions || missions.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.06] text-white/60 backdrop-blur-xl">
        Create your first mission
      </div>
    )
  }

  const hero = missions[0]
  const orbitMissions = missions.slice(1, 4)
  const scrollMissions = missions.slice(1)
  const heroStatus = missionStatus(hero)
  const showScrollStage = missions.length > 4

  async function handleDelete(event: React.MouseEvent, missionId: string) {
    event.stopPropagation()
    if (!onDeleteMission) return
    if (!window.confirm('Delete this mission permanently?')) return
    await onDeleteMission(missionId)
  }

  return (
    <div className="space-y-5">
      <motion.div
        layout
        whileHover={{ scale: 1.01 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        onClick={() => onSelect(hero.id)}
        className={`relative cursor-pointer overflow-hidden rounded-[30px] border p-6 shadow-[0_32px_90px_rgba(2,8,23,0.42)] backdrop-blur-xl ${
          hero.status === 'active' || hero.status === 'scheduled'
            ? 'border-blue-300/20 bg-white/[0.10]'
            : 'border-white/14 bg-white/[0.08]'
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(255,255,255,0.02),rgba(124,58,237,0.12))]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${heroStatus.tone}`}>
                <span className={`h-2 w-2 rounded-full ${heroStatus.dot}`} />
                {heroStatus.label}
              </span>
              <span className="text-xs uppercase tracking-[0.22em] text-white/35">
                Mission Stage
              </span>
            </div>

            <div className="space-y-2">
              <h2 className="max-w-3xl text-2xl font-semibold tracking-tight text-white md:text-3xl">
                {missionTitle(hero)}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-white/58">
                {hero.location_input || hero.location || 'Global'} mission control with live run telemetry and draft generation visibility.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-3">
            <Metric label="Leads Today" value={hero.leadsToday} />
            <Metric label="Target" value={hero.daily_target ?? 0} />
            <Metric label="Last Run" value={relativeTime(hero.last_run_at)} />
          </div>
        </div>

        {onDeleteMission ? (
          <button
            type="button"
            onClick={(event) => void handleDelete(event, hero.id)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-black/25 text-white/48 transition hover:border-red-400/25 hover:text-red-300"
            aria-label="Delete mission"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </motion.div>

      {!showScrollStage && orbitMissions.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {orbitMissions.map((mission) => {
            const status = missionStatus(mission)
            const highlighted = highlightedMissionId === mission.id

            return (
              <motion.div
                key={mission.id}
                layout
                whileHover={{ scale: 1.03, opacity: 1 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                onClick={() => onSelect(mission.id)}
                className={`relative cursor-pointer overflow-hidden rounded-2xl border p-4 backdrop-blur-md ${
                  highlighted
                    ? 'border-blue-300/30 bg-white/[0.12] shadow-[0_0_28px_rgba(59,130,246,0.18)]'
                    : 'border-white/10 bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.tone}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                  <span className="text-xs tabular-nums text-white/40">{mission.leadsToday} leads</span>
                </div>

                <div className="mt-4 text-sm font-medium text-white">
                  {missionTitle(mission)}
                </div>

                {onDeleteMission ? (
                  <button
                    type="button"
                    onClick={(event) => void handleDelete(event, mission.id)}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/40 transition hover:border-red-400/25 hover:text-red-300"
                    aria-label="Delete mission"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </motion.div>
            )
          })}

          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={onCreateMission}
            className="flex min-h-[152px] items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/[0.03] text-white/60 backdrop-blur-md transition hover:border-white/30 hover:text-white"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Plus className="h-4 w-4" />
              New mission
            </span>
          </motion.button>
        </div>
      ) : null}

      {showScrollStage ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">
              Mission Orbit
            </p>
            <button
              type="button"
              onClick={onCreateMission}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/62 backdrop-blur-md transition hover:border-white/20 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              New mission
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-2">
            {scrollMissions.map((mission) => {
              const status = missionStatus(mission)
              const highlighted = highlightedMissionId === mission.id

              return (
                <motion.div
                  key={mission.id}
                  whileHover={{ scale: 1.03 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  onClick={() => onSelect(mission.id)}
                  className={`relative min-w-[240px] cursor-pointer rounded-2xl border p-4 backdrop-blur-md ${
                    highlighted
                      ? 'border-blue-300/30 bg-white/[0.12] shadow-[0_0_28px_rgba(59,130,246,0.18)]'
                      : 'border-white/10 bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.tone}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                    <span className="text-xs tabular-nums text-white/40">{mission.leadsToday}</span>
                  </div>

                  <div className="mt-4 text-sm font-medium text-white">
                    {missionTitle(mission)}
                  </div>

                  {onDeleteMission ? (
                    <button
                      type="button"
                      onClick={(event) => void handleDelete(event, mission.id)}
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/40 transition hover:border-red-400/25 hover:text-red-300"
                      aria-label="Delete mission"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </motion.div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
