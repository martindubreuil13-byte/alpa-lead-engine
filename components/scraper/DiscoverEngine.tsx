'use client'

import { useRef, type MutableRefObject } from 'react'

import { describeCheckSummary, getSignalStates, type EngineView } from '@/lib/scraper/engine-view'
import { describeContacts, describePossibleEmails, type ContactSummary } from '@/lib/scraper/results-summary'

import ActivityStrip, { type ActivityStripItem } from './ActivityStrip'
import EngineRail from './EngineRail'
import SignalField from './SignalField'
import useAmbientMotion from './useAmbientMotion'
import usePrefersReducedMotion from './usePrefersReducedMotion'

type DiscoverEngineProps = {
  view: EngineView
  activity: ActivityStripItem[]
  /**
   * Contact figures for the businesses in the finished results. Passed only once the search is
   * settled; it comes from the real result, never from the live stream.
   */
  results?: ContactSummary | null
  /** One quiet line under the settled summary (for example, what was filtered). */
  settledNote?: string | null
  onStop?: () => void
  onNewSearch?: () => void
  /** Small print shown inside the expanded activity history. */
  footnote?: string
  /** The root element, so the page can scroll to it and tell whether focus is inside it. */
  rootRef?: MutableRefObject<HTMLElement | null>
}

function formatClock(milliseconds: number) {
  const total = Math.max(Math.floor(milliseconds / 1000), 0)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function secondsPhrase(milliseconds: number | null) {
  if (milliseconds === null) return ''
  const seconds = Math.max(Math.round(milliseconds / 1000), 1)
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
}

const LABEL = 'text-xs font-medium uppercase tracking-[0.24em] text-white/70'

// How tall the stage is. It is one explicit height per state so that the move to the settled summary
// is a single smooth transition, and so the page below never jumps while the numbers change.
const STAGE_HEIGHT = {
  working: 'min-h-[21rem] sm:min-h-[25rem]',
  settled: 'min-h-[11rem] sm:min-h-[12rem]',
}

// Font size of the one persistent count. It is the focal point twice (when discovery is announced and
// when the search settles) and a quiet header in between, while website checks take the focus.
const COUNT_SIZE = {
  discover: 'text-[7rem] text-white sm:text-[11rem]',
  enrich: 'text-3xl text-white/55 sm:text-4xl',
  settled: 'text-6xl text-white sm:text-8xl',
}

// The Discover experience: one dominant moment at a time over a slim stage map.
//   Searching: a real elapsed clock and one quiet ring.   Discovery: the real count.
//   Enrichment: websites checked, against the real total.  Settled: a compact summary that the
//   results sit directly beneath. Everything numeric comes from real events or the real result.
export default function DiscoverEngine({
  view,
  activity,
  results,
  settledNote,
  onStop,
  onNewSearch,
  footnote,
  rootRef,
}: DiscoverEngineProps) {
  const { focus, discover, enrich } = view
  const fallbackRef = useRef<HTMLElement | null>(null)
  const ref = rootRef ?? fallbackRef
  const reducedMotion = usePrefersReducedMotion()

  const settled = focus === 'settled'
  // Decorative motion exists only while the search itself is under way.
  const ambient = useAmbientMotion(ref, {
    enabled: focus === 'search' && view.running && !view.stalled,
    reducedMotion,
  })
  const states = getSignalStates(view.signals)

  // The hero is what was delivered: the businesses that reached the results. Before that it is progress
  // toward the requested amount, never the number of candidates the search happened to look at.
  const ready = settled && results ? results.businesses : discover.count
  const noun = ready === 1 ? 'business' : 'businesses'
  const announcement = settled
    ? `Search complete. ${ready} ${noun} ready.`
    : discover.state === 'complete'
      ? `${discover.count} ${discover.count === 1 ? 'business' : 'businesses'} found.`
      : ''

  const fraction =
    enrich.scope !== null && enrich.scope > 0 ? `${enrich.done} / ${enrich.scope}` : String(enrich.done)
  const evaluatingMore = enrich.extraCandidates || discover.searchingMore
  const countSize = settled ? COUNT_SIZE.settled : focus === 'enrich' ? COUNT_SIZE.enrich : COUNT_SIZE.discover
  const contactParts = settled && results ? describeContacts(results) : null
  const possibleEmails = settled && results ? describePossibleEmails(results) : null

  return (
    <section
      ref={ref}
      aria-label={settled ? 'Search summary' : 'ALPA is working on your search'}
      className={`w-full ${view.stalled ? 'engine-stalled' : ''}`}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="flex min-h-[2.25rem] items-baseline justify-between gap-4 text-xs uppercase tracking-[0.2em] text-white/70">
        <span className="truncate">{view.context}</span>
        {settled ? (
          onNewSearch ? (
            <button
              type="button"
              onClick={onNewSearch}
              className="-my-2 rounded px-1 py-2 uppercase tracking-[0.16em] text-white/70 transition hover:text-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a]"
            >
              New search
            </button>
          ) : null
        ) : focus !== 'search' ? (
          // While searching, the large clock below is the real elapsed time; avoid repeating it.
          <span className="tabular-nums text-white/80">{formatClock(view.elapsedMs)}</span>
        ) : null}
      </div>

      <div
        className={`engine-stage relative mt-2 flex flex-col items-center justify-center overflow-hidden text-center ${
          settled ? STAGE_HEIGHT.settled : STAGE_HEIGHT.working
        }`}
      >
        {settled ? null : <div aria-hidden="true" className="engine-field absolute inset-0" />}
        {focus === 'search' ? (
          <>
            {/* A faint static ring is always there; the moving one exists only while it may animate. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-auto h-[17rem] w-[17rem] rounded-full border border-white/10 sm:h-[22rem] sm:w-[22rem]"
            />
            {ambient ? (
              <span
                aria-hidden="true"
                className="engine-pulse pointer-events-none absolute inset-0 m-auto h-[17rem] w-[17rem] rounded-full border border-[#d8c28a]/70 sm:h-[22rem] sm:w-[22rem]"
              />
            ) : null}
          </>
        ) : null}

        {focus === 'search' ? (
          <div key="search" className="engine-reveal relative z-10 px-2">
            <p className={LABEL}>Searching for businesses</p>
            <p className="engine-count mt-5 font-display text-7xl leading-none tabular-nums text-white/95 sm:text-9xl">
              {formatClock(view.elapsedMs)}
            </p>
            <p className="mt-5 min-h-[1.25rem] text-xs uppercase tracking-[0.2em] text-[#d8c28a]">
              {view.foundSoFar > 0
                ? view.target
                  ? `${view.foundSoFar} / ${view.target} businesses`
                  : `${view.foundSoFar} found so far`
                : ''}
            </p>
          </div>
        ) : (
          <div className="relative z-10 w-full px-2">
            {/* One persistent count: it is never remounted, so it changes size instead of being replaced. */}
            <p className={`engine-count font-display leading-none tabular-nums ${countSize}`}>{ready}</p>
            <p className={`${focus === 'enrich' ? 'mt-1 text-xs uppercase tracking-[0.2em] text-white/55' : `${LABEL} mt-4`}`}>
              {settled
                ? ready === 1
                  ? 'Business ready'
                  : 'Businesses ready'
                : discover.count === 1
                  ? 'Business found'
                  : 'Businesses found'}
            </p>

            {focus === 'discover' ? (
              <p key="discover" className="engine-reveal mt-3 text-sm uppercase tracking-[0.2em] text-[#d8c28a]">
                Found in {secondsPhrase(discover.durationMs)}
              </p>
            ) : null}

            {focus === 'enrich' ? (
              <div key="enrich" className="engine-reveal">
                <p className={`${LABEL} mt-8`}>{enrich.state === 'complete' ? 'Businesses checked' : enrich.finalizing ? 'Finishing up' : 'Checking businesses'}</p>
                <p className={`engine-count mt-4 font-display leading-none tabular-nums text-white ${enrich.finalizing ? 'text-5xl sm:text-6xl' : 'text-7xl sm:text-9xl'}`}>
                  {enrich.state === 'pending' ? '–' : enrich.scope === 0 ? '0' : enrich.finalizing ? 'Finalizing' : fraction}
                </p>
                <SignalField
                  states={states}
                  summary={describeCheckSummary(enrich)}
                />
                <div className="mt-4 min-h-[1.5rem] text-xs uppercase tracking-[0.2em]">
                  {enrich.emails > 0 || enrich.state === 'complete' ? (
                    <p className="text-[#d8c28a]">
                      {enrich.confidenceKnown
                        ? `${enrich.emails} ${enrich.emails === 1 ? 'business' : 'businesses'} with an email`
                        : `${enrich.emails} email ${enrich.emails === 1 ? 'match' : 'matches'} found during checks`}
                    </p>
                  ) : null}
                  {enrich.possibleEmails > 0 ? (
                    <p className="mt-2 text-white/65">
                      {enrich.possibleEmails} possible {enrich.possibleEmails === 1 ? 'email' : 'emails'} counted separately (lower confidence)
                    </p>
                  ) : null}
                  {evaluatingMore && enrich.state !== 'complete' ? (
                    <p className="mt-2 text-white/55 normal-case tracking-normal">
                      {view.target ? `Evaluating additional candidates to complete your ${view.target}.` : 'Evaluating additional candidates.'}
                    </p>
                  ) : null}
                  {view.stalled ? (
                    <p role="status" className="mt-2 text-white/75">
                      Still working. This is taking longer than usual.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {settled ? (
              <div key="settled" className="engine-reveal">
                {contactParts ? (
                  <p className="mt-5 text-base tabular-nums text-white/85 sm:text-lg">{contactParts.join('  ·  ')}</p>
                ) : null}
                {possibleEmails ? <p className="mt-2 text-xs text-white/55">{possibleEmails}</p> : null}
                {settledNote || activity.length > 0 ? (
                  <details className="group mx-auto mt-4 max-w-md text-left">
                    <summary className="mx-auto w-fit cursor-pointer list-none rounded px-1 py-2 text-xs uppercase tracking-[0.16em] text-white/65 transition hover:text-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a] [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">View activity</span>
                      <span className="hidden group-open:inline">Hide activity</span>
                    </summary>
                    {settledNote ? <p className="mt-2 text-center text-xs text-white/65">{settledNote}</p> : null}
                    {activity.length > 0 ? (
                      <ul className="mt-3 max-h-48 divide-y divide-white/10 overflow-y-auto border-y border-white/10 pr-2">
                        {activity.map((item, index) => (
                          <li key={`${item.label}-${item.detail ?? ''}-${index}`} className="py-2 text-xs text-white/70">
                            {item.detail ? `${item.label} — ${item.detail}` : item.label}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {footnote ? <p className="mt-2 text-center text-xs text-white/50">{footnote}</p> : null}
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* In search, the stage above is the only focus; the rail is a quiet footnote to it. */}
      <EngineRail view={view} />

      {settled ? null : (
        <div className="mt-8 space-y-4">
          <ActivityStrip items={activity} idle="Searching for businesses…" footnote={footnote} />
          {onStop && view.running ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded text-xs uppercase tracking-[0.16em] text-white/65 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]"
            >
              Stop search
            </button>
          ) : null}
        </div>
      )}
    </section>
  )
}
