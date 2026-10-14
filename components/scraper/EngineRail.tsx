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
  /** How long Business Intelligence has taken (live while it runs, frozen when it ends); null when unknown. */
  intelligenceMs?: number | null
  /** Every business found was already in My Leads, so there is nothing new to research. */
  noNewBusinesses?: boolean
  /** Free trial: a short profile is written when a business is opened, so the third stage is ready rather than unavailable. */
  profilesOnDemand?: boolean
}

type RailTone = 'active' | 'complete' | 'upcoming' | 'separate'

const TONE: Record<RailTone, { rule: string; label: string; value: string }> = {
  active: { rule: 'border-t-[#d8c28a]', label: 'text-white', value: 'text-white/90' },
  complete: { rule: 'border-t-white/30', label: 'text-white/85', value: 'text-white/80' },
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
  working,
  progress,
  origin = 'origin-left',
}: {
  /** Omitted for a capability that is not a step of this search. */
  index?: string
  name: string
  /** Shown instead of `name` on narrow screens. */
  shortName?: string
  tone: RailTone
  value: string
  sub?: string
  /** Gold highlight and a quiet pulse while this stage is genuinely working. */
  working?: boolean
  /** Thin gold line, 0 to 1; omitted for stages without one. */
  progress?: number | null
  /** Where the enlarged active stage grows from, so the end columns never push past the edge or into a neighbor. */
  origin?: string
}) {
  const style = TONE[tone]
  return (
    <li
      // The active stage is drawn slightly larger with a transform, so nothing around it moves; completed stages return to
      // normal size and upcoming ones stay quiet. Without motion preference the change is instant.
      className={`${origin} border-t pt-3 transition-colors duration-700 motion-safe:transition-[color,border-color,transform,opacity] motion-safe:duration-700 ${style.rule} ${tone === 'active' ? 'scale-[1.13]' : 'scale-100'} ${tone === 'upcoming' ? 'opacity-50' : ''}`}
    >
      <div className={`flex items-center text-[10px] font-medium uppercase tracking-[0.14em] sm:text-xs sm:tracking-[0.2em] ${working ? 'text-[#d8c28a]' : style.label}`}>
        {working ? <span aria-hidden="true" className="mr-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d8c28a] motion-safe:animate-pulse" /> : null}
        {index ? <span className={`tabular-nums ${working ? 'text-[#d8c28a]/70' : 'text-white/45'}`}>{index}</span> : null}
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
      {progress != null ? (
        <div
          role="progressbar"
          aria-label="Profiles completed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="mt-2 h-px w-full bg-white/10"
        >
          <div className="h-px bg-[#d8c28a] transition-[width] duration-700 ease-out" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      <p className="mt-1 min-h-[1rem] text-xs text-white/50">{sub}</p>
    </li>
  )
}

// The slim stage map beneath the focal area. It is deliberately quiet: small type, hairlines, no
// large numbers. The active stage is marked by a gold hairline; completed stages stay as small
// facts; Business Profiles are stated honestly as a separate step, never as part of this search.
export default function EngineRail({ view, intelligence, intelligenceMs, noNewBusinesses, profilesOnDemand }: EngineRailProps) {
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
        origin="origin-center"
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
          origin="origin-right"
          name="Business Intelligence"
          shortName="Intelligence"
          tone={intelligence.phase === 'complete' ? 'complete' : intelligence.live ? 'active' : 'upcoming'}
          value={intelligence.headline}
          sub={[intelligence.detail, formatStageDuration(intelligenceMs ?? null)].filter(Boolean).join(' · ')}
          working={intelligence.live && intelligence.phase !== 'not_running'}
          progress={intelligence.progress}
        />
      ) : noNewBusinesses ? (
        <RailItem
          index="03"
          name="Business Intelligence"
          shortName="Intelligence"
          tone="complete"
          value="No new businesses to research."
          origin="origin-right"
        />
      ) : profilesOnDemand ? (
        // Free trial: a short profile is written when a business is opened, so this is ready to be explored, not unavailable.
        <RailItem
          name="Business Profiles"
          shortName="Profiles"
          tone="separate"
          value="Ready to explore"
          sub="Open a business for its profile"
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
