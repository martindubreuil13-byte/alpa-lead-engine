import { retryVerdict, type RetryContext, type RetryRefusal } from '../intelligence/retry-eligibility.ts'

type Client = any

const sum = (rows: Array<{ actual_usd: number | string | null; reserved_usd: number | string }> | null) =>
  (rows ?? []).reduce((total, row) => total + Number(row.actual_usd ?? row.reserved_usd ?? 0), 0)

export type RetryDecision =
  | { ok: true; queueId: string; retryCount: number; grant: boolean }
  | { ok: false; reason: RetryRefusal | 'unavailable' }

/**
 * Reads one failed run job with the run, the operator's controls and the spend so far, and applies the same limits the
 * worker's claim applies. Read-only: it changes nothing and starts nothing.
 */
export async function decideRetry(admin: Client, input: { runId: string; leadId: string; userId: string }): Promise<RetryDecision> {
  try {
    const [{ data: job }, { data: run }, { data: ctl }] = await Promise.all([
      admin.from('commercial_intelligence_queue').select('id, status, last_error, retry_count, max_retries, claim_token')
        .eq('run_id', input.runId).eq('lead_id', input.leadId).eq('user_id', input.userId).maybeSingle(),
      admin.from('ci_research_runs').select('status, expires_at, budget_limit_usd, customer_month_limit_usd, max_attempts').eq('run_id', input.runId).eq('user_id', input.userId).maybeSingle(),
      admin.from('ci_research_controls').select('allow_all_customers, allowed_user_ids, per_job_reserve_usd, per_profile_ceiling_usd, global_monthly_limit_usd').maybeSingle(),
    ])
    if (!job || !run || !ctl) return { ok: false, reason: 'unavailable' }

    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
    const columns = 'actual_usd, reserved_usd'
    const [profile, runSpend, customerMonth, globalMonth] = await Promise.all([
      admin.from('ci_research_charges').select(columns).eq('queue_id', job.id),
      admin.from('ci_research_charges').select(columns).eq('run_id', input.runId),
      admin.from('ci_research_charges').select(columns).eq('user_id', input.userId).gte('created_at', month),
      admin.from('ci_research_charges').select(columns).gte('created_at', month),
    ])
    if (profile.error || runSpend.error || customerMonth.error || globalMonth.error) return { ok: false, reason: 'unavailable' }

    const context: RetryContext = {
      jobStatus: job.status,
      lastError: job.last_error,
      retryCount: Number(job.retry_count),
      maxRetries: Number(job.max_retries),
      runMaxAttempts: Number.isInteger(run.max_attempts) ? Number(run.max_attempts) : undefined,
      claimed: job.claim_token !== null,
      runStatus: run.status,
      runExpiresAt: run.expires_at,
      allowed: ctl.allow_all_customers === true || (ctl.allowed_user_ids ?? []).includes(input.userId),
      perJobReserve: ctl.per_job_reserve_usd === null ? null : Number(ctl.per_job_reserve_usd),
      profileCeiling: ctl.per_profile_ceiling_usd === null ? null : Number(ctl.per_profile_ceiling_usd),
      spent: { profile: sum(profile.data), run: sum(runSpend.data), customerMonth: sum(customerMonth.data), globalMonth: sum(globalMonth.data) },
      limits: { run: Number(run.budget_limit_usd), customerMonth: Number(run.customer_month_limit_usd), globalMonth: ctl.global_monthly_limit_usd === null ? null : Number(ctl.global_monthly_limit_usd) },
    }
    const verdict = retryVerdict(context)
    return verdict.ok ? { ok: true, queueId: job.id, retryCount: context.retryCount, grant: verdict.grant === true } : verdict
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Puts the one failed job back to pending, atomically: the update applies only if the job is still failed with the same
 * attempt count and is unclaimed, so two requests cannot both succeed. The attempt counter is not touched (only the ceiling
 * of an exhausted job rises, by one, when the customer's one retry is granted), and the
 * worker's claim still checks the attempt allowance and every budget before it reserves anything.
 */
export async function requeueFailedItem(admin: Client, input: { runId: string; leadId: string; userId: string; queueId: string; retryCount: number; grant?: boolean }): Promise<boolean> {
  const { data, error } = await admin
    .from('commercial_intelligence_queue')
    .update({
      status: 'pending', completed_at: null, started_at: null, claim_token: null, last_error: 'Retry requested by customer',
      // The claim waits 60 seconds after a job's last attempt. A customer-requested retry must be claimable by the worker tick this
      // request kicks off; otherwise that tick finds nothing and the job sits until the next scheduled tick.
      last_retry_at: null,
      // The one customer retry of an exhausted job: its own ceiling rises by exactly one, so the claim can reserve and run it once
      // and a second manual retry is refused. Nothing else about the job's counters changes.
      ...(input.grant ? { max_retries: input.retryCount + 1 } : {}),
    })
    .eq('id', input.queueId).eq('run_id', input.runId).eq('lead_id', input.leadId).eq('user_id', input.userId)
    .eq('status', 'failed').eq('retry_count', input.retryCount).is('claim_token', null)
    .select('id')
  return !error && Array.isArray(data) && data.length === 1
}
