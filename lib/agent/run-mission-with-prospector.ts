import type { TrialLead } from '@/lib/trial'
import { createServerClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/lib/supabase/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>
type MissionRow = Database['public']['Tables']['agent_missions']['Row']
type IcpRow = Database['public']['Tables']['agent_icp']['Row']

type MissionRunSummary = {
  discovered: number
  qualified: number
  rejected: number
  queued: number
  overflow: number
}

type ScrapeResultPayload = {
  discoveredCount: number
  addedLeads: TrialLead[]
}

const MAX_TARGETS = 2

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
    .slice(0, MAX_TARGETS)
}

function parseMissionLocation(location: string | null | undefined) {
  const normalized = String(location || '').trim()
  const parts = normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return { city: 'Global', region: '', country: 'Global' }
  }

  if (parts.length === 1) {
    return { city: parts[0], region: '', country: parts[0] }
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

function buildMissionLocationLabel(location: string | null | undefined) {
  return String(location || '').trim()
}

function normalizeBusinessName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeWebsiteHost(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  try {
    return new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]?.toLowerCase() || ''
  }
}

function buildMissionQueueKey(
  lead:
    | Pick<TrialLead, 'company_name' | 'website'>
    | { business_name?: string | null; website?: string | null }
) {
  const name = 'company_name' in lead ? lead.company_name : String(lead.business_name || '')
  return `${normalizeBusinessName(name)}::${normalizeWebsiteHost(lead.website)}`
}

function buildMissionQuery(targetBusinesses: string[], locationLabel: string) {
  const targetQuery =
    targetBusinesses.length > 1
      ? `${targetBusinesses[0]} OR ${targetBusinesses[1]}`
      : targetBusinesses[0]

  return [targetQuery, locationLabel].filter(Boolean).join(' ').trim()
}

async function readScrapeResultPayload(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Scraper response body unavailable')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload: ScrapeResultPayload | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''

    for (const event of events) {
      const dataLine = event
        .split('\n')
        .find((line) => line.startsWith('data: '))

      if (!dataLine) {
        continue
      }

      try {
        const parsed = JSON.parse(dataLine.slice(6)) as {
          type?: string
          payload?: ScrapeResultPayload
        }

        if (parsed.type === 'result' && parsed.payload) {
          finalPayload = parsed.payload
        }
      } catch {
        continue
      }
    }
  }

  return finalPayload
}

export async function runMissionWithProspector(params: {
  supabase: SupabaseServerClient
  mission: MissionRow
  icp: IcpRow
  userId: string
  scrapeBaseUrl: string
  cookieHeader?: string | null
}) {
  const { supabase, mission, icp, userId, scrapeBaseUrl, cookieHeader } = params
  console.log('MISSION START')
  const targetBusinesses = parseIcpTargetBusinesses(icp.structured_output)

  if (targetBusinesses.length === 0) {
    throw new Error('Mission ICP is missing target businesses')
  }

  const location = parseMissionLocation(mission.location)
  const locationLabel = buildMissionLocationLabel(mission.location)
  const query = buildMissionQuery(targetBusinesses, locationLabel)
  const target = Math.max(1, mission.leads_per_day)

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (cookieHeader) {
    headers.Cookie = cookieHeader
  }

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }

  console.log('AGENT SCRAPE REQUEST:', {
    query,
    location: mission.location,
    target,
  })

  const response = await fetch(`${scrapeBaseUrl}/api/scrape`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      defaultCity: location.city,
      region: location.region,
      country: location.country,
      maxLeads: target * 2,
      mode: 'fast',
    }),
    cache: 'no-store',
  })

  const scrapeResult = await readScrapeResultPayload(response)

  if (!response.ok || !scrapeResult) {
    throw new Error(`Scraper failed with status ${response.status}`)
  }

  const discoveredLeads = Array.isArray(scrapeResult.addedLeads)
    ? scrapeResult.addedLeads
    : []
  const qualifiedLeads = discoveredLeads.filter((lead) => lead.email && lead.website)
  console.log('SCRAPER SUCCESS')

  console.log('AGENT SCRAPE RESULT:', {
    discovered: discoveredLeads.length,
    qualified: qualifiedLeads.length,
  })

  let seenQueueKeys = new Set<string>()

  try {
    const { data: existingQueueRows, error: existingQueueError } = await supabase
      .from('agent_lead_queue')
      .select('business_name, website')
      .eq('user_id', userId)
      .eq('mission_id', mission.id)

    if (existingQueueError) {
      console.error('QUEUE READ ERROR (ignored):', existingQueueError)
    } else {
      seenQueueKeys = new Set(
        (existingQueueRows ?? []).map((row) => buildMissionQueueKey(row))
      )
    }
  } catch (error) {
    console.error('QUEUE READ ERROR (ignored):', error)
  }

  const uniqueQualifiedLeads = qualifiedLeads.filter((lead) => {
    const queueKey = buildMissionQueueKey(lead)

    if (seenQueueKeys.has(queueKey)) {
      return false
    }

    seenQueueKeys.add(queueKey)
    return true
  })

  const finalLeads = uniqueQualifiedLeads.slice(0, target)
  const overflow = Math.max(0, uniqueQualifiedLeads.length - target)
  const summary = {
    discovered: discoveredLeads.length,
    qualified: uniqueQualifiedLeads.length,
    rejected: Math.max(0, discoveredLeads.length - uniqueQualifiedLeads.length),
    queued: finalLeads.length,
    overflow,
  } satisfies MissionRunSummary
  console.log('AGENT FINAL:', {
    discovered: summary.discovered,
    qualified: summary.qualified,
  })

  if (finalLeads.length > 0) {
    try {
      const { error: insertError } = await supabase
        .from('agent_lead_queue')
        .insert(
          finalLeads.map((lead) => ({
            user_id: userId,
            mission_id: mission.id,
            icp_id: icp.id,
            business_name: lead.company_name,
            website: lead.website,
            email: lead.email,
            phone: lead.phone,
            location: lead.city || null,
            qualification_status: 'qualified',
            context_status: 'pending',
            draft_status: 'pending',
          }))
        )

      if (insertError) {
        console.error('QUEUE INSERT ERROR (ignored):', insertError)
      }
    } catch (error) {
      console.error('QUEUE INSERT ERROR (ignored):', error)
    }
  }

  return summary
}
