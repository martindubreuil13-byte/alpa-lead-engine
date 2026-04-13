import * as cheerio from 'cheerio'

import { createServerClient } from '@/lib/supabase/server'
import { searchGooglePlaces } from '@/lib/sources/google'
import { searchSerperMaps } from '@/lib/sources/serper'
import type { Database, Json } from '@/lib/supabase/types'
import {
  extractEmailCandidatesFromHtml,
  getWebsiteHost,
  hostsClearlyRelated,
  isBlockedWebsiteHost,
  normalizePhone,
  pickBestEmailCandidate,
  sanitizeWebsite,
} from '@/lib/validation'

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>
type MissionRow = Database['public']['Tables']['agent_missions']['Row']
type IcpRow = Database['public']['Tables']['agent_icp']['Row']

type MissionLead = {
  business_name: string
  website: string | null
  email: string | null
  phone: string | null
}

type HtmlPage = {
  html: string
  resolvedUrl: string
}

type MissionRunSummary = {
  discovered: number
  qualified: number
  rejected: number
  queued: number
}

const FETCH_TIMEOUT = 6000
const MAX_SECONDARY_PAGE_FETCHES = 3
const ENRICHMENT_WORKERS = 4

function normalizeBusinessName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function parseIcpTargetBusinesses(structuredOutput: Json): string[] {
  if (!structuredOutput || typeof structuredOutput !== 'object' || Array.isArray(structuredOutput)) {
    return []
  }

  const value = structuredOutput as Record<string, Json | undefined>
  const targetBusinesses = value.target_businesses

  if (!Array.isArray(targetBusinesses)) {
    return []
  }

  return targetBusinesses
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseMissionLocation(location: string | null | undefined) {
  const normalized = String(location || '').trim()
  const parts = normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return { city: 'Global', region: '', country: undefined as string | undefined }
  }

  if (parts.length === 1) {
    return { city: parts[0], region: '', country: undefined as string | undefined }
  }

  if (parts.length === 2) {
    return { city: parts[0], region: parts[1], country: parts[1] }
  }

  return {
    city: parts[0],
    region: parts[1],
    country: parts.slice(2).join(', '),
  }
}

function buildQueueKey(businessName: string | null | undefined, website: string | null | undefined) {
  const websiteHost = getWebsiteHost(website || null) || ''
  return `${normalizeBusinessName(businessName)}::${websiteHost}`
}

function normalizeDiscoveredLead(candidate: {
  company_name: string
  website?: string | null
  email?: string | null
  phone?: string | null
}): MissionLead | null {
  const business_name = String(candidate.company_name || '').trim()
  if (!business_name) {
    return null
  }

  return {
    business_name,
    website: sanitizeWebsite(candidate.website || null),
    email: candidate.email ? String(candidate.email).trim().toLowerCase() : null,
    phone: normalizePhone(candidate.phone || null),
  }
}

async function fetchHtml(url: string) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return null
    }

    return {
      html: await response.text(),
      resolvedUrl: response.url || url,
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

  const candidates: ReturnType<typeof extractEmailCandidatesFromHtml> = []
  const homepage = await fetchHtml(base)
  const pages: HtmlPage[] = []

  if (homepage) {
    const resolvedHost = getWebsiteHost(homepage.resolvedUrl)
    if (
      resolvedHost &&
      !isBlockedWebsiteHost(resolvedHost) &&
      hostsClearlyRelated(originalHost, resolvedHost)
    ) {
      pages.push(homepage)
    }
  }

  const secondaryPages = await Promise.all(
    buildSecondaryPageUrls(base, homepage).map(async (url) => fetchHtml(url))
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

async function enrichMissionLeads(leads: MissionLead[]) {
  const queue = leads.filter((lead) => Boolean(lead.website) && !lead.email)

  async function worker() {
    while (true) {
      const lead = queue.shift()
      if (!lead) break

      const emailRecord = await enrichEmail(lead.website)

      if (!emailRecord) {
        continue
      }

      lead.email = emailRecord.value
    }
  }

  await Promise.all(Array.from({ length: ENRICHMENT_WORKERS }, () => worker()))
}

function buildMissionDiscoveryQueries(mission: MissionRow, icp: IcpRow) {
  const targetBusinesses = parseIcpTargetBusinesses(icp.structured_output)
  const location = parseMissionLocation(mission.location)
  const discoveryTarget = Math.min(
    Math.max(mission.leads_per_day * 2, mission.leads_per_day + 4),
    40
  )

  return {
    targetBusinesses,
    location,
    discoveryTarget,
  }
}

function qualifyMissionLead(
  lead: MissionLead,
  options: {
    requireEmail: boolean
    requireWebsite: boolean
    duplicateKeys: Set<string>
  }
) {
  const queueKey = buildQueueKey(lead.business_name, lead.website)

  if (options.duplicateKeys.has(queueKey)) {
    return { qualified: false, queueKey }
  }

  if (options.requireWebsite && !lead.website) {
    return { qualified: false, queueKey }
  }

  if (options.requireEmail && !lead.email) {
    return { qualified: false, queueKey }
  }

  return { qualified: true, queueKey }
}

export async function runMissionV1(params: {
  supabase: SupabaseServerClient
  mission: MissionRow
  icp: IcpRow
  userId: string
}) {
  const { supabase, mission, icp, userId } = params
  const plan = buildMissionDiscoveryQueries(mission, icp)

  if (plan.targetBusinesses.length === 0) {
    throw new Error('Mission ICP is missing target businesses')
  }

  const discoveredMap = new Map<string, MissionLead>()
  const {
    city,
    region,
    country,
  } = plan.location

  for (const targetBusiness of plan.targetBusinesses) {
    if (discoveredMap.size >= plan.discoveryTarget) {
      break
    }

    const remaining = Math.max(1, plan.discoveryTarget - discoveredMap.size)
    const serperResults = await searchSerperMaps({
      query: targetBusiness,
      city,
      region,
      maxResults: remaining,
    })

    for (const result of serperResults) {
      const normalized = normalizeDiscoveredLead(result)
      if (!normalized) continue

      discoveredMap.set(
        buildQueueKey(normalized.business_name, normalized.website),
        normalized
      )
    }

    if (discoveredMap.size >= plan.discoveryTarget) {
      continue
    }

    const googleResults = await searchGooglePlaces({
      query: targetBusiness,
      city,
      region,
      country,
      maxResults: Math.max(1, plan.discoveryTarget - discoveredMap.size),
    })

    for (const result of googleResults) {
      const normalized = normalizeDiscoveredLead(result)
      if (!normalized) continue

      discoveredMap.set(
        buildQueueKey(normalized.business_name, normalized.website),
        normalized
      )
    }
  }

  const discoveredLeads = Array.from(discoveredMap.values()).slice(0, plan.discoveryTarget)
  await enrichMissionLeads(discoveredLeads)

  const { data: existingQueueRows, error: existingQueueError } = await supabase
    .from('agent_lead_queue')
    .select('business_name, website')
    .eq('user_id', userId)
    .eq('mission_id', mission.id)

  if (existingQueueError) {
    throw new Error(existingQueueError.message)
  }

  const duplicateKeys = new Set(
    (existingQueueRows ?? []).map((row) => buildQueueKey(row.business_name, row.website))
  )

  const qualifiedLeads: MissionLead[] = []
  let rejected = 0
  const requireEmail = true
  const requireWebsite = Boolean(mission.require_website)

  for (const lead of discoveredLeads) {
    const result = qualifyMissionLead(lead, {
      requireEmail,
      requireWebsite,
      duplicateKeys,
    })

    if (!result.qualified) {
      rejected += 1
      continue
    }

    duplicateKeys.add(result.queueKey)
    qualifiedLeads.push(lead)
  }

  const leadsToQueue = qualifiedLeads.slice(0, Math.max(0, mission.leads_per_day))
  rejected += Math.max(0, qualifiedLeads.length - leadsToQueue.length)

  if (leadsToQueue.length > 0) {
    const { error: insertError } = await supabase
      .from('agent_lead_queue')
      .insert(
        leadsToQueue.map((lead) => ({
          user_id: userId,
          mission_id: mission.id,
          icp_id: icp.id,
          business_name: lead.business_name,
          website: lead.website,
          email: lead.email,
          phone: lead.phone,
          qualification_status: 'qualified',
          context_status: 'pending',
          draft_status: 'pending',
        }))
      )

    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  return {
    discovered: discoveredLeads.length,
    qualified: qualifiedLeads.length,
    rejected,
    queued: leadsToQueue.length,
  } satisfies MissionRunSummary
}
