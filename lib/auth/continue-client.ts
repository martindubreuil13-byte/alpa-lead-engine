import { destinationAfterConfirmation } from '@/lib/auth/email-confirmation'
import { readPendingCheckout } from '@/lib/checkout/pending-plan'
import { finishGuestHandOver } from '@/lib/guest/claim-client'
import { supabase } from '@/lib/supabase'

/**
 * For a customer who is signed in and needs to be taken on: hands over this browser's own guest trial exactly as the login form does
 * (nothing happens in a browser that never held one), then returns where they should go. Null when nobody is signed in.
 */
export async function destinationForSignedInCustomer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session?.user) return null
  await finishGuestHandOver()
  let browserPending = null
  try { browserPending = readPendingCheckout(window.localStorage) } catch { browserPending = null }
  return destinationAfterConfirmation({ next: null, browserPending, userMetadata: session.user.user_metadata })
}
