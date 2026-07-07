import { redirect } from 'next/navigation'

import MyLeadsWorkspaceClient, {
  type MyLeadsCampaignSignal,
  type MyLeadsLead,
} from './MyLeadsWorkspaceClient'
import CommercialIntelligenceStatus from './CommercialIntelligenceStatus'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// CANONICAL LEAD SELECTION
// Matches Lead Library exactly to ensure consistent totals across ALPA
const LEAD_SELECT = 'id, user_id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, created_at, last_activity_at, status_updated_at, date_added, website_snapshot, business_signals, commercial_profile, ci_enrichment_status, ci_started_at, ci_completed_at, ci_last_error, ci_retry_count, ci_processing_duration_ms, ci_cost_estimate, ci_model_versions'

export default async function MyLeadsPage() {
  const pageStartedAt = Date.now()
  console.log('[CI-TRACE] STEP 9 BEFORE MyLeadsPage.getUserProfile')
  const profile = await getUserProfile()
  console.log(
    `[CI-TRACE] STEP 9 AFTER MyLeadsPage.getUserProfile has_profile=${Boolean(profile)} elapsed_ms=${Date.now() - pageStartedAt}`
  )

  if (!profile || !isAdmin(profile)) {
    console.log('[CI-TRACE] STEP 9 EARLY_RETURN MyLeadsPage reason=not_admin_or_missing_profile')
    redirect('/dashboard/leads')
  }

  console.log('[CI-TRACE] STEP 9 BEFORE MyLeadsPage.createServerClient')
  const supabase = await createServerClient()
  console.log(`[CI-TRACE] STEP 9 AFTER MyLeadsPage.createServerClient elapsed_ms=${Date.now() - pageStartedAt}`)
  const userId = profile.id

  // Fetch exact count of all leads for this user (canonical source of truth)
  const countStartedAt = Date.now()
  console.log(`[CI-TRACE] STEP 9 BEFORE MyLeadsPage.lead_count user_id=${userId}`)
  const countResult = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  console.log(
    `[CI-TRACE] STEP 9 AFTER MyLeadsPage.lead_count user_id=${userId} count=${countResult.count ?? 'N/A'} has_error=${Boolean(countResult.error)} elapsed_ms=${Date.now() - countStartedAt}`
  )

  const totalLeadCount = countResult.count ?? 0

  // Fetch leads with ordering (no limit to load all for workspace)
  const leadsStartedAt = Date.now()
  console.log(
    `[CI-TRACE] STEP 9 BEFORE MyLeadsPage.leads_query user_id=${userId} select_includes_ci=${LEAD_SELECT.includes('commercial_profile') && LEAD_SELECT.includes('ci_enrichment_status')}`
  )
  const [leadsResult, campaignResult] = await Promise.all([
    supabase
      .from('leads')
      .select(LEAD_SELECT)
      .eq('user_id', userId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('outreach_queue')
      .select('lead_id, review_status, status')
      .eq('user_id', userId)
      .not('lead_id', 'is', null)
      .in('review_status', ['draft', 'approved']),
  ])
  const ciSummary = (leadsResult.data || []).reduce(
    (acc: Record<string, number>, lead: any) => {
      const status = lead.ci_enrichment_status || 'not_generated'
      acc[status] = (acc[status] || 0) + 1
      return acc
    },
    {}
  )
  console.log(
    `[CI-TRACE] STEP 9 AFTER MyLeadsPage.leads_query user_id=${userId} loaded=${leadsResult.data?.length || 0} has_error=${Boolean(leadsResult.error)} ci_summary=${JSON.stringify(ciSummary)} sample=${JSON.stringify((leadsResult.data || []).slice(0, 5).map((lead: any) => ({ lead_id: lead.id, status: lead.ci_enrichment_status || 'not_generated', has_profile: Boolean(lead.commercial_profile), completed_at: lead.ci_completed_at || null })))} elapsed_ms=${Date.now() - leadsStartedAt}`
  )


  if (leadsResult.error) {
    console.error('[CI-TRACE] STEP 9 ERROR MyLeadsPage.leads_query failed', leadsResult.error, (leadsResult.error as any)?.stack)
    console.error('[my-leads] lead fetch failed:', leadsResult.error)
  }

  if (campaignResult.error) {
    console.error('[CI-TRACE] STEP 9 ERROR MyLeadsPage.campaign_query failed', campaignResult.error, (campaignResult.error as any)?.stack)
    console.error('[my-leads] campaign signal fetch failed:', campaignResult.error)
  }

  return (
    <>
      <CommercialIntelligenceStatus />
      <MyLeadsWorkspaceClient
        totalCount={totalLeadCount}
        loadedCount={leadsResult.data?.length ?? 0}
        initialLeads={(leadsResult.data || []) as unknown as MyLeadsLead[]}
        campaignSignals={(campaignResult.data || []) as unknown as MyLeadsCampaignSignal[]}
      />
    </>
  )
}
