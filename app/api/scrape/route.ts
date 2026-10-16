import { guestDb, guestSession } from '@/lib/guest/server'
import { guestRateBucket, sameOrigin } from '@/lib/guest/security'
import { classifyReserveRefusal } from '@/lib/guest/reserve-refusal'
import { GUEST_MESSAGES, type GuestErrorCode } from '@/lib/guest/search-errors'
import { after } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

import { searchGooglePlaces } from '@/lib/sources/google'
import { searchSerperMaps } from '@/lib/sources/serper'
import {
  type EmailConfidence,
  getWebsiteHost,
  isBlockedWebsiteHost,
  normalizePhone,
} from '@/lib/validation'
import { type TrialLead } from '@/lib/trial'
import { currentCostContext, runWithCostContext } from '@/lib/costs/context'
import { flushCostRecords, recordDiscoveryRun } from '@/lib/costs/record'
import { runSharedProspectorDiscovery } from '@/lib/scraper/run-scraper-shared'
import { loadExistingBusinessIndex } from '@/lib/scraper/existing-business-index'
import { describeSearchShortfall, type DiscoveryStopReason } from '@/lib/scraper/discovery-outcome'
import { enrichEmail } from '@/lib/scraper/email-enrichment'
import type { EmailInspection } from '@/lib/scraper/email-inspection'
import { buildLeadInsertPayload, buildResultLead, toLeadRow } from '@/lib/scraper/lead-payload'
import { createSaveTracker, type ScrapeProgressEvent } from '@/lib/scraper/progress-events'
import { getLeadLimit, isCountableLead } from '@/lib/usage/usage'
import { resolveUserSubscription } from '@/lib/auth/resolve-user-subscription'
import { ENTITLEMENT_UNAVAILABLE_MESSAGE, verifyEntitlementLive } from '@/lib/auth/paid-entitlement'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDiscoverCapacity, saveDiscoverResults, type DiscoverCapacity } from '@/lib/scraper/save-discover-results'
import { enqueueLeadEnrichment } from '@/lib/commercial-intelligence/queue-manager'
import { authorizeResearchRun, isRunAuthorizationEnabled } from '@/lib/commercial-intelligence/run-authorization'
import { kickResearch } from '@/lib/commercial-intelligence/kick-research'
import { isEntitledToAutomaticResearch } from '@/lib/commercial-intelligence/research-entitlement'
import { findExistingOwnerLeadId, isPrivatePreviewWorkerRequest } from '@/lib/commercial-intelligence/private-preview'

export const runtime = 'nodejs'
export const maxDuration = 300

const ENRICHMENT_WORKERS = 4
const MAX_SERPER_QUERIES = 2
const MAX_GOOGLE_CALLS = 1
const SERPER_EARLY_STOP_LEADS = 10
const HIGH_CONFIDENCE_TARGET = 5
const MIN_WEBSITE_TARGET = 7
const MIN_ENRICHMENT_RATE = 0.5

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
  workerEligible: boolean
  accounting?: { runId: string; limit: number; monthly: boolean }
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
  city: string | null
  address?: string | null
  region?: string | null
  country?: string | null
  industry?: string | null
  source: DiscoverySource
  source_url?: string | null
  cost_estimate: number
  email: string | null
  email_source: string | null
  email_confidence: EmailConfidence | null
  is_generic_email: boolean
  website_intelligence?: import('@/lib/guest/website-facts').WebsiteFacts | null
  enrichment_attempted: boolean
  enriched_website_host: string | null
  email_inspection?: EmailInspection | null
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
  requestedCount?: number
  stopReason?: DiscoveryStopReason
  shortfallMessage?: string | null
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

function createSseResponse(message: string, status = 200, code?: GuestErrorCode) {
  return new Response(`data: ${JSON.stringify({ type: 'log', message, ...(code ? { code } : {}) })}\n\n`, {
    status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

async function getOrCreateCurrentUsageRow(
  supabase: SupabaseClient<any>,
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
  supabase: SupabaseClient<any>,
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
  return buildResultLead(lead, crypto.randomUUID())
}

async function saveLead(supabase: ReturnType<typeof createServerClient>, lead: DiscoveryLead, userId: string) {
  const startedAt = Date.now()
  console.log(
    `[CI-TRACE] STEP 1 ENTER saveLead company="${lead.company_name}" user_id=${userId} website=${lead.website || 'N/A'}`
  )
  console.log('SCRAPER INSERT USER_ID:', userId)

  if (!userId) {
    console.log('[CI-TRACE] STEP 1 EARLY_RETURN saveLead reason=missing_user_id')
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
    console.log(`[CI-TRACE] STEP 1 EARLY_RETURN saveLead reason=missing_company_name user_id=${userId}`)
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

  // The row inserted, including the provider's category (`industry`), which used to be dropped here.
  const payload = toLeadRow(buildLeadInsertPayload(lead, userId))

  console.log('INSERT PAYLOAD:', payload)
  console.log('FINAL CLEAN PAYLOAD:', JSON.stringify(payload, null, 2))

  const insertStartedAt = Date.now()
  console.log(
    `[CI-TRACE] STEP 1 BEFORE leads.insert company="${payload.company_name}" user_id=${payload.user_id} website=${payload.website || 'N/A'}`
  )
  let { data, error } = await supabase
    .from('leads')
    .insert(payload)
    .select()
  console.log(
    `[CI-TRACE] STEP 1 AFTER leads.insert company="${payload.company_name}" returned_count=${data?.length || 0} lead_id=${data?.[0]?.id || 'N/A'} has_error=${Boolean(error)} elapsed_ms=${Date.now() - insertStartedAt}`
  )

  if (error && isMissingOptionalActivityColumn(error)) {
    console.log(
      `[CI-TRACE] STEP 1 EARLY_SIGNAL saveLead retrying_without_last_activity_at company="${payload.company_name}" code=${error.code || 'unknown'} message=${error.message}`
    )
    const legacyPayload = { ...payload }
    delete legacyPayload.last_activity_at
    const legacyInsertStartedAt = Date.now()
    console.log(
      `[CI-TRACE] STEP 1 BEFORE leads.insert legacy company="${legacyPayload.company_name}" user_id=${legacyPayload.user_id}`
    )
    ;({ data, error } = await supabase
      .from('leads')
      .insert(legacyPayload)
      .select())
    console.log(
      `[CI-TRACE] STEP 1 AFTER leads.insert legacy company="${legacyPayload.company_name}" returned_count=${data?.length || 0} lead_id=${data?.[0]?.id || 'N/A'} has_error=${Boolean(error)} elapsed_ms=${Date.now() - legacyInsertStartedAt}`
    )
  }

  if (error) {
    console.error('[CI-TRACE] STEP 1 ERROR saveLead insert failed', error, (error as any)?.stack)
    console.error('DB ERROR:', JSON.stringify(error, null, 2))

    const described = describeDbError(error)

    return {
      ok: false,
      reason: classifyDbError(described),
      error: described,
    } satisfies SaveLeadResult
  }

  if (!data || data.length === 0) {
    console.error(
      `[CI-TRACE] STEP 1 EARLY_RETURN saveLead reason=no_inserted_row company="${payload.company_name}" elapsed_ms=${Date.now() - startedAt}`
    )
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

  const insertedLeadId = data[0].id
  console.log('DB INSERT OK:', insertedLeadId || payload.company_name)
  console.log('[FORENSIC] saveLead returning id:', insertedLeadId)
  console.log(
    `[CI-TRACE] STEP 1 PASS saveLead lead_id=${insertedLeadId} company="${payload.company_name}" elapsed_ms=${Date.now() - startedAt}`
  )

  return { ok: true, reason: 'saved', id: insertedLeadId } satisfies SaveLeadResult
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

// Every provider call made while a discovery runs is recorded against this run (see lib/costs); recording never affects the run.
async function runScraper(
  supabase: ReturnType<typeof createServerClient>,
  config: ScrapeConfig,
  send: (msg: string) => void,
  options?: Parameters<typeof runScraperCore>[3]
) {
  const runId = config.accounting?.runId ?? crypto.randomUUID()
  try {
    return await runWithCostContext(
      { runId, userId: config.userId ?? null, purpose: 'discovery', audience: options?.guestMode ? 'guest' : 'member' },
      () => runScraperCore(supabase, config, send, options)
    )
  } finally {
    await flushCostRecords()
  }
}

async function runScraperCore(
  supabase: ReturnType<typeof createServerClient>,
  config: ScrapeConfig,
  send: (msg: string) => void,
  options?: {
    guestMode?: boolean
    onGuestLead?: (lead: TrialLead) => void
    onResult?: (result: ScrapeResultPayload) => void
    onProgress?: (event: ScrapeProgressEvent) => void
  }
) {
  try {
    const { query, defaultCity, region, country, maxLeads, outputLeadLimit, userId } = config

    if (!query || !defaultCity) {
      send('❌ invalid input')
      return
    }

    // The signed-in customer's existing businesses, read once, while the first provider call is under way. Guests have none.
    const existingBusinesses = userId && !options?.guestMode ? loadExistingBusinessIndex(supabase, userId) : null
    const discovery = await runSharedProspectorDiscovery(
      {
        query,
        defaultCity,
        region,
        country,
        maxLeads,
        mode: 'deep',
        existingBusinesses,
      },
      send,
      options?.onProgress
    )
    const validDiscoveredLeads = discovery.discoveredLeads
    const finalEnrichedLeads = discovery.finalEnrichedLeads
    const filteredOutWithoutContactCount = discovery.filteredOutWithoutContactCount
    let allowedOutputCount = Math.max(0, outputLeadLimit)
    const locationLabel = discovery.locationLabel
    const summaryLine = discovery.summaryLine
    const detailLine = discovery.detailLine

    let addedCount = 0
    let duplicateCount = 0
    // Businesses recognised as already saved before enrichment never reach the save; they are reported with the ones the save
    // itself rejects as duplicates, so "already in My Leads" is one accurate number.
    const alreadySavedBeforeSave = discovery.alreadySavedSkippedCount
    let invalidCount = 0
    let dbErrorCount = 0
    const addedLeads: TrialLead[] = []
    let confirmedCapacity: DiscoverCapacity | null = null

    // Save progress: announced once up front, then after each attempt finishes.
    const saveTracker = createSaveTracker(
      Math.min(finalEnrichedLeads.length, allowedOutputCount),
      options?.onProgress
    )
    saveTracker.start()

    if (options?.guestMode) {
      for (const lead of finalEnrichedLeads) {
        if (addedCount >= allowedOutputCount) {
          break
        }

        const guestLead = { ...createGuestLead(lead), website_intelligence: lead.website_intelligence ?? null }
        addedLeads.push(guestLead)
        options.onGuestLead?.(guestLead)
        addedCount += 1
        saveTracker.record('saved')
      }
    } else if (config.accounting && userId) {
      const savedBatch = await saveDiscoverResults(createAdminClient(), {
        runId: config.accounting.runId,
        userId,
        limit: config.accounting.limit,
        monthly: config.accounting.monthly,
        leads: finalEnrichedLeads.map((lead) => toLeadRow(buildLeadInsertPayload(lead, userId))),
      })
      confirmedCapacity = savedBatch
      // Capacity is rechecked inside the transaction, including competing runs.
      if (savedBatch.outcomes.some((outcome) => outcome.status === 'limit')) {
        allowedOutputCount = savedBatch.outcomes.filter((outcome) => outcome.status === 'saved').length
      }
      for (const outcome of savedBatch.outcomes) {
        const lead = finalEnrichedLeads[outcome.index]
        if (outcome.status === 'saved' && outcome.id) {
          addedLeads.push({ ...createGuestLead(lead), id: outcome.id })
          addedCount += 1
          // Queueing occurs after the atomic save and cannot discard its confirmed result. With run authorization on
          // (B2 Phase 1) no per-lead inert job is created here: the whole run is authorized once, from the save
          // receipt, after the results have been sent (see POST below).
          if (!isRunAuthorizationEnabled()) {
            try {
              const queued = await enqueueLeadEnrichment(outcome.id, supabase, { workerEligible: false })
              if (!queued.ok) console.error('[scrape] queue handoff failed', outcome.id)
            } catch {
              console.error('[scrape] queue handoff unavailable', outcome.id)
            }
          }
          saveTracker.record('saved')
        } else if (outcome.status === 'duplicate') {
          duplicateCount += 1
          saveTracker.record('duplicate')
        } else if (outcome.status === 'invalid') {
          invalidCount += 1
          saveTracker.record('invalid')
        } else if (outcome.status === 'failed') {
          dbErrorCount += 1
          saveTracker.record('failed')
        }
      }
    } else {
      for (const lead of finalEnrichedLeads) {
        if (addedCount >= allowedOutputCount) {
          break
        }

        if (!userId) {
          console.log('[CI-TRACE] STEP 1 EARLY_RETURN saveLead skipped reason=missing_authenticated_user')
          send('❌ missing authenticated user')
          break
        }

        const saveStartedAt = Date.now()
        console.log(
          `[CI-TRACE] STEP 1 BEFORE saveLead lead_company="${lead.company_name}" user_id=${userId}`
        )
        const saved = await saveLead(supabase, lead, userId)
        console.log(
          `[CI-TRACE] STEP 1 AFTER saveLead ok=${saved.ok} lead_id=${saved.ok ? saved.id : 'N/A'} elapsed_ms=${Date.now() - saveStartedAt}`
        )

        if (saved.ok) {
          console.log(`[CI-SCRAPER] saveLead returned id: ${saved.id}, userId: ${userId}`)
          console.log('[FORENSIC] saved.id exists:', Boolean(saved.id), 'value:', saved.id)

          addedLeads.push({
            ...createGuestLead(lead),
            id: saved.id,
          })
          addedCount += 1

          // Enqueue for background enrichment via durable queue
          const enqueueStartedAt = Date.now()
          console.log(`[CI-TRACE] STEP 2 BEFORE enqueueLeadEnrichment lead_id=${saved.id}`)
          const enqueueResult = await enqueueLeadEnrichment(saved.id, supabase, {
            workerEligible: config.workerEligible,
          })
          console.log(
            `[CI-TRACE] STEP 2 AFTER enqueueLeadEnrichment lead_id=${saved.id} ok=${enqueueResult.ok} queue_id=${enqueueResult.ok ? enqueueResult.data?.id || 'unknown' : 'N/A'} queue_status=${enqueueResult.ok ? enqueueResult.data?.status || 'unknown' : 'N/A'} elapsed_ms=${Date.now() - enqueueStartedAt}`
          )

          if (enqueueResult.ok) {
            console.log(`[CI-SCRAPER] Queue: ${enqueueResult.data?.id || saved.id} queued successfully`)
          } else {
            console.error(
              `[CI-TRACE] STEP 2 FAIL enqueueLeadEnrichment lead_id=${saved.id} error=${enqueueResult.error}`
            )
            console.error(`[CI-SCRAPER] Queue: Failed to enqueue ${saved.id} - ${enqueueResult.error}`)
          }

          saveTracker.record('saved')
          continue
        }
        console.log(
          `[CI-TRACE] STEP 1 EARLY_RETURN saveLead failed reason=${saved.reason} code=${saved.error.code || 'unknown'} message=${saved.error.message}`
        )

        const errorSummary = [
          `code=${saved.error.code || 'unknown'}`,
          `message=${saved.error.message}`,
          saved.error.details ? `details=${saved.error.details}` : null,
          saved.error.hint ? `hint=${saved.error.hint}` : null,
        ]
          .filter(Boolean)
          .join(' | ')

        if (saved.reason === 'duplicate' && config.workerEligible) {
          // Owner-verified private preview: reuse the existing lead instead of
          // dropping it, and let the database RPC decide whether it needs research.
          const existingId = await findExistingOwnerLeadId(supabase, userId, lead)
          if (existingId) {
            addedLeads.push({ ...createGuestLead(lead), id: existingId })
            addedCount += 1
            const requeue = await enqueueLeadEnrichment(existingId, supabase, { workerEligible: true })
            if (!requeue.ok) {
              console.error(`[CI-SCRAPER] Queue: Failed to requeue ${existingId} - ${requeue.error}`)
            }
            saveTracker.record('saved')
            continue
          }
        }

        if (saved.reason === 'duplicate') {
          duplicateCount += 1
          saveTracker.record('duplicate')
          send(`⚠️ duplicate skipped: ${lead.company_name} | ${errorSummary}`)
        } else if (saved.reason === 'invalid') {
          invalidCount += 1
          saveTracker.record('invalid')
          send(`⚠️ invalid lead skipped: ${lead.company_name} | ${errorSummary}`)
        } else {
          dbErrorCount += 1
          saveTracker.record('failed')
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

      const costRunId = currentCostContext()?.runId
      if (costRunId) {
        recordDiscoveryRun({
          runId: costRunId,
          userId: userId ?? null,
          audience: options?.guestMode ? 'guest' : 'member',
          delivered: addedCount,
          duplicates: duplicateCount + alreadySavedBeforeSave,
          rejected: discovery.filteredOutRelevanceCount + filteredOutWithoutContactCount + invalidCount,
          stopReason: discovery.stopReason,
        })
      }

      send(
        `💾 saved: ${addedCount}, duplicates: ${duplicateCount + alreadySavedBeforeSave}, invalid: ${invalidCount}, db errors: ${dbErrorCount}`
      )
    }
    const limitMessage =
      finalEnrichedLeads.length > allowedOutputCount
        ? formatOutputLimitMessage(addedCount)
        : null

    options?.onResult?.({
      requestedCount: maxLeads,
      stopReason: discovery.stopReason,
      shortfallMessage: describeSearchShortfall({
        requested: maxLeads,
        added: addedCount,
        outputLimit: allowedOutputCount,
        stopReason: discovery.stopReason,
        duplicates: duplicateCount + alreadySavedBeforeSave,
        invalid: invalidCount,
        failed: dbErrorCount,
        withoutContact: filteredOutWithoutContactCount,
        irrelevant: discovery.filteredOutRelevanceCount,
      }),
      summaryLine,
      detailLine,
      limitMessage,
      locationLabel,
      // Includes businesses recognised as already saved: they were found, and must stay in the customer's count.
      discoveredCount: validDiscoveredLeads.length + alreadySavedBeforeSave,
      enrichedCount: finalEnrichedLeads.length,
      addedCount,
      addedLeads,
      ...(confirmedCapacity ? {
        leads_used: confirmedCapacity.leads_used,
        leads_limit: confirmedCapacity.leads_limit,
        current_period_end: confirmedCapacity.current_period_end,
        usage_warning: getUsageWarning(confirmedCapacity.leads_used, confirmedCapacity.leads_limit),
      } : {}),
    })

    if (limitMessage) {
      send(limitMessage)
    }

    if (validDiscoveredLeads.length === 0 && alreadySavedBeforeSave === 0) {
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

  const isGuestMode = !user || body.guestTrial === true
  let serverGuestId: string | null = null
  let guestReserved = 0
  const guestRunId = crypto.randomUUID()
  const guestResults: TrialLead[] = []
  const privatePreviewRequested = body.privatePreview === true
  const isPrivatePreview = isPrivatePreviewWorkerRequest(
    privatePreviewRequested,
    user?.id,
    process.env.PRIVATE_ALPA_OWNER_USER_ID
  )

  if (privatePreviewRequested && !isPrivatePreview) {
    return new Response('data: ❌ private preview access denied\n\n', {
      status: 404,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
      },
    })
  }
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
  if (!Number.isInteger(requestedLeadCount) || requestedLeadCount < 1 || requestedLeadCount > 50) {
    return createSseResponse('❌ invalid input', 400)
  }

  let authenticatedPlan = 'free'
  let trackedUsageRow: UsageRow | null = null
  let leadsLimit = 25
  let currentUsage = 0
  let usesMonthlyAccounting = false

  if (isGuestMode) {
    const refuse = (code: GuestErrorCode, status: number) => createSseResponse(`❌ ${GUEST_MESSAGES[code]}`, status, code)
    if (!sameOrigin(req)) return refuse('GUEST_ORIGIN', 403)
    if (!String(body.query || '').trim() || !String(body.defaultCity || '').trim()
      || String(body.query).length > 200 || String(body.defaultCity).length > 200) return refuse('GUEST_INVALID', 400)
    try {
      serverGuestId = await guestSession(true)
      const address = process.env.VERCEL === '1' ? req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : 'local-development'
      if (!address || !serverGuestId) return refuse('GUEST_UNAVAILABLE', 503)
      const { data,error } = await guestDb().rpc('reserve_guest_trial',{
        p_id:serverGuestId,p_bucket:guestRateBucket(address,process.env.SUPABASE_SERVICE_ROLE_KEY!),p_count:Math.min(requestedLeadCount,25),p_run:guestRunId,
      })
      if(error) throw error
      guestReserved = Number(data)
      if(!guestReserved) {
        // The reservation function answers 0 for every refusal; say which one, so the visitor knows whether to wait, open
        // the results already saved, or try another network. Reading the row changes nothing.
        const { data: row } = await guestDb().from('guest_trials').select('created_at,attempts,used,active_until').eq('id', serverGuestId).maybeSingle()
        const code = classifyReserveRefusal(row)
        return refuse(code, code === 'GUEST_UNAVAILABLE' ? 503 : code === 'GUEST_EXPIRED' ? 410 : 429)
      }
      leadsLimit = guestReserved
      currentUsage = 0
    } catch {
      return refuse('GUEST_UNAVAILABLE', 503)
    }
  }

  if (user?.id && !isGuestMode) {
    // A search is a paid action: Stripe is asked every time and the stored plan is never a substitute. If Stripe cannot be reached the search
    // does not start (nothing is used, no research is authorized) and the person is told so. Guests never reach this branch.
    let verified: [Awaited<ReturnType<typeof resolveUserSubscription>>, { count: number | null }] | null = null
    try {
      const [entitlement, leadCount] = await Promise.all([
        verifyEntitlementLive(() => resolveUserSubscription(user.id, { email: user.email, requireFresh: true })),
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .or('email.not.is.null,phone.not.is.null'),
      ])
      verified = entitlement.ok ? [entitlement.subscription, leadCount] : null
    } catch {
      verified = null
    }
    if (!verified) {
      return createSseResponse(`❌ ${ENTITLEMENT_UNAVAILABLE_MESSAGE}`, 503)
    }
    const [subscription, { count }] = verified

    authenticatedPlan = subscription.subscription_active ? subscription.plan : 'free'
    if (count === null && isPrivatePreview) {
      return createSseResponse('❌ fatal: Lead allowance could not be checked. No search was started.', 503)
    }
    currentUsage = count ?? 0
    leadsLimit = getLeadLimit(authenticatedPlan)

    console.info('[scrape.subscription]', {
      auth_user_id: user.id,
      stripe_customer_id: subscription.stripe_customer_id,
      stripe_subscription_id: subscription.stripe_subscription_id,
      resolved_plan: authenticatedPlan,
      resolved_status: subscription.plan_status,
      subscription_active: subscription.subscription_active,
      leads_limit: leadsLimit,
    })

    const monthly = subscription.subscription_active || authenticatedPlan === 'admin'
    usesMonthlyAccounting = monthly
    if (!isPrivatePreview) {
      try {
        const capacity = await getDiscoverCapacity(createAdminClient(), user.id, leadsLimit, monthly)
        currentUsage = capacity.leads_used
      } catch {
        return createSseResponse('❌ fatal: Lead accounting is unavailable. No search was started.', 503)
      }
    } else if (monthly) {
      trackedUsageRow = await getOrCreateCurrentUsageRow(createAdminClient(), user.id, leadsLimit)
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
  if (remainingCapacity === 0) {
    return createSseResponse('❌ fatal: You have reached your lead limit.', 403)
  }

  const config: ScrapeConfig = {
    query: String(body.query || '').trim(),
    defaultCity: String(body.defaultCity || '').trim(),
    region: String(body.region || '').trim(),
    // No default country: the location the customer typed decides, and an unknown country stays unknown.
    country: String(body.country || '').trim(),
    maxLeads: isGuestMode ? guestReserved : requestedLeadCount,
    outputLeadLimit: remainingCapacity,
    userId: isGuestMode ? null : user?.id || null,
    workerEligible: isPrivatePreview,
    accounting: user && !isGuestMode && !isPrivatePreview ? {
      runId: crypto.randomUUID(), limit: leadsLimit,
      monthly: usesMonthlyAccounting,
    } : undefined,
  }

  const encoder = new TextEncoder()

  // Research starts in the background once the run is authorized, after the results were sent. Resolved with true
  // only by a successful authorization; every other path resolves false (resolving twice is harmless).
  let startResearch: (go: boolean) => void = () => {}
  const researchRequested = new Promise<boolean>((resolve) => { startResearch = resolve })
  const origin = new URL(req.url).origin
  after(async () => {
    if (await researchRequested) await kickResearch(origin)
  })

  // A guest on a phone may sit behind a carrier proxy that drops a silent connection. A comment line every few seconds (ignored
  // by the browser's event parser) keeps the stream visibly alive and lets the page tell "quiet" from "gone".
  let keepAlive: ReturnType<typeof setInterval> | null = null
  const stopKeepAlive = () => { if (keepAlive) { clearInterval(keepAlive); keepAlive = null } }

  const stream = new ReadableStream({
    async start(controller) {
      let latestResult: ScrapeResultPayload | null = null
      const closeStream = () => { stopKeepAlive(); try { controller.close() } catch { /* the browser already closed its stream */ } }
      if (isGuestMode) {
        keepAlive = setInterval(() => {
          try { controller.enqueue(encoder.encode(': ping\n\n')) } catch { stopKeepAlive() }
        }, 12_000)
      }

      const emit = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          // A closed browser stream must not interrupt a committed save or its confirmation handling.
        }
      }

      const send = (msg: string) => {
        emit({ type: 'log', message: msg })
      }

      if (!config.query || !config.defaultCity) {
        send('❌ invalid input')
        startResearch(false)
        closeStream()
        return
      }

      if (config.maxLeads <= 0) {
        send('❌ invalid input')
        send('🎉 done')
        startResearch(false)
        closeStream()
        return
      }

      send('🟢 stream started')
      await runScraper(supabase, config, send, {
        guestMode: isGuestMode,
        onGuestLead(lead) {
          guestResults.push(lead)
        },
        onResult(result) {
          latestResult = result
        },
        // Additive event type. A failed emit must never interrupt discovery.
        onProgress(event) {
          try {
            emit(event)
          } catch {
            // stream already closed or cancelled
          }
        },
      })

      if (isGuestMode && serverGuestId) {
        const { data,error } = await guestDb().rpc('finish_guest_trial', {p_id:serverGuestId,p_run:guestRunId,p_reserved:guestReserved,p_leads:guestResults})
        if(error || !data) {
          send('❌ Results could not be saved. Please reopen your trial results before retrying.')
          startResearch(false)
          closeStream()
          return
        }
        guestResults.forEach(lead => emit({ type: 'lead', payload: lead }))
      }
      const completedResult = latestResult as ScrapeResultPayload | null

      if (completedResult) {
        const finalResult = completedResult
        let resultPayload: ScrapeResultPayload = finalResult

        if (trackedUsageRow) {
          try {
            const nextUsageRow = await incrementUsageRow(
              createAdminClient(),
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
              detailLine: [finalResult.detailLine, 'Usage could not be confirmed. Check your saved leads before repeating the search.'].filter(Boolean).join(' '),
              leads_limit: trackedUsageRow.leads_limit,
              current_period_end: trackedUsageRow.period_end,
            }
          }
        }

        emit({ type: 'result', payload: resultPayload })

        // B2 Phase 1: authorize research for exactly the businesses this run saved. It happens AFTER the results were
        // sent, so it can never delay them; it never throws; and with CI_RUN_AUTHORIZATION_ENABLED off (the default)
        // nothing here runs and Discover behaves exactly as before.
        // Automatic research is a paid-plan feature: a free or lapsed member's run is saved but never authorized.
        if (isRunAuthorizationEnabled() && !isGuestMode && isEntitledToAutomaticResearch(authenticatedPlan) && config.accounting && config.userId && finalResult.addedCount > 0) {
          const authorization = await authorizeResearchRun(createAdminClient(), {
            runId: config.accounting.runId,
            userId: config.userId,
            planLeadsLimit: config.accounting.limit,
          })
          emit({
            type: 'intelligence',
            payload: authorization.ok
              ? { runId: authorization.runId, authorized: true, saved: authorization.saved, queued: authorization.queued }
              : { runId: config.accounting.runId, authorized: false },
          })
          if (authorization.ok && authorization.queued > 0) startResearch(true)
        }

        if (!isGuestMode && finalResult.addedCount > 0) {
          console.log(
            `[CI-TRACE] STEP 3 HANDOFF client_trigger_expected added_count=${finalResult.addedCount}`
          )
        } else {
          console.log(
            `[CI-TRACE] STEP 3 EARLY_RETURN client_trigger_not_expected is_guest=${isGuestMode} added_count=${finalResult.addedCount}`
          )
        }
      }

      startResearch(false)
      closeStream()
    },
    cancel() { stopKeepAlive() },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
