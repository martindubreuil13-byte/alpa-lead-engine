export type EnrichmentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'

export interface WebsiteSnapshot {
  title: string | null
  meta_description: string | null
  h1: string | null
  body_excerpt: string | null
  contact_url: string | null
  about_url: string | null
  services_url: string | null
  visible_email: string | null
  visible_phone: string | null
  social_links: {
    linkedin?: string
    twitter?: string
    facebook?: string
    instagram?: string
    github?: string
  }
  html_hash: string // SHA256 of full HTML for dedup
  extracted_at: string // ISO timestamp
  page_language?: string
  favicon_url?: string
}

export interface BusinessSignals {
  has_https: boolean
  has_contact_page: boolean
  has_about_page: boolean
  has_services_page: boolean
  has_pricing: boolean
  has_testimonials: boolean
  has_blog: boolean
  has_faq: boolean
  has_booking_link: boolean
  has_social_links: boolean
  has_visible_email: boolean
  has_visible_phone: boolean
  detected_cms?: string // WordPress, Webflow, Squarespace, etc.
  detected_ecommerce_platform?: string // Shopify, WooCommerce, etc.
  response_time_ms?: number
  detected_at: string // ISO timestamp
}

export interface CommercialProfile {
  summary: string // 1-2 sentence factual summary
  industry: string // e.g., "Software Development"
  business_category: string // e.g., "B2B SaaS"
  primary_service: string // Main offering
  core_services: string[] // List of main services
  target_customer: string // Who they serve
  competitive_advantage: string // Key differentiator
  keywords: string[] // Extracted keywords from site
  generated_at: string // ISO timestamp
}

export interface CommercialIntelligenceData {
  website_snapshot: WebsiteSnapshot | null
  business_signals: BusinessSignals | null
  commercial_profile: CommercialProfile | null
  enrichment_status: EnrichmentStatus
  enriched_at: string | null
  started_at: string | null
  last_error: string | null
  retry_count: number
  processing_duration_ms: number | null
  model_versions: {
    snapshot: string // e.g., "v1"
    signals: string // e.g., "v1"
    profile: string // e.g., "gpt-4o-mini-20240718"
  }
  cost_estimate: number
}

export interface EnrichmentJob {
  id: string
  user_id: string
  lead_id: string
  status: EnrichmentStatus
  started_at: string | null
  completed_at: string | null
  processing_duration_ms: number | null
  retry_count: number
  max_retries: number
  next_retry_at: string | null
  error_message: string | null
  error_code: string | null
  snapshot_status: EnrichmentStatus | null
  signals_status: EnrichmentStatus | null
  profile_status: EnrichmentStatus | null
  total_cost: number
  created_at: string
  updated_at: string
}

export interface ExtractionResult<T> {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: string
  }
  duration_ms: number
  cost: number
}
