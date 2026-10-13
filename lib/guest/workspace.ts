// The guest results workspace, as plain functions: how a discovered business becomes a My Leads row, and how the (at most 25)
// businesses are searched, filtered, sorted and counted in the browser. Pure, so it is tested without a browser.
//
// The vocabulary (search words, contact filters, sort names) is the member workspace's own, so both read the same.

import type { LeadListItem } from '../my-leads/list.ts'
import { cleanSearchText, type ContactKey, type SortKey } from '../my-leads/params.ts'
import type { TrialLead } from '../trial.ts'

export type GuestFilters = { q: string; city: string; industry: string; contact: ContactKey[]; sort: SortKey }

export const GUEST_DEFAULT_FILTERS: GuestFilters = { q: '', city: '', industry: '', contact: [], sort: 'activity' }
/** The sorts that make sense for a fresh discovery: its own order (best match first), names, places and the order found. */
export const GUEST_SORT_KEYS: SortKey[] = ['activity', 'name', 'location']

const hasText = (value: string | null | undefined) => Boolean(String(value ?? '').trim())

export function hasGuestFilters(filters: GuestFilters): boolean {
  return Boolean(filters.q.trim() || filters.city.trim() || filters.industry.trim() || filters.contact.length)
}

/** The state a guest row reports: what ALPA read from the business's own website, in plain terms. */
export function guestWebsiteState(lead: TrialLead): { label: string; tone: 'ready' | 'quiet' } {
  const facts = lead.website_intelligence
  if (facts && (hasText(facts.description) || hasText(facts.title) || (facts.headings?.length ?? 0) > 0)) return { label: 'Website read', tone: 'ready' }
  return { label: hasText(lead.website) ? 'Nothing to read' : 'No website', tone: 'quiet' }
}

export function toGuestListItem(lead: TrialLead): LeadListItem {
  return {
    id: lead.id,
    company_name: lead.company_name,
    industry: lead.industry ?? null,
    city: lead.city ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    website: lead.website ?? null,
    has: { email: hasText(lead.email), phone: hasText(lead.phone), website: hasText(lead.website) },
    archived: false,
    created_at: lead.created_at ?? null,
    last_activity_at: null,
    // Guests have no stored profile; the row's own chip (guestWebsiteState) is what it shows.
    intelligence: { state: 'not_started', label: guestWebsiteState(lead).label, preview: lead.website_intelligence?.description ?? null },
  }
}

const folded = (value: string | null | undefined) => String(value ?? '').toLowerCase()

/** The words a search looks through: name, industry, city, website address and the website's own description and topics. */
function haystack(lead: TrialLead): string {
  const facts = lead.website_intelligence
  return folded([lead.company_name, lead.industry, lead.city, lead.website, facts?.title, facts?.description, ...(facts?.headings ?? [])].filter(Boolean).join(' '))
}

export function filterAndSortGuest(leads: TrialLead[], filters: GuestFilters): TrialLead[] {
  const words = cleanSearchText(filters.q).split(' ').filter(Boolean).slice(0, 5)
  const city = folded(filters.city).trim()
  const industry = folded(filters.industry).trim()
  const kept = leads.filter((lead) => {
    if (words.length && !words.every((word) => haystack(lead).includes(word.toLowerCase()))) return false
    if (city && !folded(lead.city).includes(city)) return false
    if (industry && !folded(lead.industry).includes(industry)) return false
    return filters.contact.every((key) => hasText(lead[key]))
  })
  const compare = (a: TrialLead, b: TrialLead, key: 'company_name' | 'city') => folded(a[key]).localeCompare(folded(b[key]), 'en', { sensitivity: 'base' })
  // "activity" is the order the search returned them in, which is kept (a stable sort never reorders equal items).
  if (filters.sort === 'name') return [...kept].sort((a, b) => compare(a, b, 'company_name'))
  if (filters.sort === 'location') return [...kept].sort((a, b) => compare(a, b, 'city') || compare(a, b, 'company_name'))
  return kept
}

export type GuestSummary = { total: number; withEmail: number; withPhone: number; withWebsite: number }

export function summarizeGuest(leads: TrialLead[]): GuestSummary {
  return {
    total: leads.length,
    withEmail: leads.filter((lead) => hasText(lead.email)).length,
    withPhone: leads.filter((lead) => hasText(lead.phone)).length,
    withWebsite: leads.filter((lead) => hasText(lead.website)).length,
  }
}

export function describeGuestRange(shown: number, total: number): string {
  if (total === 0) return 'No businesses'
  return shown === total ? `${total} ${total === 1 ? 'business' : 'businesses'}` : `${shown} of ${total} businesses`
}
