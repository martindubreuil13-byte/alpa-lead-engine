export type Lead = {
  id: string
  company_name: string
  city: string | null
  industry: string | null
  email: string | null
  phone: string | null
  website?: string | null
  notes?: string | null
  status: string
  pipeline_stage?: string | null
  close_reason?: string | null
  first_contact_at?: string | null
  followup_due_at?: string | null
  followup_sent_at?: string | null
  final_attempt_sent_at?: string | null
  last_contact_at?: string | null
  outreach_attempts?: number | null
  next_action_status?: string | null
  closed_at?: string | null
  created_at?: string | null
  date_added?: string | null
  updated_at?: string | null
  status_updated_at?: string | null
  last_activity_at?: string | null
}

export type PipelineStage = 'ready' | 'contacted' | 'ready_followup' | 'final_attempt' | 'closed'
export type SendMode = 'initial' | 'followup'
export type UrgencyTone = 'new' | 'waiting' | 'ready' | 'overdue' | 'final' | 'closed'
export type LegacyLeadStatus = 'inbox' | 'contacted' | 'followup_due' | 'followup_sent' | 'closed_no_response'

export const FOLLOWUP_WAIT_DAYS = 5
export const OVERDUE_DAYS = 8

export const STAGES: Array<{ key: PipelineStage; title: string; shortTitle: string; description: string }> = [
  { key: 'ready', title: 'New / Ready', shortTitle: 'New', description: 'Fresh leads ready for first outreach.' },
  { key: 'contacted', title: 'Contacted / Waiting', shortTitle: 'Waiting', description: 'Recently contacted leads still inside the wait window.' },
  { key: 'ready_followup', title: 'Ready for Follow-up', shortTitle: 'Follow-up', description: 'Leads at day five or later without a follow-up.' },
  { key: 'final_attempt', title: 'Final Attempt', shortTitle: 'Final', description: 'Follow-up sent. Watch for a reply or close the loop.' },
  { key: 'closed', title: 'Closed', shortTitle: 'Closed', description: 'Completed opportunities and disqualified leads.' },
]

export const ACTIVE_PIPELINE_STAGES = STAGES.filter((stage) => stage.key !== 'closed')

export function getLegacyStatusForPipelineStage(stage: PipelineStage): LegacyLeadStatus {
  if (stage === 'ready') return 'inbox'
  if (stage === 'contacted') return 'contacted'
  if (stage === 'ready_followup') return 'followup_due'
  if (stage === 'final_attempt') return 'followup_sent'
  return 'closed_no_response'
}

export function addDaysIso(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString()
}

export function getDaysSince(date: string | null | undefined) {
  if (!date) return null
  const timestamp = new Date(date).getTime()
  if (Number.isNaN(timestamp)) return null

  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000))
}

export function normalizeBaseStage(lead: Lead): Exclude<PipelineStage, 'ready_followup'> {
  if (lead.pipeline_stage === 'closed' || ['closed_no_response', 'no_response', 'rejected', 'invalid'].includes(lead.status)) return 'closed'
  if (lead.pipeline_stage === 'final_attempt' || lead.status === 'followup_sent' || lead.followup_sent_at || lead.next_action_status === 'final_attempt_sent') {
    return 'final_attempt'
  }
  if (
    lead.pipeline_stage === 'contacted' ||
    lead.pipeline_stage === 'followup' ||
    lead.pipeline_stage === 'ready_followup' ||
    lead.first_contact_at ||
    lead.status === 'contacted' ||
    lead.status === 'followup_due'
  ) {
    return 'contacted'
  }
  return 'ready'
}

export function isReadyForFollowup(lead: Lead) {
  if (lead.followup_sent_at || lead.final_attempt_sent_at || normalizeBaseStage(lead) === 'closed') {
    return false
  }

  const dueAt = lead.followup_due_at ? new Date(lead.followup_due_at).getTime() : Number.NaN

  if (!Number.isNaN(dueAt)) {
    return dueAt <= Date.now()
  }

  const days = getDaysSince(lead.first_contact_at)
  return days !== null && days >= FOLLOWUP_WAIT_DAYS
}

export function canSendFollowup(lead: Lead) {
  const baseStage = normalizeBaseStage(lead)
  return baseStage === 'contacted' || baseStage === 'final_attempt'
}

export function getPipelineLifecycleStatus(lead: Lead): PipelineStage {
  const baseStage = normalizeBaseStage(lead)
  if (baseStage === 'contacted' && isReadyForFollowup(lead)) return 'ready_followup'
  return baseStage
}

export function getNextActionLabel(lead: Lead) {
  const stage = getPipelineLifecycleStatus(lead)
  const days = getDaysSince(lead.first_contact_at)

  if (stage === 'closed') return 'Closed'
  if (stage === 'ready') return 'New'
  if (stage === 'ready_followup') return 'Follow-up Ready'
  if (stage === 'final_attempt') return 'Final Sent'
  if (days !== null) return `Day ${days}`
  return 'Contacted'
}

export function getLibraryLifecycleLabel(lead: Lead) {
  const stage = getPipelineLifecycleStatus(lead)

  if (stage === 'closed') return 'Closed'
  if (stage === 'ready') return 'New'
  if (stage === 'contacted') return 'Contacted'
  if (stage === 'ready_followup') return 'Ready for Follow-up'
  return 'Final Attempt'
}

export function getDrawerNextActionLabel(lead: Lead) {
  const stage = getPipelineLifecycleStatus(lead)
  const days = getDaysSince(lead.first_contact_at)

  if (stage === 'closed') return 'Closed'
  if (stage === 'ready') return 'Send initial outreach'
  if (stage === 'ready_followup') return 'Ready for follow-up'
  if (stage === 'final_attempt') return 'Final attempt sent'
  if (days !== null) return `Waiting for follow-up · Day ${days}`
  return 'Waiting for follow-up'
}

export function getUrgencyTone(lead: Lead): UrgencyTone {
  const stage = getPipelineLifecycleStatus(lead)
  const days = getDaysSince(lead.first_contact_at)

  if (stage === 'closed') return 'closed'
  if (stage === 'final_attempt') return 'final'
  if (stage === 'ready_followup' && (days ?? 0) >= OVERDUE_DAYS) return 'overdue'
  if (stage === 'ready_followup') return 'ready'
  if (stage === 'contacted') return 'waiting'
  return 'new'
}

export function formatDate(date: string | null | undefined) {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null

  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parsed)
}

export function normalizeUrl(url: string | null | undefined) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
