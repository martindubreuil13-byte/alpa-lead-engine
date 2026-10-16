import { clearGuestTrialMode } from '@/lib/session/guest-trial-mode'
import { writeStoredGuestClaimResult, type StoredGuestClaimResult } from '@/lib/session/scrape-result'

// The browser's call to the existing guest-claim route, for the screens a customer can arrive at already signed in (after confirming their
// email, or opening /login while signed in). It is the same request the login form makes and it changes nothing about it: the server
// reads the trial from this browser's own signed cookie, so in a browser that never held the trial (another device) there is nothing to
// claim and nothing happens.
//
// "failed" is different from "nothing to claim": the customer's free businesses are still waiting, so nothing is cleared and the screen
// offers a retry.
export type ClaimStatus = 'imported' | 'nothing' | 'failed'

export async function claimGuestTrial(): Promise<ClaimStatus> {
  try {
    const res = await fetch('/api/guest/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    // No trial in this browser, or it expired: there is nothing to bring over.
    if (res.status === 401 || res.status === 410) return 'nothing'
    const data = (await res.json().catch(() => null)) as StoredGuestClaimResult | null
    if (!res.ok) return 'failed'
    const result: StoredGuestClaimResult = {
      success: true,
      imported: data?.imported ?? 0,
      skipped_invalid: data?.skipped_invalid ?? 0,
      skipped_duplicate: data?.skipped_duplicate ?? 0,
      skipped_allowance: data?.skipped_allowance ?? 0,
    }
    writeStoredGuestClaimResult(result)
    return result.imported > 0 || result.skipped_duplicate > 0 ? 'imported' : 'nothing'
  } catch {
    return 'failed'
  }
}

/** What the login form does after a successful sign-in, for a customer who is already signed in. Guest state is cleared only when the hand-over did not fail. */
export async function finishGuestHandOver(): Promise<ClaimStatus> {
  const status = await claimGuestTrial()
  if (status !== 'failed') clearGuestTrialMode()
  return status
}
