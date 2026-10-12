export type SourceLead = {
  company_name: string
  phone?: string | null
  website?: string | null
  email?: string | null
  industry?: string | null
  /** The business's own city as its address states it. Null when the address does not say; never the search location. */
  city?: string | null
  /** The provider's address and what it reliably states about the region and country. Null when unknown. */
  address?: string | null
  region?: string | null
  country?: string | null
  source: string
  source_url?: string | null
}

export type SourceSearchInput = {
  query: string
  city: string
  region: string
  country?: string
  /** ISO 3166-1 alpha-2 code of the requested country, only when it was determined reliably. */
  countryCode?: string
  maxResults: number
  send?: (msg: string) => void
}
