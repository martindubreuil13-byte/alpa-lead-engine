// What the Discover results workspace is allowed to say about a set of businesses.
//
// Everything here is derived from the businesses that actually came back; nothing is estimated.
// The vocabulary is deliberately narrow, because these are different facts and must not be
// presented as one another:
//   - a business was discovered
//   - a website was found for it                    (a link exists; it says nothing about content)
//   - an email address was found on its site        (found, never "verified" or "deliverable")
//   - an email address is only a possible match     (low or unknown confidence: counted apart)
//   - a phone number was found
//   - a Business Profile exists                     (only when a real summary is stored)

import { isEmailInspection } from './email-inspection.ts'
import type { TrialLead } from '../trial.ts'

export type ContactLead = Pick<TrialLead, 'website' | 'email' | 'email_confidence' | 'phone'>

export type ContactSummary = {
  businesses: number
  websites: number
  /** Email addresses found with high or medium confidence. Not verified. */
  emails: number
  /** Email addresses with low or unknown confidence. Never counted as `emails`. */
  possibleEmails: number
  phones: number
}

const filled = (value: string | null | undefined) => Boolean(value && value.trim())

export function isPossibleEmail(lead: Pick<TrialLead, 'email' | 'email_confidence'>) {
  return filled(lead.email) && lead.email_confidence !== 'high' && lead.email_confidence !== 'medium'
}

export function summarizeContacts(leads: ContactLead[]): ContactSummary {
  const summary: ContactSummary = { businesses: leads.length, websites: 0, emails: 0, possibleEmails: 0, phones: 0 }
  for (const lead of leads) {
    if (filled(lead.website)) summary.websites += 1
    if (filled(lead.email)) {
      if (isPossibleEmail(lead)) summary.possibleEmails += 1
      else summary.emails += 1
    }
    if (filled(lead.phone)) summary.phones += 1
  }
  return summary
}

function count(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

/**
 * The one-line contact summary under the settled count, e.g. "5 emails · 9 phone numbers · 7 websites".
 * All three always appear, including zeros, so a missing kind of contact is visible, not hidden.
 */
export function describeContacts(summary: ContactSummary): string[] {
  return [
    count(summary.emails, 'email'),
    count(summary.phones, 'phone number'),
    count(summary.websites, 'website'),
  ]
}

/** Secondary line for addresses that are not counted as emails, or null when there are none. */
export function describePossibleEmails(summary: ContactSummary): string | null {
  return summary.possibleEmails > 0
    ? `${count(summary.possibleEmails, 'possible email')} not counted above (lower confidence)`
    : null
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

export type ResearchState = 'researching' | 'ready' | 'unavailable'

export type ResultRowModel = {
  id: string
  name: string
  /** "Miami · Dentists", or null when neither is known. */
  descriptor: string | null
  website: { host: string; href: string } | null
  email: { address: string; href: string; possible: boolean } | null
  /** The customer-facing line when no address was found. Null when there is one. */
  emailMissing: string | null
  /** Subtle, honest context for the missing address (what could not be inspected). Null when none applies. */
  emailMissingReason: string | null
  /** Shown with an address when only part of the website could be checked. Null otherwise. */
  emailNote: string | null
  phone: { display: string; href: string } | null
  /** A stored, factual synopsis. Never generated here. */
  synopsis: string | null
  /** Only set where background research is genuinely running for this view (owner preview). */
  research: ResearchState | null
  /** The existing lead detail page. Opening it never starts research. */
  detailHref: string
}

// Customer wording for the email line. Plain language only: no error codes, no status names. The primary
// message is always the same simple sentence; the secondary reason keeps the inspection honest (it says
// what could not be checked) and is omitted when the whole website was read and simply had no address.
export const EMAIL_WORDING = {
  /** The one primary message whenever no email was found. */
  notDiscovered: 'Email not discovered',
  /** Secondary: no page could be read, so nothing is known about the site. */
  unreadable: "Website couldn't be checked.",
  /** Secondary: some pages could not be read, and nothing was found on the ones that could. */
  partial: 'Only part of the website was checked.',
  /** Secondary: there was no website to look at. */
  noWebsite: 'No website provided.',
  /** Shown beside an address that was found while some pages could not be read. */
  partialNote: 'Only part of the website was checked',
} as const

export function describeEmailStatus(
  lead: Pick<TrialLead, 'website' | 'email' | 'email_inspection'>
): { missing: string | null; reason: string | null; note: string | null } {
  const inspection = isEmailInspection(lead.email_inspection) ? lead.email_inspection : null

  if (lead.email?.trim()) {
    return {
      missing: null,
      reason: null,
      note: inspection?.state === 'checked' && inspection.partial ? EMAIL_WORDING.partialNote : null,
    }
  }

  const missing = EMAIL_WORDING.notDiscovered
  if (!websiteHost(lead.website) || inspection?.state === 'no_website') return { missing, reason: EMAIL_WORDING.noWebsite, note: null }
  if (inspection?.state === 'unreadable') return { missing, reason: EMAIL_WORDING.unreadable, note: null }
  if (inspection?.state === 'checked' && inspection.partial) return { missing, reason: EMAIL_WORDING.partial, note: null }
  return { missing, reason: null, note: null }
}

/** Businesses whose website was listed but could not be read at all. */
export function countUnreadableWebsites(leads: Array<Pick<TrialLead, 'website' | 'email_inspection'>>): number {
  return leads.filter((lead) => websiteHost(lead.website) && isEmailInspection(lead.email_inspection) && lead.email_inspection.state === 'unreadable').length
}

export function websiteHost(website: string | null | undefined): string | null {
  const value = website?.trim()
  if (!value) return null
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, '')
  } catch {
    return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] || null
  }
}

function websiteHref(website: string) {
  const value = website.trim()
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function formatSegment(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  // A stored industry such as "dentists" reads better as "Dentists"; anything already cased is left alone.
  return trimmed === trimmed.toLowerCase() ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed
}

export function describeLead(lead: Pick<TrialLead, 'city' | 'industry'>): string | null {
  const parts = [formatSegment(lead.city), formatSegment(lead.industry)].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function toResultRow(
  lead: TrialLead,
  options: { researchState?: ResearchState | null } = {}
): ResultRowModel {
  const host = websiteHost(lead.website)
  const synopsis = lead.commercial_profile?.summary?.trim() || null
  const email = lead.email?.trim() || null
  const phone = lead.phone?.trim() || null
  const emailStatus = describeEmailStatus(lead)

  return {
    id: lead.id,
    name: lead.company_name,
    descriptor: describeLead(lead),
    website: host && lead.website ? { host, href: websiteHref(lead.website) } : null,
    email: email ? { address: email, href: `mailto:${email}`, possible: isPossibleEmail(lead) } : null,
    emailMissing: emailStatus.missing,
    emailMissingReason: emailStatus.reason,
    emailNote: emailStatus.note,
    phone: phone ? { display: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` } : null,
    synopsis,
    research: options.researchState ?? null,
    detailHref: `/dashboard/leads/${lead.id}?view=details`,
  }
}

/** "Showing 5 of 25", or null when everything is shown. */
export function describeShown(shown: number, total: number): string | null {
  return total > shown ? `Showing ${shown} of ${total}` : null
}

/**
 * The one quiet line under the settled summary. The hero already says how many businesses are ready, so
 * this only explains the difference between that and the work behind it: how many candidates were
 * evaluated (`discovered`, which can exceed the request when extra candidates were considered), how many
 * websites were inspected, and what was filtered. Only numbers the server reported; only when relevant.
 */
export function describeSettledNote(input: {
  /** Candidates the search evaluated (the raw discovery count). */
  discovered: number | null
  /** Businesses that reached the results. */
  added: number
  duplicates: number
  invalid: number
  /** Website checks that concluded across every pass. */
  inspected?: number | null
  /** Websites that could not be read at all (see countUnreadableWebsites). */
  unreadable?: number
}): string | null {
  const unreadable = input.unreadable ?? 0
  const evaluatedMore = input.discovered !== null && input.discovered !== input.added
  const parts = [
    evaluatedMore ? `${count(input.discovered as number, 'candidate')} evaluated` : null,
    evaluatedMore && input.inspected ? `${count(input.inspected, 'website')} inspected` : null,
    describeFiltering({ duplicates: input.duplicates, invalid: input.invalid }),
    unreadable > 0 ? `${count(unreadable, 'website')} couldn't be checked` : null,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Quiet notes about what happened to businesses between discovery and the list: only counts the
 * server really reported, only when non-zero.
 */
export function describeFiltering(input: { duplicates: number; invalid: number }): string | null {
  const parts = [
    input.duplicates > 0 ? `${count(input.duplicates, 'duplicate')} removed` : null,
    input.invalid > 0 ? `${input.invalid} without usable contact details filtered` : null,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}
