import { currentCostContext, type CostContext } from '@/lib/costs/context'
import type { Operation, Provider } from '@/lib/costs/pricing'

// Recording a provider call must never change what the customer gets: every failure here is swallowed, nothing is awaited by the
// caller, and the row holds only counts, ids and the estimate. No keys, no query text, no request or response bodies, no email addresses.

export type ApiUsageEvent = {
  provider: Provider
  operation: Operation
  requestCount?: number
  credits?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  model?: string | null
  /** Google data SKUs this one request generated. They share a single event, so a request is never counted twice. */
  skus?: string[] | null
  estimatedCostUsd: number | null
  ok: boolean
  httpStatus?: number | null
  /** Businesses this request returned. */
  resultsReturned?: number | null
  context?: Partial<CostContext>
}

export type UsageRow = {
  provider: Provider
  operation: Operation
  purpose: CostContext['purpose']
  audience: CostContext['audience']
  run_id: string | null
  user_id: string | null
  request_count: number
  credits: number | null
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

type Sink = {
  usage: (rows: UsageRow[]) => Promise<unknown>
  run: (row: Record<string, unknown>) => Promise<unknown>
}

let sink: Sink | null = null
/** Tests replace the destination; production uses the admin client. */
export function setCostSink(next: Sink | null) { sink = next }

async function defaultSink(): Promise<Sink> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const client = createAdminClient() as any
  return {
    usage: async (rows) => client.from('api_usage_events').insert(rows),
    run: async (row) => client.from('api_usage_runs').upsert(row, { onConflict: 'run_id' }),
  }
}

export function toUsageRow(event: ApiUsageEvent): UsageRow {
  const context = { ...currentCostContext(), ...event.context }
  return {
    provider: event.provider,
    operation: event.operation,
    purpose: context.purpose ?? 'other',
    audience: context.audience ?? 'system',
    run_id: context.runId ?? null,
    user_id: context.userId ?? null,
    request_count: event.requestCount ?? 1,
    credits: event.credits ?? null,
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

const pending = new Set<Promise<unknown>>()
function track(work: Promise<unknown>) {
  pending.add(work)
  void work.finally(() => pending.delete(work))
}
/** Lets a serverless handler or a test wait for outstanding writes. Never throws. */
export async function flushCostRecords() { await Promise.allSettled([...pending]) }

export function recordApiUsage(event: ApiUsageEvent) {
  try {
    const row = toUsageRow(event)
    track((async () => { try { await (sink ?? await defaultSink()).usage([row]) } catch { /* recording never affects the request */ } })())
  } catch { /* recording never affects the request */ }
}

export function recordDiscoveryRun(summary: DiscoveryRunSummary) {
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
    track((async () => { try { await (sink ?? await defaultSink()).run(row) } catch { /* recording never affects the request */ } })())
  } catch { /* recording never affects the request */ }
}
