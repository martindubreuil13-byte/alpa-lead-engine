// The row written to `leads` for a discovered business.
//
// Pure, so what is persisted can be tested without the route. The category (`industry`) is whatever the
// discovery provider reported for the business, trimmed; it is never filled in from the search query.

import type { EmailConfidence } from '../validation.ts'
import type { EmailInspection } from './email-inspection.ts'
import type { TrialLead } from '../trial.ts'

export type LeadInsertSource = {
  company_name: string
  email: string | null
  phone: string | null
  website: string | null
  city?: string | null
  /** The provider's own category for the business, when it supplied one. */
  industry?: string | null
  source: 'serper' | 'google' | 'hybrid'
  email_confidence: EmailConfidence | null
  email_source: string | null
  is_generic_email: boolean
  cost_estimate: number
}

export type LeadInsertPayload = {
  user_id: string
  company_name: string
  email: string | null
  phone: string | null
  website: string | null
  city: string | null
  industry: string | null
  status: 'inbox'
  source: 'serper' | 'google' | 'hybrid'
  email_confidence: EmailConfidence
  email_source: string | null
  is_generic_email: boolean
  cost_estimate: number
  last_activity_at?: string
}

/** The discovered business as it exists after enrichment: what the results payload is built from. */
export type ResultLeadSource = LeadInsertSource & {
  city: string
  source_url?: string | null
  email_inspection?: EmailInspection | null
}

/**
 * The business as the customer's results (and the guest stream) carry it. Everything the interface
 * needs to tell facts apart travels here: the real email confidence (so a possible address is not
 * mistaken for a confirmed one), how well the website was inspected, and the provider's category.
 * Only `email_inspection` is stream-only; the rest is also what is saved.
 */
export function buildResultLead(lead: ResultLeadSource, id: string, now: () => string = () => new Date().toISOString()): TrialLead {
  return {
    id,
    company_name: lead.company_name,
    city: lead.city || null,
    industry: cleanCategory(lead.industry),
    email: lead.email,
    email_source: lead.email_source,
    email_confidence: lead.email ? lead.email_confidence : null,
    is_generic_email: lead.is_generic_email,
    phone: lead.phone || null,
    website: lead.website || null,
    status: 'inbox',
    pipeline_stage: null,
    close_reason: null,
    source: lead.source,
    cost_estimate: lead.cost_estimate,
    created_at: now(),
    email_inspection: lead.email_inspection ?? null,
  }
}

/** A trimmed category, or null when there is none. Never a placeholder. */
export function cleanCategory(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

export function buildLeadInsertPayload(
  lead: LeadInsertSource,
  userId: string,
  now: () => string = () => new Date().toISOString()
): LeadInsertPayload {
  return {
    user_id: userId,
    company_name: lead.company_name,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    city: lead.city || null,
    industry: cleanCategory(lead.industry),
    status: 'inbox',
    source: lead.source || 'serper',
    email_confidence: lead.email_confidence || 'low',
    email_source: lead.email_source || lead.website || 'scraper',
    is_generic_email: lead.is_generic_email ?? false,
    cost_estimate: lead.cost_estimate ?? 0,
    last_activity_at: now(),
  }
}

/** The exact columns inserted, with the same defaults the insert has always applied. */
export function toLeadRow(base: LeadInsertPayload): LeadInsertPayload {
  return {
    user_id: base.user_id,
    company_name: base.company_name,
    email: base.email || null,
    phone: base.phone || null,
    website: base.website || null,
    city: base.city || null,
    industry: cleanCategory(base.industry),
    status: 'inbox',
    source: base.source || 'serper',
    email_source: base.email_source || null,
    email_confidence: base.email_confidence || 'low',
    is_generic_email: base.is_generic_email ?? false,
    cost_estimate: base.cost_estimate ?? 0,
    last_activity_at: base.last_activity_at,
  }
}
