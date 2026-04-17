/**
 * Agent mission runner — scraper-first, minimal control layer.
 *
 * Execution contract:
 *   - MAX 3 rounds, each with a UNIQUE query
 *   - Each round calls the scraper exactly ONCE
 *   - Stops immediately on: target reached | no new email leads | no queries left
 *   - Dedup is domain-first; DB is the hard source of truth (upsert + unique index)
 *   - Expected: 2–3 total scraper calls per mission run
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

// Basic email validation — rejects missing, malformed, or obviously junk addresses
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const JUNK_EMAIL_RE = /^(noreply|no-reply|do-not-reply|donotreply|mailer-daemon|postmaster)@/i

function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.trim()
  return e.length < 255 && EMAIL_RE.test(e) && !JUNK_EMAIL_RE.test(e)
}

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

/**
 * Return up to MAX_ROUNDS unique, normalised queries.
 * Pre-built search_patterns take priority; otherwise derive 3 variations
 * from audience + location to maximise result diversity.
 */
function buildQueryVariants(mission: MissionRow): string[] {
  if (
    Array.isArray(mission.search_patterns) &&
    (mission.search_patterns as unknown[]).length > 0
  ) {
    return (mission.search_patterns as string[])
      .map((p) => String(p).trim())
      .filter(Boolean)
      .filter((q, i, arr) => arr.indexOf(q) === i) // deduplicate
      .slice(0, MAX_ROUNDS)
  }

  const audience = String(mission.audience_input || '').trim()
  const location = String(mission.location_input || mission.location || '').trim()

  if (!audience) {
    throw new Error('Mission has no audience_input or search_patterns')
  }

  // Three distinct phrasings — different word order often yields different results
  const candidates = location
    ? [
        `${audience} ${location}`,
        `${audience} near ${location}`,
        `${location} ${audience}`,
      ]
    : [
        audience,
        `${audience} services`,
        `${audience} companies`,
      ]

  // Deduplicate and cap
  return [...new Set(candidates)].slice(0, MAX_ROUNDS)
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

  // DB unique index on (mission_id, dedup_key) is the hard guard
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
    console.log('[STOP] mission deleted')
    return { collected: 0, rounds: 0, newLeads: [], query: '', location: '' }
  }

  const userId = mission.user_id
  const icpId = mission.icp_id ?? ''
  const locationLabel = String(mission.location_input || mission.location || '').trim()
  const location = parseMissionLocation(locationLabel)
  const queries = buildQueryVariants(mission)

  console.log('[runMission] start', { missionId: mission.id, queries, target })

  // Seed seen-Set from DB dedup_key column (source of truth)
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
      // Fallback for rows that predate the dedup_key migration
      const k = buildLeadKey({ website: row.website, email: row.email })
      if (k) seen.add(k)
    }
  }

  // Track which queries have actually been sent to the scraper this run
  const executedQueries = new Set<string>()

  const collected: TrialLead[] = []
  let roundsRun = 0
  let stopReason = 'no queries left'

  for (let round = 0; round < queries.length; round++) {
    // Stop: target reached
    if (collected.length >= target) {
      stopReason = 'target reached'
      break
    }

    const rawQuery = queries[round]
    const normalisedQuery = rawQuery.trim().toLowerCase()

    // Skip duplicate queries within this run
    if (executedQueries.has(normalisedQuery)) {
      console.log(`[QUERY] skipped (duplicate): "${rawQuery}"`)
      continue
    }

    console.log(`[QUERY] executing: "${rawQuery}"`)
    executedQueries.add(normalisedQuery)

    let totalFound = 0
    let emailLeads: DiscoveryLead[] = []

    try {
      const result = await runSharedProspectorDiscovery(
        {
          query: rawQuery,
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

      totalFound = result.discoveredCount
      // Keep only leads with a valid, non-junk email
      emailLeads = result.finalEnrichedLeads.filter((l) => isValidEmail(l.email))
    } catch (err) {
      console.error(`[ROUND ${round + 1}] scraper error:`, err)
      stopReason = 'scraper error'
      break
    }

    roundsRun++

    // Dedup against seen Set
    const accepted: DiscoveryLead[] = []
    for (const lead of emailLeads) {
      const key = getKey(lead)
      if (!key || seen.has(key)) continue
      seen.add(key)
      accepted.push(lead)
    }

    console.log(
      `[ROUND ${round + 1}]\n` +
      `  leads found:  ${totalFound}\n` +
      `  email leads:  ${emailLeads.length}\n` +
      `  accepted:     ${accepted.length} / ${target}`
    )

    // Stop: no email leads from scraper
    if (emailLeads.length === 0) {
      stopReason = 'no email leads'
      break
    }

    // Stop: all email leads were already seen (pool exhausted for this query)
    if (accepted.length === 0) {
      stopReason = 'no new leads'
      // Don't break — try next query variant
      continue
    }

    const budget = target + 2 - collected.length
    const toInsert = accepted.slice(0, Math.max(0, budget))

    const inserted = await persistLeads({
      supabase,
      userId,
      missionId: mission.id,
      icpId,
      leads: toInsert,
    })

    collected.push(...toInsert.slice(0, inserted).map(toTrialLead))

    if (collected.length >= target) {
      stopReason = 'target reached'
      break
    }
  }

  console.log(`[STOP] reason: ${stopReason}`)
  console.log('[runMission] done', { collected: collected.length, rounds: roundsRun, target })

  return {
    collected: collected.length,
    rounds: roundsRun,
    newLeads: collected,
    query: queries[0] ?? '',
    location: locationLabel,
  }
}
