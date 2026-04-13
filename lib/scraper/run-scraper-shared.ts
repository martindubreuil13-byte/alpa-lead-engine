import * as cheerio from 'cheerio'

import { searchGooglePlaces } from '@/lib/sources/google'
import { searchSerperMaps } from '@/lib/sources/serper'
import { type EmailConfidence, extractEmailCandidatesFromHtml, getWebsiteHost, hostsClearlyRelated, isBlockedWebsiteHost, normalizePhone, pickBestEmailCandidate, sanitizeWebsite } from '@/lib/validation'
import { isCountableLead } from '@/lib/usage/usage'

const ENRICHMENT_WORKERS = 4
const FETCH_TIMEOUT = 6000
const MAX_SERPER_QUERIES = 2
const MAX_GOOGLE_CALLS = 1
const SERPER_EARLY_STOP_LEADS = 10
const HIGH_CONFIDENCE_TARGET = 5
const MIN_WEBSITE_TARGET = 7
const MIN_ENRICHMENT_RATE = 0.5
const MAX_SECONDARY_PAGE_FETCHES = 3

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

export type DiscoveryLead = {
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

export type SharedProspectorDiscoveryResult = {
  discoveredLeads: DiscoveryLead[]
  finalEnrichedLeads: DiscoveryLead[]
  discoveredCount: number
  enrichedCount: number
  filteredOutWithoutContactCount: number
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

export function buildDiscoveryLeadKey(lead: Pick<DiscoveryLead, 'website' | 'phone' | 'company_name' | 'city'>) {
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

export async function runSharedProspectorDiscovery(
  config: SharedScrapeConfig,
  send: (msg: string) => void
): Promise<SharedProspectorDiscoveryResult> {
  const { query, defaultCity, region, country, maxLeads } = config

  if (!query || !defaultCity) {
    throw new Error('Invalid scraper input')
  }

  let totalApiCost = 0
  let googleCalls = 0
  const discoveredLeads: DiscoveryLead[] = []
  const sentPhases = new Set<ScrapePhase>()

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

  const serperQueries = buildSerperQueries(query, defaultCity)
  const serperLeadTarget = Math.min(maxLeads, SERPER_EARLY_STOP_LEADS)

  for (const currentQuery of serperQueries) {
    if (discoveredLeads.length >= serperLeadTarget) {
      send('Processing results...')
      break
    }

    if (!canSpend(totalApiCost, SERPER_DISCOVERY_COST_ESTIMATE)) {
      send(`💸 budget reached before Serper query (${SCRAPE_COST_BUDGET})`)
      break
    }

    totalApiCost = roundCostEstimate(totalApiCost + SERPER_DISCOVERY_COST_ESTIMATE)
    send(`🔎 ${currentQuery}`)
    send('🛰️ Serper priority pass')

    let serperResults: Awaited<ReturnType<typeof searchSerperMaps>> = []

    try {
      serperResults =
        (await searchSerperMaps({
          query: currentQuery,
          city: defaultCity,
          region,
          maxResults: Math.max(1, serperLeadTarget - discoveredLeads.length),
          send,
        })) || []
    } catch {
      send('⚠️ Serper failed')
    }

    for (const lead of serperResults) {
      if (discoveredLeads.length >= maxLeads) break

      const upserted = upsertDiscoveredLead(
        discoveredLeads,
        createDiscoveryLead({
          company_name: lead.company_name,
          website: lead.website || null,
          phone: normalizePhone(lead.phone || null),
          city: lead.city || defaultCity,
          industry: lead.industry || null,
          source: 'serper',
          source_url: lead.source_url || lead.website || null,
          cost_estimate: SERPER_DISCOVERY_COST_ESTIMATE,
        })
      )

      if (upserted.isNew) {
        send(`📥 ${lead.company_name}`)
      }
    }

    if (discoveredLeads.length >= serperLeadTarget) {
      send('Processing results...')
      break
    }
  }

  const validDiscoveredLeads = discoveredLeads.filter(isValidDiscoveredLead).slice(0, maxLeads)
  send(`📦 discovered: ${validDiscoveredLeads.length}`)

  await enrichLeadQueue(
    validDiscoveredLeads.filter(shouldAttemptEnrichment),
    send,
    sendPhase
  )

  let metrics = calculateMetrics(validDiscoveredLeads)

  send(
    `📊 websites: ${metrics.leadsWithWebsite}, valid emails: ${metrics.leadsWithValidEmail}, enrichment rate: ${metrics.enrichmentRate}`
  )

  const shouldStopAfterSerper =
    metrics.strongSignalLeads >= targetStrongSignalLeads ||
    !shouldEscalateToGoogle(metrics, targetStrongSignalLeads, websiteTarget)

  if (!shouldStopAfterSerper && googleCalls < MAX_GOOGLE_CALLS) {
    if (!canSpend(totalApiCost, GOOGLE_DISCOVERY_COST_ESTIMATE)) {
      send(`💸 budget reached before Google improvement (${SCRAPE_COST_BUDGET})`)
    } else {
      sendPhase('Improving results')

      googleCalls += 1
      totalApiCost = roundCostEstimate(totalApiCost + GOOGLE_DISCOVERY_COST_ESTIMATE)

      const weakLeadCount = validDiscoveredLeads.filter(
        (lead) => !lead.email || lead.email_confidence !== 'high'
      ).length
      const missingLeadCount = Math.max(0, maxLeads - validDiscoveredLeads.length)
      const signalGap = Math.max(0, targetStrongSignalLeads - metrics.strongSignalLeads)
      const websiteGap = Math.max(0, websiteTarget - metrics.leadsWithWebsite)
      const googleBudget = Math.max(
        1,
        Math.min(
          maxLeads,
          missingLeadCount + Math.max(signalGap, websiteGap) + Math.min(weakLeadCount, 2)
        )
      )

      send('⚡ Improving results with Google...')
      send(
        `🛰️ Google improvement pass (${metrics.leadsWithWebsite}/${websiteTarget} websites, rate ${metrics.enrichmentRate})`
      )

      let googleResults: Awaited<ReturnType<typeof searchGooglePlaces>> = []

      try {
        googleResults =
          (await searchGooglePlaces({
            query,
            city: defaultCity,
            region,
            country,
            maxResults: googleBudget,
            send,
          })) || []
      } catch {
        send('⚠️ Google failed')
      }

      const googleEnrichmentTargets: DiscoveryLead[] = []
      const queuedKeys = new Set<string>()

      for (const lead of googleResults) {
        const upserted = upsertDiscoveredLead(
          validDiscoveredLeads,
          createDiscoveryLead({
            company_name: lead.company_name,
            website: lead.website || null,
            phone: normalizePhone(lead.phone || null),
            city: lead.city || defaultCity,
            industry: lead.industry || null,
            source: 'google',
            source_url: lead.source_url || lead.website || null,
            cost_estimate: GOOGLE_DISCOVERY_COST_ESTIMATE,
          }),
          {
            allowNew: validDiscoveredLeads.length < maxLeads,
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

      await enrichLeadQueue(googleEnrichmentTargets, send, sendPhase)
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

  const fullyEnrichedLeads = validDiscoveredLeads.filter((lead) => isCountableLead(lead))
  const finalEnrichedLeads = fullyEnrichedLeads.filter((lead) => hasContactMethod(lead))
  const filteredOutWithoutContactCount = fullyEnrichedLeads.length - finalEnrichedLeads.length
  const locationLabel = formatLocationLabel(defaultCity, region, country)
  const summaryLine = formatLeadSummary(finalEnrichedLeads.length)
  const detailLine = null

  send(`📦 enriched: ${finalEnrichedLeads.length}`)

  if (filteredOutWithoutContactCount > 0) {
    send(`Filtered out ${filteredOutWithoutContactCount} leads without contact info`)
  }

  if (validDiscoveredLeads.length === 0) {
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
    locationLabel,
    summaryLine,
    detailLine,
  }
}
