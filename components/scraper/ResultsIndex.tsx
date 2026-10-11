import Link from 'next/link'
import type { ReactNode, Ref } from 'react'

import type { ResearchState, ResultRowModel, RowIntelligence } from '@/lib/scraper/results-summary'

import RetryProfile from './RetryProfile'

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
  /** Retries one failed business profile; resolves to a customer-facing message when it was refused, else null. */
  onRetryProfile?: (leadId: string) => Promise<string | null>
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

// Contact links are plain underlined text; the 44px height is a comfortable touch target on phones.
const CONTACT_LINK =
  'inline-flex min-h-[44px] min-w-0 max-w-full items-center rounded-sm py-2 underline decoration-[#0b1a33]/25 underline-offset-4 transition-colors hover:decoration-[#7a5f27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27] sm:min-h-0 sm:py-0.5'

// Three small outline icons in one family: 16px, 1.5 stroke, currentColor. Decorative: each link
// carries its own accessible name, so the icons are hidden from assistive technology.
const ICON_PROPS = {
  viewBox: '0 0 24 24',
  width: 16,
  height: 16,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

function GlobeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9Z" />
    </svg>
  )
}

function EnvelopeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 4h3.5l1.8 4.5-2.2 1.4a11 11 0 0 0 5 5l1.4-2.2L19 14.5V18a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  )
}

/**
 * One contact line: a fixed icon column, then the value. The icon column keeps website, email and
 * telephone aligned and instantly distinguishable; `muted` dims both icon and text when the value is absent.
 */
function ContactLine({ icon, muted = false, children }: { icon: ReactNode; muted?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`flex h-[44px] w-4 shrink-0 items-center sm:h-7 ${muted ? 'text-[#5b6372]/60' : GOLD}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

const REASON_TEXT: Record<'budget' | 'cancelled' | 'research_failed', string> = {
  budget: 'This search reached its research limit.',
  cancelled: 'Research was stopped for this search.',
  research_failed: 'The website could not be researched.',
}

// A business profile, kept honest. What the website itself shows (pages read, rule-detected features, source links) is
// listed apart from what the AI wrote about it, and the limits of the profile are stated. Interactive parts sit above the
// row's stretched link (relative z-10) so they stay clickable and keyboard reachable.
function IntelligenceBlock({ intelligence, leadId, onRetry }: { intelligence: RowIntelligence; leadId: string; onRetry?: (leadId: string) => Promise<string | null> }) {
  const { state, card, label, reason } = intelligence

  if (state !== 'ready' || !card) {
    return (
      <div className="mt-3 max-w-prose">
        <p className={`text-sm ${MUTED}`}>{label}</p>
        {reason && reason in REASON_TEXT ? <p className={`text-xs ${MUTED}`}>{REASON_TEXT[reason as keyof typeof REASON_TEXT]}</p> : null}
        {intelligence.retryable && onRetry ? <RetryProfile leadId={leadId} onRetry={onRetry} /> : null}
      </div>
    )
  }

  return (
    <div className="mt-4 max-w-prose border-l border-[#b89a5a]/60 pl-4">
      <p className={`text-[11px] font-medium uppercase tracking-[0.16em] ${GOLD}`}>Business profile</p>
      <p className="mt-2 text-sm leading-6 text-[#243049]">{card.summary}</p>
      {card.services.length > 0 ? (
        <p className="mt-2 text-sm leading-6 text-[#3b4455]">
          <span className={MUTED}>Offers </span>
          {card.services.join(' · ')}
        </p>
      ) : null}
      {card.audience ? (
        <p className="text-sm leading-6 text-[#3b4455]">
          <span className={MUTED}>Serves </span>
          {card.audience}
        </p>
      ) : null}
      <details className="group relative z-10 mt-2">
        <summary className={`inline-flex min-h-[44px] cursor-pointer list-none items-center rounded-sm text-xs underline decoration-[#0b1a33]/25 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27] sm:min-h-0 [&::-webkit-details-marker]:hidden ${MUTED}`}>
          How this profile was built
        </summary>
        <div className="mt-2 space-y-3 pb-1 text-xs leading-5 text-[#3b4455]">
          <div>
            <p className={`font-medium uppercase tracking-[0.14em] ${MUTED}`}>From their website</p>
            {card.facts.pagesRead.length > 0 ? <p>Pages read: {card.facts.pagesRead.join(', ')}.</p> : null}
            {card.facts.signals.length > 0 ? <p>{card.facts.signals.join(' · ')}.</p> : null}
            {card.facts.sources.length > 0 ? (
              <p className="flex flex-wrap gap-x-3">
                {card.facts.sources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Source: ${source.label} (opens in a new tab)`} className="underline decoration-[#0b1a33]/25 underline-offset-4 hover:decoration-[#7a5f27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27]">
                    {source.label}
                  </a>
                ))}
              </p>
            ) : null}
          </div>
          <div>
            <p className={`font-medium uppercase tracking-[0.14em] ${MUTED}`}>Written by AI</p>
            <p>The summary, what the business offers and who it serves were written from that text.</p>
          </div>
          <ul className={`list-disc space-y-0.5 pl-4 ${MUTED}`}>
            {card.limitations.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  )
}
function Missing({ children, reason }: { children: string; reason?: string | null }) {
  // Understated, not alarming: absence of a contact is information, not an error.
  return (
    <div className={`flex min-h-[44px] flex-col justify-center py-0.5 sm:min-h-[1.75rem] sm:py-0 ${MUTED}`}>
      <p className="text-sm">{children}</p>
      {reason ? <p className="text-xs">{reason}</p> : null}
    </div>
  )
}

function ResultRow({ row, index, showResearchStatus, onRetry }: { row: ResultRowModel; index: number; showResearchStatus: boolean; onRetry?: (leadId: string) => Promise<string | null> }) {
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
          {row.intelligence ? <IntelligenceBlock intelligence={row.intelligence} leadId={row.id} onRetry={onRetry} /> : null}
        </div>

        <div className="relative z-10 min-w-0 space-y-1 text-sm">
          <ContactLine icon={<GlobeIcon />} muted={!row.website}>
            {row.website ? (
              <a
                href={row.website.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Website: ${row.website.host} (opens in a new tab)`}
                className={`${CONTACT_LINK} ${INK}`}
              >
                <span className="truncate">{row.website.host}</span>
              </a>
            ) : (
              <Missing>No website found</Missing>
            )}
          </ContactLine>
          <ContactLine icon={<EnvelopeIcon />} muted={!row.email}>
            {row.email ? (
              <div>
                <p className="flex flex-wrap items-center gap-x-2">
                  <a href={row.email.href} aria-label={`Email: ${row.email.address}`} className={`${CONTACT_LINK} ${INK}`}>
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
              <Missing reason={row.emailMissingReason}>{row.emailMissing ?? 'Email not discovered'}</Missing>
            )}
          </ContactLine>
          <ContactLine icon={<PhoneIcon />} muted={!row.phone}>
            {row.phone ? (
              <a href={row.phone.href} aria-label={`Telephone: ${row.phone.display}`} className={`${CONTACT_LINK} ${INK} tabular-nums`}>
                {row.phone.display}
              </a>
            ) : (
              <Missing>No phone number</Missing>
            )}
          </ContactLine>
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
  onRetryProfile,
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
            <ResultRow key={row.id} row={row} index={index} showResearchStatus={showResearchStatus} onRetry={onRetryProfile} />
          ))}
        </ul>
      )}
    </section>
  )
}
