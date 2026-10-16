import { destinationForPlan } from '@/lib/auth/email-confirmation'
import { finishGuestHandOver, type ClaimStatus } from '@/lib/guest/claim-client'
import { supabase } from '@/lib/supabase'

/** Whether anyone is signed in in this browser. */
export async function isSignedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session?.user)
}

/** Hands this browser's own guest trial over (nothing happens in a browser that never held one). */
export const handOverGuestTrial = (): Promise<ClaimStatus> => finishGuestHandOver()

/** Where a signed-in customer goes next: the dashboard for a paid plan, the workspace otherwise (as after the login form). */
export async function destinationForSignedInCustomer(): Promise<string> {
  try {
    const response = await fetch('/api/auth/subscription', { cache: 'no-store' })
    const payload = response.ok ? await response.json().catch(() => null) : null
    return destinationForPlan(payload?.subscription?.plan)
  } catch {
    return destinationForPlan(null)
  }
}
