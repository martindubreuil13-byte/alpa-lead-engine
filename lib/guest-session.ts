import {
  FREE_TRIAL_LEAD_LIMIT,
  GUEST_CAPTURE_EMAIL_STORAGE_KEY,
  GUEST_LEADS_STORAGE_KEY,
  GUEST_LEADS_UPDATED_EVENT,
  GUEST_SESSION_STORAGE_KEY,
  type TrialLead,
} from '@/lib/trial'

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function dispatchGuestLeadUpdate() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(GUEST_LEADS_UPDATED_EVENT))
}

function buildGuestLeadKey(lead: Pick<TrialLead, 'company_name' | 'email' | 'website' | 'city'>) {
  return [
    lead.company_name.trim().toLowerCase(),
    (lead.email || '').trim().toLowerCase(),
    (lead.website || '').trim().toLowerCase(),
    (lead.city || '').trim().toLowerCase(),
  ].join('::')
}

export function getGuestSessionId() {
  if (!canUseStorage()) return null
  return window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY)
}

export function getOrCreateGuestSessionId() {
  if (!canUseStorage()) return null

  const existing = getGuestSessionId()
  if (existing) return existing

  const nextId = crypto.randomUUID()
  window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, nextId)
  return nextId
}

export function getGuestLeads(): TrialLead[] {
  if (!canUseStorage()) return []

  const raw = window.localStorage.getItem(GUEST_LEADS_STORAGE_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveGuestLeads(leads: TrialLead[]) {
  if (!canUseStorage()) return

  window.localStorage.setItem(
    GUEST_LEADS_STORAGE_KEY,
    JSON.stringify(leads.slice(0, FREE_TRIAL_LEAD_LIMIT))
  )
  dispatchGuestLeadUpdate()
}

export function upsertGuestLead(lead: TrialLead) {
  const current = getGuestLeads()
  const leadKey = buildGuestLeadKey(lead)
  const next = current.filter((item) => item.id !== lead.id && buildGuestLeadKey(item) !== leadKey)
  next.unshift(lead)
  saveGuestLeads(next)
}

export function removeGuestLead(id: string) {
  saveGuestLeads(getGuestLeads().filter((lead) => lead.id !== id))
}

export function updateGuestLead(id: string, updates: Partial<TrialLead>) {
  saveGuestLeads(
    getGuestLeads().map((lead) =>
      lead.id === id ? { ...lead, ...updates } : lead
    )
  )
}

export function clearGuestTrial() {
  if (!canUseStorage()) return

  window.localStorage.removeItem(GUEST_LEADS_STORAGE_KEY)
  window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY)
  window.localStorage.removeItem(GUEST_CAPTURE_EMAIL_STORAGE_KEY)
  dispatchGuestLeadUpdate()
}
