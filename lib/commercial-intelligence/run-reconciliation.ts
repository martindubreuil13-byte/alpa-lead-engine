// Closes the loose ends of research runs that have expired.
//
// A run lives for `run_ttl_hours`. The worker already refuses to claim anything from an expired run, so nothing runs after expiry;
// what is left behind is jobs that never started, which would sit "pending" for ever and make a finished search look unfinished.
// This closes exactly those jobs, as unavailable ("run expired"), and nothing else:
//   - a job that is running or claimed is never touched (stale-claim recovery owns it)
//   - a job that completed or failed keeps its result
//   - the lead, its saved profile, the run's spend and every allowance are left exactly as they are
// Safe to repeat: a second pass finds nothing to close. It is not scheduled anywhere; it is called by an operator, with
// `dryRun` true unless the caller says otherwise.

type Client = any

export type ReconcileResult = { dryRun: boolean; expiredRuns: number; jobsToClose: number; jobsClosed: number }

export const RUN_EXPIRED_REASON = 'run expired'

export async function reconcileExpiredRuns(admin: Client, options: { dryRun?: boolean; now?: Date; limit?: number } = {}): Promise<ReconcileResult> {
  const dryRun = options.dryRun !== false
  const now = (options.now ?? new Date()).toISOString()
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)

  const { data: runs, error } = await admin.from('ci_research_runs').select('run_id').eq('status', 'active').lt('expires_at', now).limit(limit)
  if (error) throw new Error('Expired runs could not be read')
  const runIds = (runs ?? []).map((run: { run_id: string }) => run.run_id)
  if (runIds.length === 0) return { dryRun, expiredRuns: 0, jobsToClose: 0, jobsClosed: 0 }

  // Only jobs that have not started and are not claimed.
  const { data: waiting, error: waitingError } = await admin
    .from('commercial_intelligence_queue')
    .select('id')
    .in('run_id', runIds)
    .eq('status', 'pending')
    .is('claim_token', null)
  if (waitingError) throw new Error('Waiting jobs could not be read')
  const jobsToClose = (waiting ?? []).length
  if (dryRun || jobsToClose === 0) return { dryRun, expiredRuns: runIds.length, jobsToClose, jobsClosed: 0 }

  const { data: closed, error: closeError } = await admin
    .from('commercial_intelligence_queue')
    .update({ status: 'failed', completed_at: now, claim_token: null, last_error: RUN_EXPIRED_REASON })
    .in('run_id', runIds)
    .eq('status', 'pending')
    .is('claim_token', null)
    .select('id')
  if (closeError) throw new Error('Waiting jobs could not be closed')
  return { dryRun, expiredRuns: runIds.length, jobsToClose, jobsClosed: (closed ?? []).length }
}
