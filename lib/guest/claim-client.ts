import { clearGuestTrialMode } from '@/lib/session/guest-trial-mode'
import { writeStoredGuestClaimResult, type StoredGuestClaimResult } from '@/lib/session/scrape-result'

export const GUEST_IMPORT_RETRY_MESSAGE = 'Your account is ready, but we could not confirm that your guest businesses were saved. Your trial has not been cleared. Please retry the import before continuing.'

export class GuestImportError extends Error {
  constructor() { super(GUEST_IMPORT_RETRY_MESSAGE); this.name = 'GuestImportError' }
}

// Only the server's signed trial cookie selects what is imported. No browser business payload is sent.
export async function claimGuestTrialIfNeeded(): Promise<StoredGuestClaimResult | null> {
  let res: Response
  try {
    res = await fetch('/api/guest/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  } catch { throw new GuestImportError() }
  const data = await res.json().catch(() => null)
  // A fresh device has no trial to import. An expired trial, auth failure or unavailable RPC is NOT success.
  if (res.status === 401 && data?.error === 'No guest session') return null
  const counters = ['imported', 'skipped_invalid', 'skipped_duplicate', 'skipped_allowance'] as const
  if (!res.ok || data?.success !== true || counters.some(key => !Number.isSafeInteger(data[key]) || data[key] < 0)) {
    throw new GuestImportError()
  }
  const result: StoredGuestClaimResult = {
    success: true,
    imported: data.imported,
    skipped_invalid: data.skipped_invalid,
    skipped_duplicate: data.skipped_duplicate,
    skipped_allowance: data.skipped_allowance,
  }
  writeStoredGuestClaimResult(result)
  return result
}

/** Clear guest mode only after a confirmed import or an explicit absence of a guest session. */
export async function finishGuestHandOver() {
  const result = await claimGuestTrialIfNeeded()
  clearGuestTrialMode()
  return result
}
