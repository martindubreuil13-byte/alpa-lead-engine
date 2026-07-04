import { redirect } from 'next/navigation'

import MyLeadsWorkspaceClient, {
  type MyLeadsCampaignSignal,
  type MyLeadsLead,
} from './MyLeadsWorkspaceClient'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// CANONICAL LEAD SELECTION
// Matches Lead Library exactly to ensure consistent totals across ALPA
const LEAD_SELECT = 'id, user_id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, created_at, last_activity_at, status_updated_at, date_added, website_snapshot, business_signals, commercial_profile, ci_enrichment_status, ci_started_at, ci_completed_at, ci_last_error, ci_retry_count, ci_processing_duration_ms, ci_cost_estimate, ci_model_versions'

export default async function MyLeadsPage() {
  const profile = await getUserProfile()

  if (!profile || !isAdmin(profile)) {
    redirect('/dashboard/leads')
  }

  const supabase = await createServerClient()
  const userId = profile.id

  // Fetch exact count of all leads for this user (canonical source of truth)
  const countResult = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  const totalLeadCount = countResult.count ?? 0

  // Fetch leads with ordering (no limit to load all for workspace)
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

  if (leadsResult.error) {
    console.error('[my-leads] lead fetch failed:', leadsResult.error)
  }

  if (campaignResult.error) {
    console.error('[my-leads] campaign signal fetch failed:', campaignResult.error)
  }

  return (
    <MyLeadsWorkspaceClient
      totalCount={totalLeadCount}
      loadedCount={leadsResult.data?.length ?? 0}
      initialLeads={(leadsResult.data || []) as unknown as MyLeadsLead[]}
      campaignSignals={(campaignResult.data || []) as unknown as MyLeadsCampaignSignal[]}
    />
  )
}
