// Whether one failed Business Intelligence profile may be tried again. This never loosens a limit: it only says yes when
// the job's own attempt allowance and every budget would still permit a normal attempt, exactly as the worker's claim
// will check again. Attempt counters are never reset; a job that used its attempts, or a budget that is spent, says no.

export type RetryRefusal = 'not_failed' | 'cancelled' | 'expired' | 'not_allowed' | 'attempts' | 'budget'

export type RetryContext = {
  jobStatus: string
  lastError: string | null
  retryCount: number
  maxRetries: number
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

export function retryVerdict(ctx: RetryContext, now = Date.now()): { ok: true } | { ok: false; reason: RetryRefusal } {
  if (ctx.runStatus !== 'active') return { ok: false, reason: 'cancelled' }
  if (Date.parse(ctx.runExpiresAt) <= now) return { ok: false, reason: 'expired' }
  if (ctx.jobStatus !== 'failed' || ctx.claimed) return { ok: false, reason: 'not_failed' }
  if (/^cancelled/i.test(ctx.lastError ?? '')) return { ok: false, reason: 'cancelled' }
  if (!ctx.allowed) return { ok: false, reason: 'not_allowed' }
  if (ctx.retryCount >= ctx.maxRetries) return { ok: false, reason: 'attempts' }
  const reserve = ctx.perJobReserve
  if (reserve === null || ctx.profileCeiling === null || ctx.limits.globalMonth === null) return { ok: false, reason: 'budget' }
  if (ctx.spent.profile + reserve > ctx.profileCeiling) return { ok: false, reason: 'budget' }
  if (ctx.spent.run + reserve > ctx.limits.run) return { ok: false, reason: 'budget' }
  if (ctx.spent.customerMonth + reserve > ctx.limits.customerMonth) return { ok: false, reason: 'budget' }
  if (ctx.spent.globalMonth + reserve > ctx.limits.globalMonth) return { ok: false, reason: 'budget' }
  return { ok: true }
}

export const RETRY_REFUSAL_TEXT: Record<RetryRefusal | 'already_requested' | 'unavailable', string> = {
  not_failed: 'This profile is not in a state that can be retried.',
  cancelled: 'Research was stopped for this search, so it cannot be retried.',
  expired: 'This search is too old for its profile to be retried. Run a new search.',
  not_allowed: 'Business Intelligence is not available for this account.',
  attempts: 'This profile already used both of its attempts, so it cannot be retried.',
  budget: 'The research budget for this search or month is used up, so it cannot be retried now.',
  already_requested: 'A retry for this profile is already under way.',
  unavailable: 'The retry could not be requested right now. Try again shortly.',
}
