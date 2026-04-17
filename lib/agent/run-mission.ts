/**
 * Agent mission runner — memory-aware, adaptive, cost-efficient.
 *
 * Execution contract:
 *   - MissionMemory tracks all seen domains, used queries, and query performance
 *   - Domain-first dedup prevents reprocessing the same company across rounds
 *   - Low-yield queries (<3 email leads) are retired and replaced with refined variants
 *   - Hard stop when 2 consecutive rounds yield 0 accepted leads → status: exhausted
 *   - 5-minute cooldown guard prevents double-execution from fast frontend retries
 *   - Email yield improvement: tries /contact + /about for leads missing an email
 *   - All enrichment is domain-cached; never fetches the same site twice per run
 */

import { buildLeadKey } from '@/lib/agent/lead-key'
import { findEmailOnWebsite } from '@/lib/agent/enrich-context'
import { runSharedProspectorDiscovery } from '@/lib/scraper/run-scraper-shared'
import type { DiscoveryLead } from '@/lib/scraper/run-scraper-shared'
import type { TrialLead } from '@/lib/trial'
import { cleanEmail, cleanPhone } from '@/lib/utils/clean-contact'
import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>
type MissionRow = Database['public']['Tables']['agent_missions']['Row']

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ROUNDS = 3
const MAX_QUEUE_SIZE = MAX_ROUNDS + 2        // base queries + up to 2 injected refinements
const BATCH_SIZE = 20
const LOW_YIELD_THRESHOLD = 3                // emailLeads < 3 → retire query
const EMAIL_RECOVERY_CAP = 5                 // max no-email leads to attempt recovery per round
const COOLDOWN_MS = 5 * 60 * 1000           // 5 minutes between runs on the same mission

// ─── Module-level cooldown (process-scoped, best-effort in serverless) ────────
const runCooldowns = new Map<string, number>()

// ─── Email validation ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const JUNK_EMAIL_RE = /^(noreply|no-reply|do-not-reply|donotreply|mailer-daemon|postmaster)@/i

function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.trim()
  return e.length < 255 && EMAIL_RE.test(e) && !JUNK_EMAIL_RE.test(e)
}

// ─── Domain normalization ─────────────────────────────────────────────────────

function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    const u = new URL(normalized)
    return u.hostname.replace(/^www\./, '').toLowerCase().trim() || null
  } catch {
    // Fallback: strip protocol + www manually
    const d = url
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/[/?#].*$/, '')
      .toLowerCase()
      .trim()
    return d || null
  }
}

// ─── Mission memory ───────────────────────────────────────────────────────────

type QueryStats = {
  leadsFound: number
  emailLeads: number
  acceptedLeads: number
}

type MissionMemory = {
  /** All domains seen (website) — prevents reprocessing same company */
  seenDomains: Set<string>
  /** Domains actively rejected (e.g. junk leads) */
  rejectedDomains: Set<string>
  /** Normalised queries sent to the scraper this run */
  usedQueries: Set<string>
  /** Queries with emailLeads < LOW_YIELD_THRESHOLD — never reuse */
  lowYieldQueries: Set<string>
  /** Per-query stats for refinement decisions */
  queryStats: Map<string, QueryStats>
}

function createMemory(): MissionMemory {
  return {
    seenDomains: new Set(),
    rejectedDomains: new Set(),
    usedQueries: new Set(),
    lowYieldQueries: new Set(),
    queryStats: new Map(),
  }
}

// ─── Output type ──────────────────────────────────────────────────────────────

export type MissionRunOutput = {
  collected: number
  rounds: number
  newLeads: TrialLead[]
  query: string
  location: string
  stopReason: string
}

// ─── Location ─────────────────────────────────────────────────────────────────

function parseMissionLocation(label: string) {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return { city: 'Global', region: '', country: 'Global' }
  if (parts.length === 1) return { city: parts[0]!, region: '', country: parts[0]! }
  if (parts.length === 2) return { city: parts[0]!, region: parts[1]!, country: parts[1]! }
  return { city: parts[0]!, region: parts[1]!, country: parts.slice(2).join(', ') }
}

// ─── Query variants ───────────────────────────────────────────────────────────

function buildBaseQueries(mission: MissionRow): string[] {
  if (
    Array.isArray(mission.search_patterns) &&
    (mission.search_patterns as unknown[]).length > 0
  ) {
    return (mission.search_patterns as string[])
      .map((p) => String(p).trim())
      .filter(Boolean)
      .filter((q, i, arr) => arr.indexOf(q) === i)
      .slice(0, MAX_ROUNDS)
  }

  const audience = String(mission.audience_input || '').trim()
  const location = String(mission.location_input || mission.location || '').trim()

  if (!audience) throw new Error('Mission has no audience_input or search_patterns')

  const candidates = location
    ? [`${audience} ${location}`, `${audience} near ${location}`, `${location} ${audience}`]
    : [audience, `${audience} services`, `${audience} companies`]

  return [...new Set(candidates)].slice(0, MAX_ROUNDS)
}

// ─── Intelligent query refinement ─────────────────────────────────────────────

/**
 * Generate up to `limit` refined query variants for a low-yield base query.
 *
 * Uses three strategies:
 *   1. Intent-based: append "email", "contact", "company", "firm"
 *   2. Structure-based: prepend/append location
 *   3. Niche-based: prepend "independent", "small", "local"
 *
 * Skips variants already in usedQueries or lowYieldQueries.
 */
function generateRefinedQueries(
  query: string,
  locationLabel: string,
  memory: MissionMemory,
  limit = 2
): string[] {
  const lower = query.toLowerCase()
  const candidates: string[] = []

  // 1. Intent-based — different search intent signals
  for (const suffix of ['email', 'contact', 'company', 'firm']) {
    if (!lower.endsWith(` ${suffix}`) && !lower.includes(` ${suffix} `)) {
      candidates.push(`${query} ${suffix}`)
    }
  }

  // 2. Structure-based — reorder with location for different index coverage
  const city = locationLabel.split(',')[0]?.trim() ?? ''
  if (city && !lower.includes(city.toLowerCase())) {
    candidates.push(`${city} ${query}`)
    candidates.push(`${query} near ${city}`)
  }

  // 3. Niche-based — narrower scope often surfaces different results
  for (const prefix of ['independent', 'small', 'local']) {
    if (!lower.startsWith(`${prefix} `)) {
      candidates.push(`${prefix} ${query}`)
    }
  }

  // Filter already used, low-yield, or duplicate candidates
  const result: string[] = []
  for (const c of candidates) {
    const norm = c.trim().toLowerCase()
    if (
      memory.usedQueries.has(norm) ||
      memory.lowYieldQueries.has(norm) ||
      result.some((r) => r.toLowerCase() === norm)
    ) continue
    result.push(c)
    if (result.length >= limit) break
  }

  return result
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

// ─── Lead sanitisation ────────────────────────────────────────────────────────

function sanitiseLead(lead: DiscoveryLead): DiscoveryLead {
  return {
    ...lead,
    email: cleanEmail(lead.email) ?? null,
    phone: cleanPhone(lead.phone) ?? null,
  }
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

// ─── Email recovery for no-email leads ───────────────────────────────────────

/**
 * For leads the scraper returned without an email, attempt to find one by
 * crawling homepage → /contact → /about.
 * Capped at EMAIL_RECOVERY_CAP leads per round to keep the run fast.
 * Skips domains already in seenDomains.
 */
async function recoverEmails(
  leads: DiscoveryLead[],
  memory: MissionMemory
): Promise<DiscoveryLead[]> {
  const recovered: DiscoveryLead[] = []
  let attempts = 0

  for (const lead of leads) {
    if (attempts >= EMAIL_RECOVERY_CAP) break

    const domain = normalizeDomain(lead.website)
    if (!domain || memory.seenDomains.has(domain)) continue

    attempts++
    const found = await findEmailOnWebsite(lead.website)
    if (!found || !isValidEmail(found.email)) continue

    recovered.push({
      ...lead,
      email: found.email,
      email_source: found.source,
      email_confidence: 'medium',
      is_generic_email: false,
    })
  }

  if (recovered.length > 0) {
    console.log(`[EMAIL_RECOVERY] found ${recovered.length} emails from ${attempts} attempts`)
  }

  return recovered
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runMission(params: {
  supabase: SupabaseServerClient
  mission: MissionRow
  target: number
}): Promise<MissionRunOutput> {
  const { supabase, mission, target } = params

  // ── Cooldown guard ────────────────────────────────────────────────────────
  const lastRun = runCooldowns.get(mission.id) ?? 0
  if (Date.now() - lastRun < COOLDOWN_MS) {
    console.log('[STOP] cooldown active — skipping run', { missionId: mission.id })
    return { collected: 0, rounds: 0, newLeads: [], query: '', location: '', stopReason: 'cooldown' }
  }

  // ── Liveness check — abort if mission deleted/exhausted after job was queued
  const { data: liveCheck } = await supabase
    .from('agent_missions')
    .select('id, status')
    .eq('id', mission.id)
    .maybeSingle()

  if (!liveCheck || liveCheck.status === 'deleted' || liveCheck.status === 'exhausted') {
    console.log(`[STOP] mission ${liveCheck?.status ?? 'not found'}`)
    return { collected: 0, rounds: 0, newLeads: [], query: '', location: '', stopReason: liveCheck?.status ?? 'not_found' }
  }

  const userId = mission.user_id
  const icpId = mission.icp_id ?? ''
  const locationLabel = String(mission.location_input || mission.location || '').trim()
  const location = parseMissionLocation(locationLabel)
  const baseQueries = buildBaseQueries(mission)

  console.log('[runMission] start', { missionId: mission.id, queries: baseQueries, target })

  // ── Initialise memory ─────────────────────────────────────────────────────
  const memory = createMemory()

  // Seed seenDomains and seen keys from DB (hard source of truth)
  const { data: existing } = await supabase
    .from('agent_lead_queue')
    .select('dedup_key, website, email')
    .eq('mission_id', mission.id)
    .eq('user_id', userId)

  const seen = new Set<string>()   // dedup keys for DB upsert
  for (const row of existing ?? []) {
    // Key-level dedup
    if (row.dedup_key) {
      seen.add(row.dedup_key)
    } else {
      const k = buildLeadKey({ website: row.website, email: row.email })
      if (k) seen.add(k)
    }
    // Domain-level dedup
    const domain = normalizeDomain(row.website)
    if (domain) memory.seenDomains.add(domain)
  }

  // ── Run loop ──────────────────────────────────────────────────────────────
  const queryQueue = [...baseQueries]
  let queueIndex = 0

  const collected: TrialLead[] = []
  let roundsRun = 0
  let stopReason = 'no queries left'
  let consecutiveEmptyRounds = 0
  let totalAcceptedAllRounds = 0

  while (queueIndex < queryQueue.length && queryQueue.length <= MAX_QUEUE_SIZE) {

    // Hard cap: never exceed MAX_ROUNDS scraper calls
    if (roundsRun >= MAX_ROUNDS) {
      stopReason = 'max rounds reached'
      break
    }

    // Target reached
    if (collected.length >= target) {
      stopReason = 'target reached'
      break
    }

    // All remaining queries are low-yield → stop
    const remaining = queryQueue.slice(queueIndex)
    if (remaining.length > 0 && remaining.every((q) => memory.lowYieldQueries.has(q.trim().toLowerCase()))) {
      stopReason = 'all queries exhausted (low yield)'
      break
    }

    const rawQuery = queryQueue[queueIndex]!
    queueIndex++
    const normQuery = rawQuery.trim().toLowerCase()

    // Skip queries already executed or known low-yield
    if (memory.usedQueries.has(normQuery)) {
      console.log(`[QUERY] skipped (duplicate): "${rawQuery}"`)
      continue
    }
    if (memory.lowYieldQueries.has(normQuery)) {
      console.log(`[QUERY] skipped (low yield): "${rawQuery}"`)
      continue
    }

    console.log(`[QUERY] executing: "${rawQuery}"`)
    memory.usedQueries.add(normQuery)

    // ── Scraper call ─────────────────────────────────────────────────────
    let totalFound = 0
    let rawLeads: DiscoveryLead[] = []

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
      rawLeads = result.finalEnrichedLeads.map(sanitiseLead)
    } catch (err) {
      console.error(`[ROUND ${roundsRun + 1}] scraper error:`, err)
      stopReason = 'scraper error'
      break
    }

    roundsRun++

    // ── Domain dedup (before any email check) ─────────────────────────────
    const domainDedupedLeads = rawLeads.filter((lead) => {
      const domain = normalizeDomain(lead.website)
      if (!domain) return true   // no website — keep, fall back to key-based dedup
      if (memory.seenDomains.has(domain)) return false
      memory.seenDomains.add(domain)
      return true
    })

    // ── Email yield improvement ───────────────────────────────────────────
    // Separate leads that already have a valid email from those that don't
    const hasEmail = domainDedupedLeads.filter((l) => isValidEmail(l.email))
    const noEmail = domainDedupedLeads.filter((l) => !isValidEmail(l.email) && l.website)

    // Try to recover emails for no-email leads (capped, non-blocking)
    const recovered = await recoverEmails(noEmail, memory)
    // Add recovered domains to seenDomains
    for (const r of recovered) {
      const domain = normalizeDomain(r.website)
      if (domain) memory.seenDomains.add(domain)
    }

    const emailLeads = [...hasEmail, ...recovered]

    // ── Query performance tracking ─────────────────────────────────────────
    const stats: QueryStats = {
      leadsFound: totalFound,
      emailLeads: emailLeads.length,
      acceptedLeads: 0,   // filled below
    }

    if (emailLeads.length < LOW_YIELD_THRESHOLD) {
      memory.lowYieldQueries.add(normQuery)
      console.log(`[QUERY] low yield (${emailLeads.length} email leads) → retiring "${rawQuery}"`)

      // Inject refined variants (max 2) into the queue
      if (roundsRun < MAX_ROUNDS && queryQueue.length < MAX_QUEUE_SIZE) {
        const refined = generateRefinedQueries(rawQuery, locationLabel, memory, 2)
        if (refined.length > 0) {
          console.log(`[QUERY] injecting ${refined.length} refined variant(s):`, refined)
          queryQueue.splice(queueIndex, 0, ...refined)
        }
      }
    }

    // ── Key-based dedup against DB seen set ───────────────────────────────
    const accepted: DiscoveryLead[] = []
    for (const lead of emailLeads) {
      const key = getKey(lead)
      if (!key || seen.has(key)) continue
      seen.add(key)
      accepted.push(lead)
    }

    stats.acceptedLeads = accepted.length
    memory.queryStats.set(rawQuery, stats)

    console.log(
      `[ROUND ${roundsRun}]\n` +
      `  leads found:  ${totalFound}\n` +
      `  email leads:  ${emailLeads.length} (${recovered.length} recovered)\n` +
      `  accepted:     ${accepted.length} / ${target}`
    )

    // ── Stop: no email leads at all from scraper ──────────────────────────
    if (emailLeads.length === 0) {
      stopReason = 'no email leads'
      break
    }

    // ── Stop: consecutive empty rounds ────────────────────────────────────
    if (accepted.length === 0) {
      consecutiveEmptyRounds++
      if (consecutiveEmptyRounds >= 2) {
        stopReason = 'no new leads (2 consecutive empty rounds)'
        break
      }
      stopReason = 'no new leads'
      continue
    }

    consecutiveEmptyRounds = 0
    totalAcceptedAllRounds += accepted.length

    // ── Persist accepted leads ────────────────────────────────────────────
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

  // ── Hard stop: exhausted pool (never found any leads in this run) ─────────
  if (totalAcceptedAllRounds === 0 && roundsRun >= 2) {
    stopReason = 'exhausted'
    console.log('[STOP] pool exhausted — marking mission as exhausted')
    await supabase
      .from('agent_missions')
      .update({ status: 'exhausted' })
      .eq('id', mission.id)
      .eq('user_id', userId)
  }

  console.log(`[STOP] reason: ${stopReason}`)
  console.log('[runMission] done', { collected: collected.length, rounds: roundsRun, target })

  // Record cooldown timestamp
  runCooldowns.set(mission.id, Date.now())

  return {
    collected: collected.length,
    rounds: roundsRun,
    newLeads: collected,
    query: baseQueries[0] ?? '',
    location: locationLabel,
    stopReason,
  }
}
