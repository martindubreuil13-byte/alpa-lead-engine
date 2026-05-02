import {
  OVERDUE_DAYS,
  getDaysSince,
  getPipelineLifecycleStatus,
  type Lead,
  type PipelineStage,
} from '@/lib/pipeline/lifecycle'

export type PipelineSortMode =
  | 'recent_activity'
  | 'recently_added'
  | 'needs_attention'
  | 'oldest_waiting'
  | 'az'

const SEARCH_FIELDS: Array<keyof Pick<Lead, 'company_name' | 'city' | 'email' | 'website'>> = [
  'company_name',
  'city',
  'email',
  'website',
]

function parseTime(value: string | null | undefined) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function getLeadActivityTime(lead: Lead) {
  return Math.max(
    parseTime(lead.last_activity_at),
    parseTime(lead.last_contact_at),
    parseTime(lead.status_updated_at),
    parseTime(lead.updated_at),
    parseTime(lead.followup_sent_at),
    parseTime(lead.final_attempt_sent_at),
    parseTime(lead.closed_at),
    parseTime(lead.created_at),
    parseTime(lead.date_added)
  )
}

function getLeadCreatedTime(lead: Lead) {
  return Math.max(parseTime(lead.created_at), parseTime(lead.date_added))
}

function getFollowupDueTime(lead: Lead) {
  return parseTime(lead.followup_due_at) || parseTime(lead.first_contact_at)
}

function compareStrings(a: string | null | undefined, b: string | null | undefined) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' })
}

function tieBreakByCompany(a: Lead, b: Lead) {
  return compareStrings(a.company_name, b.company_name)
}

export function filterPipelineLeads(leads: Lead[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return leads

  return leads.filter((lead) =>
    SEARCH_FIELDS.some((field) => String(lead[field] || '').toLowerCase().includes(normalizedQuery))
  )
}

export function sortPipelineLeads(leads: Lead[], mode: PipelineSortMode) {
  return [...leads].sort((a, b) => comparePipelineLeads(a, b, mode))
}

export function comparePipelineLeads(a: Lead, b: Lead, mode: PipelineSortMode) {
  if (mode === 'az') return tieBreakByCompany(a, b)

  if (mode === 'recently_added') {
    return getLeadCreatedTime(b) - getLeadCreatedTime(a) || tieBreakByCompany(a, b)
  }

  if (mode === 'oldest_waiting') {
    const aWaiting = getPipelineLifecycleStatus(a) === 'contacted' ? 0 : 1
    const bWaiting = getPipelineLifecycleStatus(b) === 'contacted' ? 0 : 1
    return (
      aWaiting - bWaiting ||
      parseTime(a.first_contact_at) - parseTime(b.first_contact_at) ||
      getLeadActivityTime(a) - getLeadActivityTime(b) ||
      tieBreakByCompany(a, b)
    )
  }

  if (mode === 'needs_attention') {
    return compareNeedsAttention(a, b)
  }

  return getLeadActivityTime(b) - getLeadActivityTime(a) || tieBreakByCompany(a, b)
}

function compareNeedsAttention(a: Lead, b: Lead) {
  const aStage = getPipelineLifecycleStatus(a)
  const bStage = getPipelineLifecycleStatus(b)
  const aReady = aStage === 'ready_followup' ? 0 : 1
  const bReady = bStage === 'ready_followup' ? 0 : 1
  const aOverdue = isOverdueFollowup(a, aStage) ? 0 : 1
  const bOverdue = isOverdueFollowup(b, bStage) ? 0 : 1

  return (
    aReady - bReady ||
    aOverdue - bOverdue ||
    getFollowupDueTime(a) - getFollowupDueTime(b) ||
    getLeadActivityTime(b) - getLeadActivityTime(a) ||
    tieBreakByCompany(a, b)
  )
}

function isOverdueFollowup(lead: Lead, stage: PipelineStage) {
  if (stage !== 'ready_followup') return false
  return (getDaysSince(lead.first_contact_at) ?? 0) >= OVERDUE_DAYS
}

