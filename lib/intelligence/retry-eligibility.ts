// Whether one failed Business Intelligence profile may be tried again. This never loosens a limit: it only says yes when
// the job's own attempt allowance and every budget would still permit a normal attempt, exactly as the worker's claim
// will check again. Attempt counters are never reset; a job that used its attempts, or a budget that is spent, says no.

export type RetryRefusal = 'not_failed' | 'cancelled' | 'expired' | 'not_allowed' | 'attempts' | 'budget' | 'not_recoverable'

export type RetryContext = {
  jobStatus: string
  lastError: string | null
  retryCount: number
  maxRetries: number
  /**
   * The attempts the run itself allows (ci_research_runs.max_attempts). When known, a job that used them all may be retried by its
   * customer exactly once more; that retry raises the job's own ceiling by one, so a second manual retry is refused. Without it the
   * original rule applies: a retry only while the job still has an attempt left.
   */
  runMaxAttempts?: number
  claimed: boolean
  runStatus: string
  runExpiresAt: string
  /** Whether this customer may have research at all (the operator's allow-list), and whether the budgets are configured. */
  allowed: boolean
  perJobReserve: number | null
  profileCeiling: number | null
  /** Spend so far (settled actual, else reserved). */
  spent: { profile: number; run: number; customerMonth: number; globalMonth: number }
  limits: { run: number; customerMonth: number; globalMonth: number | null }
}

/**
 * Whether a stored failure could go away by trying again. Internal reason codes only (never customer text): a missing, blocked,
 * oversized or unreadable website will fail the same way again, and so will a spent budget. Timeouts, network trouble, server
 * errors, interruptions and an unusable AI answer are worth one more try.
 */
export function isRecoverableFailure(lastError: string | null | undefined): boolean {
  const error = String(lastError ?? '')
  if (!error) return true
  if (/budget_exhausted|entitlement_ended|did not provide enough readable|no website|exceeded the size limit|certificate|HTTP (401|403|404|410|451)|INVALID_CONTENT_TYPE|not allowed|private address/i.test(error)) return false
  return true
}

export function retryVerdict(ctx: RetryContext, now = Date.now()): { ok: true; grant?: boolean } | { ok: false; reason: RetryRefusal } {
  if (ctx.runStatus !== 'active') return { ok: false, reason: 'cancelled' }
  if (Date.parse(ctx.runExpiresAt) <= now) return { ok: false, reason: 'expired' }
  if (ctx.jobStatus !== 'failed' || ctx.claimed) return { ok: false, reason: 'not_failed' }
  if (/^cancelled/i.test(ctx.lastError ?? '')) return { ok: false, reason: 'cancelled' }
  if (!ctx.allowed) return { ok: false, reason: 'not_allowed' }
  let grant = false
  if (ctx.retryCount >= ctx.maxRetries) {
    // Attempts used up. With the run's own allowance known, the customer gets one more, once; otherwise none.
    if (ctx.runMaxAttempts === undefined || ctx.maxRetries > ctx.runMaxAttempts) return { ok: false, reason: 'attempts' }
    // Budget-exhausted jobs never ran an AI call, but the same rule keeps this simple: only a failure a retry could fix.
    if (!isRecoverableFailure(ctx.lastError)) return { ok: false, reason: 'not_recoverable' }
    grant = true
  }
  const reserve = ctx.perJobReserve
  if (reserve === null || ctx.profileCeiling === null || ctx.limits.globalMonth === null) return { ok: false, reason: 'budget' }
  if (ctx.spent.profile + reserve > ctx.profileCeiling) return { ok: false, reason: 'budget' }
  if (ctx.spent.run + reserve > ctx.limits.run) return { ok: false, reason: 'budget' }
  if (ctx.spent.customerMonth + reserve > ctx.limits.customerMonth) return { ok: false, reason: 'budget' }
  if (ctx.spent.globalMonth + reserve > ctx.limits.globalMonth) return { ok: false, reason: 'budget' }
  return grant ? { ok: true, grant: true } : { ok: true }
}

export const RETRY_REFUSAL_TEXT: Record<RetryRefusal | 'already_requested' | 'unavailable', string> = {
  not_failed: 'This profile is not in a state that can be retried.',
  cancelled: 'Research was stopped for this search, so it cannot be retried.',
  expired: 'This search is too old for its profile to be retried. Run a new search.',
  not_allowed: 'Business Intelligence is not available for this account.',
  attempts: 'This profile has already been retried once, so it cannot be retried again.',
  not_recoverable: "ALPA can't read this website (it is blocked, missing, too large or unreadable), so trying again would not help.",
  budget: 'The research budget for this search or month is used up, so it cannot be retried now.',
  already_requested: 'A retry for this profile is already under way.',
  unavailable: 'The retry could not be requested right now. Try again shortly.',
}
