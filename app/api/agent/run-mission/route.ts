import { NextResponse, after } from 'next/server'

import { enrichLeadContext } from '@/lib/agent/enrich-context'
import { generateOutreachDraft } from '@/lib/agent/generate-outreach-draft'
import { runMission } from '@/lib/agent/run-mission'
import { syncAgentLeadsToMain } from '@/lib/agent/sync-agent-leads-to-main'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'
import type { TrialLead } from '@/lib/trial'

export const runtime = 'nodejs'

type OfferContext = {
  what_you_do: string
  who_you_help: string
  main_benefit: string
  angle: string
}

function buildDedupKey(lead: { email?: string | null; website?: string | null }) {
  const email = String(lead.email || '').trim().toLowerCase()
  if (email) return email
  return String(lead.website || '').trim().toLowerCase()
}

/** Insert new leads into agent_lead_queue, deduping against existing rows. Returns only the newly inserted leads. */
async function persistLeads(params: {
  supabase: Awaited<ReturnType<typeof createServerClient>>
  missionId: string
  icpId: string
  userId: string
  leads: TrialLead[]
}): Promise<TrialLead[]> {
  const { supabase, missionId, icpId, userId, leads } = params
  if (!leads.length) return []

  try {
    const { data: existingRows } = await supabase
      .from('agent_lead_queue')
      .select('email, website')
      .eq('user_id', userId)
      .eq('mission_id', missionId)

    const existingKeys = new Set(
      (existingRows || []).map(buildDedupKey).filter(Boolean)
    )

    const newLeads = leads.filter((lead) => {
      const key = buildDedupKey(lead)
      if (!key) return true
      if (existingKeys.has(key)) return false
      existingKeys.add(key)
      return true
    })

    if (newLeads.length > 0) {
      const { error: insertError } = await supabase.from('agent_lead_queue').insert(
        newLeads.map((lead) => ({
          user_id: userId,
          mission_id: missionId,
          icp_id: icpId,
          business_name: lead.company_name,
          website: lead.website,
          email: lead.email,
          phone: lead.phone,
          location: lead.city ?? null,
          qualification_status: 'qualified',
          context_status: 'pending',
          draft_status: 'pending',
        }))
      )
      if (insertError) {
        console.error('[run-mission] queue insert error (ignored):', insertError)
      }
    }

    return newLeads
  } catch (err) {
    console.error('[run-mission] persist error (ignored):', err)
    return []
  }
}

/** Enrich + generate email drafts for new leads, inserting into outreach_queue. Sequential for visibility. */
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
  const { supabase, userId, missionId, leads, offerContext, offerInput, audienceInput, locationInput, icpAngles, missionCta, senderSignature } = params
  if (!leads.length) return

  // Dedup against existing outreach drafts for this mission
  const { data: existingDrafts } = await supabase
    .from('outreach_queue')
    .select('contact_email, website')
    .eq('mission_id', missionId)

  const existingKeys = new Set<string>()
  existingDrafts?.forEach((d) => {
    if (d.contact_email) existingKeys.add(`e:${d.contact_email.toLowerCase()}`)
    if (d.website) existingKeys.add(`w:${d.website.toLowerCase()}`)
  })

  const leadsToProcess = leads.filter((lead) => {
    if (!lead.email && !lead.website) return false
    if (lead.email && existingKeys.has(`e:${lead.email.toLowerCase()}`)) return false
    if (lead.website && existingKeys.has(`w:${lead.website.toLowerCase()}`)) return false
    return true
  })

  if (!leadsToProcess.length) return

  for (const lead of leadsToProcess) {
    const name = lead.company_name || 'Unknown'
    console.log('[run-mission] START GENERATION', { company_name: name, missionId })

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
        console.log('[run-mission] INVALID DRAFT STRUCTURE', { company_name: name, draft })
        continue
      }

      console.log('[run-mission] DRAFT GENERATED', { company_name: name, subject: draft.subject })

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
        console.log('[run-mission] INSERT FAILED', { company_name: name, error: insertError })
      } else {
        console.log('[run-mission] INSERT SUCCESS', { company_name: name })
      }
    } catch (err) {
      console.log('[run-mission] GENERATION FAILED', { company_name: name, error: err })
    }
  }
}

/**
 * Find all leads in the queue that don't have an outreach draft yet and generate them.
 * Runs every cycle so no lead is permanently skipped. Sequential for full traceability.
 * Capped at `cap` per call to avoid overloading a single after() run.
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
  const { supabase, userId, missionId, offerContext, offerInput, audienceInput, locationInput, icpAngles, missionCta, senderSignature, cap = 10 } = params

  // All leads for this mission
  const { data: allLeads } = await supabase
    .from('agent_lead_queue')
    .select('id, business_name, email, website, location')
    .eq('mission_id', missionId)
    .eq('user_id', userId)

  if (!allLeads?.length) return

  // All existing outreach for this mission (any review_status)
  const { data: existingOutreach } = await supabase
    .from('outreach_queue')
    .select('contact_email, website')
    .eq('mission_id', missionId)

  const existingKeys = new Set<string>()
  existingOutreach?.forEach((d) => {
    if (d.contact_email) existingKeys.add(`e:${d.contact_email.toLowerCase()}`)
    if (d.website) existingKeys.add(`w:${d.website.toLowerCase()}`)
  })

  const leadsNeedingDraft = allLeads
    .filter((lead) => {
      if (!lead.email && !lead.website) return false
      if (lead.email && existingKeys.has(`e:${lead.email.toLowerCase()}`)) return false
      if (lead.website && existingKeys.has(`w:${lead.website.toLowerCase()}`)) return false
      return true
    })
    .slice(0, cap)

  console.log('[run-mission] missing drafts', {
    leadsCount: allLeads.length,
    draftsCount: existingOutreach?.length ?? 0,
    generating: leadsNeedingDraft.length,
  })

  if (!leadsNeedingDraft.length) return

  for (const lead of leadsNeedingDraft) {
    const name = lead.business_name || 'Unknown'
    console.log('[run-mission] START GENERATION', { company_name: name, missionId })

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

      if (!draft.subject || !draft.body) {
        console.log('[run-mission] INVALID DRAFT STRUCTURE', { company_name: name, draft })
        continue
      }

      console.log('[run-mission] DRAFT GENERATED', { company_name: name, subject: draft.subject })

      const { error: insertError } = await supabase.from('outreach_queue').insert({
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

      if (insertError) {
        console.log('[run-mission] INSERT FAILED', { company_name: name, error: insertError })
      } else {
        console.log('[run-mission] INSERT SUCCESS', { company_name: name })
      }
    } catch (err) {
      console.log('[run-mission] GENERATION FAILED', { company_name: name, error: err })
    }
  }
}

/** Compute next run timestamp: tomorrow at 09:00 UTC. */
function computeNextRunAt(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(9, 0, 0, 0)
  return d.toISOString()
}

/**
 * Transition mission to 'completed' once:
 * - leads_today >= daily_target
 * - AND all today's leads have outreach drafts
 * Sets completed_at + next_run_at (tomorrow 09:00 UTC).
 */
async function checkMissionCompletion(params: {
  supabase: Awaited<ReturnType<typeof createServerClient>>
  missionId: string
  userId: string
  dailyTarget: number
}) {
  const { supabase, missionId, userId, dailyTarget } = params

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { count: leadsToday } = await supabase
    .from('agent_lead_queue')
    .select('id', { count: 'exact', head: true })
    .eq('mission_id', missionId)
    .gte('created_at', todayStart.toISOString())

  if ((leadsToday ?? 0) < dailyTarget) return

  // Require all today's leads to have drafts before marking complete
  const { count: draftsTotal } = await supabase
    .from('outreach_queue')
    .select('id', { count: 'exact', head: true })
    .eq('mission_id', missionId)

  if ((draftsTotal ?? 0) < (leadsToday ?? 0)) return

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

    // Execution guard: run only if active, or if completed and next_run_at has passed (new day)
    const now = new Date()
    const isScheduledRun =
      mission.status === 'completed' &&
      !!mission.next_run_at &&
      now >= new Date(mission.next_run_at)

    if (mission.status !== 'active' && !isScheduledRun) {
      return NextResponse.json({ error: 'MISSION_NOT_ACTIVE', status: mission.status }, { status: 200 })
    }

    // Reset completed → active for this new cycle
    if (isScheduledRun) {
      await supabase
        .from('agent_missions')
        .update({ status: 'active', completed_at: null, next_run_at: null })
        .eq('id', missionId)
        .eq('user_id', user.id)
    }

    // ICP is optional — missions created via new setup flow use search_patterns directly
    let icp = null
    if (mission.icp_id) {
      const { data: icpData, error: icpError } = await supabase
        .from('agent_icp')
        .select('*')
        .eq('id', mission.icp_id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (icpError) {
        console.error('[run-mission] icp lookup error:', icpError)
        return NextResponse.json({ error: 'ICP_LOOKUP_FAILED' }, { status: 500 })
      }

      icp = icpData
    }

    if (!icp && !mission.search_patterns) {
      return NextResponse.json({ error: 'MISSION_HAS_NO_SEARCH_CONFIG' }, { status: 400 })
    }

    const result = await runMission({
      supabase,
      mission,
      icp,
      scrapeBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin,
      cookieHeader: req.headers.get('cookie'),
    })

    // Collect context for background pipeline
    const offerContext = (mission.offer_context ?? null) as OfferContext | null
    const offerInput = mission.offer_input || ''
    const audienceInput = mission.audience_input || ''
    const locationInput = mission.location_input || mission.location || ''
    const senderSignature = mission.sender_signature || null
    const icpAngles: string[] = []
    if (offerContext?.angle) icpAngles.push(offerContext.angle)
    const icpExpanded = mission.icp_expanded
    if (Array.isArray(icpExpanded)) {
      icpAngles.push(...(icpExpanded as string[]).slice(0, 2))
    }

    after(async () => {
      try {
        const newLeads = await persistLeads({
          supabase,
          missionId: mission.id,
          icpId: icp?.id ?? mission.icp_id ?? '',
          userId: user.id,
          leads: result.leads,
        })

        await syncAgentLeadsToMain({ supabase, userId: user.id, missionId: mission.id })

        // Use exact mission CTA; null means no CTA line in email
        const missionCta = mission.cta || null

        // Generate drafts for newly found leads immediately
        await runEmailPipeline({
          supabase,
          userId: user.id,
          missionId: mission.id,
          leads: newLeads,
          offerContext,
          offerInput,
          audienceInput,
          locationInput,
          icpAngles,
          missionCta,
          senderSignature,
        })

        // Always backfill: generate drafts for any lead across all rounds that still lacks one
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

        await checkMissionCompletion({
          supabase,
          missionId: mission.id,
          userId: user.id,
          dailyTarget: mission.daily_target ?? 10,
        })
      } catch (err) {
        console.error('[run-mission] after() pipeline error (ignored):', err)
      }
    })

    console.log('[run-mission] complete', {
      missionId,
      found: result.found,
      withEmail: result.withEmail,
      elapsed: Date.now() - startTime,
    })

    return NextResponse.json({
      success: true,
      leads: result.leads,
      found: result.found,
      withEmail: result.withEmail,
      readyToContact: result.readyToContact,
      query: result.query,
      location: result.location,
    })
  } catch (err) {
    console.error('[run-mission] error:', err, { elapsed: Date.now() - startTime })
    return NextResponse.json({ error: 'MISSION_FAILED' }, { status: 500 })
  }
}
