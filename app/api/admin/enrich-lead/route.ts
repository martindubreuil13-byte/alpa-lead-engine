import { enrichLeadDirect } from '@/lib/commercial-intelligence/enrich-lead-direct'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    // Verify admin access
    const profile = await getUserProfile()
    if (!profile || !isAdmin(profile)) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { leadId } = await req.json()

    if (!leadId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Missing leadId',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Verify lead exists
    const supabase = await createServerClient()
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id')
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

    // Run canonical enrichment pipeline
    const result = await enrichLeadDirect(leadId)

    return new Response(
      JSON.stringify({
        ok: result.success,
        data: {
          leadId: result.leadId,
          website_snapshot: result.website_snapshot,
          business_signals: result.business_signals,
          commercial_profile: result.commercial_profile,
          ci_enrichment_status: result.ci_enrichment_status,
          ci_started_at: result.ci_started_at,
          ci_completed_at: result.ci_completed_at,
          ci_last_error: result.ci_last_error,
          ci_retry_count: result.ci_retry_count,
          ci_processing_duration_ms: result.ci_processing_duration_ms,
          ci_cost_estimate: result.ci_cost_estimate,
          ci_model_versions: result.ci_model_versions,
        },
        error: result.error,
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
