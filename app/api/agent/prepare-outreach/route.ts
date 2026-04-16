import { NextResponse } from 'next/server'
import { z } from 'zod'

import { enrichLeadContext } from '@/lib/agent/enrich-context'
import { generateOutreachDraft } from '@/lib/agent/generate-outreach-draft'
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

    // Load active mission for offer_context (new setup flow) + ICP for angles (legacy)
    const { data: activeMission } = await supabase
      .from('agent_missions')
      .select('offer_context, offer_input')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

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
      .eq('status', 'draft')
      .in('lead_id', leadIds)

    const alreadyQueued = new Set((existingDrafts || []).map((d) => d.lead_id).filter(Boolean))

    const queueIds: string[] = []

    for (const lead of leads) {
      if (alreadyQueued.has(lead.id)) continue

      const context = await enrichLeadContext({
        company_name: lead.company_name,
        website: lead.website,
      })

      const draft = await generateOutreachDraft({
        company_name: lead.company_name,
        location: lead.city,
        offer,
        angles,
        offer_context: offerContext,
        context,
      })

      const { data: inserted, error: insertError } = await supabase
        .from('outreach_queue')
        .insert({
          user_id: user.id,
          lead_id: lead.id,
          source,
          mission_id: missionId ?? null,
          company_name: lead.company_name,
          contact_email: lead.email,
          location: lead.city,
          website: lead.website,
          subject: draft.subject,
          hook: draft.hook,
          body: draft.body,
          cta: draft.cta,
          full_email: draft.full_email,
          personalization_score: draft.personalization_score,
          quality_score: draft.quality_score,
          context_status: context.enriched ? 'enriched' : 'basic',
          context_title: context.title || null,
          context_description: context.description || null,
          context_h1: context.h1 || null,
          review_status: 'draft',
        })
        .select('id')
        .single()

      if (insertError) {
        console.error('[prepare-outreach] insert error (skipped):', insertError)
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
