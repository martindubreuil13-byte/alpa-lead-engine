/**
 * Stable dedup key for a lead — domain-first.
 *
 * Priority:
 *   1. website → extract bare domain (strip protocol, www, path, query, hash)
 *   2. email   → domain part after @
 *   3. fallback → lowercase(name) + '-' + lowercase(location)
 *
 * Used consistently everywhere: lead insert, seen-Set population,
 * outreach_queue dedup check. Must stay in sync with the SQL backfill
 * in migration 20260416_03_add_dedup_key.sql.
 */
export function buildLeadKey(params: {
  website?: string | null
  email?: string | null
  name?: string | null
  location?: string | null
}): string {
  const { website, email, name, location } = params

  if (website) {
    return website
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/[/?#].*$/, '')
      .toLowerCase()
      .trim()
  }

  if (email) {
    return (email.split('@')[1] ?? '').toLowerCase().trim()
  }

  return `${(name ?? '').toLowerCase()}-${(location ?? '').toLowerCase()}`.trim()
}
