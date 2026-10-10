// A business category exactly as a discovery provider reported it, tidied for display.
//
// Returns null when the provider gave nothing usable. It never falls back to the search query: "consultant"
// typed by the customer is not a category the provider assigned to a business, and presenting it as one
// would be invented data.

// Google Places returns these on almost every place. They describe "a place", not a kind of business.
const GENERIC_PLACE_CODES = new Set([
  'point_of_interest',
  'establishment',
  'premise',
  'subpremise',
  'political',
  'geocode',
  'street_address',
  'route',
  'locality',
  'sublocality',
  'neighborhood',
  'food', // a bare "food" is not informative next to the specific type that usually follows it
])

export function providerCategory(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (GENERIC_PLACE_CODES.has(raw.toLowerCase())) return null

  // "real_estate_agency" -> "Real estate agency". Text that is already readable is left as the provider wrote it.
  const readable = /^[a-z0-9_]+$/.test(raw) ? raw.replace(/_/g, ' ') : raw
  const tidy = readable.replace(/\s+/g, ' ').trim()
  return tidy ? tidy.charAt(0).toUpperCase() + tidy.slice(1, 120) : null
}

/** A Serper map listing's category: its own `type`, else the first of its `types`. Never the search query. */
export function serperPlaceCategory(place: { type?: string | null; types?: Array<string | null | undefined> | null }): string | null {
  return providerCategory(place.type) ?? firstProviderCategory(place.types)
}

/** The first usable category in a provider's list of types. */
export function firstProviderCategory(values: ReadonlyArray<string | null | undefined> | null | undefined): string | null {
  for (const value of values ?? []) {
    const category = providerCategory(value)
    if (category) return category
  }
  return null
}
