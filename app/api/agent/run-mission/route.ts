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

import { enrichLeadContext } from '@/lib/agent/enrich-context'
import { generateOutreachDraft } from '@/lib/agent/generate-outreach-draft'
import { runMission } from '@/lib/agent/run-mission'
import { syncAgentLeadsToMain } from '@/lib/agent/sync-agent-leads-to-main'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'
import type { TrialLead } from '@/lib/trial'

export const runtime = 'nodejs'

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
}) {
  const {
    supabase, userId, missionId, leads, offerContext, offerInput,
    audienceInput, locationInput, icpAngles, missionCta, senderSignature,
  } = params

  if (!leads.length) return

  // Load existing outreach keys to avoid generating duplicate drafts
  const { data: existingDrafts } = await supabase
    .from('outreach_queue')
    .select('contact_email, website')
    .eq('mission_id', missionId)

  const existingKeys = new Set<string>()
  existingDrafts?.forEach((d) => {
    if (d.contact_email) existingKeys.add(`e:${d.contact_email.toLowerCase()}`)
    if (d.website) existingKeys.add(`w:${d.website.toLowerCase()}`)
  })

  const toProcess = leads.filter((lead) => {
    if (!lead.email && !lead.website) return false
    if (lead.email && existingKeys.has(`e:${lead.email.toLowerCase()}`)) return false
    if (lead.website && existingKeys.has(`w:${lead.website.toLowerCase()}`)) return false
    return true
  })

  if (!toProcess.length) {
    console.log('[runEmailPipeline] no leads to process (all already have drafts)')
    return
  }

  console.log(`[runEmailPipeline] generating drafts for ${toProcess.length} leads`)

  for (const lead of toProcess) {
    const name = lead.company_name || 'Unknown'
    try {
      const context = await enrichLeadContext({
        company_name: lead.company_name,
        website: lead.website,
      })

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
  cap?: number
}) {
  const {
    supabase, userId, missionId, offerContext, offerInput, audienceInput,
    locationInput, icpAngles, missionCta, senderSignature, cap = 10,
  } = params

  const { data: allLeads } = await supabase
    .from('agent_lead_queue')
    .select('id, business_name, email, website, location')
    .eq('mission_id', missionId)
    .eq('user_id', userId)

  if (!allLeads?.length) return

  const { data: existingOutreach } = await supabase
    .from('outreach_queue')
    .select('contact_email, website')
    .eq('mission_id', missionId)

  const existingKeys = new Set<string>()
  existingOutreach?.forEach((d) => {
    if (d.contact_email) existingKeys.add(`e:${d.contact_email.toLowerCase()}`)
    if (d.website) existingKeys.add(`w:${d.website.toLowerCase()}`)
  })

  const needingDraft = allLeads
    .filter((lead) => {
      if (!lead.email && !lead.website) return false
      if (lead.email && existingKeys.has(`e:${lead.email.toLowerCase()}`)) return false
      if (lead.website && existingKeys.has(`w:${lead.website.toLowerCase()}`)) return false
      return true
    })
    .slice(0, cap)

  if (!needingDraft.length) return

  console.log(`[generateMissingDrafts] backfilling ${needingDraft.length} leads`)

  for (const lead of needingDraft) {
    const name = lead.business_name || 'Unknown'
    try {
      const context = await enrichLeadContext({
        company_name: lead.business_name,
        website: lead.website,
      })

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
    .in('status', ['active', 'needs_review'])
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

    // Execution guard: only run if active, or if completed and next_run_at has passed
    const now = new Date()
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

    // ── Return immediately — all scraping + generation runs in after() ──
    after(async () => {
      try {
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
          cap: 10,
        })

        // ── 5. Check completion and schedule next run if done ──
        await checkMissionCompletion({
          supabase,
          missionId: mission.id,
          userId: user.id,
          dailyTarget,
          newLeadsThisRun: result.collected,
        })

        console.log('[run-mission] after() pipeline complete', {
          missionId: mission.id,
          elapsed: Date.now() - startTime,
        })
      } catch (err) {
        console.error('[run-mission] after() pipeline error (non-fatal):', err)
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
