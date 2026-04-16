/**
 * Agent mission runner — scraper-first, minimal control layer.
 *
 * The agent does NOT scrape, score, or filter by ICP.
 * It calls the existing scraper, keeps only leads with an email,
 * deduplicates via dedup_key (DB is source of truth), and stops
 * when the target is reached.
 *
 * Loop (max MAX_ROUNDS):
 *   1. Call runSharedProspectorDiscovery (fast mode)
 *   2. Filter: keep only leads that have an email
 *   3. Dedup: skip any key already seen this run (loaded from DB on start)
 *   4. Upsert to DB with ON CONFLICT DO NOTHING (DB enforces uniqueness)
 *   5. Stop if collected >= target OR scraper returned 0 email leads
 */

import { buildLeadKey } from '@/lib/agent/lead-key'
import { runSharedProspectorDiscovery } from '@/lib/scraper/run-scraper-shared'
import type { DiscoveryLead } from '@/lib/scraper/run-scraper-shared'
import type { TrialLead } from '@/lib/trial'
import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>
type MissionRow = Database['public']['Tables']['agent_missions']['Row']

const MAX_ROUNDS = 3
const BATCH_SIZE = 20

export type MissionRunOutput = {
  collected: number
  rounds: number
  newLeads: TrialLead[]
  query: string
  location: string
}

// ─── Location ─────────────────────────────────────────────────────────────────

function parseMissionLocation(label: string) {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return { city: 'Global', region: '', country: 'Global' }
  if (parts.length === 1) return { city: parts[0], region: '', country: parts[0] }
  if (parts.length === 2) return { city: parts[0], region: parts[1], country: parts[1] }
  return { city: parts[0], region: parts[1], country: parts.slice(2).join(', ') }
}

// ─── Query variants ───────────────────────────────────────────────────────────

function buildQueryVariants(mission: MissionRow): string[] {
  if (
    Array.isArray(mission.search_patterns) &&
    (mission.search_patterns as unknown[]).length > 0
  ) {
    return (mission.search_patterns as string[])
      .map((p) => String(p).trim())
      .filter(Boolean)
      .slice(0, MAX_ROUNDS)
  }

  const audience = String(mission.audience_input || '').trim()
  const location = String(mission.location_input || mission.location || '').trim()

  if (!audience) {
    throw new Error('Mission has no audience_input or search_patterns')
  }

  const variants = [
    [audience, location].filter(Boolean).join(' '),
    [audience, 'near', location].filter(Boolean).join(' '),
    [audience, 'companies', location].filter(Boolean).join(' '),
  ]

  return [...new Set(variants)].slice(0, MAX_ROUNDS)
}

// ─── Dedup key ────────────────────────────────────────────────────────────────

function getKey(lead: DiscoveryLead): string {
  return buildLeadKey({
    website: lead.website,
    email: lead.email,
    name: lead.company_name,
    location: lead.city,
  })
}

// ─── Lead conversion ──────────────────────────────────────────────────────────

function toTrialLead(lead: DiscoveryLead): TrialLead {
  return {
    id: crypto.randomUUID(),
    company_name: lead.company_name,
    city: lead.city || null,
    industry: lead.industry || null,
    email: lead.email,
    email_source: lead.email_source,
    email_confidence: lead.email_confidence,
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

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistLeads(params: {
  supabase: SupabaseServerClient
  userId: string
  missionId: string
  icpId: string
  leads: DiscoveryLead[]
}): Promise<number> {
  const { supabase, userId, missionId, icpId, leads } = params
  if (leads.length === 0) return 0

  const rows = leads.map((lead) => ({
    user_id: userId,
    mission_id: missionId,
    icp_id: icpId,
    business_name: lead.company_name,
    website: lead.website,
    email: lead.email,
    phone: lead.phone,
    location: lead.city ?? null,
    dedup_key: getKey(lead),
    qualification_status: 'qualified',
    context_status: 'pending',
    draft_status: 'pending',
  }))

  // ON CONFLICT DO NOTHING — DB unique index on (mission_id, dedup_key) is the hard guard
  const { error, data } = await supabase
    .from('agent_lead_queue')
    .upsert(rows, { onConflict: 'mission_id,dedup_key', ignoreDuplicates: true })
    .select('id')

  if (error) {
    console.error('[runMission] upsert error:', error)
    return 0
  }

  return data?.length ?? leads.length
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runMission(params: {
  supabase: SupabaseServerClient
  mission: MissionRow
  target: number
}): Promise<MissionRunOutput> {
  const { supabase, mission, target } = params

  // Hard guard: abort if mission was deleted after this job was queued
  const { data: liveCheck } = await supabase
    .from('agent_missions')
    .select('id, status')
    .eq('id', mission.id)
    .maybeSingle()

  if (!liveCheck || liveCheck.status === 'deleted') {
    console.log('[runMission] mission deleted → stop')
    return { collected: 0, rounds: 0, newLeads: [], query: '', location: '' }
  }

  const userId = mission.user_id
  const icpId = mission.icp_id ?? ''
  const locationLabel = String(mission.location_input || mission.location || '').trim()
  const location = parseMissionLocation(locationLabel)
  const queries = buildQueryVariants(mission)

  console.log('[runMission] start', {
    missionId: mission.id,
    queries,
    location: locationLabel,
    target,
  })

  // Seed seen-Set from DB using stored dedup_key (source of truth)
  const seen = new Set<string>()

  const { data: existing } = await supabase
    .from('agent_lead_queue')
    .select('dedup_key, website, email')
    .eq('mission_id', mission.id)
    .eq('user_id', userId)

  for (const row of existing ?? []) {
    if (row.dedup_key) {
      seen.add(row.dedup_key)
    } else {
      // Fallback for rows that predate the migration
      const k = buildLeadKey({ website: row.website, email: row.email })
      if (k) seen.add(k)
    }
  }

  const collected: TrialLead[] = []
  let roundsRun = 0

  for (let round = 0; round < queries.length; round++) {
    if (collected.length >= target) break

    const query = queries[round]
    console.log(`[runMission] ROUND ${round + 1} — query="${query}"`)

    let emailLeads: DiscoveryLead[] = []

    try {
      const result = await runSharedProspectorDiscovery(
        {
          query,
          defaultCity: location.city,
          region: location.region,
          country: location.country,
          maxLeads: BATCH_SIZE,
          mode: 'fast',
        },
        (msg) => {
          if (msg.startsWith('📥') || msg.startsWith('📦') || msg.startsWith('⚠')) {
            console.log(`[scraper] ${msg}`)
          }
        }
      )

      console.log(`[scraper] discovered=${result.discoveredCount}`)

      // ONLY keep leads that have an email — no other filtering
      emailLeads = result.finalEnrichedLeads.filter((l) => Boolean(l.email))
    } catch (err) {
      console.error(`[runMission] ROUND ${round + 1} scraper error:`, err)
      break
    }

    roundsRun++

    // Hard stop: scraper returned 0 email leads — pool exhausted
    if (emailLeads.length === 0) {
      console.log('[runMission] 0 email leads returned — stopping early')
      break
    }

    // Dedup against in-memory seen Set (mirrors DB state)
    const accepted: DiscoveryLead[] = []
    for (const lead of emailLeads) {
      const key = getKey(lead)
      if (!key || seen.has(key)) continue
      seen.add(key)
      accepted.push(lead)
    }

    console.log(
      `[filter] emailLeads=${emailLeads.length}`,
      `\n[dedup] accepted=${accepted.length} total=${collected.length + accepted.length}/${target}`
    )

    if (accepted.length > 0) {
      const budget = target + 2 - collected.length
      const toInsert = accepted.slice(0, Math.max(0, budget))

      const inserted = await persistLeads({
        supabase,
        userId,
        missionId: mission.id,
        icpId,
        leads: toInsert,
      })

      // Only add truly inserted leads to collected (DB may have rejected some via unique constraint)
      collected.push(...toInsert.slice(0, inserted).map(toTrialLead))

      console.log(
        `[runMission] ROUND ${round + 1} done — ` +
        `inserted=${inserted} total=${collected.length}/${target}`
      )
    }
  }

  console.log('[runMission] done', {
    collected: collected.length,
    rounds: roundsRun,
    target,
  })

  return {
    collected: collected.length,
    rounds: roundsRun,
    newLeads: collected,
    query: queries[0] ?? '',
    location: locationLabel,
  }
}
