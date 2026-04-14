import type { Database } from '@/lib/supabase/types'
import type { TrialLead } from '@/lib/trial'

type MissionQueueLeadRow = Pick<
  Database['public']['Tables']['agent_lead_queue']['Row'],
  | 'id'
  | 'user_id'
  | 'mission_id'
  | 'business_name'
  | 'website'
  | 'email'
  | 'phone'
  | 'location'
  | 'qualification_status'
  | 'created_at'
>

export type MissionInboxLead = TrialLead & {
  user_id: string
  mission_id: string
  qualification_status: string
  queue_source: 'agent_mission'
}

function normalizeOptionalText(value: string | null) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function mapQualificationStatusToInboxStatus(qualificationStatus: string | null | undefined) {
  const normalized = String(qualificationStatus || '').trim().toLowerCase()

  if (normalized === 'contacted') {
    return 'contacted'
  }

  if (normalized === 'pipeline' || normalized === 'in_pipeline') {
    return 'pipeline'
  }

  return 'inbox'
}

export function mapMissionQueueRowToInboxLead(row: MissionQueueLeadRow): MissionInboxLead {
  return {
    id: row.id,
    user_id: row.user_id,
    mission_id: row.mission_id,
    qualification_status: row.qualification_status,
    company_name: normalizeOptionalText(row.business_name) || 'Untitled business',
    city: normalizeOptionalText(row.location),
    industry: null,
    email: normalizeOptionalText(row.email),
    email_source: 'agent mission',
    is_generic_email: false,
    phone: normalizeOptionalText(row.phone),
    website: normalizeOptionalText(row.website),
    status: mapQualificationStatusToInboxStatus(row.qualification_status),
    pipeline_stage: null,
    close_reason: null,
    source: 'agent_mission',
    cost_estimate: null,
    created_at: row.created_at,
    queue_source: 'agent_mission',
  }
}

export function mapMissionQueueRowsToInboxLeads(rows: MissionQueueLeadRow[]) {
  return rows.map(mapMissionQueueRowToInboxLead)
}
