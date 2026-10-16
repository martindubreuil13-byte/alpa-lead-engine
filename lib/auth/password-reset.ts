// Password reset: the rules, kept apart from the screens so they can be tested without a browser or a mail server.
//
// How it works. The visitor asks for a link (resetPasswordForEmail); Supabase emails a one-time link that returns to /auth/reset. The
// page turns that link into a temporary session (or explains why it cannot), the visitor chooses a new password (updateUser), and
// other sessions are signed out. Nothing here ever tells the visitor whether an email address has an account.

export const RESET_PATH = '/auth/reset'
/** The only origin a reset link may return to when the app is not told otherwise. */
export const CANONICAL_ORIGIN = 'https://alpa.mindrasolutions.com'
export const MIN_PASSWORD_LENGTH = 8
/** Supabase hashes at most 72 characters of a password. */
export const MAX_PASSWORD_LENGTH = 72
export const RESEND_COOLDOWN_SECONDS = 60
export const SUPPORT_EMAIL = 'info@mindrasolutions.com'

const originOf = (value: string | undefined | null) => {
  try { return value ? new URL(value).origin : null } catch { return null }
}
const isLocal = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

/**
 * Where the emailed link must return to. Only an allow-listed origin is ever used: the production site, the origin the app is configured
 * with, or localhost outside production. Any other origin (a preview address, a look-alike host, a script) falls back to the production
 * site. Supabase enforces its own redirect allow-list on top of this; the exact address must be listed there.
 */
export function resetRedirectUrl(input: { origin?: string | null; appUrl?: string | null; production: boolean }): string {
  return appRedirectUrl(RESET_PATH, input)
}

/** The same allow-list for any page an email link returns to (password reset, email confirmation). The path is always one of ours. */
export function appRedirectUrl(path: string, input: { origin?: string | null; appUrl?: string | null; production: boolean }): string {
  const allowed = new Set<string>([CANONICAL_ORIGIN])
  const configured = originOf(input.appUrl)
  if (configured && (configured.startsWith('https://') || (!input.production && isLocal(configured)))) allowed.add(configured)
  const origin = originOf(input.origin)
  const chosen = origin && (allowed.has(origin) || (!input.production && isLocal(origin))) ? origin : configured && allowed.has(configured) ? configured : CANONICAL_ORIGIN
  return `${chosen}${path}`
}

// ---- asking for a link -------------------------------------------------------------------------------------------------------------
type AuthErrorLike = { message?: string; code?: string; status?: number; name?: string } | null | undefined

export type ResetRequestOutcome =
  /** The same answer whether or not the address has an account. */
  | { kind: 'sent' }
  /** The mail system is at its limit. Says nothing about any account, so it can be stated plainly. */
  | { kind: 'rate_limited' }
  | { kind: 'invalid_email' }
  | { kind: 'unavailable' }

export const isPlausibleEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)

const isNetworkError = (error: AuthErrorLike) =>
  Boolean(error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || (error.status === undefined && /fetch|network|failed to/i.test(error.message ?? ''))))

/**
 * Turns Supabase's answer into one of four outcomes, chosen so that none of them depends on whether an account exists:
 * - success, and every failure that could only happen for an existing account (a per-address "wait 60 seconds", a failed send), are "sent";
 * - the project-wide email limit and request limit are "rate_limited": they hit everyone alike.
 */
export function classifyResetResponse(error: AuthErrorLike): ResetRequestOutcome {
  if (!error) return { kind: 'sent' }
  const message = error.message ?? ''
  if (isNetworkError(error)) return { kind: 'unavailable' }
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
    // "For security purposes, you can only request this after N seconds": per address, so it is answered like a success.
    if (/after \d+ seconds|security purposes/i.test(message)) return { kind: 'sent' }
    return { kind: 'rate_limited' }
  }
  if (error.code === 'over_request_rate_limit') return { kind: 'rate_limited' }
  if (error.code === 'validation_failed' || error.code === 'email_address_invalid' || ((error.status === 400 || error.status === 422) && /email/i.test(message))) return { kind: 'invalid_email' }
  // A failure to send the email only happens for an address that has an account, so it is answered like a success (and should be
  // watched in the Supabase auth logs): showing it would reveal which addresses are registered.
  if (typeof error.status === 'number' && error.status >= 500) return { kind: 'sent' }
  return { kind: 'unavailable' }
}

export const MESSAGES = {
  sent: 'If an account exists for that email, a reset link is on its way. It can take a few minutes; check your spam folder too. The link works once and expires after an hour.',
  rateLimited: `We can't send more emails right now. Please try again in a few minutes, or contact ${SUPPORT_EMAIL}.`,
  invalidEmail: 'Enter a valid email address.',
  unavailable: 'We could not reach the service. Check your connection and try again.',
} as const

type ResetClient = { auth: { resetPasswordForEmail: (email: string, options: { redirectTo: string }) => Promise<{ error: AuthErrorLike }> } }

/** The one place a reset email is requested: trims the address, uses only the allow-listed return address, and never reports whether the account exists. */
export async function requestPasswordReset(client: ResetClient, rawEmail: string, redirectTo: string): Promise<ResetRequestOutcome> {
  const email = rawEmail.trim()
  if (!isPlausibleEmail(email)) return { kind: 'invalid_email' }
  try {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
    return classifyResetResponse(error)
  } catch (error) {
    return classifyResetResponse(error as AuthErrorLike)
  }
}

// ---- coming back from the email --------------------------------------------------------------------------------------------------
export type RecoveryLink =
  | { kind: 'code'; code: string }
  | { kind: 'token_hash'; tokenHash: string }
  /** Tokens in the address fragment; the Supabase client reads these itself. */
  | { kind: 'implicit' }
  | { kind: 'error'; reason: 'expired' | 'invalid' }
  | { kind: 'none' }

const TOKEN = /^[A-Za-z0-9._~-]{8,2048}$/

export type AuthLink =
  | { kind: 'code'; code: string }
  | { kind: 'token_hash'; tokenHash: string; otpType: string }
  | { kind: 'implicit' }
  | { kind: 'error'; reason: 'expired' | 'invalid' }
  | { kind: 'none' }

/**
 * Reads what Supabase put on the address when it sent the visitor back, for the kinds of email link in `allowedTypes`
 * ('recovery' for a password reset, 'signup'/'email' for a confirmation). Never trusts it: unknown or malformed values, and a link of
 * a different kind, are "invalid".
 */
export function parseAuthLink(input: { search: string; hash: string }, allowedTypes: string[]): AuthLink {
  const query = new URLSearchParams(input.search.replace(/^\?/, ''))
  const fragment = new URLSearchParams(input.hash.replace(/^#/, ''))
  const get = (name: string) => query.get(name) ?? fragment.get(name)

  const error = get('error') ?? get('error_code')
  if (error) {
    const code = get('error_code') ?? ''
    const text = `${get('error_description') ?? ''} ${error}`
    return { kind: 'error', reason: code === 'otp_expired' || /expired|already|used/i.test(text) ? 'expired' : 'invalid' }
  }
  const tokenHash = query.get('token_hash')
  if (tokenHash) {
    const type = query.get('type') ?? ''
    return allowedTypes.includes(type) && TOKEN.test(tokenHash) ? { kind: 'token_hash', tokenHash, otpType: type } : { kind: 'error', reason: 'invalid' }
  }
  const code = query.get('code')
  if (code) return TOKEN.test(code) ? { kind: 'code', code } : { kind: 'error', reason: 'invalid' }
  if (fragment.get('access_token')) return allowedTypes.includes(fragment.get('type') ?? '') ? { kind: 'implicit' } : { kind: 'error', reason: 'invalid' }
  return { kind: 'none' }
}

/** Reads a password-reset link. */
export function parseRecoveryLink(input: { search: string; hash: string }): RecoveryLink {
  const link = parseAuthLink(input, ['recovery'])
  return link.kind === 'token_hash' ? { kind: 'token_hash', tokenHash: link.tokenHash } : link
}

export type RecoveryOutcome = 'ready' | 'expired' | 'invalid' | 'other_browser' | 'none'

type SessionLike = { access_token?: string } | null
type LinkClient = {
  auth: {
    /** Resolves when the client has finished reading the address (a one-time code or tokens in it); `error` is set when that failed. */
    initialize: () => Promise<{ error: AuthErrorLike }>
    getSession: () => Promise<{ data: { session: SessionLike } }>
    verifyOtp: (params: { type: 'recovery' | 'signup' | 'email'; token_hash: string }) => Promise<{ data?: { session?: SessionLike } | null; error: AuthErrorLike }>
  }
}

function reasonFromError(error: AuthErrorLike): RecoveryOutcome {
  const text = `${error?.name ?? ''} ${error?.code ?? ''} ${error?.message ?? ''}`
  if (/verifier|different browser/i.test(text)) return 'other_browser'
  if (/expired|otp_expired|already|used|flow_state|flow state|not found|invalid/i.test(text)) return 'expired'
  return 'invalid'
}

/**
 * Turns an email link into a session, and says plainly why when it cannot. The Supabase client reads a code or tokens in the address by
 * itself as the page loads, so for those links this waits for it to finish and takes its verdict: a failure is a failure even if the
 * visitor was already signed in, and a link that works always gives a session that came from that link. A token-hash link (the form an
 * email template can use) is verified here, and the session in the answer is the proof.
 */
export function establishRecoverySession(client: LinkClient, link: RecoveryLink, options: LinkOptions = {}): Promise<RecoveryOutcome> {
  return establishSessionFromLink(client, link.kind === 'token_hash' ? { ...link, otpType: 'recovery' } : link, options)
}

export type LinkOptions = {
  /** Whether this browser holds the secret that goes with a code link (it does only where the link was asked for). Default: yes. */
  hasVerifier?: boolean
}

export async function establishSessionFromLink(client: LinkClient, link: AuthLink, options: LinkOptions = {}): Promise<RecoveryOutcome> {
  if (link.kind === 'none') return 'none'
  if (link.kind === 'error') return link.reason

  try {
    if (link.kind === 'token_hash') {
      const { data, error } = await client.auth.verifyOtp({ type: link.otpType as 'recovery' | 'signup' | 'email', token_hash: link.tokenHash })
      if (error) return reasonFromError(error)
      return data?.session?.access_token ? 'ready' : 'invalid'
    }
    // A code can only be exchanged in the browser that asked for the link. Elsewhere the Supabase client does not even try, so say so.
    if (link.kind === 'code' && options.hasVerifier === false) return 'other_browser'
    // Otherwise the client has already been (or is still) exchanging the code or tokens: wait for its verdict.
    const { error } = await client.auth.initialize()
    if (error) return reasonFromError(error)
    const { data } = await client.auth.getSession()
    return data.session?.access_token ? 'ready' : 'invalid'
  } catch (error) {
    return reasonFromError(error as AuthErrorLike)
  }
}

// ---- choosing the new password ----------------------------------------------------------------------------------------------------
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`
  if (password !== confirm) return 'The two passwords do not match.'
  return null
}

export type UpdateOutcome = 'updated' | 'weak' | 'same' | 'expired' | 'rate_limited' | 'unavailable'

export function classifyUpdateError(error: AuthErrorLike): Exclude<UpdateOutcome, 'updated'> {
  if (!error) return 'unavailable'
  const text = `${error.name ?? ''} ${error.code ?? ''} ${error.message ?? ''}`
  if (isNetworkError(error)) return 'unavailable'
  if (error.code === 'same_password' || /different from the old password|same_password/i.test(text)) return 'same'
  if (error.code === 'weak_password' || /weak_password|password should|at least \d+ characters|too short/i.test(text)) return 'weak'
  if (/session_not_found|session_expired|AuthSessionMissing|session missing|jwt expired|not authenticated/i.test(text) || error.status === 401 || error.status === 403) return 'expired'
  if (error.status === 429 || /rate_limit/i.test(text)) return 'rate_limited'
  return 'unavailable'
}

export const UPDATE_MESSAGES: Record<Exclude<UpdateOutcome, 'updated'>, string> = {
  weak: `Choose a stronger password: at least ${MIN_PASSWORD_LENGTH} characters, and not an obvious or common one.`,
  same: 'Choose a password different from your current one.',
  expired: 'This reset link is no longer valid. Request a new link below.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  unavailable: 'We could not save your password right now. Please try again.',
}

type UpdateClient = {
  auth: {
    updateUser: (attributes: { password: string }) => Promise<{ error: AuthErrorLike }>
    signOut: (options: { scope: 'others' }) => Promise<unknown>
  }
}

/** Sets the new password, then signs every other session out so anyone holding the old password's sessions is locked out. */
export async function setNewPassword(client: UpdateClient, password: string): Promise<UpdateOutcome> {
  try {
    const { error } = await client.auth.updateUser({ password })
    if (error) return classifyUpdateError(error)
  } catch (error) {
    return classifyUpdateError(error as AuthErrorLike)
  }
  try { await client.auth.signOut({ scope: 'others' }) } catch { /* the password is already changed */ }
  return 'updated'
}

/** The address bar with the one-time values removed, so they are not kept in history or sent along in a Referer header. */
export const cleanedPath = () => RESET_PATH
