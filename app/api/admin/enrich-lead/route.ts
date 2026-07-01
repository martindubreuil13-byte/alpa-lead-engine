import { createServerClient } from '@/lib/supabase/server'
import { enrichLeadCommercialIntelligence } from '@/lib/commercial-intelligence/enrich-lead'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export async function POST(req: Request) {
  try {
    // Verify admin access
    const profile = await getUserProfile()
    if (!profile || !isAdmin(profile)) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { leadId, forceRefresh } = await req.json()

    if (!leadId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Missing leadId',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = await createServerClient()

    // Fetch lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, user_id, website, company_name, ci_enrichment_status')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Lead not found',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Check if already enriched
    if (
      lead.ci_enrichment_status === 'completed' &&
      !forceRefresh
    ) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Lead already enriched. Use forceRefresh: true to re-enrich.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Reset status if force refreshing
    if (forceRefresh) {
      await supabase
        .from('leads')
        .update({
          ci_enrichment_status: 'pending',
          ci_enriched_at: null,
          ci_last_error: null,
        })
        .eq('id', leadId)
    }

    // Create or fetch job
    let job = null
    if (forceRefresh) {
      // Delete old job if force refreshing
      await supabase
        .from('commercial_intelligence_jobs')
        .delete()
        .eq('lead_id', leadId)
        .eq('status', 'completed')
    }

    const { data: existingJob } = await supabase
      .from('commercial_intelligence_jobs')
      .select('*')
      .eq('lead_id', leadId)
      .in('status', ['pending', 'processing'])
      .single()

    if (existingJob) {
      job = existingJob
    } else {
      // Create new job
      const { data: newJob, error: jobError } = await supabase
        .from('commercial_intelligence_jobs')
        .insert({
          user_id: profile.id,
          lead_id: leadId,
          status: 'pending',
        })
        .select()
        .single()

      if (jobError) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Failed to create enrichment job',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }

      job = newJob
    }

    // Enrich synchronously for admin testing
    const result = await enrichLeadCommercialIntelligence(job)

    return new Response(
      JSON.stringify({
        ok: result.success,
        leadId: result.leadId,
        data: result.data,
        error: result.error,
        processingDurationMs: result.processingDurationMs,
        cost: result.cost,
      }),
      { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Enrichment error:', err)
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
