// What a business profile says, in the three things a reader wants first: WHO the business is, WHAT it does and HOW to reach it.
//
// One neutral model, built from either a member's saved business (with its stored profile) or a guest's discovered business
// (with the facts read from its own website). The same presentation then serves both, and the wording rules live here:
// only what the data supports is stated, a missing fact is left out or named as missing, and nothing is ever filled in.

import type { LeadDossier } from './list.ts'
import type { TrialLead } from '../trial.ts'

export type DossierContact = {
  name: string | null
  email: string | null
  /** A short caution about the address ("Possible address."), when one applies. */
  emailNote: string | null
  phone: string | null
  website: string | null
  /** Plain statements of what was not found, never guesses. */
  missing: string[]
}

export type DossierModel = {
  name: string
  /** WHO: industry and place first, then any other identifying detail the data holds. */
  who: string[]
  /** WHAT: a factual description, where it came from, and what else the business says about itself. */
  what: {
    text: string | null
    /** "From their website", for the line above or below the text. Null when there is no text. */
    attribution: string | null
    /** A website title shown only when there is no description to show. */
    titleLine: string | null
    topics: string[]
    topicsLabel: string
    offers: string[]
    serves: string | null
    /** What to say when there is nothing to show. */
    empty: string
    sources: Array<{ label: string; url: string }>
    caveat: string | null
  }
  contact: DossierContact
}

const REASON_TEXT: Record<string, string> = {
  budget: 'This search reached its research limit.',
  cancelled: 'Research was stopped for this search.',
  research_failed: 'The website could not be researched.',
  run_limit: "Not researched: this search's research limit was reached.",
  no_website: 'This business has no website to read.',
}
const STATE_TEXT: Record<string, string> = {
  queued: 'Queued for research. The profile will appear here when it is generated.',
  researching: 'Being researched now. The profile will appear here when it is generated.',
  retry_pending: 'Research will be retried.',
  failed: "The profile couldn't be completed.",
  partial: 'Only part of the profile could be built.',
  unavailable: 'No business profile was generated for this business.',
  cancelled: 'Research was stopped for this search.',
  not_started: 'No business profile has been generated for this business yet.',
}

export const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null
  try {
    return new URL(/^[a-z]+:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** Only web addresses a person can safely open. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value || '')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const clean = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------------------------------------------------- member
export function memberDossierModel(lead: LeadDossier): DossierModel {
  const { intelligence, contact } = lead
  const card = intelligence.card
  const profile = intelligence.profile
  const reason = intelligence.reason ? REASON_TEXT[intelligence.reason] : null
  return {
    name: lead.company_name,
    who: [
      [lead.industry ?? profile?.industry, profile?.business_category, lead.city].filter(Boolean).join(' · ') || 'Industry and location were not provided',
      hostOf(contact.website) ?? '',
    ].filter(Boolean),
    what: {
      text: card ? card.summary : null,
      attribution: card ? 'A summary of what their website says' : null,
      titleLine: null,
      topics: [],
      topicsLabel: '',
      offers: profile?.core_services ?? [],
      serves: profile?.target_customer ?? null,
      empty: `${STATE_TEXT[intelligence.state] ?? 'No business profile is available.'}${reason ? ` ${reason}` : ''}`,
      sources: [],
      caveat: null,
    },
    contact: {
      name: contact.name,
      email: contact.email,
      emailNote: contact.email ? (contact.email_confidence === 'low' ? 'Lower-confidence address.' : contact.is_generic_email ? 'Shared business inbox.' : null) : null,
      phone: contact.phone,
      website: contact.website,
      missing: !contact.email && !contact.phone && !contact.website ? ['No contact details were found for this business.'] : [],
    },
  }
}

// ----------------------------------------------------------------------------------------------------------------------- guest
/**
 * A guest's business. "What they do" is the description, topics and title the business publishes on its own website; it is
 * labelled as the website's own words and never rewritten or extended.
 */
export function guestDossierModel(lead: TrialLead): DossierModel {
  const facts = lead.website_intelligence ?? null
  const description = clean(facts?.description)
  const title = clean(facts?.title)
  const topics = (facts?.headings ?? []).map(clean).filter(Boolean).slice(0, 8)
  const email = clean(lead.email) || null
  const phone = clean(lead.phone) || null
  const website = safeHttpUrl(lead.website)

  const unreadable = lead.email_inspection?.state === 'unreadable'
  const missing: string[] = []
  if (!email) missing.push(unreadable ? 'Email unavailable: the website could not be read.' : 'No email address was published on the pages ALPA read.')
  if (!phone) missing.push('No phone number was found.')
  if (!website) missing.push('No website was found.')

  let empty = 'ALPA could not read a description for this business.'
  if (!website) empty = 'This business has no website listed, so there is nothing to read.'
  else if (unreadable) empty = 'Its website could not be read, so there is no description.'
  else if (facts) empty = 'No descriptive text was found on the pages ALPA read.'

  const sources = (facts?.source_urls ?? [])
    .map((url) => ({ label: hostOf(url) ?? 'Website', url: safeHttpUrl(url) ?? '' }))
    .filter((source) => source.url)

  return {
    name: lead.company_name,
    who: [[lead.industry, lead.city].filter(Boolean).join(' · ') || 'Industry and location were not provided', hostOf(lead.website) ?? ''].filter(Boolean),
    what: {
      text: description || null,
      attribution: description ? 'From their website' : null,
      titleLine: !description && title ? title : null,
      topics,
      topicsLabel: 'Topics on their website',
      offers: [],
      serves: null,
      empty,
      sources,
      caveat: facts && (description || title || topics.length)
        ? `These are statements from the business website. ALPA has not independently confirmed them.${lead.email_inspection?.partial ? ' Some website pages could not be read.' : ''}`
        : null,
    },
    contact: {
      name: null,
      email,
      emailNote: email ? (lead.email_confidence === 'low' ? 'Possible address.' : lead.is_generic_email ? 'Shared business inbox.' : null) : null,
      phone,
      website,
      missing,
    },
  }
}
