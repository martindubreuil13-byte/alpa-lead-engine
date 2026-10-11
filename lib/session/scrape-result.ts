import type { TrialLead } from '@/lib/trial'

const SCRAPE_RESULT_STORAGE_KEY = 'alpa_latest_scrape_result'
const INBOX_FOCUS_STORAGE_KEY = 'alpa_focus_inbox'
const GUEST_CLAIM_RESULT_STORAGE_KEY = 'alpa_guest_claim_result'

export type StoredScrapeResult = {
  totalFoundLeads: number
  savedLeads: number
  latestSavedLeads: TrialLead[]
  /** The Discover run whose Business Intelligence this page follows (B2 Phase 1). Absent when research is not authorized. */
  researchRunId?: string | null
}

export type StoredGuestClaimResult = {
  success: true
  imported: number
  skipped_invalid: number
  skipped_duplicate: number
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function readStoredScrapeResult(): StoredScrapeResult | null {
  if (!canUseStorage()) return null

  const raw = window.sessionStorage.getItem(SCRAPE_RESULT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredScrapeResult>
    if (
      typeof parsed.totalFoundLeads === 'number' &&
      typeof parsed.savedLeads === 'number' &&
      Array.isArray(parsed.latestSavedLeads)
    ) {
      return {
        totalFoundLeads: parsed.totalFoundLeads,
        savedLeads: parsed.savedLeads,
        latestSavedLeads: parsed.latestSavedLeads as TrialLead[],
        researchRunId: typeof parsed.researchRunId === 'string' ? parsed.researchRunId : null,
      }
    }
  } catch {}

  return null
}

export function writeStoredScrapeResult(result: StoredScrapeResult) {
  if (!canUseStorage()) return
  window.sessionStorage.setItem(SCRAPE_RESULT_STORAGE_KEY, JSON.stringify(result))
}

/** Remembers which run to follow, so a refresh or a return visit resumes progress from the server. */
export function rememberResearchRun(runId: string | null) {
  const stored = readStoredScrapeResult()
  if (stored) writeStoredScrapeResult({ ...stored, researchRunId: runId })
}

export function readStoredGuestClaimResult(): StoredGuestClaimResult | null {
  if (!canUseStorage()) return null

  const raw = window.sessionStorage.getItem(GUEST_CLAIM_RESULT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredGuestClaimResult>
    if (
      parsed.success === true &&
      typeof parsed.imported === 'number' &&
      typeof parsed.skipped_invalid === 'number' &&
      typeof parsed.skipped_duplicate === 'number'
    ) {
      return {
        success: true,
        imported: parsed.imported,
        skipped_invalid: parsed.skipped_invalid,
        skipped_duplicate: parsed.skipped_duplicate,
      }
    }
  } catch {}

  return null
}

export function writeStoredGuestClaimResult(result: StoredGuestClaimResult) {
  if (!canUseStorage()) return
  window.sessionStorage.setItem(GUEST_CLAIM_RESULT_STORAGE_KEY, JSON.stringify(result))
}

export function clearStoredGuestClaimResult() {
  if (!canUseStorage()) return
  window.sessionStorage.removeItem(GUEST_CLAIM_RESULT_STORAGE_KEY)
}

export function clearStoredScrapeResult() {
  if (!canUseStorage()) return
  window.sessionStorage.removeItem(SCRAPE_RESULT_STORAGE_KEY)
  window.sessionStorage.removeItem(INBOX_FOCUS_STORAGE_KEY)
}

export function requestInboxFocus() {
  if (!canUseStorage()) return
  window.sessionStorage.setItem(INBOX_FOCUS_STORAGE_KEY, '1')
}

export function consumeInboxFocusRequest() {
  if (!canUseStorage()) return false
  const shouldFocus = window.sessionStorage.getItem(INBOX_FOCUS_STORAGE_KEY) === '1'
  if (shouldFocus) {
    window.sessionStorage.removeItem(INBOX_FOCUS_STORAGE_KEY)
  }
  return shouldFocus
}
