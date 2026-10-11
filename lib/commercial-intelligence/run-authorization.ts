// Run-scoped research authorization, called by Discover after the atomic save has succeeded.
//
// A second environment switch, CI_RUN_AUTHORIZATION_ENABLED, decides whether Discover authorizes research at all. It is
// separate from CI_RESEARCH_ENABLED (which decides whether research may run) so the integration can be deployed and
// tested with both OFF: with this one OFF Discover behaves exactly as it did before Phase 1.
//
// The database does the real work (supabase/proposed/20261016_ci_phase1_run_scoped.sql): it derives the saved lead ids
// from the save receipt itself, so this module passes only the run, the customer and the plan's lead limit. It never
// throws: a failure to authorize must not affect the customer's results, and the answer is simply "not authorized".

export const RUN_AUTHORIZATION_ENV = 'CI_RUN_AUTHORIZATION_ENABLED'

type Env = Record<string, string | undefined>

export function isRunAuthorizationEnabled(env: Env = process.env): boolean {
  return env[RUN_AUTHORIZATION_ENV]?.trim() === 'true'
}

export type RunAuthorization =
  | { ok: true; runId: string; saved: number; queued: number; already: boolean }
  | { ok: false; reason: 'invalid' | 'refused' | 'timeout' | 'unavailable' }

const AUTHORIZATION_TIMEOUT_MS = 4_000

export async function authorizeResearchRun(
  // The generated database types do not know the Phase 1 functions yet, so the client is deliberately untyped.
  client: any,
  input: { runId: string; userId: string; planLeadsLimit: number },
  options: { timeoutMs?: number } = {}
): Promise<RunAuthorization> {
  if (!input.runId || !input.userId || !Number.isInteger(input.planLeadsLimit) || input.planLeadsLimit < 1) {
    return { ok: false, reason: 'invalid' }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const call = Promise.resolve(
      client.rpc('authorize_ci_research_run', { p_run_id: input.runId, p_user_id: input.userId, p_plan_leads_limit: input.planLeadsLimit })
    )
    const result = await Promise.race([
      call,
      new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), options.timeoutMs ?? AUTHORIZATION_TIMEOUT_MS) }),
    ])
    if (result === 'timeout') return { ok: false, reason: 'timeout' }
    if (result.error) return { ok: false, reason: 'refused' }
    const data = result.data as { run_id?: string; saved?: number; queued?: number; already?: boolean } | null
    if (!data?.run_id) return { ok: false, reason: 'refused' }
    return { ok: true, runId: data.run_id, saved: Number(data.saved ?? 0), queued: Number(data.queued ?? 0), already: Boolean(data.already) }
  } catch {
    return { ok: false, reason: 'unavailable' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
