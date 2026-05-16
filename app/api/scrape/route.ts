import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import * as cheerio from 'cheerio'

import { searchGooglePlaces } from '@/lib/sources/google'
import { searchSerperMaps } from '@/lib/sources/serper'
import {
  type EmailConfidence,
  extractEmailCandidatesFromHtml,
  getWebsiteHost,
  hostsClearlyRelated,
  isBlockedWebsiteHost,
  normalizePhone,
  pickBestEmailCandidate,
  sanitizeWebsite,
} from '@/lib/validation'
import { type TrialLead } from '@/lib/trial'
import { runSharedProspectorDiscovery } from '@/lib/scraper/run-scraper-shared'
import { isCountableLead } from '@/lib/usage/usage'

export const runtime = 'nodejs'

const ENRICHMENT_WORKERS = 4
const FETCH_TIMEOUT = 6000
const MAX_SERPER_QUERIES = 2
const MAX_GOOGLE_CALLS = 1
const SERPER_EARLY_STOP_LEADS = 10
const HIGH_CONFIDENCE_TARGET = 5
const MIN_WEBSITE_TARGET = 7
const MIN_ENRICHMENT_RATE = 0.5
const MAX_SECONDARY_PAGE_FETCHES = 3

// Internal relative cost estimates used for source prioritization reporting.
const SERPER_DISCOVERY_COST_ESTIMATE = 0.01
const GOOGLE_DISCOVERY_COST_ESTIMATE = 0.03
const SCRAPE_COST_BUDGET = Number(
  (
    SERPER_DISCOVERY_COST_ESTIMATE * MAX_SERPER_QUERIES +
    GOOGLE_DISCOVERY_COST_ESTIMATE * MAX_GOOGLE_CALLS
  ).toFixed(4)
)

type ScrapeConfig = {
  query: string
  defaultCity: string
  region: string
  country: string
  maxLeads: number
  outputLeadLimit: number
  userId: string | null
}

type HtmlPage = {
  html: string
  resolvedUrl: string
}

type DiscoverySource = 'serper' | 'google' | 'hybrid'
type ScrapePhase =
  | 'Finding businesses'
  | 'Checking websites'
  | 'Extracting contacts'
  | 'Improving results'

type DiscoveryLead = {
  company_name: string
  website: string | null
  phone: string | null
  city: string
  industry?: string | null
  source: DiscoverySource
  source_url?: string | null
  cost_estimate: number
  email: string | null
  email_source: string | null
  email_confidence: EmailConfidence | null
  is_generic_email: boolean
  enrichment_attempted: boolean
  enriched_website_host: string | null
}

type ScrapeMetrics = {
  leadsWithWebsite: number
  leadsWithValidEmail: number
  strongSignalLeads: number
  enrichmentRate: number
}

type DiscoveryUpsertResult = {
  isNew: boolean
  lead: DiscoveryLead | null
  previousLead: DiscoveryLead | null
}

type SaveLeadResult =
  | { ok: true; reason: 'saved'; id: string }
  | {
      ok: false
      reason: 'duplicate' | 'invalid' | 'error'
      error: {
        code: string | null
        message: string
        details: string | null
        hint: string | null
      }
    }

type ScrapeResultPayload = {
  summaryLine: string
  detailLine: string | null
  limitMessage: string | null
  locationLabel: string
  discoveredCount: number
  enrichedCount: number
  addedCount: number
  addedLeads: TrialLead[]
  leads_used?: number
  leads_limit?: number
  usage_warning?: 'none' | 'warning' | 'critical'
  current_period_end?: string | null
}

type UsageRow = {
  id: string
  user_id: string
  leads_used: number
  leads_limit: number
  period_start: string
  period_end: string
}

type LeadInsertPayload = {
  user_id: string
  company_name: string
  email: string | null
  phone: string | null
  website: string | null
  city: string | null
  status: 'inbox'
  source: DiscoverySource
  email_confidence: EmailConfidence
  email_source: string | null
  is_generic_email: boolean
  cost_estimate: number
  last_activity_at?: string
}

function roundCostEstimate(value: number) {
  return Number(value.toFixed(4))
}

function normalizeCompanyName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeLocation(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function formatLocationLabel(city: string, region: string, country: string) {
  const parts = [city, region].map((part) => String(part || '').trim()).filter(Boolean)
  if (parts.length > 0) {
    return parts.join(', ')
  }

  return String(country || '').trim() || 'your target market'
}

function formatLeadSummary(count: number) {
  return `${count} ${count === 1 ? 'lead' : 'leads'} ready to contact`
}

function formatOutputLimitMessage(count: number) {
  return `Only ${count} ${count === 1 ? 'lead' : 'leads'} added — limit reached`
}

function getUsagePeriodEnd(periodStartIso: string) {
  const periodEnd = new Date(periodStartIso)
  periodEnd.setMonth(periodEnd.getMonth() + 1)
  return periodEnd.toISOString()
}

function getUsageWarning(leadsUsed: number, leadsLimit: number): 'none' | 'warning' | 'critical' {
  if (!Number.isFinite(leadsLimit) || leadsLimit <= 0) {
    return 'none'
  }

  const usageRatio = leadsUsed / leadsLimit

  if (usageRatio >= 0.9) {
    return 'critical'
  }

  if (usageRatio >= 0.8) {
    return 'warning'
  }

  return 'none'
}

function createSseResponse(message: string, status = 200) {
  return new Response(`data: ${JSON.stringify({ type: 'log', message })}\n\n`, {
    status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

async function getOrCreateCurrentUsageRow(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  leadsLimit: number
) {
  const nowIso = new Date().toISOString()

  const { data: latestRow, error: selectError } = await supabase
    .from('usage')
    .select('id, user_id, leads_used, leads_limit, period_start, period_end')
    .eq('user_id', userId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (selectError) {
    throw new Error(`Usage lookup failed: ${selectError.message}`)
  }

  if (latestRow) {
    const activePeriod =
      latestRow.period_start <= nowIso && nowIso <= latestRow.period_end

    if (activePeriod) {
      if (latestRow.leads_limit === leadsLimit) {
        return latestRow as UsageRow
      }

      const { data: updatedRow, error: updateError } = await supabase
        .from('usage')
        .update({ leads_limit: leadsLimit })
        .eq('id', latestRow.id)
        .select('id, user_id, leads_used, leads_limit, period_start, period_end')
        .maybeSingle()

      if (updateError) {
        throw new Error(`Usage limit sync failed: ${updateError.message}`)
      }

      if (!updatedRow) {
        throw new Error('Usage limit sync failed: row not returned')
      }

      return updatedRow as UsageRow
    }
  }

  const periodStart = nowIso
  const periodEnd = getUsagePeriodEnd(periodStart)

  const { data: insertedRow, error: insertError } = await supabase
    .from('usage')
    .insert({
      user_id: userId,
      leads_used: 0,
      leads_limit: leadsLimit,
      period_start: periodStart,
      period_end: periodEnd,
    })
    .select('id, user_id, leads_used, leads_limit, period_start, period_end')
    .maybeSingle()

  if (insertError) {
    throw new Error(`Usage creation failed: ${insertError.message}`)
  }

  if (!insertedRow) {
    throw new Error('Usage creation failed: row not returned')
  }

  return insertedRow as UsageRow
}

async function incrementUsageRow(
  supabase: ReturnType<typeof createServerClient>,
  usageRow: UsageRow,
  addedCount: number
) {
  let currentRow = usageRow

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextLeadsUsed = currentRow.leads_used + addedCount

    const { data: updatedRow, error: updateError } = await supabase
      .from('usage')
      .update({ leads_used: nextLeadsUsed })
      .eq('id', currentRow.id)
      .eq('leads_used', currentRow.leads_used)
      .select('id, user_id, leads_used, leads_limit, period_start, period_end')
      .maybeSingle()

    if (updateError) {
      throw new Error(`Usage update failed: ${updateError.message}`)
    }

    if (updatedRow) {
      return updatedRow as UsageRow
    }

    const { data: refetchedRow, error: refetchError } = await supabase
      .from('usage')
      .select('id, user_id, leads_used, leads_limit, period_start, period_end')
      .eq('id', currentRow.id)
      .maybeSingle()

    if (refetchError) {
      throw new Error(`Usage refetch failed: ${refetchError.message}`)
    }

    if (!refetchedRow) {
      throw new Error('Usage update failed: row not found after retry')
    }

    currentRow = refetchedRow as UsageRow
  }

  throw new Error('Usage update failed after retries')
}

function normalizePhoneKey(phone: string | null | undefined) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits || null
}

function getWebsiteKey(website: string | null | undefined) {
  return getWebsiteHost(website || null)
}

function hasUsableWebsite(website: string | null | undefined) {
  const host = getWebsiteKey(website)
  return Boolean(host && !isBlockedWebsiteHost(host))
}

function isValidDiscoveredLead(lead: DiscoveryLead) {
  return Boolean(lead.company_name && (lead.website || lead.phone))
}

function hasContactMethod(lead: Pick<DiscoveryLead, 'email' | 'phone'>) {
  return Boolean(String(lead.email || '').trim() || String(lead.phone || '').trim())
}

function namesClearlyRelated(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeCompanyName(left)
  const normalizedRight = normalizeCompanyName(right)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  )
}

function locationsClearlyMatch(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeLocation(left)
  const normalizedRight = normalizeLocation(right)

  if (!normalizedLeft || !normalizedRight) {
    return false
  }

  return normalizedLeft === normalizedRight
}

function mergeDiscoverySource(
  current: DiscoverySource,
  incoming: Exclude<DiscoverySource, 'hybrid'>
): DiscoverySource {
  if (current === incoming || current === 'hybrid') {
    return current
  }

  return 'hybrid'
}

function sourceAlreadyCounted(
  current: DiscoverySource,
  incoming: Exclude<DiscoverySource, 'hybrid'>
) {
  return current === incoming || current === 'hybrid'
}

function createDiscoveryLead(
  lead: Omit<DiscoveryLead, 'email' | 'email_source' | 'email_confidence' | 'is_generic_email' | 'enrichment_attempted' | 'enriched_website_host'>
): DiscoveryLead {
  return {
    ...lead,
    email: null,
    email_source: null,
    email_confidence: null,
    is_generic_email: false,
    enrichment_attempted: false,
    enriched_website_host: null,
  }
}

function pickPreferredWebsite(current: string | null, incoming: string | null) {
  const currentHost = getWebsiteKey(current)
  const incomingHost = getWebsiteKey(incoming)

  if (!incomingHost) {
    return current || null
  }

  if (!currentHost) {
    return incoming
  }

  if (currentHost === incomingHost) {
    return current || incoming
  }

  if (isBlockedWebsiteHost(currentHost) && !isBlockedWebsiteHost(incomingHost)) {
    return incoming
  }

  return current
}

function pickPreferredPhone(current: string | null, incoming: string | null) {
  return current || incoming || null
}

function findExistingLeadIndex(leads: DiscoveryLead[], candidate: DiscoveryLead) {
  const candidateWebsite = getWebsiteKey(candidate.website)
  const candidatePhone = normalizePhoneKey(candidate.phone)
  const candidateLocation = normalizeLocation(candidate.city)

  return leads.findIndex((existing) => {
    const existingWebsite = getWebsiteKey(existing.website)
    const existingPhone = normalizePhoneKey(existing.phone)
    const existingLocation = normalizeLocation(existing.city)

    // Strongest identity: exact website host.
    if (candidateWebsite && existingWebsite) {
      return candidateWebsite === existingWebsite
    }

    // If both sides have different website hosts, avoid weaker merge fallbacks.
    if (candidateWebsite && existingWebsite && candidateWebsite !== existingWebsite) {
      return false
    }

    // Second-best identity: phone, guarded by location or related names.
    if (candidatePhone && existingPhone && candidatePhone === existingPhone) {
      return (
        locationsClearlyMatch(candidateLocation, existingLocation) ||
        namesClearlyRelated(candidate.company_name, existing.company_name)
      )
    }

    // Final fallback: normalized company name plus location.
    return (
      namesClearlyRelated(candidate.company_name, existing.company_name) &&
      locationsClearlyMatch(candidateLocation, existingLocation)
    )
  })
}

function mergeDiscoveryLead(existing: DiscoveryLead, incoming: DiscoveryLead): DiscoveryLead {
  const incomingSource = incoming.source === 'hybrid' ? 'google' : incoming.source
  const nextSource = mergeDiscoverySource(existing.source, incomingSource)
  const nextCost = sourceAlreadyCounted(existing.source, incomingSource)
    ? existing.cost_estimate
    : roundCostEstimate(existing.cost_estimate + incoming.cost_estimate)
  const nextWebsite = pickPreferredWebsite(existing.website, incoming.website)
  const previousWebsiteKey = getWebsiteKey(existing.website)
  const nextWebsiteKey = getWebsiteKey(nextWebsite)
  const websiteChanged = previousWebsiteKey !== nextWebsiteKey

  return {
    ...existing,
    company_name:
      existing.company_name.length >= incoming.company_name.length
        ? existing.company_name
        : incoming.company_name,
    website: nextWebsite,
    phone: pickPreferredPhone(existing.phone, incoming.phone),
    city: existing.city || incoming.city,
    industry: existing.industry || incoming.industry || null,
    source_url: existing.source_url || incoming.source_url || null,
    source: nextSource,
    cost_estimate: nextCost,
    email: websiteChanged ? null : existing.email,
    email_source: websiteChanged ? null : existing.email_source,
    email_confidence: websiteChanged ? null : existing.email_confidence,
    is_generic_email: websiteChanged ? false : existing.is_generic_email,
    enrichment_attempted: websiteChanged ? false : existing.enrichment_attempted,
    enriched_website_host: websiteChanged ? null : existing.enriched_website_host,
  }
}

function upsertDiscoveredLead(
  leads: DiscoveryLead[],
  incoming: DiscoveryLead,
  options?: { allowNew?: boolean }
): DiscoveryUpsertResult {
  const existingIndex = findExistingLeadIndex(leads, incoming)

  if (existingIndex === -1) {
    if (options?.allowNew === false) {
      return { isNew: false, lead: null, previousLead: null }
    }

    leads.push(incoming)
    return { isNew: true, lead: incoming, previousLead: null }
  }

  const previousLead = { ...leads[existingIndex] }
  const merged = mergeDiscoveryLead(leads[existingIndex], incoming)
  leads[existingIndex] = merged

  return { isNew: false, lead: merged, previousLead }
}

function buildLeadQueueKey(lead: DiscoveryLead) {
  return [
    getWebsiteKey(lead.website) || '',
    normalizePhoneKey(lead.phone) || '',
    normalizeCompanyName(lead.company_name),
    normalizeLocation(lead.city),
  ].join('::')
}

function buildSerperQueries(query: string, city: string) {
  return Array.from(
    new Set([`${query} ${city}`.trim(), `${query} near ${city}`.trim()].filter(Boolean))
  ).slice(0, MAX_SERPER_QUERIES)
}

function buildLeadInsertPayload(lead: DiscoveryLead, userId: string): LeadInsertPayload {
  const payload: LeadInsertPayload = {
    user_id: userId,
    company_name: lead.company_name,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    city: lead.city || null,
    status: 'inbox',
    source: lead.source || 'serper',
    email_confidence: lead.email_confidence || 'low',
    email_source: lead.email_source || lead.website || 'scraper',
    is_generic_email: lead.is_generic_email ?? false,
    cost_estimate: lead.cost_estimate ?? 0,
    last_activity_at: new Date().toISOString(),
  }

  if (!payload.source) payload.source = 'serper'
  if (!payload.email_confidence) payload.email_confidence = 'low'
  if (payload.is_generic_email === undefined) payload.is_generic_email = false

  return payload
}

function describeDbError(error: any) {
  return {
    code: error?.code ? String(error.code) : null,
    message: error?.message ? String(error.message) : 'Unknown database error',
    details: error?.details ? String(error.details) : null,
    hint: error?.hint ? String(error.hint) : null,
  }
}

function classifyDbError(
  error: ReturnType<typeof describeDbError>
): Exclude<SaveLeadResult['reason'], 'saved'> {
  if (
    error.code === '23505' ||
    /duplicate/i.test(error.message) ||
    /already exists/i.test(error.message)
  ) {
    return 'duplicate'
  }

  if (
    error.code === '23502' ||
    error.code?.startsWith('23') ||
    /null value/i.test(error.message) ||
    /violates/i.test(error.message)
  ) {
    return 'invalid'
  }

  return 'error'
}

function calculateMetrics(leads: DiscoveryLead[]): ScrapeMetrics {
  const leadsWithWebsite = leads.filter((lead) => hasUsableWebsite(lead.website)).length
  const leadsWithValidEmail = leads.filter((lead) => Boolean(lead.email)).length
  const strongSignalLeads = leads.filter((lead) => lead.email_confidence === 'high').length
  const enrichmentRate =
    leadsWithWebsite === 0 ? 0 : Number((leadsWithValidEmail / leadsWithWebsite).toFixed(2))

  return {
    leadsWithWebsite,
    leadsWithValidEmail,
    strongSignalLeads,
    enrichmentRate,
  }
}

function shouldAttemptEnrichment(lead: DiscoveryLead) {
  const websiteHost = getWebsiteKey(lead.website)

  return Boolean(
    websiteHost &&
      !isBlockedWebsiteHost(websiteHost) &&
      (!lead.enrichment_attempted || lead.enriched_website_host !== websiteHost)
  )
}

function shouldEscalateToGoogle(
  metrics: ScrapeMetrics,
  targetStrongSignalLeads: number,
  websiteTarget: number
) {
  return (
    metrics.strongSignalLeads < targetStrongSignalLeads ||
    metrics.leadsWithWebsite < websiteTarget ||
    metrics.enrichmentRate < MIN_ENRICHMENT_RATE
  )
}

function canSpend(currentCost: number, nextCost: number) {
  return roundCostEstimate(currentCost + nextCost) <= SCRAPE_COST_BUDGET
}

function createGuestLead(lead: DiscoveryLead): TrialLead {
  return {
    id: crypto.randomUUID(),
    company_name: lead.company_name,
    city: lead.city || null,
    industry: lead.industry || null,
    email: lead.email,
    email_source: lead.email_source,
    is_generic_email: lead.is_generic_email,
    phone: lead.phone || null,
    website: lead.website || null,
    status: 'inbox',
    pipeline_stage: null,
    close_reason: null,
    source: lead.source,
    cost_estimate: lead.cost_estimate,
    created_at: new Date().toISOString(),
  }
}

async function fetchHtml(url: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) return null

    return {
      html: await res.text(),
      resolvedUrl: res.url || url,
    } satisfies HtmlPage
  } catch {
    return null
  }
}

function buildSecondaryPageUrls(base: string, homepage: HtmlPage | null) {
  const baseHost = getWebsiteHost(base)
  if (!baseHost) {
    return []
  }

  const candidates = new Map<string, number>()
  const anchorBase = homepage?.resolvedUrl || base
  const defaultPaths = [
    { path: '/contact', priority: 4 },
    { path: '/contact-us', priority: 4 },
    { path: '/about', priority: 3 },
    { path: '/about-us', priority: 3 },
    { path: '/team', priority: 2 },
  ]

  const addCandidate = (value: string, priority: number) => {
    try {
      const url = new URL(value, anchorBase)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return
      }

      const host = getWebsiteHost(url.toString())
      if (!host || isBlockedWebsiteHost(host) || !hostsClearlyRelated(baseHost, host)) {
        return
      }

      url.hash = ''
      url.search = ''

      const pathname = url.pathname.replace(/\/+$/, '') || '/'
      if (pathname === '/') {
        return
      }

      const normalizedUrl = `${url.origin}${pathname}`
      const previousPriority = candidates.get(normalizedUrl) || 0
      if (priority > previousPriority) {
        candidates.set(normalizedUrl, priority)
      }
    } catch {}
  }

  defaultPaths.forEach(({ path, priority }) => addCandidate(path, priority))

  if (homepage) {
    const $ = cheerio.load(homepage.html)

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href')
      if (!href) {
        return
      }

      const text = $(element).text().trim().toLowerCase()
      const hrefLower = href.toLowerCase()
      let priority = 0

      if (hrefLower.includes('contact') || text.includes('contact')) {
        priority = 4
      } else if (hrefLower.includes('about') || text.includes('about')) {
        priority = 3
      } else if (hrefLower.includes('team') || text.includes('team')) {
        priority = 2
      }

      if (priority > 0) {
        addCandidate(href, priority)
      }
    })
  }

  return [...candidates.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_SECONDARY_PAGE_FETCHES)
    .map(([url]) => url)
}

async function enrichEmail(website: string | null) {
  const base = sanitizeWebsite(website)
  if (!base) return null

  const originalHost = getWebsiteHost(base)
  if (!originalHost || isBlockedWebsiteHost(originalHost)) {
    return null
  }

  const candidates: Awaited<ReturnType<typeof extractEmailCandidatesFromHtml>> = []
  const homepage = await fetchHtml(base)
  const pages: HtmlPage[] = []

  if (homepage) {
    const resolvedHost = getWebsiteHost(homepage.resolvedUrl)
    if (resolvedHost && !isBlockedWebsiteHost(resolvedHost) && hostsClearlyRelated(originalHost, resolvedHost)) {
      pages.push(homepage)
    }
  }

  const secondaryPageUrls = buildSecondaryPageUrls(base, homepage)
  const secondaryPages = await Promise.all(
    secondaryPageUrls.map(async (url) => fetchHtml(url))
  )

  for (const page of secondaryPages) {
    if (page) {
      pages.push(page)
    }
  }

  for (const page of pages) {
    const resolvedHost = getWebsiteHost(page.resolvedUrl)
    if (!resolvedHost || isBlockedWebsiteHost(resolvedHost)) {
      continue
    }

    if (!hostsClearlyRelated(originalHost, resolvedHost)) {
      continue
    }

    candidates.push(
      ...extractEmailCandidatesFromHtml({
        html: page.html,
        pageUrl: page.resolvedUrl,
        websiteHost: resolvedHost,
      })
    )
  }

  return pickBestEmailCandidate(candidates)
}

async function saveLead(supabase: ReturnType<typeof createServerClient>, lead: DiscoveryLead, userId: string) {
  console.log('SCRAPER INSERT USER_ID:', userId)

  if (!userId) {
    console.warn('INVALID LEAD SKIPPED:', { user_id: userId, company_name: lead.company_name })
    return {
      ok: false,
      reason: 'invalid',
      error: {
        code: null,
        message: 'Missing authenticated user id',
        details: null,
        hint: null,
      },
    } satisfies SaveLeadResult
  }

  if (!lead.company_name) {
    console.warn('INVALID LEAD SKIPPED:', { user_id: userId, company_name: lead.company_name })
    return {
      ok: false,
      reason: 'invalid',
      error: {
        code: null,
        message: 'Lead missing required fields',
        details: JSON.stringify({
          company_name: Boolean(lead.company_name),
          user_id: Boolean(userId),
        }),
        hint: 'Skip invalid lead before insert',
      },
    } satisfies SaveLeadResult
  }

  const basePayload = buildLeadInsertPayload(lead, userId)

  const payload: LeadInsertPayload = {
    user_id: basePayload.user_id,
    company_name: basePayload.company_name,
    email: basePayload.email || null,
    phone: basePayload.phone || null,
    website: basePayload.website || null,
    city: basePayload.city || null,
    status: 'inbox',
    source: basePayload.source || 'serper',
    email_source: basePayload.email_source || null,
    email_confidence: basePayload.email_confidence || 'low',
    is_generic_email: basePayload.is_generic_email ?? false,
    cost_estimate: basePayload.cost_estimate ?? 0,
    last_activity_at: basePayload.last_activity_at,
  }

  console.log('INSERT PAYLOAD:', payload)
  console.log('FINAL CLEAN PAYLOAD:', JSON.stringify(payload, null, 2))

  let { data, error } = await supabase
    .from('leads')
    .insert(payload)
    .select()

  if (error && isMissingOptionalActivityColumn(error)) {
    const legacyPayload = { ...payload }
    delete legacyPayload.last_activity_at
    ;({ data, error } = await supabase
      .from('leads')
      .insert(legacyPayload)
      .select())
  }

  if (error) {
    console.error('DB ERROR:', JSON.stringify(error, null, 2))

    const described = describeDbError(error)

    return {
      ok: false,
      reason: classifyDbError(described),
      error: described,
    } satisfies SaveLeadResult
  }

  if (!data || data.length === 0) {
    console.error('DB INSERT FAILED: no data returned', payload)

    return {
      ok: false,
      reason: 'error',
      error: {
        code: null,
        message: 'Insert succeeded without returned row',
        details: JSON.stringify(payload),
        hint: 'Expected inserted lead row from Supabase .select()',
      },
    } satisfies SaveLeadResult
  }

  console.log('DB INSERT OK:', data[0]?.id || payload.company_name)

  return { ok: true, reason: 'saved', id: data[0].id } satisfies SaveLeadResult
}

function isMissingOptionalActivityColumn(error: any) {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === '42703' || message.includes('last_activity_at')
}

async function enrichLeadQueue(
  queue: DiscoveryLead[],
  send: (msg: string) => void,
  sendPhase: (phase: ScrapePhase) => void
) {
  if (queue.length === 0) {
    return
  }

  sendPhase('Checking websites')
  sendPhase('Extracting contacts')

  async function worker(id: number) {
    while (true) {
      const lead = queue.shift()
      if (!lead) break

      const websiteHost = getWebsiteKey(lead.website)
      lead.enrichment_attempted = true
      lead.enriched_website_host = websiteHost

      if (!websiteHost || isBlockedWebsiteHost(websiteHost)) {
        send(`⛔ no website: ${lead.company_name}`)
        continue
      }

      send(`🔬 ${lead.company_name}`)

      const emailRecord = await enrichEmail(lead.website)

      if (!emailRecord) {
        send(`⛔ no email: ${lead.company_name}`)
        continue
      }

      lead.email = emailRecord.value
      lead.email_source = emailRecord.emailSource
      lead.email_confidence = emailRecord.emailConfidence
      lead.is_generic_email = emailRecord.isGenericEmail

      send(`✨ ${lead.company_name}`)
    }

    send(`🧵 worker ${id} done`)
  }

  await Promise.all(
    Array.from({ length: ENRICHMENT_WORKERS }, (_, index) => worker(index + 1))
  )
}

async function runScraper(
  supabase: ReturnType<typeof createServerClient>,
  config: ScrapeConfig,
  send: (msg: string) => void,
  options?: {
    guestMode?: boolean
    onGuestLead?: (lead: TrialLead) => void
    onResult?: (result: ScrapeResultPayload) => void
  }
) {
  try {
    const { query, defaultCity, region, country, maxLeads, outputLeadLimit, userId } = config

    if (!query || !defaultCity) {
      send('❌ invalid input')
      return
    }

    const discovery = await runSharedProspectorDiscovery(
      {
        query,
        defaultCity,
        region,
        country,
        maxLeads,
        mode: 'deep',
      },
      send
    )
    const validDiscoveredLeads = discovery.discoveredLeads
    const finalEnrichedLeads = discovery.finalEnrichedLeads
    const filteredOutWithoutContactCount = discovery.filteredOutWithoutContactCount
    const allowedOutputCount = Math.max(0, outputLeadLimit)
    const locationLabel = discovery.locationLabel
    const summaryLine = discovery.summaryLine
    const detailLine = discovery.detailLine

    let addedCount = 0
    let duplicateCount = 0
    let invalidCount = 0
    let dbErrorCount = 0
    const addedLeads: TrialLead[] = []

    if (options?.guestMode) {
      for (const lead of finalEnrichedLeads) {
        if (addedCount >= allowedOutputCount) {
          break
        }

        const guestLead = createGuestLead(lead)
        addedLeads.push(guestLead)
        options.onGuestLead?.(guestLead)
        addedCount += 1
      }
    } else {
      for (const lead of finalEnrichedLeads) {
        if (addedCount >= allowedOutputCount) {
          break
        }

        if (!userId) {
          send('❌ missing authenticated user')
          break
        }

        const saved = await saveLead(supabase, lead, userId)

        if (saved.ok) {
          addedLeads.push({
            ...createGuestLead(lead),
            id: saved.id,
          })
          addedCount += 1
          continue
        }

        const errorSummary = [
          `code=${saved.error.code || 'unknown'}`,
          `message=${saved.error.message}`,
          saved.error.details ? `details=${saved.error.details}` : null,
          saved.error.hint ? `hint=${saved.error.hint}` : null,
        ]
          .filter(Boolean)
          .join(' | ')

        if (saved.reason === 'duplicate') {
          duplicateCount += 1
          send(`⚠️ duplicate skipped: ${lead.company_name} | ${errorSummary}`)
        } else if (saved.reason === 'invalid') {
          invalidCount += 1
          send(`⚠️ invalid lead skipped: ${lead.company_name} | ${errorSummary}`)
        } else {
          dbErrorCount += 1
          send(`❌ db error: ${lead.company_name} | ${errorSummary}`)
        }
      }
    }

    if (!options?.guestMode) {
      if (userId) {
        const { data: testRows } = await supabase
          .from('leads')
          .select('id, company_name, status')
          .eq('user_id', userId)
          .limit(5)

        console.log('POST-SCRAPE DB CHECK:', testRows)
      }

      send(
        `💾 saved: ${addedCount}, duplicates: ${duplicateCount}, invalid: ${invalidCount}, db errors: ${dbErrorCount}`
      )
    }
    const limitMessage =
      finalEnrichedLeads.length > allowedOutputCount
        ? formatOutputLimitMessage(addedCount)
        : null

    options?.onResult?.({
      summaryLine,
      detailLine,
      limitMessage,
      locationLabel,
      discoveredCount: validDiscoveredLeads.length,
      enrichedCount: finalEnrichedLeads.length,
      addedCount,
      addedLeads,
    })

    if (limitMessage) {
      send(limitMessage)
    }

    if (validDiscoveredLeads.length === 0) {
      send('⚠️ no leads found')
    }

    send('🎉 Prospecting complete')
  } catch (err: any) {
    send(`❌ fatal: ${err?.message || 'unknown'}`)
  }
}

export async function POST(req: Request) {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    }
  )

  const body = await req.json()
  const guestSessionId = String(body.guestSessionId || '').trim()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isGuestMode = !user && Boolean(guestSessionId)
  console.log(
    'SCRAPER AUTH CONTEXT:',
    JSON.stringify(
      {
        auth_user_id: user?.id || null,
        guest_session_id: guestSessionId || null,
        is_guest_mode: isGuestMode,
      },
      null,
      2
    )
  )

  if (!user && !isGuestMode) {
    return new Response('data: ❌ missing authenticated user\n\n', {
      status: 401,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  const requestedLeadCount = Number(body.maxLeads || 10)

  let authenticatedPlan = 'free'
  let trackedUsageRow: UsageRow | null = null
  let leadsLimit = 25
  let currentUsage = 0

  if (isGuestMode) {
    leadsLimit = 25
    currentUsage = Math.max(0, Math.min(Number(body.existingLeadCount || 0), leadsLimit))
  }

  if (user?.id) {
    const [{ data: profile }, { count }] = await Promise.all([
      supabase
        .from('profiles')
        .select('plan')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .or('email.not.is.null,phone.not.is.null'),
    ])

    authenticatedPlan = profile?.plan || 'free'
    currentUsage = count ?? 0

    if (authenticatedPlan === 'admin') {
      leadsLimit = 10000
    } else if (authenticatedPlan === 'starter') {
      leadsLimit = 500
    } else {
      leadsLimit = 25
    }

    if (authenticatedPlan === 'starter' || authenticatedPlan === 'admin') {
      trackedUsageRow = await getOrCreateCurrentUsageRow(supabase, user.id, leadsLimit)
      currentUsage = trackedUsageRow.leads_used

      if (trackedUsageRow.leads_used >= trackedUsageRow.leads_limit) {
        return createSseResponse(
          `❌ fatal: You’ve reached your monthly limit of ${trackedUsageRow.leads_limit} leads.`,
          403
        )
      }
    }
  }

  const remainingCapacity = Math.max(leadsLimit - currentUsage, 0)

  const config: ScrapeConfig = {
    query: String(body.query || '').trim(),
    defaultCity: String(body.defaultCity || '').trim(),
    region: String(body.region || '').trim(),
    country: String(body.country || 'Canada').trim(),
    maxLeads: requestedLeadCount,
    outputLeadLimit: remainingCapacity,
    userId: user?.id || null,
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let latestResult: ScrapeResultPayload | null = null

      const emit = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      const send = (msg: string) => {
        emit({ type: 'log', message: msg })
      }

      if (!config.query || !config.defaultCity) {
        send('❌ invalid input')
        controller.close()
        return
      }

      if (config.maxLeads <= 0) {
        send('❌ invalid input')
        send('🎉 done')
        controller.close()
        return
      }

      send('🟢 stream started')
      await runScraper(supabase, config, send, {
        guestMode: isGuestMode,
        onGuestLead(lead) {
          emit({ type: 'lead', payload: lead })
        },
        onResult(result) {
          latestResult = result
        },
      })

      if (latestResult) {
        const finalResult = latestResult as ScrapeResultPayload
        let resultPayload: ScrapeResultPayload = finalResult

        if (trackedUsageRow) {
          try {
            const nextUsageRow = await incrementUsageRow(
              supabase,
              trackedUsageRow,
              finalResult.addedCount
            )

            trackedUsageRow = nextUsageRow
            resultPayload = {
              ...finalResult,
              leads_used: nextUsageRow.leads_used,
              leads_limit: nextUsageRow.leads_limit,
              usage_warning: getUsageWarning(nextUsageRow.leads_used, nextUsageRow.leads_limit),
              current_period_end: nextUsageRow.period_end,
            }
          } catch (usageError: any) {
            send(`⚠️ usage update skipped: ${usageError?.message || 'unknown error'}`)
            resultPayload = {
              ...finalResult,
              leads_used: trackedUsageRow.leads_used + finalResult.addedCount,
              leads_limit: trackedUsageRow.leads_limit,
              usage_warning: getUsageWarning(
                trackedUsageRow.leads_used + finalResult.addedCount,
                trackedUsageRow.leads_limit
              ),
              current_period_end: trackedUsageRow.period_end,
            }
          }
        }

        emit({ type: 'result', payload: resultPayload })
      }

      controller.close()
    },
    cancel() {},
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
