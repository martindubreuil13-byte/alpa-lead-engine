// The country a search is for, when it can be determined reliably from what the customer typed.
//
// A search provider is told a country (Serper's `gl`, Google's region bias) only when the customer named one, or when the
// location is one of the supported cities whose country is certain. Nothing is guessed from a bare city name: "London" or
// "Springfield" exist in several countries, so they resolve to nothing and the search runs without a country, exactly as
// the customer asked.

export type ResolvedCountry = { code: string; name: string }

// ISO 3166-1 alpha-2 codes (the form Serper's `gl` takes). Names that are also common place or region names elsewhere
// (for example Georgia, Jordan, Jersey, Guinea) are deliberately left out, since they are not reliable.
const COUNTRIES: Array<[code: string, name: string, aliases: string[]]> = [
  ['us', 'United States', ['usa', 'u.s.', 'u.s.a.', 'us', 'united states', 'united states of america', 'america']],
  ['ca', 'Canada', ['canada']], // not "ca": that is California
  ['gb', 'United Kingdom', ['uk', 'u.k.', 'gb', 'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland']],
  ['ie', 'Ireland', ['ireland', 'republic of ireland']],
  ['au', 'Australia', ['australia', 'au']],
  ['nz', 'New Zealand', ['new zealand', 'nz']],
  ['in', 'India', ['india']],
  ['ae', 'United Arab Emirates', ['uae', 'u.a.e.', 'united arab emirates']],
  ['sa', 'Saudi Arabia', ['saudi arabia', 'ksa']],
  ['sg', 'Singapore', ['singapore']],
  ['za', 'South Africa', ['south africa']],
  ['ng', 'Nigeria', ['nigeria']],
  ['ke', 'Kenya', ['kenya']],
  ['pk', 'Pakistan', ['pakistan']],
  ['bd', 'Bangladesh', ['bangladesh']],
  ['ph', 'Philippines', ['philippines', 'the philippines']],
  ['id', 'Indonesia', ['indonesia']],
  ['my', 'Malaysia', ['malaysia']],
  ['th', 'Thailand', ['thailand']],
  ['vn', 'Vietnam', ['vietnam', 'viet nam']],
  ['jp', 'Japan', ['japan']],
  ['kr', 'South Korea', ['south korea', 'korea']],
  ['cn', 'China', ['china']],
  ['hk', 'Hong Kong', ['hong kong']],
  ['fr', 'France', ['france']],
  ['de', 'Germany', ['germany', 'deutschland']],
  ['es', 'Spain', ['spain', 'espana', 'españa']],
  ['it', 'Italy', ['italy', 'italia']],
  ['pt', 'Portugal', ['portugal']],
  ['nl', 'Netherlands', ['netherlands', 'the netherlands', 'holland']],
  ['be', 'Belgium', ['belgium']],
  ['ch', 'Switzerland', ['switzerland']],
  ['at', 'Austria', ['austria']],
  ['se', 'Sweden', ['sweden']],
  ['no', 'Norway', ['norway']],
  ['dk', 'Denmark', ['denmark']],
  ['fi', 'Finland', ['finland']],
  ['pl', 'Poland', ['poland']],
  ['tr', 'Turkey', ['turkey', 'türkiye']],
  ['il', 'Israel', ['israel']],
  ['eg', 'Egypt', ['egypt']],
  ['ma', 'Morocco', ['morocco']],
  ['mx', 'Mexico', ['mexico', 'méxico']],
  ['br', 'Brazil', ['brazil', 'brasil']],
  ['ar', 'Argentina', ['argentina']],
  ['cl', 'Chile', ['chile']],
  ['co', 'Colombia', ['colombia']],
  ['pe', 'Peru', ['peru']],
]

// The supported cities of the coordinate table in serper.ts are Canadian; their country is certain.
const SUPPORTED_CITIES = new Set(['montreal', 'laval', 'longueuil', 'quebec', 'toronto', 'vancouver', 'calgary'])

// Canadian provinces and US states, as the last part of a location ("Ottawa, ON", "Miami, Florida"). Georgia is left out:
// it is also a country. Two-letter codes are matched only in this position, never anywhere else in the text.
export const CA_REGIONS = new Set(['on', 'qc', 'bc', 'ab', 'mb', 'sk', 'ns', 'nb', 'nl', 'pe', 'yt', 'nt', 'nu', 'ontario', 'quebec', 'québec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan', 'nova scotia', 'new brunswick', 'newfoundland and labrador', 'prince edward island'])
export const US_REGIONS = new Set(['al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'])

// Two-letter codes that are both a US state or Canadian province and an ISO country code (CO Colorado/Colombia, IN Indiana/
// India, CA California/Canada, DE Delaware/Germany ...). Typed alone they say nothing reliable about the country, so they
// are not used; the full name always is.
const AMBIGUOUS_CODES = new Set(['al', 'az', 'ar', 'ca', 'co', 'de', 'id', 'il', 'in', 'la', 'me', 'md', 'ma', 'mn', 'ms', 'mo', 'mt', 'ne', 'nc', 'pa', 'sc', 'sd', 'tn', 'va', 'sk', 'nl', 'pe', 'yt'])

export const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()

const BY_ALIAS = new Map<string, ResolvedCountry>()
for (const [code, name, aliases] of COUNTRIES) {
  BY_ALIAS.set(normalize(name), { code, name })
  for (const alias of aliases) BY_ALIAS.set(normalize(alias), { code, name })
}

/** A country named exactly (name, common alias or ISO code); null when it is not one we are sure about. */
export function lookupCountry(value: string | null | undefined): ResolvedCountry | null {
  const key = normalize(String(value ?? ''))
  return key ? BY_ALIAS.get(key) ?? null : null
}

/**
 * Order of evidence: a country the request names explicitly; then a country named as the last part of the location
 * ("Mumbai, India", "India"); then a Canadian province or US state in that position; then a supported Canadian city. Anything else is ambiguous and resolves to null.
 */
export function resolveCountry(input: { city?: string | null; region?: string | null; country?: string | null }): ResolvedCountry | null {
  const explicit = lookupCountry(input.country)
  if (explicit) return explicit
  for (const field of [input.region, input.city]) {
    const parts = String(field ?? '').split(',')
    const last = lookupCountry(parts[parts.length - 1])
    if (last) return last
    // A region after a comma ("Ottawa, ON"), or a region on its own in the region field.
    if (parts.length > 1 || field === input.region) {
      const region = normalize(parts[parts.length - 1])
      if (region.length === 2 && AMBIGUOUS_CODES.has(region)) continue
      if (CA_REGIONS.has(region)) return lookupCountry('canada')
      if (US_REGIONS.has(region)) return lookupCountry('united states')
    }
  }
  const city = normalize(String(input.city ?? '').split(',')[0])
  return SUPPORTED_CITIES.has(city) ? lookupCountry('canada') : null
}

/** Google Places' `region` bias takes a ccTLD, and only some countries map cleanly. */
export function googleRegionFor(code: string | null | undefined): string | undefined {
  switch (code) {
    case 'us': case 'ca': case 'au': case 'ae': return code
    case 'gb': return 'uk'
    default: return undefined
  }
}
