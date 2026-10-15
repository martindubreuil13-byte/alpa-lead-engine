import { isRecoverableFailure } from './retry-eligibility.ts'

// What the customer is told about Business Intelligence for one Discover run.
//
// Everything here is a pure function of rows the server has confirmed (the database's own progress function plus the
// stored profiles). Nothing is estimated, interpolated or animated: no row, no claim. "Complete" means no job is
// unresolved; "researching" means a job is genuinely running; "queued" jobs are never presented as running, and when
// research is switched off the stage says so.

export type ProfileState =
  | 'queued'
  | 'researching'
  | 'retry_pending'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'unavailable'
  | 'cancelled'

export const PROFILE_STATES: ProfileState[] = ['queued', 'researching', 'retry_pending', 'ready', 'partial', 'failed', 'unavailable', 'cancelled']

export type RunProgressRow = {
  lead_id: string
  state: ProfileState
  retry_count?: number
  last_error?: string | null
  run_status?: 'active' | 'cancelled'
  expires_at?: string | null
  queued_at?: string | null
}

export type RunSummary = {
  total: number
  ready: number
  researching: number
  queued: number
  retryPending: number
  partial: number
  failed: number
  unavailable: number
  cancelled: number
  /** Jobs that may still change: queued, researching, retry pending. */
  unresolved: number
  runStatus: 'active' | 'cancelled'
  /** Age of the oldest job that has not started, in seconds; null when none is waiting. */
  oldestQueuedSeconds: number | null
}

const isState = (value: unknown): value is ProfileState => PROFILE_STATES.includes(value as ProfileState)

export function summarizeRun(rows: RunProgressRow[], now = Date.now()): RunSummary | null {
  if (!rows.length) return null
  const counts: Record<ProfileState, number> = { queued: 0, researching: 0, retry_pending: 0, ready: 0, partial: 0, failed: 0, unavailable: 0, cancelled: 0 }
  let oldest: number | null = null
  for (const row of rows) {
    const state: ProfileState = isState(row.state) ? row.state : 'queued'
    counts[state] += 1
    if ((state === 'queued' || state === 'retry_pending') && row.queued_at) {
      const at = Date.parse(row.queued_at)
      if (Number.isFinite(at) && (oldest === null || at < oldest)) oldest = at
    }
  }
  return {
    total: rows.length,
    ready: counts.ready,
    researching: counts.researching,
    queued: counts.queued,
    retryPending: counts.retry_pending,
    partial: counts.partial,
    failed: counts.failed,
    unavailable: counts.unavailable,
    cancelled: counts.cancelled,
    unresolved: counts.queued + counts.researching + counts.retry_pending,
    runStatus: rows.some((row) => row.run_status === 'cancelled') ? 'cancelled' : 'active',
    oldestQueuedSeconds: oldest === null ? null : Math.max(Math.floor((now - oldest) / 1000), 0),
  }
}

/** A job waiting this long with none running, while research is on, is reported as slower than expected. */
export const STALL_AFTER_SECONDS = 300

export type IntelligencePhase = 'not_running' | 'preparing' | 'researching' | 'stalled' | 'complete' | 'stopped'

export type IntelligenceStage = {
  phase: IntelligencePhase
  /** Shown in the stage rail and above the results. */
  headline: string
  /** One quiet line with the real counts. */
  detail: string
  ready: number
  total: number
  /** True only while a job is actually running or the page should keep checking for new profiles. */
  live: boolean
  /** Resolved profiles over authorized ones (0 to 1); null when nothing was authorized. Below 1 while anything is unresolved. */
  progress?: number | null
}

const noun = (count: number) => (count === 1 ? 'profile' : 'profiles')

/** Why the profiles that were never researched were left out, from the run's own record. */
export type UnavailableBreakdown = { noWebsite: number; overLimit: number }

function resolvedNote(summary: RunSummary, breakdown?: UnavailableBreakdown | null): string {
  // Four distinct outcomes: generated (the headline), tried but unsuccessful, left out by the run limit, no website.
  const unsuccessful = summary.failed + summary.partial
  const parts = breakdown
    ? [
        unsuccessful > 0 ? `${unsuccessful} research ${unsuccessful === 1 ? 'attempt' : 'attempts'} unsuccessful` : null,
        breakdown.overLimit > 0 ? `${breakdown.overLimit} not researched (run limit)` : null,
        breakdown.noWebsite > 0 ? `${breakdown.noWebsite} with no website` : null,
        summary.cancelled > 0 ? `${summary.cancelled} stopped` : null,
      ]
    : [
        unsuccessful > 0 ? `${unsuccessful} could not be completed` : null,
        summary.unavailable > 0 ? `${summary.unavailable} unavailable` : null,
        summary.cancelled > 0 ? `${summary.cancelled} stopped` : null,
      ]
  return parts.filter(Boolean).join(' · ')
}

/**
 * The third stage, from real counts. `researchRunning` is whether research is actually switched on right now (server
 * confirmed); it is never inferred from the existence of queued jobs.
 */
export function describeIntelligence(summary: RunSummary | null, researchRunning: boolean, breakdown?: UnavailableBreakdown | null): IntelligenceStage | null {
  const stage = describeStage(summary, researchRunning, breakdown)
  if (!stage || !summary) return stage
  // Authorized profiles are the ones that were ever going to be researched (not those without a website or over the cap).
  // A profile is resolved once it is ready or has ended; queued, researching and retrying ones are not, so the line
  // cannot reach 100% while anything is pending.
  const authorized = summary.total - summary.unavailable
  const resolved = summary.ready + summary.partial + summary.failed + summary.cancelled
  return { ...stage, progress: authorized > 0 ? Math.min(resolved / authorized, 1) : null }
}

function describeStage(summary: RunSummary | null, researchRunning: boolean, breakdown?: UnavailableBreakdown | null): IntelligenceStage | null {
  if (!summary) return null
  const { ready } = summary
  // Progress is measured against the businesses authorized for research, not every saved business: those without a website
  // and those left out by the run limit are never researched. With none authorized there is nothing to count against.
  const authorized = summary.total - summary.unavailable
  const total = authorized
  // "Eligible" is stated, not promised: only businesses with a readable website are authorized, and a website can still fail.
  const counts = authorized > 0 ? `${ready} generated of ${authorized} eligible` : 'No businesses authorized for research'
  // What is happening to the rest, while research runs: processing now, waiting, ended without a profile, and the businesses
  // that were never eligible because they have no website.
  const live = [
    counts,
    summary.researching > 0 ? `${summary.researching} processing` : null,
    summary.queued + summary.retryPending > 0 ? `${summary.queued + summary.retryPending} queued` : null,
    summary.failed + summary.partial > 0 ? `${summary.failed + summary.partial} unsuccessful` : null,
    breakdown && breakdown.noWebsite > 0 ? `${breakdown.noWebsite} with no website` : null,
  ].filter(Boolean).join(' · ')

  if (summary.unresolved === 0) {
    const note = resolvedNote(summary, breakdown)
    if (summary.runStatus === 'cancelled' && ready === 0) {
      return { phase: 'stopped', headline: 'Business intelligence stopped', detail: note || 'Research was stopped for this search', ready, total, live: false }
    }
    return {
      phase: summary.runStatus === 'cancelled' ? 'stopped' : 'complete',
      headline: `${ready} business ${noun(ready)} generated`,
      detail: note,
      ready,
      total,
      live: false,
    }
  }

  if (summary.runStatus === 'cancelled') {
    return { phase: 'stopped', headline: 'Stopping business intelligence', detail: counts, ready, total, live: summary.researching > 0 }
  }

  if (!researchRunning) {
    return {
      phase: 'not_running',
      headline: 'Business Intelligence is not currently running',
      detail: `${counts} · ${summary.unresolved} waiting`,
      ready,
      total,
      live: false,
    }
  }

  if (summary.researching === 0 && summary.oldestQueuedSeconds !== null && summary.oldestQueuedSeconds > STALL_AFTER_SECONDS) {
    return { phase: 'stalled', headline: 'Taking longer than expected', detail: `${counts} · research has not started on the rest yet`, ready, total, live: true }
  }

  if (summary.researching > 0 || ready > 0 || summary.retryPending > 0) {
    return { phase: 'researching', headline: 'Research in progress', detail: live, ready, total, live: true }
  }

  return { phase: 'preparing', headline: 'Preparing business intelligence', detail: live, ready, total, live: true }
}

/**
 * The one quiet line under the "Results" heading. While a run is followed it must agree with Stage 03, so it describes
 * what is actually happening; with no run it returns null and the page keeps its previous wording.
 */
export function describeProfileNote(stage: IntelligenceStage | null | undefined): string | null {
  if (!stage) return null
  switch (stage.phase) {
    case 'complete': return "Business profiles are written from each business's own website."
    case 'not_running': return 'Business Intelligence is not currently running. Profiles will appear here when it is.'
    case 'stopped': return 'Business Intelligence was stopped for this search. Finished profiles are kept.'
    default: return 'Business profiles appear here as they are ready.'
  }
}

// ---------------------------------------------------------------------------------------------
// Customer-safe reasons (the stored error text is internal and is never shown as is)
// ---------------------------------------------------------------------------------------------

export type ProfileReason = 'budget' | 'cancelled' | 'research_failed' | 'run_limit' | 'no_website' | 'expired' | 'unreadable' | 'plan_ended' | null

export function toProfileReason(state: ProfileState, lastError: string | null | undefined, initialState?: string | null): ProfileReason {
  if (state === 'cancelled') return 'cancelled'
  // A run that expired before a business was researched is closed by reconciliation: it is neither a failure nor a cancellation.
  if (lastError && /^run expired/i.test(lastError)) return 'expired'
  // The database reports both as unavailable; the run's own record says which it was.
  if (state === 'unavailable' && initialState === 'unavailable_no_website') return 'no_website'
  if (state === 'unavailable' && (initialState === 'skipped_limit' || initialState === 'skipped_existing')) return 'run_limit'
  if (state !== 'failed' && state !== 'partial') return null
  if (lastError && /budget_exhausted/i.test(lastError)) return 'budget'
  if (lastError && /^entitlement_ended/i.test(lastError)) return 'plan_ended'
  // A website that is blocked, missing, too large or unreadable will not change by trying again; say so instead of 'failed'.
  if (lastError && !isRecoverableFailure(lastError)) return 'unreadable'
  return 'research_failed'
}

export const ROW_LABEL: Record<ProfileState, string> = {
  queued: 'Business profile queued',
  researching: 'Researching this business',
  retry_pending: 'Business profile will be retried',
  ready: 'Business profile generated',
  partial: 'Only part of the profile could be built',
  failed: "Business profile couldn't be completed",
  unavailable: 'No business profile for this business',
  cancelled: 'Business profile stopped',
}

// ---------------------------------------------------------------------------------------------
// The profile as the customer reads it: what the website says, kept apart from what the AI wrote about it
// ---------------------------------------------------------------------------------------------

export type ProfileCard = {
  /** AI-written synopsis of the website's own text. */
  summary: string
  /** AI-extracted, only when the website text supports it. */
  services: string[]
  audience: string | null
  /** Plain facts read from the website by rules, not by the AI. */
  facts: { signals: string[]; pagesRead: string[]; sources: Array<{ label: string; url: string }> }
  /** Honest limits of this profile. */
  limitations: string[]
}

type StoredLead = {
  commercial_profile?: Record<string, unknown> | null
  website_snapshot?: Record<string, unknown> | null
  business_signals?: Record<string, unknown> | null
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

const SIGNAL_FACTS: Array<[string, string]> = [
  ['has_pricing', 'Mentions pricing'],
  ['has_testimonials', 'Shows testimonials'],
  ['has_booking_link', 'Offers online booking'],
  ['has_blog', 'Has a blog'],
  ['has_faq', 'Has an FAQ'],
]

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

const PAGE_LABEL: Record<string, string> = { homepage: 'Home page', about: 'About page', services: 'Services page', contact: 'Contact page' }

/**
 * Builds the card from stored data only. Nothing is invented: a field the profile does not have is simply absent,
 * the competitive-advantage field is deliberately not shown (the model was asked for an explicit differentiator
 * only and it cannot be verified), and the limitations are derived from what was actually read.
 */
export function buildProfileCard(lead: StoredLead): ProfileCard | null {
  const profile = lead.commercial_profile
  const summary = clean(profile?.summary, 700)
  if (!profile || !summary) return null

  const services = [...new Set([clean(profile.primary_service, 120), ...(Array.isArray(profile.core_services) ? profile.core_services.map((item) => clean(item, 120)) : [])].filter(Boolean))].slice(0, 5)
  const audience = clean(profile.target_customer, 200) || null

  const signals = SIGNAL_FACTS.filter(([key]) => lead.business_signals?.[key] === true).map(([, label]) => label)
  const pages = Array.isArray(lead.website_snapshot?.research_pages) ? (lead.website_snapshot?.research_pages as Array<Record<string, unknown>>) : []
  const pagesRead = [...new Set(pages.map((page) => PAGE_LABEL[String(page.kind)]).filter(Boolean))]
  const urls = Array.isArray(lead.website_snapshot?.source_urls) ? (lead.website_snapshot?.source_urls as unknown[]) : []
  const sources = [...new Set(urls.map(safeUrl).filter((url): url is string => Boolean(url)))]
    .slice(0, 4)
    .map((url) => ({ label: new URL(url).pathname === '/' || new URL(url).pathname === '' ? new URL(url).hostname.replace(/^www\./, '') : new URL(url).pathname.replace(/\/$/, ''), url }))

  const limitations = ['Written by AI from the text of the website. It is not independently verified.']
  if (lead.website_snapshot?.content_truncated === true) limitations.push('A very large page was only read in part (its first 1 MB).')
  if (pagesRead.length > 0 && pagesRead.length < 3) limitations.push(`Based on ${pagesRead.length === 1 ? 'one page' : `${pagesRead.length} pages`} of the website.`)
  if (!audience) limitations.push('The website did not clearly describe who it serves.')

  return { summary, services, audience, facts: { signals, pagesRead, sources }, limitations }
}

// ---------------------------------------------------------------------------------------------
// My Leads: one honest state per saved lead, from the stored profile and the lead's own run job
// ---------------------------------------------------------------------------------------------

export type LeadProfileState = ProfileState | 'not_started'

export type QueueRowLike = { status: string; retry_count: number | null; last_error: string | null; run_id: string | null } | null | undefined

/**
 * A lead's profile state. Only a job that belongs to a Discover run counts as research: a job without a run id is
 * historical, and `ci_enrichment_status = 'pending'` (the column default) means nothing. A stored profile always wins.
 */
export function deriveLeadProfileState(
  lead: { commercial_profile?: Record<string, unknown> | null; website?: string | null },
  job: QueueRowLike
): LeadProfileState {
  if (clean(lead.commercial_profile?.summary, 700)) return 'ready'
  if (!job || !job.run_id) return lead.website && lead.website.trim() ? 'not_started' : 'unavailable'
  switch (job.status) {
    case 'processing': return 'researching'
    case 'pending': return (job.retry_count ?? 0) > 0 ? 'retry_pending' : 'queued'
    case 'failed':
      if (/^cancelled/i.test(job.last_error ?? '')) return 'cancelled'
      // Closed because its run expired before it started: not a failure of the business or the website.
      return /^run expired/i.test(job.last_error ?? '') ? 'unavailable' : 'failed'
    default: return 'not_started'
  }
}

export const LEAD_PROFILE_LABEL: Record<LeadProfileState, string> = {
  ...ROW_LABEL,
  // In My Leads a finished profile is a standing fact about the saved business, and "ready" is the word that page uses
  // everywhere else (its filter and status lines); Discover says "generated" for what a live run produced.
  ready: 'Business profile ready',
  not_started: 'Business profile not generated for this lead',
}
