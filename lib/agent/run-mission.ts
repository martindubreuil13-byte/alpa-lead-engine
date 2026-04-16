import type { TrialLead } from '@/lib/trial'
import { createServerClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/lib/supabase/types'
import { deriveAllowedCategories, scoreLeadRelevance } from '@/lib/agent/score-lead-relevance'

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>
type MissionRow = Database['public']['Tables']['agent_missions']['Row']
type IcpRow = Database['public']['Tables']['agent_icp']['Row']

export type MissionRunOutput = {
  leads: TrialLead[]
  found: number
  withEmail: number
  readyToContact: number
  query: string
  location: string
}

function parseIcpTargetBusinesses(structuredOutput: Json): string[] {
  if (!structuredOutput || typeof structuredOutput !== 'object' || Array.isArray(structuredOutput)) {
    return []
  }
  const value = structuredOutput as Record<string, Json | undefined>
  const targetBusinesses = value.target_businesses
  if (!Array.isArray(targetBusinesses)) return []
  return targetBusinesses
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
}

function parseMissionLocation(location: string | null | undefined) {
  const normalized = String(location || '').trim()
  const parts = normalized.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return { city: 'Global', region: '', country: 'Global' }
  if (parts.length === 1) return { city: parts[0], region: '', country: parts[0] }
  if (parts.length === 2) return { city: parts[0], region: parts[1], country: parts[1] }
  return { city: parts[0], region: parts[1], country: parts.slice(2).join(', ') }
}

function buildQuery(targetBusinesses: string[], locationLabel: string) {
  const targetQuery =
    targetBusinesses.length > 1
      ? `${targetBusinesses[0]} OR ${targetBusinesses[1]}`
      : targetBusinesses[0]
  return [targetQuery, locationLabel].filter(Boolean).join(' ').trim()
}

function buildDedupKey(lead: { email?: string | null; website?: string | null }) {
  const email = String(lead.email || '').trim().toLowerCase()
  if (email) return email
  return String(lead.website || '').trim().toLowerCase()
}

async function readScrapeLeads(response: Response): Promise<TrialLead[]> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Scraper response body unavailable')

  const decoder = new TextDecoder()
  let buffer = ''
  let leads: TrialLead[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''

    for (const event of events) {
      const dataLine = event.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      try {
        const parsed = JSON.parse(dataLine.slice(6)) as {
          type?: string
          payload?: { addedLeads?: TrialLead[] }
        }
        if (parsed.type === 'result' && Array.isArray(parsed.payload?.addedLeads)) {
          leads = parsed.payload.addedLeads
        }
      } catch {
        continue
      }
    }
  }

  return leads
}

function pickSearchQuery(mission: MissionRow, icp: IcpRow): string {
  // Use mission search_patterns if available (from new conversational setup)
  if (mission.search_patterns && Array.isArray(mission.search_patterns) && mission.search_patterns.length > 0) {
    const patterns = mission.search_patterns as string[]
    // Rotate through patterns based on a time-based index to vary queries
    const idx = Math.floor(Date.now() / 1000 / 60 / 5) % patterns.length
    return String(patterns[idx] || patterns[0]).trim()
  }

  // Fall back to ICP target_businesses + location
  const targetBusinesses = parseIcpTargetBusinesses(icp.structured_output)
  if (targetBusinesses.length === 0) {
    throw new Error('Mission has no search patterns and ICP is missing target businesses')
  }
  return buildQuery(targetBusinesses, String(mission.location || '').trim())
}

export async function runMission(params: {
  supabase: SupabaseServerClient
  mission: MissionRow
  icp: IcpRow | null
  scrapeBaseUrl: string
  cookieHeader?: string | null
}): Promise<MissionRunOutput> {
  const { supabase, mission, icp, scrapeBaseUrl, cookieHeader } = params

  const locationLabel = String(mission.location_input || mission.location || '').trim()
  const location = parseMissionLocation(locationLabel)
  const query = pickSearchQuery(mission, icp ?? { structured_output: null } as unknown as IcpRow)
  const target = Math.max(1, mission.leads_per_day)

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookieHeader) headers.Cookie = cookieHeader
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

  console.log('[runMission] start', { query, location: locationLabel, target })

  const response = await fetch(`${scrapeBaseUrl}/api/scrape`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      location: locationLabel,
      target,
      defaultCity: location.city,
      region: location.region,
      country: location.country,
      maxLeads: target,
      mode: 'fast',
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Scraper returned ${response.status}`)
  }

  const rawLeads = await readScrapeLeads(response)

  // Basic dedup by email or website
  const seen = new Set<string>()
  const deduped = rawLeads.filter((lead) => {
    if (!lead.email && !lead.website) return false
    const key = buildDedupKey(lead)
    if (key && seen.has(key)) return false
    if (key) seen.add(key)
    return true
  })

  // Relevance filter: skip leads that don't match the intended audience
  const allowedCategories = deriveAllowedCategories(mission.audience_input)
  const leads: TrialLead[] = []
  for (const lead of deduped) {
    if (allowedCategories.length > 0) {
      const { score } = scoreLeadRelevance(lead, allowedCategories)
      if (score < 0.6) {
        console.log(`[runMission] FILTERED OUT (LOW RELEVANCE): ${lead.company_name}`, {
          score: score.toFixed(2),
          industry: lead.industry,
          categories: allowedCategories,
        })
        continue
      }
    }
    leads.push(lead)
  }

  const withEmail = leads.filter((l) => Boolean(String(l.email || '').trim())).length

  console.log('[runMission] done', {
    found: leads.length,
    withEmail,
    filtered: deduped.length - leads.length,
  })

  return {
    leads,
    found: leads.length,
    withEmail,
    readyToContact: withEmail,
    query,
    location: locationLabel,
  }
}
