// What a business profile says, in the three things a reader wants first: WHO the business is, WHAT it does and HOW to reach it.
//
// One neutral model, built from either a member's saved business (with its stored profile) or a guest's discovered business
// (with the facts read from its own website). The same presentation then serves both, and the wording rules live here:
// only what the data supports is stated, a missing fact is left out or named as missing, and nothing is ever filled in.

import type { LeadDossier } from './list.ts'
import type { TrialLead } from '../trial.ts'
import { readStoredLightProfile, type LightProfile } from '../guest/light-profile.ts'

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

/** The website's own words about the business, as read by rules. Never written or extended by AI. */
export type DossierSite = {
  text: string | null
  /** A website title shown only when there is no description to show. */
  titleLine: string | null
  topics: string[]
  topicsLabel: string
  sources: Array<{ label: string; url: string }>
  caveat: string | null
}

/** What ALPA's AI wrote about the business from its website (a member's Business Intelligence). Absent until one exists. */
export type DossierAi = {
  text: string
  offers: string[]
  serves: string | null
  /** Short service names from a free-trial profile, shown as tags under the paragraph. */
  tags?: string[]
}

const aiFromLightProfile = (profile: LightProfile | null): DossierAi | null =>
  profile ? { text: profile.summary, offers: [], serves: null, tags: profile.tags } : null

export type DossierModel = {
  name: string
  /** WHO: industry and place first, then any other identifying detail the data holds. */
  who: string[]
  /** WHAT: the AI summary and the website's own words are kept apart and labelled as different things. */
  what: {
    ai: DossierAi | null
    site: DossierSite | null
    /** Why there is no AI profile, from the real state, when there is none (shown quietly next to the website's words). */
    aiNote: string | null
    /** What to say when there is nothing at all to show. */
    empty: string
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

// ----------------------------------------------------------------------------------------------------------------------- shared
type FactsLike = { title?: string | null; description?: string | null; headings?: string[] | null; source_urls?: string[] | null } | null | undefined

/** The website's own words as a labelled block; null when the website gave nothing to show. */
function siteBlock(facts: FactsLike, partial: boolean): DossierSite | null {
  const description = clean(facts?.description)
  const title = clean(facts?.title)
  const topics = (facts?.headings ?? []).map(clean).filter(Boolean).slice(0, 8)
  if (!description && !title && topics.length === 0) return null
  const sources = (facts?.source_urls ?? [])
    .map((url) => ({ label: hostOf(url) ?? 'Website', url: safeHttpUrl(url) ?? '' }))
    .filter((source) => source.url)
  return {
    text: description || null,
    titleLine: !description && title ? title : null,
    topics,
    topicsLabel: 'Topics on their website',
    sources,
    caveat: `These are statements from the business website. ALPA has not independently confirmed them.${partial ? ' Some website pages could not be read.' : ''}`,
  }
}

// ---------------------------------------------------------------------------------------------------------------------- member
export function memberDossierModel(lead: LeadDossier): DossierModel {
  const { intelligence, contact } = lead
  const card = intelligence.card
  const profile = intelligence.profile
  const reason = intelligence.reason ? REASON_TEXT[intelligence.reason] : null
  const stateText = `${STATE_TEXT[intelligence.state] ?? 'No business profile is available.'}${reason ? ` ${reason}` : ''}`
  const site = siteBlock(lead.website, lead.website?.inspection?.partial === true)
  return {
    name: lead.company_name,
    who: [
      [lead.industry ?? profile?.industry, profile?.business_category, lead.city].filter(Boolean).join(' · ') || 'Industry and location were not provided',
      hostOf(contact.website) ?? '',
    ].filter(Boolean),
    what: {
      // The paid Business Intelligence summary always wins; a profile written during the free trial is shown only until one exists.
      ai: card ? { text: card.summary, offers: profile?.core_services ?? [], serves: profile?.target_customer ?? null } : aiFromLightProfile(readStoredLightProfile(lead.lightProfile)),
      site,
      aiNote: !card && site ? stateText : null,
      empty: stateText,
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

  return {
    name: lead.company_name,
    who: [[lead.industry, lead.city].filter(Boolean).join(' · ') || 'Industry and location were not provided', hostOf(lead.website) ?? ''].filter(Boolean),
    what: { ai: aiFromLightProfile(readStoredLightProfile(lead.light_profile)), site: siteBlock(facts, lead.email_inspection?.partial === true), aiNote: null, empty },
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
