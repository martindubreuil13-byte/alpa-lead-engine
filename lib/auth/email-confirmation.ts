// Email confirmation: the rules behind /auth/confirm, kept apart from the screens so they can be tested without a browser or a mail server.
//
// A confirmation email links back to /auth/confirm. The page turns that link into a session (or says plainly why it cannot), hands the
// browser's own guest trial over exactly as the login form does, and takes the customer to their workspace.
import { appRedirectUrl, classifyResetResponse, isPlausibleEmail, parseAuthLink, type AuthLink, type ResetRequestOutcome } from './password-reset.ts'

export const CONFIRM_PATH = '/auth/confirm'
export const CONTINUE_PATH = '/auth/continue'
/** Where a customer goes after confirming: the workspace, as after any sign-in. */
export const FREE_DESTINATION = '/dashboard/scraper'
/** Customers on a paid plan land on the dashboard, as they do after signing in. */
export const PAID_DESTINATION = '/dashboard'
const PAID_PLANS = ['prospector', 'starter', 'pro', 'admin']

export const confirmRedirectUrl = (input: { origin?: string | null; appUrl?: string | null; production: boolean }) => appRedirectUrl(CONFIRM_PATH, input)

/** What sign-up passes to Supabase: only where the emailed link must return to. */
export function signupOptions(input: { emailRedirectTo: string }): { emailRedirectTo: string } {
  return { emailRedirectTo: input.emailRedirectTo }
}

/** Where a signed-in customer goes next, given their plan as the server reports it. Only addresses built here are ever returned. */
export function destinationForPlan(plan: unknown): string {
  return typeof plan === 'string' && PAID_PLANS.includes(plan) ? PAID_DESTINATION : FREE_DESTINATION
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
    text: 'You opened the link somewhere other than where you signed up, so for your security please log in here to continue.',
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
