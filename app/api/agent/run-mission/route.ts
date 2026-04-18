/**
 * POST /api/agent/run-mission
 *
 * Entry point for a single mission cycle.
 *
 * HTTP response is returned immediately after auth + mission validation.
 * All heavy work (scraping, enrichment, email generation, completion check)
 * runs in after() so the client never waits for it.
 *
 * Background pipeline (after()):
 *   1. runMission()          — batch scrape up to 5× until target met, persist leads
 *   2. syncAgentLeadsToMain  — copy qualified leads into main `leads` table
 *   3. runEmailPipeline()    — generate outreach drafts for newly found leads
 *   4. generateMissingDrafts() — backfill any leads that still lack a draft
 *   5. checkMissionCompletion() — mark completed + schedule next_run_at
 */

import { NextResponse, after } from 'next/server'

import { enrichLeadContext, type LeadContext } from '@/lib/agent/enrich-context'
import { generateOutreachDraft } from '@/lib/agent/generate-outreach-draft'
import { buildLeadKey } from '@/lib/agent/lead-key'
import { runMission } from '@/lib/agent/run-mission'
import { syncAgentLeadsToMain } from '@/lib/agent/sync-agent-leads-to-main'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'
import type { TrialLead } from '@/lib/trial'

export const runtime = 'nodejs'

// ─── Route-level run lock ─────────────────────────────────────────────────────
// Prevents duplicate concurrent pipeline starts for the same mission.
// Process-scoped (works within a single Node.js instance / warm serverless pod).
// The 5-minute cooldown inside runMission() is a second independent layer.
const runLocks = new Map<string, number>()
const RUN_LOCK_MS = 60_000 // 60 seconds

// ─── Types ────────────────────────────────────────────────────────────────────

type OfferContext = {
  what_you_do: string
  who_you_help: string
  main_benefit: string
  angle: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute next run timestamp: tomorrow at 09:00 UTC. */
function computeNextRunAt(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(9, 0, 0, 0)
  return d.toISOString()
}

// ─── Email pipeline ───────────────────────────────────────────────────────────

/**
 * Generate and store outreach drafts for a list of leads.
 * Deduplicates against existing outreach_queue rows (by email + website).
 * Sequential loop for full traceability.
 */
async function runEmailPipeline(params: {
  supabase: Awaited<ReturnType<typeof createServerClient>>
  userId: string
  missionId: string
  leads: TrialLead[]
  offerContext: OfferContext | null
  offerInput: string
  audienceInput: string
  locationInput: string
  icpAngles: string[]
  missionCta: string | null
  senderSignature: string | null
  painSolved: string | null
  valueOutcome: string | null
  enrichmentCache: Map<string, LeadContext>
}) {
  const {
    supabase, userId, missionId, leads, offerContext, offerInput,
    audienceInput, locationInput, icpAngles, missionCta, senderSignature,
    painSolved, valueOutcome, enrichmentCache,
  } = params

  if (!leads.length) return

  // Load existing dedup_keys from outreach_queue — MAX 1 draft per lead per mission
  const { data: existingDrafts } = await supabase
    .from('outreach_queue')
    .select('dedup_key, contact_email, website')
    .eq('mission_id', missionId)

  const existingKeys = new Set<string>()
  existingDrafts?.forEach((d) => {
    if (d.dedup_key) {
      existingKeys.add(d.dedup_key)
    } else {
      // Fallback for rows that predate the migration
      const k = buildLeadKey({ website: d.website, email: d.contact_email })
      if (k) existingKeys.add(k)
    }
  })

  const toProcess = leads.filter((lead) => {
    const key = buildLeadKey({ website: lead.website, email: lead.email, name: lead.company_name, location: lead.city })
    return key && !existingKeys.has(key)
  })

  if (!toProcess.length) {
    console.log('[runEmailPipeline] no new leads to process (all already have drafts)')
    return
  }

  console.log(`[runEmailPipeline] generating drafts for ${toProcess.length} leads`)

  for (const lead of toProcess) {
    const name = lead.company_name || 'Unknown'
    const dedupKey = buildLeadKey({ website: lead.website, email: lead.email, name: lead.company_name, location: lead.city })

    // Double-check in-memory set (guards against duplicates within the same batch)
    if (existingKeys.has(dedupKey)) continue
    existingKeys.add(dedupKey)

    try {
      const cacheKey = (lead.website || lead.company_name || '').toLowerCase()
      let context = cacheKey ? enrichmentCache.get(cacheKey) : undefined
      if (!context) {
        context = await enrichLeadContext({ company_name: lead.company_name, website: lead.website })
        if (cacheKey) enrichmentCache.set(cacheKey, context)
      }

      const draft = await generateOutreachDraft({
        company_name: lead.company_name || context.company_name || 'your company',
        audience_input: audienceInput,
        location_input: locationInput || null,
        mission_cta: missionCta,
        sender_signature: senderSignature,
        offer: offerInput || 'our service',
        angles: icpAngles,
        context,
        offer_context: offerContext,
        pain_solved: painSolved,
        value_outcome: valueOutcome,
        // Rotate variation seed per lead so consecutive emails feel distinct
        variation_seed: toProcess.indexOf(lead) % 3,
      })

      if (!draft.subject || !draft.body) {
        console.log('[runEmailPipeline] invalid draft, skipping', { name })
        continue
      }

      const { error: insertError } = await supabase.from('outreach_queue').insert({
        user_id: userId,
        mission_id: missionId,
        lead_id: null,
        source: 'agent',
        company_name: lead.company_name || null,
        contact_email: lead.email || null,
        location: lead.city || null,
        website: lead.website || null,
        dedup_key: dedupKey || null,
        subject: draft.subject,
        hook: draft.hook,
        body: draft.body,
        cta: missionCta,
        full_email: draft.full_email || draft.body,
        personalization_score: draft.personalization_score,
        quality_score: draft.quality_score,
        context_status: context.enriched ? 'enriched' : 'basic',
        context_title: context.title || null,
        context_description: context.description || null,
        context_h1: context.h1 || null,
        review_status: 'draft',
      })

      if (insertError) {
        console.log('[runEmailPipeline] insert failed', { name, error: insertError })
      } else {
        console.log('[runEmailPipeline] draft created', { name, subject: draft.subject })
      }
    } catch (err) {
      console.log('[runEmailPipeline] generation failed', { name, error: err })
    }
  }
}

/**
 * Backfill: find any leads in agent_lead_queue that still lack an outreach draft
 * and generate them. Capped at `cap` per call to avoid runaway runs.
 */
async function generateMissingDrafts(params: {
  supabase: Awaited<ReturnType<typeof createServerClient>>
  userId: string
  missionId: string
  offerContext: OfferContext | null
  offerInput: string
  audienceInput: string
  locationInput: string
  icpAngles: string[]
  missionCta: string | null
  senderSignature: string | null
  painSolved: string | null
  valueOutcome: string | null
  cap?: number
  enrichmentCache: Map<string, LeadContext>
}) {
  const {
    supabase, userId, missionId, offerContext, offerInput, audienceInput,
    locationInput, icpAngles, missionCta, senderSignature, painSolved, valueOutcome, cap = 10,
    enrichmentCache,
  } = params

  const { data: allLeads } = await supabase
    .from('agent_lead_queue')
    .select('id, business_name, email, website, location, dedup_key')
    .eq('mission_id', missionId)
    .eq('user_id', userId)

  if (!allLeads?.length) return

  // Load existing outreach dedup_keys — strict 1 draft per lead
  const { data: existingOutreach } = await supabase
    .from('outreach_queue')
    .select('dedup_key, contact_email, website')
    .eq('mission_id', missionId)

  const existingKeys = new Set<string>()
  existingOutreach?.forEach((d) => {
    if (d.dedup_key) {
      existingKeys.add(d.dedup_key)
    } else {
      const k = buildLeadKey({ website: d.website, email: d.contact_email })
      if (k) existingKeys.add(k)
    }
  })

  const needingDraft = allLeads
    .filter((lead) => {
      const key = lead.dedup_key || buildLeadKey({ website: lead.website, email: lead.email, name: lead.business_name, location: lead.location })
      return key && !existingKeys.has(key)
    })
    .slice(0, cap)

  if (!needingDraft.length) return

  console.log(`[generateMissingDrafts] backfilling ${needingDraft.length} leads`)

  for (const lead of needingDraft) {
    const name = lead.business_name || 'Unknown'
    const dedupKey = lead.dedup_key || buildLeadKey({ website: lead.website, email: lead.email, name: lead.business_name, location: lead.location })

    if (existingKeys.has(dedupKey)) continue
    existingKeys.add(dedupKey)

    try {
      const cacheKey = (lead.website || lead.business_name || '').toLowerCase()
      let context = cacheKey ? enrichmentCache.get(cacheKey) : undefined
      if (!context) {
        context = await enrichLeadContext({ company_name: lead.business_name, website: lead.website })
        if (cacheKey) enrichmentCache.set(cacheKey, context)
      }

      const draft = await generateOutreachDraft({
        company_name: lead.business_name || context.company_name || 'your company',
        audience_input: audienceInput,
        location_input: locationInput || null,
        mission_cta: missionCta,
        sender_signature: senderSignature,
        offer: offerInput || 'our service',
        angles: icpAngles,
        context,
        offer_context: offerContext,
        pain_solved: painSolved,
        value_outcome: valueOutcome,
        variation_seed: needingDraft.indexOf(lead) % 3,
      })

      if (!draft.subject || !draft.body) continue

      const { error } = await supabase.from('outreach_queue').insert({
        user_id: userId,
        mission_id: missionId,
        lead_id: lead.id,
        source: 'agent',
        company_name: lead.business_name || null,
        contact_email: lead.email || null,
        location: lead.location || null,
        website: lead.website || null,
        dedup_key: dedupKey || null,
        subject: draft.subject,
        hook: draft.hook,
        body: draft.body,
        cta: missionCta,
        full_email: draft.full_email || draft.body,
        personalization_score: draft.personalization_score,
        quality_score: draft.quality_score,
        context_status: context.enriched ? 'enriched' : 'basic',
        context_title: context.title || null,
        context_description: context.description || null,
        context_h1: context.h1 || null,
        review_status: 'draft',
      })

      if (error) {
        console.log('[generateMissingDrafts] insert failed', { name, error })
      } else {
        console.log('[generateMissingDrafts] draft created', { name })
      }
    } catch (err) {
      console.log('[generateMissingDrafts] generation failed', { name, error: err })
    }
  }
}

// ─── Completion check ─────────────────────────────────────────────────────────

/**
 * Transition mission to 'completed' when either condition is met:
 *   A) leadsToday >= dailyTarget AND all leads have drafts
 *   B) Stagnation: newLeadsThisRun === 0 AND leadsToday >= 80% of target
 */
async function checkMissionCompletion(params: {
  supabase: Awaited<ReturnType<typeof createServerClient>>
  missionId: string
  userId: string
  dailyTarget: number
  newLeadsThisRun: number
}) {
  const { supabase, missionId, userId, dailyTarget, newLeadsThisRun } = params

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { count: leadsToday } = await supabase
    .from('agent_lead_queue')
    .select('id', { count: 'exact', head: true })
    .eq('mission_id', missionId)
    .gte('created_at', todayStart.toISOString())

  const leadsTodayCount = leadsToday ?? 0

  // Condition A: hit target + all leads have drafts
  if (leadsTodayCount >= dailyTarget) {
    const { count: draftsTotal } = await supabase
      .from('outreach_queue')
      .select('id', { count: 'exact', head: true })
      .eq('mission_id', missionId)

    if ((draftsTotal ?? 0) >= leadsTodayCount) {
      console.log('[checkMissionCompletion] condition A — target reached with full draft coverage', {
        leadsTodayCount,
        dailyTarget,
        draftsTotal,
      })
      await markCompleted(supabase, missionId, userId)
      return
    }
  }

  // Condition B: stagnation — search pool exhausted before target
  const stagnationThreshold = Math.ceil(dailyTarget * 0.8)
  if (newLeadsThisRun === 0 && leadsTodayCount >= stagnationThreshold) {
    console.log('[checkMissionCompletion] condition B — stagnation, forcing completion', {
      leadsTodayCount,
      stagnationThreshold,
      dailyTarget,
    })
    await markCompleted(supabase, missionId, userId)
  }
}

async function markCompleted(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  missionId: string,
  userId: string
) {
  await supabase
    .from('agent_missions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      next_run_at: computeNextRunAt(),
    })
    .eq('id', missionId)
    .eq('user_id', userId)
    .in('status', ['active', 'needs_review', 'running'])
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const startTime = Date.now()

  try {
    const { missionId } = await req.json()

    if (!missionId || typeof missionId !== 'string') {
      return NextResponse.json({ error: 'MISSING_MISSION_ID' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const { data: mission, error: missionError } = await supabase
      .from('agent_missions')
      .select('*')
      .eq('id', missionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (missionError) {
      console.error('[run-mission] mission lookup error:', missionError)
      return NextResponse.json({ error: 'MISSION_LOOKUP_FAILED' }, { status: 500 })
    }

    if (!mission) {
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 })
    }

    const now = new Date()

    // Guard 1: already running — block duplicate (pipeline is in-flight)
    if (mission.status === 'running') {
      console.log('[run-mission] blocked — pipeline already running', { missionId })
      return NextResponse.json({ success: true, status: 'already_running' })
    }

    // Guard 2: only run if active, or if completed and next_run_at has passed
    const isScheduledRun =
      mission.status === 'completed' &&
      !!mission.next_run_at &&
      now >= new Date(mission.next_run_at)

    if (mission.status !== 'active' && !isScheduledRun) {
      return NextResponse.json(
        { error: 'MISSION_NOT_ACTIVE', status: mission.status },
        { status: 200 }
      )
    }

    // Guard 3: active but next_run_at is still in the future — wait for scheduled slot
    if (mission.status === 'active' && mission.next_run_at && now < new Date(mission.next_run_at)) {
      console.log('[run-mission] waiting for next scheduled slot', {
        missionId,
        next_run_at: mission.next_run_at,
        now: now.toISOString(),
      })
      return NextResponse.json({ success: true, status: 'waiting_for_next_run' })
    }

    // Reset completed → active for this new cycle
    if (isScheduledRun) {
      await supabase
        .from('agent_missions')
        .update({ status: 'active', completed_at: null, next_run_at: null })
        .eq('id', missionId)
        .eq('user_id', user.id)
    }

    // Validate mission has enough config to run
    const hasSearchConfig =
      (Array.isArray(mission.search_patterns) && (mission.search_patterns as unknown[]).length > 0) ||
      Boolean(mission.audience_input)

    if (!hasSearchConfig) {
      return NextResponse.json({ error: 'MISSION_HAS_NO_SEARCH_CONFIG' }, { status: 400 })
    }

    // ── Route-level lock: reject if a run for this mission started within 60s ──
    const now60 = Date.now()
    const lastLock = runLocks.get(missionId)
    if (lastLock && now60 - lastLock < RUN_LOCK_MS) {
      console.log('[run-mission] duplicate request blocked by run lock', { missionId, age: now60 - lastLock })
      return NextResponse.json({ success: true, status: 'already_running' })
    }
    runLocks.set(missionId, now60)

    // ── Return immediately — all scraping + generation runs in after() ──
    after(async () => {
      try {
        // Mark as running so concurrent requests are blocked
        await supabase
          .from('agent_missions')
          .update({ status: 'running' })
          .eq('id', missionId)
          .eq('user_id', user.id)
          .eq('status', 'active')

        const dailyTarget = mission.daily_target ?? 10

        // Collect offer context for email generation
        const offerContext = (mission.offer_context ?? null) as OfferContext | null
        const offerInput = mission.offer_input || ''
        const audienceInput = mission.audience_input || ''
        const locationInput = mission.location_input || mission.location || ''
        const senderSignature = mission.sender_signature || null
        const missionCta = mission.cta || null

        const icpAngles: string[] = []
        if (offerContext?.angle) icpAngles.push(offerContext.angle)
        const icpExpanded = mission.icp_expanded
        if (Array.isArray(icpExpanded)) {
          icpAngles.push(...(icpExpanded as string[]).slice(0, 2))
        }

        // Richer offer framing for email generation
        const painSolved = offerContext?.angle ?? null
        const valueOutcome = offerContext?.main_benefit ?? null

        // Shared enrichment cache for this entire pipeline run — domain → context
        const enrichmentCache = new Map<string, LeadContext>()

        // ── 1. Run scraper rounds + persistence ──
        const result = await runMission({
          supabase,
          mission,
          target: dailyTarget,
        })

        console.log('[run-mission] after() scrape done', {
          collected: result.collected,
          rounds: result.rounds,
          query: result.query,
          location: result.location,
          stopReason: result.stopReason,
          elapsed: Date.now() - startTime,
        })

        // ── 2. Sync to main leads table ──
        await syncAgentLeadsToMain({
          supabase,
          userId: user.id,
          missionId: mission.id,
        })

        // ── 3. Generate outreach drafts for newly found leads ──
        await runEmailPipeline({
          supabase,
          userId: user.id,
          missionId: mission.id,
          leads: result.newLeads,
          offerContext,
          offerInput,
          audienceInput,
          locationInput,
          icpAngles,
          missionCta,
          senderSignature,
          painSolved,
          valueOutcome,
          enrichmentCache,
        })

        // ── 4. Backfill: generate drafts for any leads still missing one ──
        await generateMissingDrafts({
          supabase,
          userId: user.id,
          missionId: mission.id,
          offerContext,
          offerInput,
          audienceInput,
          locationInput,
          icpAngles,
          missionCta,
          senderSignature,
          painSolved,
          valueOutcome,
          cap: 10,
          enrichmentCache,
        })

        // ── 5. Check completion — skip if mission exhausted its search pool ──
        if (result.stopReason !== 'exhausted') {
          await checkMissionCompletion({
            supabase,
            missionId: mission.id,
            userId: user.id,
            dailyTarget,
            newLeadsThisRun: result.collected,
          })
        }

        console.log('[run-mission] after() pipeline complete', {
          missionId: mission.id,
          elapsed: Date.now() - startTime,
        })
      } catch (err) {
        console.error('[run-mission] after() pipeline error (non-fatal):', err)
      } finally {
        // Reset running → active + stamp timestamps.
        // The .eq('status', 'running') guard means this is a no-op if the pipeline
        // already transitioned the mission to completed/exhausted/stopped.
        const pipelineDone = new Date()
        await supabase
          .from('agent_missions')
          .update({
            status: 'active',
            last_run_at: pipelineDone.toISOString(),
            next_run_at: computeNextRunAt(),
          })
          .eq('id', missionId)
          .eq('user_id', user.id)
          .eq('status', 'running')

        console.log('[run-mission] after() pipeline complete — next_run_at set', {
          missionId,
          next_run_at: computeNextRunAt(),
          elapsed: Date.now() - startTime,
        })

        // Release the run lock
        runLocks.delete(missionId)
      }
    })

    // Fast response — client polls mission-status for results
    return NextResponse.json({
      success: true,
      status: mission.status,
    })
  } catch (err) {
    console.error('[run-mission] handler error:', err, { elapsed: Date.now() - startTime })
    return NextResponse.json({ error: 'MISSION_FAILED' }, { status: 500 })
  }
}
