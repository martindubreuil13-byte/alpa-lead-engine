// The My Leads query vocabulary: what a list request may ask for, validated. Shared by the endpoint and the browser, so the
// two cannot drift apart. Pure: no database, no framework.

export const PAGE_SIZE_DEFAULT = 25
export const PAGE_SIZE_MAX = 100
/** A page cannot start beyond this offset: a bound on how far a request can ask the database to skip. */
export const MAX_OFFSET = 100_000

export const SORT_KEYS = ['activity', 'newest', 'oldest', 'name', 'location'] as const
export const CONTACT_KEYS = ['email', 'phone', 'website'] as const
export const BI_FILTERS = ['ready', 'not_ready', 'awaiting', 'attention'] as const
export const VIEWS = ['active', 'archived', 'all'] as const

export type SortKey = (typeof SORT_KEYS)[number]
export type ContactKey = (typeof CONTACT_KEYS)[number]
export type BiFilter = (typeof BI_FILTERS)[number]
export type ViewKey = (typeof VIEWS)[number]

export type ListParams = {
  view: ViewKey
  /** Search words; every word must match somewhere (name, industry, city, website or the saved profile). */
  words: string[]
  city: string | null
  industry: string | null
  /** Contact details a business must have. */
  contact: ContactKey[]
  bi: BiFilter | null
  sort: SortKey
  page: number
  pageSize: number
  summary: boolean
}

export type ParseResult = { ok: true; params: ListParams } | { ok: false; message: string }

/**
 * Text that is safe to place inside a PostgREST filter: the characters that structure a filter (commas, parentheses, quotes,
 * backslashes, the * wildcard) and control characters become spaces. Left alone, `%` and `_` only widen a match inside the
 * customer's own data.
 */
export function cleanSearchText(value: string, max = 100): string {
  return value.replace(/[\u0000-\u001f\u007f,()"\\*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T | null {
  if (value === null || value === '') return fallback
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function wholeNumber(value: string | null, fallback: number): number | null {
  if (value === null || value === '') return fallback
  return /^\d{1,7}$/.test(value) ? Number(value) : null
}

export function parseListParams(search: URLSearchParams): ParseResult {
  const view = oneOf(search.get('view'), VIEWS, 'active')
  if (view === null) return { ok: false, message: 'Unknown view' }
  const sort = oneOf(search.get('sort'), SORT_KEYS, 'activity')
  if (sort === null) return { ok: false, message: 'Unknown sort' }

  let bi: BiFilter | null = null
  const biValue = search.get('bi')
  if (biValue) {
    if (!(BI_FILTERS as readonly string[]).includes(biValue)) return { ok: false, message: 'Unknown Business Intelligence filter' }
    bi = biValue as BiFilter
  }

  const contact: ContactKey[] = []
  for (const part of (search.get('contact') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
    if (!(CONTACT_KEYS as readonly string[]).includes(part)) return { ok: false, message: 'Unknown contact filter' }
    if (!contact.includes(part as ContactKey)) contact.push(part as ContactKey)
  }

  const page = wholeNumber(search.get('page'), 1)
  const requestedSize = wholeNumber(search.get('pageSize'), PAGE_SIZE_DEFAULT)
  if (page === null || page < 1 || requestedSize === null || requestedSize < 1) return { ok: false, message: 'Invalid page or page size' }
  const pageSize = Math.min(requestedSize, PAGE_SIZE_MAX)
  if ((page - 1) * pageSize > MAX_OFFSET) return { ok: false, message: 'Page is out of range' }

  const words = cleanSearchText(search.get('q') ?? '').split(' ').filter(Boolean).slice(0, 5).map((word) => word.slice(0, 50))
  const city = cleanSearchText(search.get('city') ?? '', 80) || null
  const industry = cleanSearchText(search.get('industry') ?? '', 80) || null

  return { ok: true, params: { view, words, city, industry, contact, bi, sort, page, pageSize, summary: search.get('summary') === '1' } }
}

