import { createServerClient } from '@/lib/supabase/server'
import { runSharedProspectorDiscovery, type DiscoveryLead } from '@/lib/scraper/run-scraper-shared'
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
    return new URL(candidate).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0] || ''
  }
}

function buildMissionQueueKey(lead: Pick<DiscoveryLead, 'company_name' | 'website'> | { business_name?: string | null; website?: string | null }) {
  const name =
    'company_name' in lead ? lead.company_name : String(lead.business_name || '')

  return `${normalizeBusinessName(name)}::${normalizeWebsiteHost(lead.website)}`
}

function qualifyMissionLead(
  lead: DiscoveryLead,
  options: {
    requireEmail: boolean
    requireWebsite: boolean
    duplicateKeys: Set<string>
  }
) {
  const queueKey = buildMissionQueueKey(lead)

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

export async function runMissionWithProspector(params: {
  supabase: SupabaseServerClient
  mission: MissionRow
  icp: IcpRow
  userId: string
}) {
  const { supabase, mission, icp, userId } = params
  const targetBusinesses = parseIcpTargetBusinesses(icp.structured_output)

  if (targetBusinesses.length === 0) {
    throw new Error('Mission ICP is missing target businesses')
  }

  const location = parseMissionLocation(mission.location)
  const discoveredMap = new Map<string, DiscoveryLead>()

  for (const targetBusiness of targetBusinesses) {
    const discovery = await runSharedProspectorDiscovery(
      {
        query: targetBusiness,
        defaultCity: location.city,
        region: location.region,
        country: location.country,
        maxLeads: Math.max(1, mission.leads_per_day),
      },
      () => {}
    )

    for (const lead of discovery.discoveredLeads) {
      discoveredMap.set(buildMissionQueueKey(lead), lead)
    }
  }

  const discoveredLeads = Array.from(discoveredMap.values())

  const { data: existingQueueRows, error: existingQueueError } = await supabase
    .from('agent_lead_queue')
    .select('business_name, website')
    .eq('user_id', userId)
    .eq('mission_id', mission.id)

  if (existingQueueError) {
    throw new Error(existingQueueError.message)
  }

  const duplicateKeys = new Set(
    (existingQueueRows ?? []).map((row) => buildMissionQueueKey(row))
  )

  const qualifiedLeads: DiscoveryLead[] = []
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

  const queuedLeads = qualifiedLeads.slice(0, Math.max(0, mission.leads_per_day))
  const overflow = Math.max(0, qualifiedLeads.length - queuedLeads.length)

  if (queuedLeads.length > 0) {
    const { error: insertError } = await supabase
      .from('agent_lead_queue')
      .insert(
        queuedLeads.map((lead) => ({
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
      throw new Error(insertError.message)
    }
  }

  return {
    discovered: discoveredLeads.length,
    qualified: qualifiedLeads.length,
    rejected,
    queued: queuedLeads.length,
    overflow,
  } satisfies MissionRunSummary
}
