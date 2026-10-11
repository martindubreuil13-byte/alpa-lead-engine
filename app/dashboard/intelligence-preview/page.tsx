import { notFound } from 'next/navigation'

import MyLeadsWorkspaceClient, { type MyLeadsLead } from '../my-leads/MyLeadsWorkspaceClient'

// Local development only (like the Discover replay): any other environment, including production and previews, answers
// 404. It renders the real My Leads workspace with fictional leads in every Business Intelligence state, so the profile
// display can be reviewed without a database, a login, or any research. It performs no write and no network call.
export const dynamic = 'force-dynamic'

const base = {
  user_id: 'fixture-user', status: 'inbox', pipeline_stage: null, close_reason: null, notes: null, created_at: '2026-10-11T09:00:00Z',
  date_added: '2026-10-11T09:00:00Z', last_activity_at: '2026-10-11T09:00:00Z', outreach_attempts: 0, next_action_status: null,
  website_snapshot: null, business_signals: null, commercial_profile: null, ci_enrichment_status: 'pending', ci_started_at: null,
  ci_completed_at: null, ci_last_error: null, ci_retry_count: 0, ci_processing_duration_ms: null, ci_cost_estimate: 0, ci_model_versions: null,
}

const PROFILE = {
  summary: 'Northbridge Advisory is a London consultancy that provides supply chain consulting, process audits and inventory planning to mid-size manufacturers. Its website describes a small team working through structured reviews, written recommendations and follow-up sessions, and explains how an engagement is scoped and priced.',
  industry: 'Management consulting', primary_service: 'Supply chain consulting', target_customer: 'Mid-size manufacturers',
  core_services: ['Supply chain consulting', 'Process audits', 'Inventory planning'], keywords: ['supply chain', 'inventory', 'process audit'],
}

const lead = (n: number, name: string, extra: Record<string, unknown>) =>
  ({ ...base, id: `fixture-${n}`, company_name: name, city: 'London', industry: 'Management consultant', email: `hello@${name.split(' ')[0].toLowerCase()}.example`, phone: `020 7946 ${1000 + n}`, website: `https://www.${name.split(' ')[0].toLowerCase()}.example`, ...extra }) as unknown as MyLeadsLead

export default function IntelligencePreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  const leads: MyLeadsLead[] = [
    lead(1, 'Northbridge Advisory', { profile_state: 'ready', commercial_profile: PROFILE, ci_enrichment_status: 'completed', ci_completed_at: '2026-10-11T09:20:00Z', website_snapshot: { x: 1 }, business_signals: { y: 1 } }),
    lead(2, 'Kensington Consulting', { profile_state: 'researching' }),
    lead(3, 'Thames Partners', { profile_state: 'queued' }),
    lead(4, 'Marlowe Strategy', { profile_state: 'retry_pending' }),
    lead(5, 'Hollis Associates', { profile_state: 'failed', ci_enrichment_status: 'failed', ci_last_error: 'HTTP 500 at internal-host (never shown)' }),
    lead(6, 'Ashdown Advisory', { profile_state: 'not_started' }),
    lead(7, 'Bellamy Consulting', { profile_state: 'unavailable', website: null }),
  ]
  return <MyLeadsWorkspaceClient totalCount={leads.length} loadedCount={leads.length} initialLeads={leads} />
}
