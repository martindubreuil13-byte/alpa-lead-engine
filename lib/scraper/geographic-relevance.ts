// Country-level geographic check for discovered businesses.
//
// A business is rejected only when BOTH countries are known from evidence and they differ: the requested country (what the
// customer typed or a supported city implies, see lib/sources/country.ts) and the country the business's own address
// states. The requested search text is never evidence of where a business is. Missing, partial or ambiguous addresses are
// never grounds for rejection, and no city-level judgement is made: a business in a neighbouring suburb, or in a city that
// merely shares a name, cannot be told apart from a real mismatch without a geographic database.

import { lookupCountry, type ResolvedCountry } from '../sources/country.ts'

export function isConfirmedOutsideRequestedCountry(
  requested: ResolvedCountry | null | undefined,
  business: { country?: string | null }
): boolean {
  if (!requested) return false
  const actual = lookupCountry(business.country)
  return actual !== null && actual.code !== requested.code
}
