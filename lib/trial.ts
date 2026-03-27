export const FREE_TRIAL_LEAD_LIMIT = 25
export const GUEST_SESSION_STORAGE_KEY = 'alpa_guest_session_id'
export const GUEST_LEADS_STORAGE_KEY = 'alpa_guest_leads'
export const GUEST_CAPTURE_EMAIL_STORAGE_KEY = 'alpa_guest_capture_email'
export const GUEST_LEADS_UPDATED_EVENT = 'alpa:guest-leads-updated'

export type TrialLead = {
  id: string
  company_name: string
  city: string | null
  industry: string | null
  email: string | null
  email_source: string | null
  email_confidence: 'high' | 'medium' | 'low' | null
  is_generic_email: boolean
  phone: string | null
  website: string | null
  status: string
  pipeline_stage: string | null
  close_reason: string | null
  source: string | null
  cost_estimate: number | null
  created_at: string
}
