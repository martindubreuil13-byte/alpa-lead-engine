import type { IntelligenceStage } from '@/lib/intelligence/run-progress'
import type { EngineView } from '@/lib/scraper/engine-view'
import { formatStageDuration } from '@/lib/scraper/stage-timing'

type EngineRailProps = {
  view: EngineView
  /**
   * The real state of Business Intelligence for this run (B2 Phase 1), from server-confirmed counts. When absent
   * (research is not authorized for this search) the third stage keeps its A2.3 wording.
   */
  intelligence?: IntelligenceStage | null
}

type RailTone = 'active' | 'complete' | 'upcoming' | 'separate'

const TONE: Record<RailTone, { rule: string; label: string; value: string }> = {
  active: { rule: 'border-t-[#d8c28a]', label: 'text-white', value: 'text-white/90' },
  complete: { rule: 'border-t-white/25', label: 'text-white/75', value: 'text-white/70' },
  upcoming: { rule: 'border-t-white/10', label: 'text-white/55', value: 'text-white/55' },
  separate: { rule: 'border-t-white/20 border-dashed', label: 'text-white/65', value: 'text-white/60' },
}

function RailItem({
  index,
  name,
  shortName,
  tone,
  value,
  sub,
}: {
  /** Omitted for a capability that is not a step of this search. */
  index?: string
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
      <div className={`text-[10px] font-medium uppercase tracking-[0.14em] sm:text-xs sm:tracking-[0.2em] ${style.label}`}>
        {index ? <span className="tabular-nums text-white/45">{index}</span> : null}
        <span className={index ? 'ml-2 sm:ml-3' : undefined}>
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
export default function EngineRail({ view, intelligence }: EngineRailProps) {
  const { discover, enrich } = view

  // Progress toward the requested amount; extra candidates evaluated along the way are activity, not progress.
  const enrichValue =
    enrich.state === 'pending'
      ? 'Waiting'
      : enrich.scope === 0
        ? 'No websites to check'
        : enrich.state === 'complete'
          ? `${enrich.done} checked`
          : enrich.finalizing
            ? 'Finalizing'
          : enrich.scope !== null
            ? `${enrich.done} / ${enrich.scope} checked`
            : `${enrich.done} checked`
  const discoverValue =
    discover.state !== 'complete'
      ? view.target
        ? `${view.foundSoFar} / ${view.target} businesses`
        : 'Searching'
      : `${discover.count} ${discover.count === 1 ? 'business' : 'businesses'}`

  return (
    <ol aria-label="Search stages" className="mt-8 grid grid-cols-3 gap-4 sm:gap-10">
      <RailItem
        index="01"
        name="Discover"
        tone={discover.state === 'complete' ? 'complete' : 'active'}
        value={discoverValue}
        sub={discover.state === 'complete' ? formatStageDuration(discover.durationMs) : undefined}
      />
      <RailItem
        index="02"
        name="Enrich"
        tone={enrich.state === 'complete' ? 'complete' : enrich.state === 'active' ? 'active' : 'upcoming'}
        value={enrichValue}
        sub={enrich.state === 'pending' ? undefined : formatStageDuration(enrich.durationMs)}
      />
      {intelligence ? (
        // A real third stage: only server-confirmed counts. "Complete" is shown only when nothing is unresolved, and a
        // queued profile is never described as being researched.
        <RailItem
          index="03"
          name="Business Intelligence"
          shortName="Intelligence"
          tone={intelligence.phase === 'complete' ? 'complete' : intelligence.live ? 'active' : 'upcoming'}
          value={intelligence.headline}
          sub={intelligence.detail}
        />
      ) : (
        // A separate capability, not a step this search is waiting on: no number, a dashed rule, and plain words.
        <RailItem
          name="Business Profiles"
          shortName="Profiles"
          tone="separate"
          value="Not included in this search"
          sub="Available separately"
        />
      )}
    </ol>
  )
}
