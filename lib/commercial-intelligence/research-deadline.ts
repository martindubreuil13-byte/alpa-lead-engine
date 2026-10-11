// One enforceable deadline for one research job.
//
// A deadline that is only compared with the clock after the work has finished is not a deadline.
// This one aborts an AbortSignal when it expires (fetches and the OpenAI request really stop) and
// rejects `guard()`, so the job returns on time even if some step cannot be cancelled (a DNS lookup,
// a database call that ignores the signal). Whatever such a step does afterwards is discarded.

/** Overall budget for researching one lead. It replaces the old "check the clock afterwards" limit. */
export const RESEARCH_DEADLINE_MS = 60_000
/** Extra time an outer caller waits for a job's own deadline handling before giving up on it. */
export const RESEARCH_DEADLINE_GRACE_MS = 5_000
/** Time a single request (route or worker tick) may spend researching; Vercel maxDuration is 300 s. */
export const RESEARCH_BATCH_BUDGET_MS = 240_000

export class ResearchDeadlineError extends Error {
  readonly code = 'DEADLINE_EXCEEDED'
  readonly deadlineMs: number
  readonly stage?: string
  constructor(deadlineMs: number, stage?: string) {
    super(`Research exceeded its ${Math.round(deadlineMs / 1000)}s deadline${stage ? ` during ${stage}` : ''}`)
    this.name = 'ResearchDeadlineError'
    this.deadlineMs = deadlineMs
    this.stage = stage
  }
}

export type ResearchDeadline = {
  readonly signal: AbortSignal
  readonly deadlineMs: number
  expired(): boolean
  remainingMs(): number
  /** Resolves with `work`, or rejects with ResearchDeadlineError when the deadline passes first. */
  guard<T>(work: Promise<T>, stage?: string): Promise<T>
  /** Stops the timer. Always call it when the job is over. */
  dispose(): void
}

export function createResearchDeadline(deadlineMs = RESEARCH_DEADLINE_MS): ResearchDeadline {
  const controller = new AbortController()
  const startedAt = Date.now()
  let expired = false

  const timer = setTimeout(() => {
    expired = true
    controller.abort(new ResearchDeadlineError(deadlineMs))
  }, deadlineMs)

  return {
    signal: controller.signal,
    deadlineMs,
    expired: () => expired,
    remainingMs: () => Math.max(0, deadlineMs - (Date.now() - startedAt)),
    guard<T>(work: Promise<T>, stage?: string): Promise<T> {
      if (expired) {
        work.catch(() => undefined)
        return Promise.reject(new ResearchDeadlineError(deadlineMs, stage))
      }
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          // The losing work keeps running if it cannot be cancelled; its outcome is ignored.
          work.catch(() => undefined)
          reject(new ResearchDeadlineError(deadlineMs, stage))
        }
        controller.signal.addEventListener('abort', onAbort, { once: true })
        work.then(
          (value) => { controller.signal.removeEventListener('abort', onAbort); resolve(value) },
          (error) => { controller.signal.removeEventListener('abort', onAbort); reject(error) }
        )
      })
    },
    dispose() {
      clearTimeout(timer)
    },
  }
}

/**
 * How many jobs fit in one request. Claiming more than a request can finish leaves the rest in
 * 'processing' until stale recovery, which is exactly the stuck state a deadline exists to prevent.
 */
export function jobsThatFit(
  requested: number,
  options: { budgetMs?: number; perJobMs?: number; parallel?: number } = {}
) {
  const perJob = (options.perJobMs ?? RESEARCH_DEADLINE_MS) + RESEARCH_DEADLINE_GRACE_MS
  const rounds = Math.max(1, Math.floor((options.budgetMs ?? RESEARCH_BATCH_BUDGET_MS) / perJob))
  const capacity = rounds * Math.max(1, options.parallel ?? 1)
  return Math.max(1, Math.min(requested, capacity))
}
