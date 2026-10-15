import { clearGuestTrialMode } from '@/lib/session/guest-trial-mode'
import { writeStoredGuestClaimResult, type StoredGuestClaimResult } from '@/lib/session/scrape-result'

// The browser's call to the existing guest-claim route, for the screens a customer can arrive at already signed in (after confirming their
// email, or opening /login while signed in). It is the same request the login form makes and it changes nothing about it: the server
// reads the trial from this browser's own signed cookie, so in a browser that never held the trial (another device) there is nothing to
// claim and nothing happens. It never claims, moves or deletes anything the server does not hold for this browser.
export async function claimGuestTrialIfNeeded(): Promise<StoredGuestClaimResult | null> {
  try {
    const res = await fetch('/api/guest/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    const data = (await res.json().catch(() => null)) as StoredGuestClaimResult | null
    if (!res.ok) return null
    const result: StoredGuestClaimResult = {
      success: true,
      imported: data?.imported ?? 0,
      skipped_invalid: data?.skipped_invalid ?? 0,
      skipped_duplicate: data?.skipped_duplicate ?? 0,
      skipped_allowance: data?.skipped_allowance ?? 0,
    }
    writeStoredGuestClaimResult(result)
    return result
  } catch {
    return null
  }
}

/** What the login form does after a successful sign-in, for a customer who is already signed in. */
export async function finishGuestHandOver() {
  await claimGuestTrialIfNeeded()
  clearGuestTrialMode()
}
