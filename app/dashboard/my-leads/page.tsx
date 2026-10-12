import { redirect } from 'next/navigation'

import MyLeadsWorkspaceClient, { type MyLeadsLead } from './MyLeadsWorkspaceClient'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { deriveLeadProfileState } from '@/lib/intelligence/run-progress'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// PHASE 0.1: My Leads is the Permanent Business Repository (ADR-001)
// This canonical selection defines the complete business entity.
// All discovered businesses live here; all other modules reference from here.
const LEAD_SELECT = 'id, user_id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, created_at, last_activity_at, status_updated_at, date_added, website_snapshot, business_signals, commercial_profile, ci_enrichment_status, ci_started_at, ci_completed_at, ci_last_error, ci_retry_count, ci_processing_duration_ms, ci_cost_estimate, ci_model_versions'

export default async function MyLeadsPage() {
  const pageStartedAt = Date.now()
  const profile = await getUserProfile()
  console.log(
  )

  if (!profile) {
    redirect('/login')
  }

  const supabase = await createServerClient()
  const userId = profile.id

  // Fetch exact count of all leads for this user (canonical source of truth)
  const countStartedAt = Date.now()
  const countResult = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  console.log(
  )

  const totalLeadCount = countResult.count ?? 0

  // Fetch leads with ordering (no limit to load all for workspace)
  const leadsStartedAt = Date.now()
  console.log(
  )
  const leadsResult = await supabase
    .from('leads')
    .select(LEAD_SELECT)
    .eq('user_id', userId)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
  const ciSummary = (leadsResult.data || []).reduce(
    (acc: Record<string, number>, lead: any) => {
      const status = lead.ci_enrichment_status || 'not_generated'
      acc[status] = (acc[status] || 0) + 1
      return acc
    },
    {}
  )
  console.log(
  )


  if (leadsResult.error) {
    console.error('[my-leads] lead fetch failed:', leadsResult.error)
  }

  // Read-only: each lead's research state comes from its stored profile and its own Discover-run job. Jobs without a
  // run id are historical and mean nothing; the `pending` column default is never read as progress.
  const jobsResult = await supabase
    .from('commercial_intelligence_queue')
    .select('lead_id, status, retry_count, last_error, run_id, created_at')
    .eq('user_id', userId)
    .not('run_id', 'is', null)
    .order('created_at', { ascending: true })
  const jobByLead = new Map<string, { status: string; retry_count: number | null; last_error: string | null; run_id: string | null }>()
  for (const job of jobsResult.data || []) jobByLead.set(job.lead_id, job) // the newest run job wins
  const leadsWithProfileState = (leadsResult.data || []).map((lead: any) => ({
    ...lead,
    profile_state: deriveLeadProfileState(lead, jobByLead.get(lead.id)),
  }))

  return (
    <MyLeadsWorkspaceClient
      totalCount={totalLeadCount}
      loadedCount={leadsResult.data?.length ?? 0}
      initialLeads={leadsWithProfileState as unknown as MyLeadsLead[]}
    />
  )
}
