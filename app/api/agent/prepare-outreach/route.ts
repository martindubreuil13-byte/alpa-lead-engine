import { NextResponse } from 'next/server'
import { z } from 'zod'

import { enrichLeadContext, type LeadContext } from '@/lib/agent/enrich-context'
import { generateOutreachDraft } from '@/lib/agent/generate-outreach-draft'
import { getMissionCTA } from '@/lib/agent/user-ctas'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const requestSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(50),
  source: z.enum(['manual', 'agent']).optional().default('manual'),
  missionId: z.string().uuid().nullable().optional(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { leadIds, source, missionId } = parsed.data

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    // Load leads from main table
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, company_name, email, phone, website, city, industry')
      .in('id', leadIds)
      .eq('user_id', user.id)

    if (leadsError || !leads?.length) {
      return NextResponse.json({ error: 'LEADS_NOT_FOUND' }, { status: 404 })
    }

    const missionQuery = supabase
      .from('agent_missions')
      .select('id, offer_context, offer_input, audience_input, location_input, cta, ctas, sender_signature')
      .eq('user_id', user.id)
    const { data: activeMission } = missionId
      ? await missionQuery.eq('id', missionId).maybeSingle()
      : await missionQuery.eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()

    const { data: icp } = await supabase
      .from('agent_icp')
      .select('raw_input, structured_output')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    const offer = String(activeMission?.offer_input || icp?.raw_input || '').trim() || 'an automated lead generation solution'
    const structured = icp?.structured_output as Record<string, unknown> | null
    const angles = Array.isArray(structured?.messaging_angles)
      ? (structured.messaging_angles as string[]).filter((a) => typeof a === 'string')
      : []
    const offerContext = activeMission?.offer_context as {
      what_you_do: string; who_you_help: string; main_benefit: string; angle: string
    } | null ?? null

    // Check for existing drafts to avoid duplication
    const { data: existingDrafts } = await supabase
      .from('outreach_queue')
      .select('lead_id')
      .eq('user_id', user.id)
      .eq('review_status', 'draft')
      .in('lead_id', leadIds)

    const alreadyQueued = new Set((existingDrafts || []).map((d) => d.lead_id).filter(Boolean))

    const queueIds: string[] = []

    for (const [index, lead] of leads.entries()) {
      if (alreadyQueued.has(lead.id)) continue
      const selectedCta =
        getMissionCTA(activeMission ?? null, index) ||
        getMissionCTA({ cta: activeMission?.cta || null }, index)

      let context: LeadContext = {
        enriched: false,
        website: lead.website || '',
        company_name: lead.company_name || '',
        title: '',
        description: '',
        h1: '',
      }

      try {
        context = await enrichLeadContext({
          company_name: lead.company_name,
          website: lead.website,
        })
      } catch (contextError) {
        console.error('[prepare-outreach] context enrichment failed, using basic context:', contextError)
      }

      let draft
      try {
        draft = await generateOutreachDraft({
          company_name: lead.company_name,
          industry: lead.industry || null,
          audience_input: activeMission?.audience_input || '',
          location_input: activeMission?.location_input || lead.city || null,
          mission_cta: activeMission?.cta || null,
          selected_cta: selectedCta,
          sender_signature: activeMission?.sender_signature || null,
          offer,
          angles,
          offer_context: offerContext,
          context,
          variation_seed: index % 5,
        })
      } catch (generationError) {
        console.error('[prepare-outreach] generation failed, using fallback:', generationError)
        draft = await generateOutreachDraft({
          company_name: lead.company_name,
          industry: lead.industry || null,
          audience_input: activeMission?.audience_input || '',
          location_input: activeMission?.location_input || lead.city || null,
          mission_cta: null,
          selected_cta: selectedCta,
          sender_signature: activeMission?.sender_signature || null,
          offer,
          angles,
          offer_context: offerContext,
          context: {
            enriched: false,
            website: lead.website || '',
            company_name: lead.company_name || '',
            title: '',
            description: '',
            h1: '',
          },
          variation_seed: index % 5,
        })
      }

      const draftStyle = draft.style || 'fallback'
      const insertPayload = {
        user_id: user.id,
        lead_id: lead.id,
        source,
        mission_id: missionId ?? activeMission?.id ?? null,
        company_name: lead.company_name,
        contact_email: lead.email,
        location: lead.city,
        website: lead.website,
        subject: draft.subject,
        hook: draft.hook,
        body: draft.body,
        cta: draft.cta || null,
        cta_label: draft.cta_label,
        cta_type: draft.cta_type,
        cta_value: draft.cta_value,
        full_email: draft.full_email,
        style: draftStyle,
        personalization_score: draft.personalization_score,
        quality_score: draft.quality_score,
        context_status: context.enriched ? 'enriched' : 'basic',
        context_title: context.title || null,
        context_description: context.description || null,
        context_h1: context.h1 || null,
        status: 'ready',
        review_status: 'draft',
      }
      const { data: inserted, error: insertError } = await supabase
        .from('outreach_queue')
        .insert(insertPayload)
        .select('id')
        .single()

      if (insertError) {
        console.error('[prepare-outreach] insert error (skipped):', {
          error: insertError,
          payload: insertPayload,
        })
        continue
      }

      if (inserted?.id) {
        queueIds.push(inserted.id)
      }
    }

    return NextResponse.json({
      success: true,
      prepared: queueIds.length,
      queueIds,
    })
  } catch (error) {
    console.error('[prepare-outreach] error:', error)
    return NextResponse.json({ error: 'PREPARATION_FAILED' }, { status: 500 })
  }
}
