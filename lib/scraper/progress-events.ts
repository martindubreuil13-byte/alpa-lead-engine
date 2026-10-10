// Additive, typed progress events for the /api/scrape Server-Sent Events stream.
//
// Existing events are unchanged: { type: 'log' | 'lead' | 'result' }. Consumers that do not
// know `type: 'progress'` ignore it (the Discover page and the landing trial flow only act on
// the event types they recognise). Counters are cumulative and monotonic, so a repeated or
// out-of-order event can be merged safely with a per-field max.

export type CheckingProgressEvent = {
  type: 'progress'
  stage: 'checking'
  /** Website checks planned so far (grows if an extra pass is announced). */
  planned: number
  /** Checks that reached a conclusion: an email found, no email, or a skipped website. */
  completed: number
  /** Subset of completed checks that found an email. A separate metric, not progress. */
  emailsFound: number
}

export type SavingProgressEvent = {
  type: 'progress'
  stage: 'saving'
  /** Businesses this run will try to save. */
  considered: number
  /** Save attempts that finished, successful or not. Never ahead of persistence. */
  processed: number
  /** Persisted successfully (or reused existing business in owner preview). */
  saved: number
  duplicates: number
  invalid: number
  /** Database errors. */
  failed: number
}

export type ScrapeProgressEvent = CheckingProgressEvent | SavingProgressEvent

export type SaveOutcome = 'saved' | 'duplicate' | 'invalid' | 'failed'

const count = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

/**
 * Tracks website checks across every enrichment pass of one run.
 * `plan` is called with the number of websites about to be checked; `complete` once per
 * website when its check concludes (found an email or not).
 */
export function createWebsiteCheckTracker(onProgress?: (event: ScrapeProgressEvent) => void) {
  let planned = 0
  let completed = 0
  let emailsFound = 0

  const emit = () => {
    onProgress?.({
      type: 'progress',
      stage: 'checking',
      planned,
      completed: Math.min(completed, planned),
      emailsFound,
    })
  }

  return {
    plan(total: number) {
      planned += count(total)
      emit()
    },
    complete(foundEmail: boolean) {
      completed += 1
      if (foundEmail) emailsFound += 1
      emit()
    },
    snapshot: () => ({ planned, completed: Math.min(completed, planned), emailsFound }),
  }
}

export type WebsiteCheckTracker = ReturnType<typeof createWebsiteCheckTracker>

/**
 * Tracks save attempts for one run. Call `start` before the first attempt and `record` after
 * each attempt's outcome is known (after persistence succeeded or failed).
 */
export function createSaveTracker(considered: number, onProgress?: (event: ScrapeProgressEvent) => void) {
  let total = count(considered)
  let processed = 0
  let saved = 0
  let duplicates = 0
  let invalid = 0
  let failed = 0

  const emit = () => {
    onProgress?.({ type: 'progress', stage: 'saving', considered: total, processed, saved, duplicates, invalid, failed })
  }

  return {
    start: emit,
    record(outcome: SaveOutcome) {
      processed += 1
      if (outcome === 'saved') saved += 1
      else if (outcome === 'duplicate') duplicates += 1
      else if (outcome === 'invalid') invalid += 1
      else failed += 1
      // Extra attempts (earlier ones failed) can exceed the estimate; keep it honest.
      if (processed > total) total = processed
      emit()
    },
    snapshot: () => ({ considered: total, processed, saved, duplicates, invalid, failed }),
  }
}

/** Validates an untrusted stream payload. Returns null for anything that is not a progress event. */
export function parseProgressEvent(raw: unknown): ScrapeProgressEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const event = raw as Record<string, unknown>
  if (event.type !== 'progress') return null

  if (event.stage === 'checking') {
    const planned = count(event.planned)
    const completed = Math.min(count(event.completed), planned)
    return {
      type: 'progress',
      stage: 'checking',
      planned,
      completed,
      emailsFound: Math.min(count(event.emailsFound), completed),
    }
  }

  if (event.stage === 'saving') {
    const considered = count(event.considered)
    const processed = Math.min(count(event.processed), Math.max(considered, count(event.processed)))
    return {
      type: 'progress',
      stage: 'saving',
      considered: Math.max(considered, processed),
      processed,
      saved: Math.min(count(event.saved), processed),
      duplicates: Math.min(count(event.duplicates), processed),
      invalid: Math.min(count(event.invalid), processed),
      failed: Math.min(count(event.failed), processed),
    }
  }

  return null
}
