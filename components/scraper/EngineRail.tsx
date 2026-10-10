import type { EngineView } from '@/lib/scraper/engine-view'
import { formatStageDuration } from '@/lib/scraper/stage-timing'

type EngineRailProps = {
  view: EngineView
}

type RailTone = 'active' | 'complete' | 'upcoming'

const TONE: Record<RailTone, { rule: string; label: string; value: string }> = {
  active: { rule: 'border-t-[#d8c28a]', label: 'text-white', value: 'text-white/90' },
  complete: { rule: 'border-t-white/25', label: 'text-white/75', value: 'text-white/70' },
  upcoming: { rule: 'border-t-white/10', label: 'text-white/55', value: 'text-white/55' },
}

function RailItem({
  index,
  name,
  shortName,
  tone,
  value,
  sub,
}: {
  index: string
  name: string
  /** Shown instead of `name` on narrow screens. */
  shortName?: string
  tone: RailTone
  value: string
  sub?: string
}) {
  const style = TONE[tone]
  return (
    <li className={`border-t pt-3 transition-colors duration-700 ${style.rule}`}>
      <div className={`text-[11px] font-medium uppercase tracking-[0.18em] sm:text-xs sm:tracking-[0.2em] ${style.label}`}>
        <span className="tabular-nums text-white/45">{index}</span>
        <span className="ml-2 sm:ml-3">
          {shortName ? (
            <>
              <span className="sm:hidden">{shortName}</span>
              <span className="hidden sm:inline">{name}</span>
            </>
          ) : (
            name
          )}
        </span>
      </div>
      <p className={`mt-2 text-sm tabular-nums ${style.value}`}>{value}</p>
      <p className="mt-1 min-h-[1rem] text-xs text-white/50">{sub}</p>
    </li>
  )
}

// The slim stage map beneath the focal area. It is deliberately quiet: small type, hairlines, no
// large numbers. The active stage is marked by a gold hairline; completed stages stay as small
// facts; Business Profiles are stated honestly as a separate step, never as part of this search.
export default function EngineRail({ view }: EngineRailProps) {
  const { discover, enrich } = view

  const enrichValue =
    enrich.state === 'pending'
      ? 'Waiting'
      : enrich.planned === 0
        ? 'No websites to check'
        : enrich.state === 'complete'
          ? `${enrich.completed} checked`
          : enrich.planned !== null
            ? `${enrich.completed} of ${enrich.planned} checked`
            : `${enrich.completed} checked`

  return (
    <ol aria-label="Search stages" className="mt-8 grid grid-cols-3 gap-4 sm:gap-10">
      <RailItem
        index="01"
        name="Discover"
        tone={discover.state === 'complete' ? 'complete' : 'active'}
        value={discover.state === 'complete' ? `${discover.count} found` : 'Searching'}
        sub={discover.state === 'complete' ? formatStageDuration(discover.durationMs) : undefined}
      />
      <RailItem
        index="02"
        name="Enrich"
        tone={enrich.state === 'complete' ? 'complete' : enrich.state === 'active' ? 'active' : 'upcoming'}
        value={enrichValue}
        sub={enrich.state === 'pending' ? undefined : formatStageDuration(enrich.durationMs)}
      />
      {/* Nothing in this search produces a Business Profile, so this stage never becomes active. */}
      <RailItem index="03" name="Business Profiles" shortName="Profiles" tone="upcoming" value="Available separately" />
    </ol>
  )
}
