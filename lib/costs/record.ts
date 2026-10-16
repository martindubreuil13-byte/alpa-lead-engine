import { currentCostContext, type CostContext } from '@/lib/costs/context'
import type { Operation, Provider } from '@/lib/costs/pricing'

// Recording a provider call must never change what the customer gets. Every failure here is swallowed, every wait is bounded, and the
// row holds only counts, ids and the estimate: no keys, no query text, no request or response bodies, no email addresses.
//
// Reliability model: a write is attempted twice within WRITE_BUDGET_MS. Each event carries a unique `event_key` and is written with
// "insert, ignore duplicates", so a repeated write of the same event (a retry, or a second flush) can never be counted twice.
// Callers that must not lose a record before a serverless function ends (the OpenAI call sites) await it; the discovery run flushes
// at its end. What can still be lost is listed in docs/cost-intelligence.md.

export const WRITE_BUDGET_MS = 2000
const RETRY_DELAY_MS = 150
/** After the cost tables are found missing, writes are skipped for this long instead of failing on every request. */
const MISSING_TABLE_PAUSE_MS = 5 * 60_000

export type CreditsBasis = 'reported' | 'configured'

export type ApiUsageEvent = {
  provider: Provider
  operation: Operation
  requestCount?: number
  credits?: number | null
  /** Whether the credits are what the provider reported for this request or what ALPA is configured to expect. */
  creditsBasis?: CreditsBasis | null
  inputTokens?: number | null
  outputTokens?: number | null
  model?: string | null
  /** Google billing events this one request generated. They are events of a single request, never additional requests. */
  skus?: string[] | null
  estimatedCostUsd: number | null
  ok: boolean
  httpStatus?: number | null
  /** Businesses this request returned. */
  resultsReturned?: number | null
  /** Identifies this event so writing it twice counts it once. Defaults to a fresh id; OpenAI events use the completion's own id. */
  eventKey?: string
  context?: Partial<CostContext>
}

export type UsageRow = {
  event_key: string
  provider: Provider
  operation: Operation
  purpose: CostContext['purpose']
  audience: CostContext['audience']
  run_id: string | null
  user_id: string | null
  request_count: number
  credits: number | null
  credits_basis: CreditsBasis | null
  input_tokens: number | null
  output_tokens: number | null
  model: string | null
  skus: string[] | null
  estimated_cost_usd: number | null
  cost_basis: 'estimate'
  ok: boolean
  http_status: number | null
  results_returned: number | null
}

export type DiscoveryRunSummary = {
  runId: string
  userId: string | null
  audience: CostContext['audience']
  delivered: number
  duplicates: number
  rejected: number
  stopReason?: string | null
}

export type TrackingFailureRow = {
  occurred_first_at: string
  occurred_last_at: string
  failed_count: number
  kind: 'write_failed' | 'timeout' | 'mixed'
  detail_code: string | null
}

type Sink = {
  usage: (rows: UsageRow[]) => Promise<unknown>
  run: (row: Record<string, unknown>) => Promise<unknown>
  /** Optional: records a batch of failed writes, for the tracking-health panel. */
  failure?: (row: TrackingFailureRow) => Promise<unknown>
}

let sink: Sink | null = null
/** Tests replace the destination; production uses the admin client. */
export function setCostSink(next: Sink | null) { sink = next; pausedUntil = 0; unrecorded.count = 0; unrecorded.first = 0; unrecorded.last = 0; unrecorded.timeouts = 0; unrecorded.failed = 0; unrecorded.code = null }

const isMissingTable = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')))

class TablesMissing extends Error {}

async function defaultSink(): Promise<Sink> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const client = createAdminClient() as any
  const check = (result: { error: { code?: string; message?: string } | null }) => {
    if (result.error) throw isMissingTable(result.error) ? new TablesMissing() : new Error('write failed')
  }
  return {
    usage: async (rows) => check(await client.from('api_usage_events').upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true })),
    run: async (row) => check(await client.from('api_usage_runs').upsert(row, { onConflict: 'run_id' })),
    failure: async (row) => check(await client.from('api_tracking_failures').insert(row)),
  }
}

export function toUsageRow(event: ApiUsageEvent): UsageRow {
  const context = { ...currentCostContext(), ...event.context }
  return {
    event_key: event.eventKey ?? globalThis.crypto.randomUUID(),
    provider: event.provider,
    operation: event.operation,
    purpose: context.purpose ?? 'other',
    audience: context.audience ?? 'system',
    run_id: context.runId ?? null,
    user_id: context.userId ?? null,
    request_count: event.requestCount ?? 1,
    credits: event.credits ?? null,
    credits_basis: event.credits === null || event.credits === undefined ? null : event.creditsBasis ?? null,
    input_tokens: event.inputTokens ?? null,
    output_tokens: event.outputTokens ?? null,
    model: event.model ?? null,
    skus: event.skus ?? null,
    estimated_cost_usd: event.estimatedCostUsd,
    cost_basis: 'estimate',
    ok: event.ok,
    http_status: event.httpStatus ?? null,
    results_returned: event.resultsReturned ?? null,
  }
}

const stats = { written: 0, dropped: 0 }
export const costRecordingStats = () => ({ ...stats })
let pausedUntil = 0

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** A short, safe error code (never a message). */
const codeOf = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(code) ? code : null
}

type WriteOutcome = { landed: true } | { landed: false; reason: 'failed' | 'timeout' | 'paused' | 'missing'; code: string | null }

/** Runs a write twice at most, never past the budget, never throws. */
async function writeBounded(write: (destination: Sink) => Promise<unknown>): Promise<WriteOutcome> {
  if (Date.now() < pausedUntil) return { landed: false, reason: 'paused', code: null }
  const deadline = Date.now() + WRITE_BUDGET_MS
  const attempt = async (): Promise<WriteOutcome> => {
    let code: string | null = null
    for (let n = 1; n <= 2; n += 1) {
      try {
        await write(sink ?? (await defaultSink()))
        return { landed: true }
      } catch (error) {
        if (error instanceof TablesMissing || isMissingTable(error as { code?: string; message?: string })) { pausedUntil = Date.now() + MISSING_TABLE_PAUSE_MS; return { landed: false, reason: 'missing', code: null } }
        code = codeOf(error)
        if (n === 2 || Date.now() + RETRY_DELAY_MS >= deadline) return { landed: false, reason: 'failed', code }
        await wait(RETRY_DELAY_MS)
      }
    }
    return { landed: false, reason: 'failed', code }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<WriteOutcome>((resolve) => { timer = setTimeout(() => resolve({ landed: false, reason: 'timeout', code: null }), WRITE_BUDGET_MS) })
  try { return await Promise.race([attempt(), timeout]) } catch { return { landed: false, reason: 'failed', code: null } } finally { if (timer) clearTimeout(timer) }
}

// ---- known failures (for the tracking-health panel) -----------------------------------------------------------------------------
// A failed write is counted in memory and written to api_tracking_failures as one batch as soon as the database can be reached again
// (right away if it only failed once, otherwise on the next successful write). Only counts, times and a short code are kept.
// Limits: a failure while the database is unreachable cannot be stored until it is back; an instance killed before then loses the count,
// and a function killed mid-request records nothing at all. Those gaps are not detectable here.
const unrecorded = { count: 0, first: 0, last: 0, timeouts: 0, failed: 0, code: null as string | null }
let flushingFailures = false
const FAILURE_WRITE_BUDGET_MS = 1000

export const unrecordedFailures = () => ({ ...unrecorded })

function noteFailure(reason: 'failed' | 'timeout', code: string | null) {
  const now = Date.now()
  if (unrecorded.count === 0) unrecorded.first = now
  unrecorded.count += 1
  unrecorded.last = now
  if (reason === 'timeout') unrecorded.timeouts += 1; else unrecorded.failed += 1
  if (code) unrecorded.code = code
  void flushFailures()
}

async function flushFailures() {
  if (flushingFailures || unrecorded.count === 0 || Date.now() < pausedUntil) return
  flushingFailures = true
  const batch = { ...unrecorded }
  try {
    const destination = sink ?? (await defaultSink())
    if (!destination.failure) return
    const row: TrackingFailureRow = {
      occurred_first_at: new Date(batch.first).toISOString(),
      occurred_last_at: new Date(batch.last).toISOString(),
      failed_count: batch.count,
      kind: batch.timeouts > 0 && batch.failed > 0 ? 'mixed' : batch.timeouts > 0 ? 'timeout' : 'write_failed',
      detail_code: batch.code,
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const landed = await Promise.race([
      destination.failure(row).then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), FAILURE_WRITE_BUDGET_MS) }),
    ])
    if (timer) clearTimeout(timer)
    if (landed) {
      // Failures noted while this batch was being written stay for the next one.
      unrecorded.count -= batch.count
      unrecorded.timeouts = Math.max(0, unrecorded.timeouts - batch.timeouts)
      unrecorded.failed = Math.max(0, unrecorded.failed - batch.failed)
      if (unrecorded.count === 0) { unrecorded.code = null; unrecorded.first = 0; unrecorded.last = 0 } else unrecorded.first = batch.last
    }
  } catch { /* health reporting never affects anything */ } finally { flushingFailures = false }
}

const pending = new Set<Promise<unknown>>()
function track(work: Promise<WriteOutcome>) {
  const tracked = work.then((outcome) => {
    if (outcome.landed) {
      stats.written += 1
      if (unrecorded.count > 0) void flushFailures() // the database is reachable again
    } else if (outcome.reason === 'failed' || outcome.reason === 'timeout') {
      stats.dropped += 1
      console.warn('[costs] a usage record was not written')
      noteFailure(outcome.reason, outcome.code)
    }
  })
  pending.add(tracked)
  void tracked.finally(() => pending.delete(tracked))
  return tracked
}
/** Lets a serverless handler or a test wait for outstanding writes (bounded by each write's own budget). Never throws. */
export async function flushCostRecords() { await Promise.allSettled([...pending]) }

/** Records one provider request. The returned promise resolves once the write has landed or been given up on; it never rejects. */
export function recordApiUsage(event: ApiUsageEvent): Promise<void> {
  try {
    const row = toUsageRow(event)
    return track(writeBounded((destination) => destination.usage([row])))
  } catch {
    return Promise.resolve()
  }
}

export function recordDiscoveryRun(summary: DiscoveryRunSummary): Promise<void> {
  try {
    const row = {
      run_id: summary.runId,
      user_id: summary.userId,
      audience: summary.audience,
      delivered: summary.delivered,
      duplicates: summary.duplicates,
      rejected: summary.rejected,
      stop_reason: summary.stopReason ?? null,
    }
    return track(writeBounded((destination) => destination.run(row)))
  } catch {
    return Promise.resolve()
  }
}
