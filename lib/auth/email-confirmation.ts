// Email confirmation and the plan chosen before the account existed. Pure rules, kept apart from the screens so they can be tested.
//
// The plan choice travels WITH THE ACCOUNT (the sign-up's user metadata), not only in the browser, so it survives opening the
// confirmation email on another device. It is only a choice between two named plans, checked against an allow-list every time it is
// read. It is never a price, an entitlement or an identity: the checkout route decides all of that on the server.
import { appRedirectUrl, classifyResetResponse, isPlausibleEmail, parseAuthLink, type AuthLink, type ResetRequestOutcome } from './password-reset.ts'
import {
  checkoutStartHref,
  parseCheckoutPlan,
  parseCheckoutSource,
  safeNextPath,
  type PendingCheckout,
} from '../checkout/pending-plan.ts'

export const CONFIRM_PATH = '/auth/confirm'
export const CONTINUE_PATH = '/auth/continue'
/** Where a customer with no plan waiting goes: the free workspace. */
export const FREE_DESTINATION = '/dashboard/scraper'

export const confirmRedirectUrl = (input: { origin?: string | null; appUrl?: string | null; production: boolean }) => appRedirectUrl(CONFIRM_PATH, input)

/** What sign-up stores with the account. A plan that is not on the allow-list is not stored at all. */
export function signupOptions(input: { plan: unknown; source: unknown; emailRedirectTo: string }): { emailRedirectTo: string; data?: { pending_plan: string; pending_source: string } } {
  const plan = parseCheckoutPlan(input.plan)
  if (!plan) return { emailRedirectTo: input.emailRedirectTo }
  return { emailRedirectTo: input.emailRedirectTo, data: { pending_plan: plan, pending_source: parseCheckoutSource(input.source) } }
}

/** The plan saved with an account, if it is one of the named plans. Anything else in the metadata (it is the customer's to edit) is ignored. */
export function pendingFromUserMetadata(metadata: unknown): PendingCheckout | null {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  const plan = parseCheckoutPlan(record.pending_plan)
  return plan ? { plan, source: parseCheckoutSource(record.pending_source) } : null
}

/**
 * Where a signed-in customer goes next. In order: finishing their own payment, a plan chosen in this browser, a plan saved with the
 * account (the cross-device case), otherwise the free workspace. Only addresses built here are ever returned.
 */
export function destinationAfterConfirmation(input: { next?: string | null; browserPending: PendingCheckout | null; userMetadata: unknown }): string {
  const next = safeNextPath(input.next)
  if (next) return next
  const pending = input.browserPending ?? pendingFromUserMetadata(input.userMetadata)
  return pending ? checkoutStartHref(pending.plan, pending.source) : FREE_DESTINATION
}

/** Reads a confirmation link (the address Supabase sends the visitor back to). */
export function parseConfirmationLink(input: { search: string; hash: string }): AuthLink {
  return parseAuthLink(input, ['signup', 'email'])
}

export const CONFIRM_PROBLEMS = {
  expired: { title: 'This link has expired', text: 'Confirmation links work once and stop working after a while. If you already confirmed your email, log in. Otherwise ask for a new link below.' },
  invalid: { title: 'This link is not valid', text: 'The link may be incomplete. Ask for a new confirmation link below, or log in if you already confirmed your email.' },
  other_browser: {
    title: 'Your email is confirmed',
    text: 'You opened the link somewhere other than where you signed up, so for your security please log in here to continue. Your plan choice is saved with your account.',
  },
} as const

export const RESEND_MESSAGES = {
  sent: 'If that address is waiting to be confirmed, a new link is on its way. It can take a few minutes; check your spam folder too.',
} as const

type ResendClient = {
  auth: { resend: (params: { type: 'signup'; email: string; options: { emailRedirectTo: string } }) => Promise<{ error: { message?: string; code?: string; status?: number; name?: string } | null }> }
}

/** Sends a new confirmation link. Answers like the password reset does: the same words whether or not the address is waiting. */
export async function requestConfirmationResend(client: ResendClient, rawEmail: string, emailRedirectTo: string): Promise<ResetRequestOutcome> {
  const email = rawEmail.trim()
  if (!isPlausibleEmail(email)) return { kind: 'invalid_email' }
  try {
    const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo } })
    return classifyResetResponse(error)
  } catch (error) {
    return classifyResetResponse(error as { message?: string; code?: string; status?: number; name?: string })
  }
}
