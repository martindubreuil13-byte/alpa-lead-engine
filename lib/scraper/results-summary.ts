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
 * The one-line contact summary under the settled count, e.g. "7 websites · 5 emails · 9 phone numbers".
 * All three always appear, including zeros, so a missing kind of contact is visible, not hidden.
 */
export function describeContacts(summary: ContactSummary): string[] {
  return [
    count(summary.websites, 'website'),
    count(summary.emails, 'email'),
    count(summary.phones, 'phone number'),
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
  /** Why there is no address, in plain words. Null when there is one. */
  emailMissing: string | null
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

// Customer wording for the email line. Plain language only: no error codes, no status names. The three
// "no email" sentences mean different things and must never be swapped: the first says the pages were read.
export const EMAIL_WORDING = {
  /** The website was read and nothing was found on the pages checked. */
  noneChecked: 'No email on the pages we checked',
  /** Some pages could not be read, and nothing was found on the ones that could. */
  nonePartial: 'No email found. We could only check part of the site',
  /** No page could be read, so nothing is known about the site. */
  unreadable: "We couldn't read this website",
  noWebsite: 'No website to check',
  /** Nothing is known about how the site was inspected (older results, or a source that does not say). */
  unknown: 'No email found',
  /** Shown beside an address that was found while some pages could not be read. */
  partialNote: 'Only part of the website could be checked',
} as const

export function describeEmailStatus(
  lead: Pick<TrialLead, 'website' | 'email' | 'email_inspection'>
): { missing: string | null; note: string | null } {
  const inspection = isEmailInspection(lead.email_inspection) ? lead.email_inspection : null

  if (lead.email?.trim()) {
    return { missing: null, note: inspection?.state === 'checked' && inspection.partial ? EMAIL_WORDING.partialNote : null }
  }

  if (!websiteHost(lead.website) || inspection?.state === 'no_website') return { missing: EMAIL_WORDING.noWebsite, note: null }
  if (inspection?.state === 'unreadable') return { missing: EMAIL_WORDING.unreadable, note: null }
  if (inspection?.state === 'checked') {
    return { missing: inspection.partial ? EMAIL_WORDING.nonePartial : EMAIL_WORDING.noneChecked, note: null }
  }
  return { missing: EMAIL_WORDING.unknown, note: null }
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

  return {
    id: lead.id,
    name: lead.company_name,
    descriptor: describeLead(lead),
    website: host && lead.website ? { host, href: websiteHref(lead.website) } : null,
    email: email ? { address: email, href: `mailto:${email}`, possible: isPossibleEmail(lead) } : null,
    emailMissing: describeEmailStatus(lead).missing,
    emailNote: describeEmailStatus(lead).note,
    phone: phone ? { display: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` } : null,
    synopsis,
    research: options.researchState ?? null,
    detailHref: `/dashboard/leads/${lead.id}`,
  }
}

/** "Showing 5 of 25", or null when everything is shown. */
export function describeShown(shown: number, total: number): string | null {
  return total > shown ? `Showing ${shown} of ${total}` : null
}

/**
 * The one quiet line under the settled summary. `discovered` is the real discovery count and `added`
 * is how many businesses actually reached the results; they differ when some were duplicates or had
 * no usable contact details, and the line says so with the numbers the server reported.
 */
export function describeSettledNote(input: {
  discovered: number | null
  added: number
  duplicates: number
  invalid: number
  /** Websites that could not be read at all (see countUnreadableWebsites). */
  unreadable?: number
}): string | null {
  const unreadable = input.unreadable ?? 0
  const parts = [
    input.discovered !== null && input.added !== input.discovered ? `${input.added} added to your results` : null,
    describeFiltering({ duplicates: input.duplicates, invalid: input.invalid }),
    unreadable > 0 ? `${count(unreadable, 'website')} couldn't be read` : null,
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
