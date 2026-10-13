// A phone can lose the search connection (screen lock, app switch, a network handover) while the search itself keeps running
// and saving on the server. This waits for that search to finish and says what happened, from the server's own record
// (GET /api/guest/session), never from guesses on the device.

export type GuestSnapshot = {
  leads?: unknown[]
  used?: number
  attempts?: number
  /** True while a search for this visitor is reserved and running on the server. */
  searching?: boolean
}

export type RecoveryOutcome =
  /** The search finished and its businesses are saved (leads may be 0 for a search that found none). */
  | { state: 'completed'; leads: number }
  /** The server never started a search for this attempt, so nothing was used and the visitor can simply try again. */
  | { state: 'not_started' }
  /** The server was still working, or could not be reached, when the wait ended. */
  | { state: 'pending' }

export type RecoveryOptions = {
  fetchSession: () => Promise<GuestSnapshot | null>
  /** The visitor's search attempts before this search started; null when unknown. */
  baselineAttempts: number | null
  /** The number of businesses already saved before this search; null when unknown. */
  baselineLeads: number | null
  /** The visitor reloaded or came back to a search already in progress: it certainly started. */
  assumeStarted?: boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  intervalMs?: number
  /** How long to wait for a running search; the server releases a reservation after 6 minutes. */
  timeoutMs?: number
  /** How long the server must keep showing "no search" before we believe the request never arrived. */
  notStartedGraceMs?: number
  onWaiting?: () => void
  shouldStop?: () => boolean
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function recoverGuestSearch(options: RecoveryOptions): Promise<RecoveryOutcome> {
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const interval = options.intervalMs ?? 3_000
  const timeout = options.timeoutMs ?? 7 * 60_000
  const grace = options.notStartedGraceMs ?? 6_000
  const startedAt = now()
  let quietSince: number | null = null

  while (now() - startedAt < timeout) {
    if (options.shouldStop?.()) return { state: 'pending' }
    let snapshot: GuestSnapshot | null = null
    try {
      snapshot = await options.fetchSession()
    } catch {
      snapshot = null
    }

    if (snapshot?.searching) {
      quietSince = null
      options.onWaiting?.()
    } else if (snapshot) {
      const attempts = Number.isFinite(snapshot.attempts) ? Number(snapshot.attempts) : 0
      const leads = Array.isArray(snapshot.leads) ? snapshot.leads.length : 0
      const started = options.assumeStarted
        ? true
        : options.baselineAttempts !== null
          ? attempts > options.baselineAttempts
          : leads > (options.baselineLeads ?? 0) || attempts > 0

      if (started) return { state: 'completed', leads }

      // The server shows no search for this attempt. The request may still be in flight on a slow network, so it must stay
      // that way for a short while before we conclude it never arrived.
      quietSince = quietSince ?? now()
      if (now() - quietSince >= grace) return { state: 'not_started' }
    } else {
      options.onWaiting?.()
    }

    await sleep(interval)
  }
  return { state: 'pending' }
}
