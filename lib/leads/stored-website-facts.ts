// What ALPA read from a business's own website during a free-trial search, as it is kept on the saved business (leads.website_facts)
// once the visitor creates an account. It is deliberately separate from the AI-written commercial profile: these are the website's
// own words (its title, description and headings), read by rules, never written or extended by AI.
//
// The stored value is treated as untrusted when it is read back (a customer may edit their own rows): every field is cleaned,
// capped and checked, and only web addresses a person can safely open survive.

export const WEBSITE_FACTS_VERSION = 1

export type StoredWebsiteFacts = {
  version: 1
  /** Where the facts came from: a free-trial search. Nothing else writes this column. */
  origin: 'free_trial'
  captured_at: string | null
  title: string | null
  description: string | null
  headings: string[]
  source_urls: string[]
  /** How well the website could be read when the facts were gathered (the email pipeline's own record). */
  inspection: { state: 'checked' | 'unreadable' | 'no_website'; partial: boolean } | null
}

type LiveFacts = { title?: string | null; description?: string | null; headings?: string[] | null; source_urls?: string[] | null } | null | undefined
type LiveInspection = { state?: string | null; partial?: boolean | null } | null | undefined

const STATES = ['checked', 'unreadable', 'no_website'] as const

const text = (value: unknown, max: number): string | null => {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return clean || null
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function clean(facts: LiveFacts, inspection: LiveInspection) {
  const headings = (Array.isArray(facts?.headings) ? facts!.headings! : []).map((heading) => text(heading, 150)).filter((heading): heading is string => Boolean(heading))
  const sources = (Array.isArray(facts?.source_urls) ? facts!.source_urls! : []).map(httpUrl).filter((url): url is string => Boolean(url))
  const state = (STATES as readonly string[]).includes(String(inspection?.state)) ? (inspection!.state as (typeof STATES)[number]) : null
  return {
    title: text(facts?.title, 200),
    description: text(facts?.description, 400),
    headings: [...new Set(headings)].slice(0, 8),
    source_urls: [...new Set(sources)].slice(0, 4),
    inspection: state ? { state, partial: inspection?.partial === true } : null,
  }
}

/** The value to save with a business imported from a free trial; null when the trial held no website facts at all. */
export function buildStoredWebsiteFacts(lead: { website_intelligence?: LiveFacts; email_inspection?: LiveInspection }, now: Date = new Date()): StoredWebsiteFacts | null {
  const facts = clean(lead.website_intelligence, lead.email_inspection)
  if (!facts.title && !facts.description && facts.headings.length === 0 && !facts.inspection) return null
  return { version: WEBSITE_FACTS_VERSION, origin: 'free_trial', captured_at: now.toISOString(), ...facts }
}

/** The stored value, read back safely. Anything that is not a recognised, non-empty record is null. */
export function parseStoredWebsiteFacts(value: unknown): StoredWebsiteFacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== WEBSITE_FACTS_VERSION || raw.origin !== 'free_trial') return null
  const facts = clean(
    { title: raw.title as string, description: raw.description as string, headings: raw.headings as string[], source_urls: raw.source_urls as string[] },
    raw.inspection as LiveInspection
  )
  if (!facts.title && !facts.description && facts.headings.length === 0 && !facts.inspection) return null
  const captured = typeof raw.captured_at === 'string' && Number.isFinite(Date.parse(raw.captured_at)) ? new Date(raw.captured_at).toISOString() : null
  return { version: WEBSITE_FACTS_VERSION, origin: 'free_trial', captured_at: captured, ...facts }
}
