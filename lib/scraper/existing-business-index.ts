// Awareness of the signed-in customer's existing businesses, used during discovery to skip work for ones they already have.
//
// The authoritative duplicate check is `save_discover_results` and it stays so. A candidate is a duplicate there when the
// customer already has a lead with the same name AND the same city AND (the same email OR phone OR website). This module
// applies the same rule with the evidence available at discovery time (phone and website; the email is not known until
// enrichment), so it can only ever skip what the save would have rejected anyway. It never matches on a name alone:
// two branches of one company in one city are told apart by their own phone or website.

type Client = any

export type ExistingBusinessIndex = {
  /** Existing businesses indexed, for reporting. */
  size: number
  /** False when the library was larger than the safety cap, so only part of it is indexed (fewer skips, never wrong ones). */
  complete: boolean
  /** key "name|city" -> the phone numbers and websites already saved under that name and city */
  byNameCity: Map<string, { phones: Set<string>; sites: Set<string> }>
}

export type BusinessIdentity = { company_name: string; city?: string | null; phone?: string | null; website?: string | null }

// Same normalisation the save function applies in SQL.
export const normalizeName = (value: string | null | undefined) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
export const normalizeCity = (value: string | null | undefined) => String(value ?? '').trim().toLowerCase()
export const normalizePhoneDigits = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '')
export const normalizeSite = (value: string | null | undefined) =>
  String(value ?? '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')

const nameCityKey = (identity: BusinessIdentity) => `${normalizeName(identity.company_name)}|${normalizeCity(identity.city)}`

export function buildExistingBusinessIndex(rows: BusinessIdentity[], complete = true): ExistingBusinessIndex {
  const byNameCity: ExistingBusinessIndex['byNameCity'] = new Map()
  for (const row of rows) {
    if (!normalizeName(row.company_name)) continue
    const key = nameCityKey(row)
    const entry = byNameCity.get(key) ?? { phones: new Set<string>(), sites: new Set<string>() }
    const phone = normalizePhoneDigits(row.phone)
    const site = normalizeSite(row.website)
    if (phone) entry.phones.add(phone)
    if (site) entry.sites.add(site)
    byNameCity.set(key, entry)
  }
  return { size: rows.length, complete, byNameCity }
}

/** True only when the customer already has this business: same name and city plus the same phone or website. */
export function isKnownBusiness(index: ExistingBusinessIndex | null | undefined, candidate: BusinessIdentity): boolean {
  if (!index || !normalizeName(candidate.company_name)) return false
  const entry = index.byNameCity.get(nameCityKey(candidate))
  if (!entry) return false
  const phone = normalizePhoneDigits(candidate.phone)
  const site = normalizeSite(candidate.website)
  return (phone !== '' && entry.phones.has(phone)) || (site !== '' && entry.sites.has(site))
}

/** A stable identity for counting each skipped business once, however many providers returned it. */
export function knownBusinessKey(candidate: BusinessIdentity): string {
  return `${nameCityKey(candidate)}|${normalizePhoneDigits(candidate.phone) || normalizeSite(candidate.website)}`
}

const PAGE_SIZE = 1000
const PARALLEL_PAGES = 4
/** A safety ceiling on how much of a library is indexed in one search. Beyond it the index is marked incomplete. */
export const MAX_INDEXED_BUSINESSES = 50_000

/**
 * Loads the customer's existing identities once per search with the customer's own session (row security applies). It
 * counts first, then reads fixed 1,000-row ranges in a stable order, a few at a time, so a large library is read completely
 * and never through one unbounded query. Any failure returns null: discovery then simply skips nothing.
 */
export async function loadExistingBusinessIndex(
  client: Client,
  userId: string,
  options: { maxRows?: number } = {}
): Promise<ExistingBusinessIndex | null> {
  try {
    const maxRows = options.maxRows ?? MAX_INDEXED_BUSINESSES
    const counted = await client.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    if (counted.error || typeof counted.count !== 'number') return null
    const total = counted.count
    if (total === 0) return buildExistingBusinessIndex([], true)

    const toLoad = Math.min(total, maxRows)
    const ranges: Array<[number, number]> = []
    for (let from = 0; from < toLoad; from += PAGE_SIZE) ranges.push([from, Math.min(from + PAGE_SIZE, toLoad) - 1])

    const rows: BusinessIdentity[] = []
    for (let i = 0; i < ranges.length; i += PARALLEL_PAGES) {
      const pages = await Promise.all(
        ranges.slice(i, i + PARALLEL_PAGES).map(([from, to]) =>
          client.from('leads').select('company_name, city, phone, website').eq('user_id', userId).order('id', { ascending: true }).range(from, to)
        )
      )
      for (const page of pages) {
        if (page.error || !Array.isArray(page.data)) return null
        rows.push(...page.data)
      }
    }
    return buildExistingBusinessIndex(rows, total <= maxRows)
  } catch (error) {
    console.warn('[existing-businesses] could not read the library', error instanceof Error ? error.message : 'unknown error')
    return null
  }
}
