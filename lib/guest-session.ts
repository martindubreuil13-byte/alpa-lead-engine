import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/guest/safe-storage'
import { safeRandomId } from '@/lib/guest/safe-id'
import {
  FREE_TRIAL_LEAD_LIMIT,
  GUEST_CAPTURE_EMAIL_STORAGE_KEY,
  GUEST_LEADS_STORAGE_KEY,
  GUEST_LEADS_UPDATED_EVENT,
  GUEST_SESSION_STORAGE_KEY,
  type TrialLead,
} from '@/lib/trial'

// Storage here is a convenience mirror of the server-held trial. It must never be able to stop a search, so every access goes
// through the guarded helpers and still works in memory when the browser blocks storage.
function canUseStorage() {
  return typeof window !== 'undefined'
}

function dispatchGuestLeadUpdate() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(GUEST_LEADS_UPDATED_EVENT))
}

function normalizeGuestPhone(phone: string | null | undefined) {
  return String(phone || '').replace(/\D/g, '')
}

function buildGuestLeadKey(lead: Pick<TrialLead, 'company_name' | 'email' | 'phone'>) {
  return [
    lead.company_name.trim().toLowerCase(),
    (lead.email || '').trim().toLowerCase(),
    normalizeGuestPhone(lead.phone),
  ].join('::')
}

export function getGuestSessionId() {
  if (!canUseStorage()) return null
  return safeGetItem('local', GUEST_SESSION_STORAGE_KEY)
}

export function getGuestCaptureEmail() {
  if (!canUseStorage()) return ''
  return safeGetItem('local', GUEST_CAPTURE_EMAIL_STORAGE_KEY) || ''
}

export function saveGuestCaptureEmail(email: string) {
  if (!canUseStorage()) return

  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail) {
    safeRemoveItem('local', GUEST_CAPTURE_EMAIL_STORAGE_KEY)
    return
  }

  safeSetItem('local', GUEST_CAPTURE_EMAIL_STORAGE_KEY, normalizedEmail)
}

export function getOrCreateGuestSessionId() {
  if (!canUseStorage()) return null

  const existing = getGuestSessionId()
  if (existing) return existing

  const nextId = safeRandomId()
  safeSetItem('local', GUEST_SESSION_STORAGE_KEY, nextId)
  return nextId
}

export function getGuestLeads(): TrialLead[] {
  if (!canUseStorage()) return []

  const raw = safeGetItem('local', GUEST_LEADS_STORAGE_KEY)
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

  safeSetItem('local', GUEST_LEADS_STORAGE_KEY, JSON.stringify(leads.slice(0, FREE_TRIAL_LEAD_LIMIT)))
  dispatchGuestLeadUpdate()
}

export function mergeGuestLeads(existingLeads: TrialLead[], incomingLeads: TrialLead[]) {
  const next = [...existingLeads]

  for (const lead of incomingLeads) {
    const leadKey = buildGuestLeadKey(lead)
    const existingIndex = next.findIndex(
      (item) => item.id === lead.id || buildGuestLeadKey(item) === leadKey
    )

    if (existingIndex >= 0) {
      next.splice(existingIndex, 1)
    }

    next.unshift(lead)
  }

  return next
}

export function upsertGuestLead(lead: TrialLead) {
  saveGuestLeads(mergeGuestLeads(getGuestLeads(), [lead]))
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

  safeRemoveItem('local', GUEST_LEADS_STORAGE_KEY)
  safeRemoveItem('local', GUEST_SESSION_STORAGE_KEY)
  safeRemoveItem('local', GUEST_CAPTURE_EMAIL_STORAGE_KEY)
  dispatchGuestLeadUpdate()
}
