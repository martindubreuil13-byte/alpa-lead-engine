import { classifyBusinessRelevance, rankBusinessCandidates } from '@/lib/scraper/business-relevance'
import { searchGooglePlaces } from '@/lib/sources/google'
import { searchSerperMaps } from '@/lib/sources/serper'
import { resolveCountry } from '@/lib/sources/country'
import { cleanBusinessName } from '@/lib/sources/business-name'
import { isConfirmedOutsideRequestedCountry } from './geographic-relevance'
import { countsAsStrongEmail } from './email-intelligence'
import { isKnownBusiness, knownBusinessKey, type ExistingBusinessIndex } from './existing-business-index'
import { type EmailConfidence, getWebsiteHost, isBlockedWebsiteHost, normalizePhone } from '@/lib/validation'
import { enrichEmailWithInspection } from '@/lib/scraper/email-enrichment'
import { mergeInspection, type EmailInspection } from '@/lib/scraper/email-inspection'
import { isCountableLead } from '@/lib/usage/usage'
import { summarizeContacts } from '@/lib/scraper/results-summary'
import type { DiscoveryStopReason } from '@/lib/scraper/discovery-outcome'
import {
  createWebsiteCheckTracker,
  type ScrapeProgressEvent,
  type WebsiteCheckTracker,
} from '@/lib/scraper/progress-events'

const ENRICHMENT_WORKERS = 4
const MAX_SERPER_QUERIES = 2
const MAX_GOOGLE_CALLS = 1
const HIGH_CONFIDENCE_TARGET = 5
const MIN_WEBSITE_TARGET = 7
const MIN_ENRICHMENT_RATE = 0.5

const SERPER_DISCOVERY_COST_ESTIMATE = 0.01
const GOOGLE_DISCOVERY_COST_ESTIMATE = 0.03
const SCRAPE_COST_BUDGET = Number(
  (
    SERPER_DISCOVERY_COST_ESTIMATE * MAX_SERPER_QUERIES +
    GOOGLE_DISCOVERY_COST_ESTIMATE * MAX_GOOGLE_CALLS
  ).toFixed(4)
)

export type SharedScrapeConfig = {
  query: string
  defaultCity: string
  region: string
  country: string
  maxLeads: number
  mode?: 'deep' | 'fast'
  /** The signed-in customer's existing businesses (loaded once per search, possibly still loading). Absent for guests. */
  existingBusinesses?: Promise<ExistingBusinessIndex | null> | null
}

type DiscoverySource = 'serper' | 'google' | 'hybrid'
type ScrapePhase =
  | 'Finding businesses'
  | 'Checking websites'
  | 'Extracting contacts'
  | 'Improving results'

export type DiscoveryLead = {
  company_name: string
  website: string | null
  phone: string | null
  /** The business's own city when its address states one; null when unknown (never the search location). */
  city: string | null
  /** What the provider's address says, kept for the geographic check. Not persisted (no column for it). */
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
  /** The email replaced a high-confidence low-priority role, so it still counts as strong for the fallback decision. Not persisted. */
  email_strong_for_fallback?: boolean
  is_generic_email: boolean
  website_intelligence?: import('../guest/website-facts').WebsiteFacts | null
  enrichment_attempted: boolean
  enriched_website_host: string | null
  /** How well the website was inspected for an email (see email-inspection.ts). Not persisted. */
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

export type SharedProspectorDiscoveryResult = {
  discoveredLeads: DiscoveryLead[]
  finalEnrichedLeads: DiscoveryLead[]
  discoveredCount: number
  enrichedCount: number
  filteredOutWithoutContactCount: number
  stopReason: DiscoveryStopReason
  filteredOutRelevanceCount: number
  /** Businesses skipped before enrichment because the customer already has them (counted once each; not in the totals above). */
  alreadySavedSkippedCount: number
  locationLabel: string
  summaryLine: string
  detailLine: string | null
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

function normalizeQueryToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
    .trim()
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

function usableLeads(leads: DiscoveryLead[]) {
  return leads.filter(isCountableLead).filter(hasContactMethod)
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
    // A listing title becomes the company name only when its tail is clearly promotional; otherwise it is kept as given.
    company_name: cleanBusinessName(lead.company_name),
    email: null,
    email_source: null,
    email_confidence: null,
    is_generic_email: false,
    enrichment_attempted: false,
    enriched_website_host: null,
    email_inspection: null,
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

    if (candidateWebsite && existingWebsite) {
      return candidateWebsite === existingWebsite
    }

    if (candidatePhone && existingPhone && candidatePhone === existingPhone) {
      return (
        locationsClearlyMatch(candidateLocation, existingLocation) ||
        namesClearlyRelated(candidate.company_name, existing.company_name)
      )
    }

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
    address: existing.address ?? incoming.address ?? null,
    region: existing.region ?? incoming.region ?? null,
    country: existing.country ?? incoming.country ?? null,
    industry: existing.industry || incoming.industry || null,
    source_url: existing.source_url || incoming.source_url || null,
    source: nextSource,
    cost_estimate: nextCost,
    email: websiteChanged ? null : existing.email,
    email_source: websiteChanged ? null : existing.email_source,
    email_confidence: websiteChanged ? null : existing.email_confidence,
    email_strong_for_fallback: websiteChanged ? false : existing.email_strong_for_fallback,
    is_generic_email: websiteChanged ? false : existing.is_generic_email,
    enrichment_attempted: websiteChanged ? false : existing.enrichment_attempted,
    enriched_website_host: websiteChanged ? null : existing.enriched_website_host,
    // A different website means a different inspection: what was learned about the old one does not carry over.
    email_inspection: websiteChanged ? null : (existing.email_inspection ?? null),
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

export function buildDiscoveryLeadKey(lead: Pick<DiscoveryLead, 'website' | 'phone' | 'company_name' | 'city'>) {
  return [
    getWebsiteKey(lead.website) || '',
    normalizePhoneKey(lead.phone) || '',
    normalizeCompanyName(lead.company_name),
    normalizeLocation(lead.city),
  ].join('::')
}

function matchesTokenSequence(tokens: string[], index: number, sequence: string[]) {
  if (sequence.length === 0 || index + sequence.length > tokens.length) {
    return false
  }

  return sequence.every((token, offset) => tokens[index + offset] === token)
}

function sanitizeQuery(query: string, location: string) {
  const rawTokens = String(query || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (rawTokens.length === 0) {
    return ''
  }

  const normalizedTokens = rawTokens.map(normalizeQueryToken)
  const locationTokens = String(location || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(normalizeQueryToken)
    .filter(Boolean)
  const nearLocationTokens = locationTokens.length > 0 ? ['near', ...locationTokens] : []
  const hasNearLocation =
    nearLocationTokens.length > 0 &&
    normalizedTokens.some((_, index) => matchesTokenSequence(normalizedTokens, index, nearLocationTokens))

  const sanitizedTokens: string[] = []
  const sanitizedNormalizedTokens: string[] = []
  let locationAdded = false
  let nearLocationAdded = false

  for (let index = 0; index < rawTokens.length; index += 1) {
    if (
      hasNearLocation &&
      nearLocationTokens.length > 0 &&
      matchesTokenSequence(normalizedTokens, index, nearLocationTokens)
    ) {
      if (!nearLocationAdded) {
        const slice = rawTokens.slice(index, index + nearLocationTokens.length)
        sanitizedTokens.push(...slice)
        sanitizedNormalizedTokens.push(...nearLocationTokens)
        nearLocationAdded = true
        locationAdded = true
      }

      index += nearLocationTokens.length - 1
      continue
    }

    if (
      locationTokens.length > 0 &&
      matchesTokenSequence(normalizedTokens, index, locationTokens)
    ) {
      if (hasNearLocation || locationAdded) {
        index += locationTokens.length - 1
        continue
      }

      const slice = rawTokens.slice(index, index + locationTokens.length)
      sanitizedTokens.push(...slice)
      sanitizedNormalizedTokens.push(...locationTokens)
      locationAdded = true
      index += locationTokens.length - 1
      continue
    }

    const normalizedToken = normalizedTokens[index]
    if (!normalizedToken) {
      continue
    }

    if (sanitizedNormalizedTokens[sanitizedNormalizedTokens.length - 1] === normalizedToken) {
      continue
    }

    sanitizedTokens.push(rawTokens[index])
    sanitizedNormalizedTokens.push(normalizedToken)
  }

  return sanitizedTokens.join(' ').replace(/\s+/g, ' ').trim()
}

function buildSerperQueries(query: string, city: string) {
  const exactQuery = sanitizeQuery(`${query} ${city}`.trim(), city)
  const nearQuery = sanitizeQuery(`${query} near ${city}`.trim(), city)

  return Array.from(
    new Set([exactQuery, nearQuery].filter(Boolean))
  ).slice(0, MAX_SERPER_QUERIES)
}

function calculateMetrics(leads: DiscoveryLead[]): ScrapeMetrics {
  const leadsWithWebsite = leads.filter((lead) => hasUsableWebsite(lead.website)).length
  const leadsWithValidEmail = leads.filter((lead) => Boolean(lead.email)).length
  const strongSignalLeads = leads.filter(countsAsStrongEmail).length
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

async function enrichLeadQueue(
  queue: DiscoveryLead[],
  send: (msg: string) => void,
  sendPhase: (phase: ScrapePhase) => void,
  tracker?: WebsiteCheckTracker
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
        lead.email_inspection = mergeInspection(lead.email_inspection, { state: 'no_website', partial: false })
        send(`⛔ no website: ${lead.company_name}`)
        tracker?.complete(false)
        continue
      }

      send(`🔬 ${lead.company_name}`)

      const { record: emailRecord, inspection, websiteFacts } = await enrichEmailWithInspection(lead.website)
      lead.email_inspection = mergeInspection(lead.email_inspection, inspection)
      lead.website_intelligence = websiteFacts ?? lead.website_intelligence

      // The log line (and the progress counters built from it) is unchanged: "no email" here means no
      // address was found. How well the site was inspected travels separately, on the lead itself.
      if (!emailRecord) {
        send(`⛔ no email: ${lead.company_name}`)
        tracker?.complete(false)
        continue
      }

      lead.email = emailRecord.value
      lead.email_source = emailRecord.emailSource
      lead.email_confidence = emailRecord.emailConfidence
      lead.email_strong_for_fallback = 'fallbackStrong' in emailRecord && emailRecord.fallbackStrong === true
      lead.is_generic_email = emailRecord.isGenericEmail

      send(`✨ ${lead.company_name}`)
      tracker?.complete(true)
    }

    send(`🧵 worker ${id} done`)
  }

  await Promise.all(
    Array.from({ length: ENRICHMENT_WORKERS }, (_, index) => worker(index + 1))
  )
}

export async function runSharedProspectorDiscovery(
  config: SharedScrapeConfig,
  send: (msg: string) => void,
  // Optional and additive: callers that omit it (agent missions) behave exactly as before.
  onProgress?: (event: ScrapeProgressEvent) => void
): Promise<SharedProspectorDiscoveryResult> {
  const { query, defaultCity, region, country, maxLeads, mode = 'deep' } = config

  if (!query || !defaultCity) {
    throw new Error('Invalid scraper input')
  }

  console.log('SCRAPER MODE:', mode)

  // The one place the requested country is decided for every provider. When it cannot be determined reliably the
  // providers are not given one; that is stated, not guessed.
  const resolvedCountry = resolveCountry({ city: defaultCity, region, country })
  const countryCode = resolvedCountry?.code
  if (!resolvedCountry) console.log('[GEO] country not determined; searching without a country filter', { location: defaultCity })

  let totalApiCost = 0
  let googleCalls = 0
  let serperCalls = 0
  let providerFailed = false
  let costLimitReached = false
  const sourceSend = (message: string) => {
    if (/Serper (?:failed|maps failed|API key missing)|Google (?:failed|API error|Places API key missing)/.test(message)) providerFailed = true
    send(message)
  }
  const relevanceRejected = new Set<string>()
  const acceptsBusinessType = (lead: { company_name: string; industry?: string | null; city?: string | null }) => {
    if (classifyBusinessRelevance(query, lead) !== 'mismatch') return true
    relevanceRejected.add(`${normalizeCompanyName(lead.company_name)}:${lead.city ?? defaultCity}:${lead.industry ?? ''}`)
    return false
  }
  // Businesses whose own address confirms a different country than the one requested. Applied as results arrive, before
  // anything is merged, counted, saved or charged; an unknown country is never a reason to exclude.
  const locationRejected = new Set<string>()
  const acceptsLocation = (lead: { company_name: string; country?: string | null; city?: string | null }) => {
    if (!isConfirmedOutsideRequestedCountry(resolvedCountry, lead)) return true
    locationRejected.add(`${normalizeCompanyName(lead.company_name)}:${lead.country ?? ''}`)
    return false
  }
  // Businesses the customer already has, recognised before any enrichment work is spent on them. The index is loaded once per
  // search, in parallel with the first provider call. Each skipped business is counted once, and is NOT added to the
  // discovered businesses, so discovery totals are not inflated. The save still re-checks every business (authoritative).
  let existingIndexPending = config.existingBusinesses ?? null
  let existingIndex: ExistingBusinessIndex | null = null
  const knownSkipped = new Set<string>()
  const ensureExistingIndex = async () => {
    if (!existingIndexPending) return
    const pending = existingIndexPending
    existingIndexPending = null
    existingIndex = await pending.catch(() => null)
    if (!existingIndex) console.warn('[existing-businesses] index unavailable; no business is skipped before the save')
    else if (!existingIndex.complete) console.warn('[existing-businesses] library larger than the index ceiling; only part is indexed', { indexed: existingIndex.size })
  }
  const skipsKnownBusiness = (lead: { company_name: string; city?: string | null; phone?: string | null; website?: string | null }) => {
    // Compared exactly as it would be saved: the cleaned name, the provider's own city (never the searched one).
    const identity = { company_name: cleanBusinessName(lead.company_name), city: lead.city || null, phone: lead.phone ?? null, website: lead.website ?? null }
    if (!isKnownBusiness(existingIndex, identity)) return false
    const key = knownBusinessKey(identity)
    // Found like any other business (so the live count includes it), once, and then not worked on.
    if (!knownSkipped.has(key)) send(`📥 ${identity.company_name}`)
    knownSkipped.add(key)
    return true
  }
  // Provider-call decisions count a skipped business exactly as they counted it before this existed, so the number of Serper
  // and Google calls (and the cost ceiling) cannot change; only the work spent on businesses already saved does.
  const seenTotal = () => discoveredLeads.length + knownSkipped.size
  const relevanceNote = (leads: DiscoveryLead[]) => {
    const uncertain = leads.filter((lead) => classifyBusinessRelevance(query, lead) === 'uncertain').length
    const parts: string[] = []
    if (locationRejected.size) parts.push(`${locationRejected.size} source results excluded because their address is in a different country.`)
    if (relevanceRejected.size) parts.push(`${relevanceRejected.size} source results excluded because their business category did not match.`)
    if (uncertain) parts.push(`Business type could not be confirmed for ${uncertain} ${uncertain === 1 ? 'result' : 'results'} from the available name/category.`)
    return parts.join(' ') || null
  }
  const discoveredLeads: DiscoveryLead[] = []
  const sentPhases = new Set<ScrapePhase>()
  let progressLeads: DiscoveryLead[] = []
  let checkingSequence = 0
  const websiteChecks = createWebsiteCheckTracker((event) => {
    if (event.stage !== 'checking') return
    // Derive contacts from the current deduplicated businesses, not successful attempts.
    // A merged replacement website can invalidate an earlier match before its new check.
    const contacts = summarizeContacts(progressLeads)
    onProgress?.({
      ...event,
      emailsFound: contacts.emails,
      possibleEmails: contacts.possibleEmails,
      sequence: ++checkingSequence,
    })
  })

  const targetStrongSignalLeads = Math.min(HIGH_CONFIDENCE_TARGET, maxLeads)
  const websiteTarget = Math.min(MIN_WEBSITE_TARGET, maxLeads)
  const sendPhase = (phase: ScrapePhase) => {
    if (sentPhases.has(phase)) {
      return
    }

    sentPhases.add(phase)
    send(phase)
  }

  send('🚀 starting scraper')
  sendPhase('Finding businesses')

  const sanitizedQuery = sanitizeQuery(query, defaultCity)
  const serperQueries =
    mode === 'fast' ? [sanitizedQuery].filter(Boolean) : buildSerperQueries(sanitizedQuery, defaultCity)
  const serperLeadTarget = maxLeads

  for (const currentQuery of serperQueries) {
    if (seenTotal() >= serperLeadTarget) {
      send('Processing results...')
      break
    }

    if (!canSpend(totalApiCost, SERPER_DISCOVERY_COST_ESTIMATE)) {
      costLimitReached = true
      send(`💸 budget reached before Serper query (${SCRAPE_COST_BUDGET})`)
      break
    }

    totalApiCost = roundCostEstimate(totalApiCost + SERPER_DISCOVERY_COST_ESTIMATE)
    serperCalls += 1
    send(`🔎 ${currentQuery}`)
    send('🛰️ Serper priority pass')

    let serperResults: Awaited<ReturnType<typeof searchSerperMaps>> = []

    try {
      serperResults =
        (await searchSerperMaps({
          query: currentQuery,
          city: defaultCity,
          region,
          countryCode,
          maxResults: Math.max(1, serperLeadTarget - seenTotal()),
          send: sourceSend,
        })) || []
    } catch {
      providerFailed = true
      send('⚠️ Serper failed')
    }

    await ensureExistingIndex()
    for (const lead of rankBusinessCandidates(query, serperResults)) {
      if (!acceptsLocation(lead) || !acceptsBusinessType(lead)) continue
      if (skipsKnownBusiness(lead)) continue
      if (discoveredLeads.length >= maxLeads) break

      const upserted = upsertDiscoveredLead(
        discoveredLeads,
        createDiscoveryLead({
          company_name: lead.company_name,
          website: lead.website || null,
          phone: normalizePhone(lead.phone || null),
          city: lead.city || null,
          address: lead.address ?? null,
          region: lead.region ?? null,
          country: lead.country ?? null,
          industry: lead.industry || null,
          source: 'serper',
          source_url: lead.source_url || lead.website || null,
          cost_estimate: SERPER_DISCOVERY_COST_ESTIMATE,
        })
      )

      if (upserted.isNew) {
        send(`📥 ${lead.company_name}`)
      }

      if (mode === 'fast' && discoveredLeads.length >= maxLeads) {
        send('Processing results...')
        break
      }
    }

    if (seenTotal() >= serperLeadTarget) {
      send('Processing results...')
      break
    }
  }

  const validDiscoveredLeads = discoveredLeads.filter(isValidDiscoveredLead).slice(0, maxLeads)
  progressLeads = validDiscoveredLeads
  send(`📦 discovered: ${validDiscoveredLeads.length + knownSkipped.size}`)

  const initialCheckQueue = validDiscoveredLeads.filter(shouldAttemptEnrichment)
  // Announce exactly how many websites will be checked (zero is a valid, explicit answer).
  websiteChecks.plan(initialCheckQueue.length)
  await enrichLeadQueue(initialCheckQueue, send, sendPhase, websiteChecks)

  let metrics = calculateMetrics(validDiscoveredLeads)

  send(
    `📊 websites: ${metrics.leadsWithWebsite}, valid emails: ${metrics.leadsWithValidEmail}, enrichment rate: ${metrics.enrichmentRate}`
  )

  if (mode === 'fast') {
    const usable = usableLeads(validDiscoveredLeads)
    const finalEnrichedLeads = usable.slice(0, maxLeads)
    const filteredOutWithoutContactCount = validDiscoveredLeads.length - usable.length
    const locationLabel = formatLocationLabel(defaultCity, region, country)
    const summaryLine = formatLeadSummary(finalEnrichedLeads.length)
    const detailLine = null

    send(`📦 enriched: ${finalEnrichedLeads.length}`)

    if (filteredOutWithoutContactCount > 0) {
      send(`Filtered out ${filteredOutWithoutContactCount} leads without contact info`)
    }

    if (validDiscoveredLeads.length === 0 && knownSkipped.size === 0) {
      send('⚠️ no leads found')
    }

    console.log(
      `SCRAPER API COST: ${roundCostEstimate(totalApiCost)}/${SCRAPE_COST_BUDGET}`
    )

    return {
      discoveredLeads: validDiscoveredLeads,
      finalEnrichedLeads,
      discoveredCount: validDiscoveredLeads.length,
      enrichedCount: finalEnrichedLeads.length,
      filteredOutWithoutContactCount,
      filteredOutRelevanceCount: relevanceRejected.size,
      alreadySavedSkippedCount: knownSkipped.size,
      stopReason: finalEnrichedLeads.length >= maxLeads ? 'target_reached' : providerFailed ? 'provider_error' : costLimitReached ? 'cost_limit' : 'search_limit',
      locationLabel,
      summaryLine,
      detailLine: [detailLine, relevanceNote(finalEnrichedLeads)].filter(Boolean).join(' ') || null,
    }
  }

  // Contact quality can end improvement only after the requested discovery quantity is met.
  const shouldStopAfterSerper =
    usableLeads(validDiscoveredLeads).length + knownSkipped.size >= maxLeads &&
    (metrics.strongSignalLeads >= targetStrongSignalLeads ||
      !shouldEscalateToGoogle(metrics, targetStrongSignalLeads, websiteTarget))

  if (!shouldStopAfterSerper && googleCalls < MAX_GOOGLE_CALLS) {
    if (!canSpend(totalApiCost, GOOGLE_DISCOVERY_COST_ESTIMATE)) {
      costLimitReached = true
      send(`💸 budget reached before Google improvement (${SCRAPE_COST_BUDGET})`)
    } else {
      sendPhase('Improving results')

      googleCalls += 1
      totalApiCost = roundCostEstimate(totalApiCost + GOOGLE_DISCOVERY_COST_ESTIMATE)

      const weakLeadCount = validDiscoveredLeads.filter(
        (lead) => !lead.email || !countsAsStrongEmail(lead)
      ).length
      const missingLeadCount = Math.max(0, maxLeads - usableLeads(validDiscoveredLeads).length - knownSkipped.size)
      // Make room for replacements of candidates that had a website but no usable contact.
      // Provider batch sizes and the existing call/cost limits still bound the candidate pool.
      const signalGap = Math.max(0, targetStrongSignalLeads - metrics.strongSignalLeads)
      const websiteGap = Math.max(0, websiteTarget - metrics.leadsWithWebsite)
      const googleBudget = Math.max(
        1,
        Math.min(
          maxLeads,
          missingLeadCount + Math.max(signalGap, websiteGap) + Math.min(weakLeadCount, 2)
        )
      )
      const candidateLimit = validDiscoveredLeads.length + (missingLeadCount > 0 ? googleBudget : 0)

      send('⚡ Improving results with Google...')
      send(
        `🛰️ Google improvement pass (${metrics.leadsWithWebsite}/${websiteTarget} websites, rate ${metrics.enrichmentRate})`
      )

      let googleResults: Awaited<ReturnType<typeof searchGooglePlaces>> = []

      try {
        googleResults =
          (await searchGooglePlaces({
            query: sanitizedQuery,
            city: defaultCity,
            region,
            country,
            countryCode,
            maxResults: googleBudget,
            send: sourceSend,
          })) || []
      } catch {
        providerFailed = true
        send('⚠️ Google failed')
      }

      const googleEnrichmentTargets: DiscoveryLead[] = []
      const queuedKeys = new Set<string>()

      await ensureExistingIndex()
      for (const lead of rankBusinessCandidates(query, googleResults).slice(0, googleBudget)) {
        if (!acceptsLocation(lead) || !acceptsBusinessType(lead)) continue
        if (skipsKnownBusiness(lead)) continue
        const upserted = upsertDiscoveredLead(
          validDiscoveredLeads,
          createDiscoveryLead({
            company_name: lead.company_name,
            website: lead.website || null,
            phone: normalizePhone(lead.phone || null),
            city: lead.city || null,
            address: lead.address ?? null,
            region: lead.region ?? null,
            country: lead.country ?? null,
            industry: lead.industry || null,
            source: 'google',
            source_url: lead.source_url || lead.website || null,
            cost_estimate: GOOGLE_DISCOVERY_COST_ESTIMATE,
          }),
          {
            allowNew: validDiscoveredLeads.length < candidateLimit,
          }
        )

        if (!upserted.lead) {
          continue
        }

        if (upserted.isNew) {
          send(`📥 ${lead.company_name}`)
        } else {
          send(`🧩 improved ${lead.company_name}`)
        }

        const shouldQueue =
          shouldAttemptEnrichment(upserted.lead) &&
          (
            upserted.isNew ||
            !upserted.previousLead?.website ||
            getWebsiteKey(upserted.previousLead.website) !== getWebsiteKey(upserted.lead.website) ||
            !upserted.previousLead.email ||
            upserted.previousLead.email_confidence === 'low'
          )

        if (!shouldQueue) {
          continue
        }

        const queueKey = buildDiscoveryLeadKey(upserted.lead)
        if (queuedKeys.has(queueKey)) {
          continue
        }

        queuedKeys.add(queueKey)
        googleEnrichmentTargets.push(upserted.lead)
      }

      send(`📦 discovered: ${validDiscoveredLeads.length + knownSkipped.size}`)
      websiteChecks.plan(googleEnrichmentTargets.length)
      await enrichLeadQueue(googleEnrichmentTargets, send, sendPhase, websiteChecks)
      metrics = calculateMetrics(validDiscoveredLeads)

      send(
        `📊 improved websites: ${metrics.leadsWithWebsite}, valid emails: ${metrics.leadsWithValidEmail}, enrichment rate: ${metrics.enrichmentRate}`
      )
    }
  } else if (metrics.strongSignalLeads >= targetStrongSignalLeads) {
    send('✅ early stop: enrichment target reached')
  } else {
    send('✅ Serper satisfied quality targets')
  }

  // If the first raw batch filled the request, its unusable rows may have stopped the
  // initial loop before the second permitted query. Spend that remaining query only
  // when usable contacts still fall short after improvement; never raise the call limit.
  for (const currentQuery of serperQueries.slice(serperCalls)) {
    const missing = Math.max(0, maxLeads - usableLeads(validDiscoveredLeads).length - knownSkipped.size)
    if (missing === 0) break
    if (!canSpend(totalApiCost, SERPER_DISCOVERY_COST_ESTIMATE)) {
      costLimitReached = true
      break
    }
    serperCalls += 1
    totalApiCost = roundCostEstimate(totalApiCost + SERPER_DISCOVERY_COST_ESTIMATE)
    sendPhase('Improving results')
    send(`🔎 ${currentQuery}`)
    let refillResults: Awaited<ReturnType<typeof searchSerperMaps>> = []
    try {
      refillResults = (await searchSerperMaps({
        query: currentQuery, city: defaultCity, region, countryCode, maxResults: missing, send: sourceSend,
      })) || []
    } catch {
      providerFailed = true
      send('⚠️ Serper failed')
    }
    const targets: DiscoveryLead[] = []
    const queued = new Set<string>()
    await ensureExistingIndex()
    for (const lead of rankBusinessCandidates(query, refillResults).slice(0, missing)) {
      if (!acceptsLocation(lead) || !acceptsBusinessType(lead)) continue
      if (skipsKnownBusiness(lead)) continue
      const incoming = createDiscoveryLead({
        company_name: lead.company_name, website: lead.website || null,
        phone: normalizePhone(lead.phone || null), city: lead.city || null,
        address: lead.address ?? null, region: lead.region ?? null, country: lead.country ?? null,
        industry: lead.industry || null, source: 'serper',
        source_url: lead.source_url || lead.website || null, cost_estimate: SERPER_DISCOVERY_COST_ESTIMATE,
      })
      if (!isValidDiscoveredLead(incoming)) continue
      const upserted = upsertDiscoveredLead(validDiscoveredLeads, incoming)
      send(upserted.isNew ? `📥 ${lead.company_name}` : `🧩 improved ${lead.company_name}`)
      if (!upserted.lead || !shouldAttemptEnrichment(upserted.lead)) continue
      const key = buildDiscoveryLeadKey(upserted.lead)
      if (queued.has(key)) continue
      queued.add(key)
      targets.push(upserted.lead)
    }
    send(`📦 discovered: ${validDiscoveredLeads.length + knownSkipped.size}`)
    websiteChecks.plan(targets.length)
    await enrichLeadQueue(targets, send, sendPhase, websiteChecks)
  }

  const usable = usableLeads(validDiscoveredLeads)
  const finalEnrichedLeads = usable.slice(0, maxLeads)
  const filteredOutWithoutContactCount = validDiscoveredLeads.length - usable.length
  const locationLabel = formatLocationLabel(defaultCity, region, country)
  const summaryLine = formatLeadSummary(finalEnrichedLeads.length)
  const detailLine = null

  send(`📦 enriched: ${finalEnrichedLeads.length}`)

  if (filteredOutWithoutContactCount > 0) {
    send(`Filtered out ${filteredOutWithoutContactCount} leads without contact info`)
  }

  if (validDiscoveredLeads.length === 0 && knownSkipped.size === 0) {
    send('⚠️ no leads found')
  }

  console.log(
    `SCRAPER API COST: ${roundCostEstimate(totalApiCost)}/${SCRAPE_COST_BUDGET}`
  )

  return {
    discoveredLeads: validDiscoveredLeads,
    finalEnrichedLeads,
    discoveredCount: validDiscoveredLeads.length,
    enrichedCount: finalEnrichedLeads.length,
    filteredOutWithoutContactCount,
    filteredOutRelevanceCount: relevanceRejected.size,
    alreadySavedSkippedCount: knownSkipped.size,
    stopReason: finalEnrichedLeads.length >= maxLeads ? 'target_reached' : providerFailed ? 'provider_error' : costLimitReached ? 'cost_limit' : 'search_limit',
    locationLabel,
    summaryLine,
    detailLine: [detailLine, relevanceNote(finalEnrichedLeads)].filter(Boolean).join(' ') || null,
  }
}
