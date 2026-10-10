import Link from 'next/link'
import type { ReactNode, Ref } from 'react'

import type { ResearchState, ResultRowModel } from '@/lib/scraper/results-summary'

type ResultsIndexProps = {
  rows: ResultRowModel[]
  /** Moved to by the page when the results appear, so keyboard and screen-reader users land here. */
  headingRef?: Ref<HTMLHeadingElement>
  /** Quiet line under the heading, for example "Showing 5 of 25". */
  note?: string | null
  /** Header actions (export, open My Leads). Supplied by the page. */
  actions?: ReactNode
  /** Business Profiles are a separate step; say so once, here, not on every row. */
  profileNote: string
  /** Owner preview only: show the real state of background research on each row. */
  showResearchStatus?: boolean
  emptyMessage?: string
}

// The palette is the dashboard's, inverted for a reading surface: a warm near-white sheet, deep navy
// type, muted gold used only as a short rule and for the "possible" marker. Secondary text is
// #5b6372 on #f7f5ef (about 5.6:1) so small text stays comfortably readable.
const INK = 'text-[#0b1a33]'
const MUTED = 'text-[#5b6372]'
const GOLD = 'text-[#7a5f27]'

const RESEARCH_LABEL: Record<ResearchState, string> = {
  researching: 'Business Profile is being generated.',
  ready: '',
  unavailable: 'Website research could not produce a reliable synopsis.',
}

const CONTACT_LINK =
  'inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-sm py-2 underline decoration-[#0b1a33]/25 underline-offset-4 transition-colors hover:decoration-[#7a5f27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27] sm:min-h-0 sm:py-0.5'

function Missing({ children }: { children: string }) {
  // Understated, not alarming: absence of a contact is information, not an error.
  return <p className={`flex min-h-[1.75rem] items-center text-sm italic ${MUTED}`}>{children}</p>
}

function ResultRow({ row, index, showResearchStatus }: { row: ResultRowModel; index: number; showResearchStatus: boolean }) {
  const researchText = showResearchStatus && row.research ? RESEARCH_LABEL[row.research] : ''

  return (
    <li
      className="results-in group relative border-t border-[#d9d3c4] first:border-t-0 transition-colors duration-200 hover:bg-[#efece2] focus-within:bg-[#efece2]"
      style={{ ['--i' as string]: Math.min(index, 10) }}
    >
      <div className="grid gap-x-10 gap-y-3 px-4 py-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_1.25rem] sm:px-6 sm:py-6">
        <div className="min-w-0">
          {/* The whole row is the target of this one link (its ::after covers the row); the contact links
              below sit above it. That keeps a single, valid, keyboard-reachable way to open the lead. */}
          <Link
            href={row.detailHref}
            className={`font-display text-[1.65rem] leading-tight ${INK} after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[#7a5f27]`}
          >
            {row.name}
          </Link>
          {row.descriptor ? <p className={`mt-1 text-sm ${MUTED}`}>{row.descriptor}</p> : null}
          {row.synopsis ? (
            <p className="mt-3 line-clamp-3 max-w-prose text-sm leading-6 text-[#3b4455]">{row.synopsis}</p>
          ) : researchText ? (
            <p className={`mt-3 text-sm ${MUTED}`}>{researchText}</p>
          ) : null}
        </div>

        <div className="relative z-10 min-w-0 space-y-1 text-sm">
          {row.website ? (
            <p>
              <a href={row.website.href} target="_blank" rel="noopener noreferrer" className={`${CONTACT_LINK} ${INK}`}>
                <span className="truncate">{row.website.host}</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          ) : (
            <Missing>No website found</Missing>
          )}
          {row.email ? (
            <div>
              <p className="flex flex-wrap items-center gap-x-2">
                <a href={row.email.href} className={`${CONTACT_LINK} ${INK}`}>
                  <span className="truncate">{row.email.address}</span>
                </a>
                {row.email.possible ? (
                  <span title="Found on the website with lower confidence" className={`text-[11px] font-medium uppercase tracking-[0.14em] ${GOLD}`}>
                    Possible
                  </span>
                ) : null}
              </p>
              {/* An address and a limit on how much of the site was checked can both be true. */}
              {row.emailNote ? <p className={`text-xs ${MUTED}`}>{row.emailNote}</p> : null}
            </div>
          ) : (
            <Missing>{row.emailMissing ?? 'No email found'}</Missing>
          )}
          {row.phone ? (
            <p>
              <a href={row.phone.href} className={`${CONTACT_LINK} ${INK} tabular-nums`}>
                {row.phone.display}
              </a>
            </p>
          ) : (
            <Missing>No phone number</Missing>
          )}
        </div>

        <span
          aria-hidden="true"
          className={`result-arrow hidden self-start pt-2 text-lg sm:block sm:-translate-x-1 sm:opacity-0 sm:group-hover:translate-x-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-x-0 sm:group-focus-within:opacity-100 ${GOLD}`}
        >
          →
        </span>
      </div>
    </li>
  )
}

// The results workspace: an index of businesses on a quiet reading surface. It shows what exists and
// says plainly what does not; it never fabricates a field, never calls a contact verified, and opening
// a business only navigates to its existing page.
export default function ResultsIndex({
  rows,
  headingRef,
  note,
  actions,
  profileNote,
  showResearchStatus = false,
  emptyMessage = 'No businesses to show for this search.',
}: ResultsIndexProps) {
  return (
    <section aria-labelledby="discover-results-heading" className="results-in mt-8 scroll-mt-6 rounded-sm bg-[#f7f5ef] shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pb-5 pt-7 sm:px-6 sm:pt-9">
        <div className="min-w-0">
          <span aria-hidden="true" className="block h-px w-10 bg-[#b89a5a]" />
          <h2
            id="discover-results-heading"
            ref={headingRef}
            tabIndex={-1}
            className={`mt-4 font-display text-4xl leading-none ${INK} focus:outline-none`}
          >
            Results
          </h2>
          <p className={`mt-3 max-w-prose text-sm leading-6 ${MUTED}`}>
            {note ? <span className="mr-2">{note}.</span> : null}
            {profileNote}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-x-6 gap-y-2">{actions}</div> : null}
      </div>

      {rows.length === 0 ? (
        <p className={`border-t border-[#d9d3c4] px-4 py-10 text-sm sm:px-6 ${MUTED}`}>{emptyMessage}</p>
      ) : (
        <ul role="list" className="border-t border-[#d9d3c4]">
          {rows.map((row, index) => (
            <ResultRow key={row.id} row={row} index={index} showResearchStatus={showResearchStatus} />
          ))}
        </ul>
      )}
    </section>
  )
}
