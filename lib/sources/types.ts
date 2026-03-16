export type SourceLead = {
  company_name: string
  phone?: string | null
  website?: string | null
  email?: string | null
  industry?: string | null
  city?: string | null
  source: string
  source_url?: string | null
}

export type SourceSearchInput = {
  query: string
  city: string
  region: string
  maxResults: number
  send?: (msg: string) => void
}