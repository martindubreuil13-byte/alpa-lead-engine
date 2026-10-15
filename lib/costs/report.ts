import { PRICING_AS_OF, type Provider } from './pricing.ts'

// Turns the database's aggregated answer into what the dashboard shows. Pure: no database, no provider call. Everything here is an
// ESTIMATE at list price from ALPA's own request log; nothing is read from a provider's billing.

export type RangePreset = 'today' | '7d' | '30d' | 'custom'
export const MAX_CUSTOM_DAYS = 366

export type OperationRow = {
  provider: Provider; operation: string; requests: number; failed: number | null; credits: number; input_tokens: number
  output_tokens: number; cost: number; unpriced: number | null
}
export type PurposeRow = { provider: Provider; purpose: string; requests: number; ok_requests: number; cost: number }
export type DailyRow = { day: string; provider: Provider; requests: number; cost: number }
export type RawOverview = {
  by_operation: OperationRow[]
  by_purpose: PurposeRow[]
  daily: DailyRow[]
  daily_delivered: { day: string; runs: number; delivered: number }[]
  runs: { count: number; delivered: number; duplicates: number; rejected: number }
  first_event_at: string | null
  today_by_provider: { provider: Provider; cost: number }[]
  month_by_provider: { provider: Provider; cost: number }[]
  month_delivered: number
  google_sku_events: Record<string, number>
}
export type RawHistory = { daily: { day: string; settled: number; cost: number }[]; first_settled_at: string | null }
export type LimitRow = { scope: 'monthly' | 'run'; provider: Provider | 'all'; limit_usd: number; alert_at_percent: number; enforce: boolean }

export type DateRange = { from: Date; to: Date; days: number }
export type RangeResult = { ok: true; range: DateRange } | { ok: false; error: string }

const DAY = 86_400_000
const dayStart = (date: Date, tz: string) => {
  // Midnight in `tz` for the calendar day `date` falls on.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  return zonedMidnight(parts, tz)
}
function zonedMidnight(ymd: string, tz: string) {
  const guess = new Date(`${ymd}T00:00:00Z`)
  const offset = tzOffsetMs(guess, tz)
  const first = new Date(guess.getTime() - offset)
  const corrected = tzOffsetMs(first, tz)
  return new Date(guess.getTime() - corrected)
}
function tzOffsetMs(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - date.getTime()
}
const isYmd = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
export const isValidTimeZone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false } }

/** The half-open range [from, to) for a preset or a custom pair of calendar days (both inclusive), in the viewer's time zone. */
export function resolveRange(input: { preset?: string | null; from?: string | null; to?: string | null; tz?: string | null }, now = new Date()): RangeResult {
  const tz = input.tz && isValidTimeZone(input.tz) ? input.tz : 'UTC'
  const today = dayStart(now, tz)
  const addDays = (date: Date, n: number) => zonedMidnight(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date.getTime() + n * DAY + DAY / 2)), tz)
  const tomorrow = addDays(today, 1)
  const preset = (input.preset || '30d') as RangePreset
  if (preset === 'today') return { ok: true, range: { from: today, to: tomorrow, days: 1 } }
  if (preset === '7d') return { ok: true, range: { from: addDays(today, -6), to: tomorrow, days: 7 } }
  if (preset === '30d') return { ok: true, range: { from: addDays(today, -29), to: tomorrow, days: 30 } }
  if (preset === 'custom') {
    if (!isYmd(input.from) || !isYmd(input.to)) return { ok: false, error: 'Choose a start and an end date.' }
    const from = zonedMidnight(input.from, tz)
    const to = addDays(zonedMidnight(input.to, tz), 1)
    if (to <= from) return { ok: false, error: 'The end date must not be before the start date.' }
    const days = Math.round((to.getTime() - from.getTime()) / DAY)
    if (days > MAX_CUSTOM_DAYS) return { ok: false, error: `Choose at most ${MAX_CUSTOM_DAYS} days.` }
    return { ok: true, range: { from, to, days } }
  }
  return { ok: false, error: 'Unknown date range.' }
}

const n = (value: unknown) => { const v = Number(value); return Number.isFinite(v) ? v : 0 }
const ratio = (cost: number, count: number) => (count > 0 ? cost / count : null)

export type ProviderSummary = {
  provider: Provider; label: string; requests: number; failed: number; credits: number; tokens: number; cost: number; unitCost: number | null; unitLabel: string
}
export type TableRow = {
  provider: Provider; label: string; operation: string; requests: number; creditsOrTokens: string; cost: number; unitCost: number | null; unitLabel: string; unpriced: number
}
export type SeriesPoint = { day: string; serper: number; google_places: number; openai: number; total: number; requests: number; costPerBusiness: number | null; delivered: number }
export type SkuEventRow = { sku: string; label: string; events: number }
export type SpendNow = { total: number; byProvider: Record<Provider, number> }
export type LimitStatus = { scope: string; provider: string; limitUsd: number; spentUsd: number | null; percent: number | null; alertAtPercent: number; state: 'ok' | 'approaching' | 'over' | 'not_measured'; enforced: boolean }

export type CostReport = {
  pricingAsOf: string
  basis: 'estimate'
  trackingSince: string | null
  headline: {
    totalCost: number; delivered: number; costPerDelivered: number | null; discoveryCost: number; aiCost: number; aiProfiles: number
    aiCostPerProfile: number | null; runs: number; duplicates: number; rejected: number
  }
  contribution: { available: false; reason: string }
  providers: ProviderSummary[]
  table: TableRow[]
  series: SeriesPoint[]
  /** Spending today and this month so far, whatever range is being viewed. Estimates, before any free allowance. */
  now: { today: SpendNow; month: SpendNow; monthDelivered: number; monthCostPerDelivered: number | null }
  /** Google billing events (SKUs) in the range. One request produces several; they are events, not additional requests. */
  googleSkuEvents: SkuEventRow[]
  limits: LimitStatus[]
  history: { available: boolean; note: string; daily: { day: string; cost: number; settled: number }[]; total: number }
}

const LABEL: Record<Provider, string> = { serper: 'Serper', google_places: 'Google Places', openai: 'OpenAI' }
const OP_LABEL: Record<string, string> = { maps_search: 'Maps search', text_search: 'Text Search', place_details: 'Place Details', chat_completion: 'Chat completions' }
const SKU_LABEL: Record<string, string> = { text_search: 'Text Search', place_details: 'Place Details', basic_data: 'Basic Data', contact_data: 'Contact Data', atmosphere_data: 'Atmosphere Data' }
const SKU_ORDER = ['text_search', 'place_details', 'basic_data', 'contact_data', 'atmosphere_data']
const PROFILE_PURPOSES = new Set(['research_profile', 'guest_profile'])

function spendNow(rows: { provider: Provider; cost: number }[] | undefined): SpendNow {
  const byProvider: Record<Provider, number> = { serper: 0, google_places: 0, openai: 0 }
  for (const row of rows ?? []) byProvider[row.provider] += n(row.cost)
  return { total: byProvider.serper + byProvider.google_places + byProvider.openai, byProvider }
}

export function buildCostReport(raw: RawOverview, history: RawHistory | null, limits: LimitRow[], range: DateRange): CostReport {
  const ops = (raw.by_operation ?? []).map((row) => ({ ...row, requests: n(row.requests), failed: n(row.failed), credits: n(row.credits), input_tokens: n(row.input_tokens), output_tokens: n(row.output_tokens), cost: n(row.cost), unpriced: n(row.unpriced) }))
  const purposes = raw.by_purpose ?? []
  const delivered = n(raw.runs?.delivered)
  const sum = (rows: { cost: number }[]) => rows.reduce((total, row) => total + row.cost, 0)

  const providers = (['serper', 'google_places', 'openai'] as Provider[]).map((provider): ProviderSummary => {
    const rows = ops.filter((row) => row.provider === provider)
    const requests = rows.reduce((t, r) => t + r.requests, 0)
    const cost = sum(rows)
    const tokens = rows.reduce((t, r) => t + r.input_tokens + r.output_tokens, 0)
    const profiles = purposes.filter((p) => p.provider === 'openai' && PROFILE_PURPOSES.has(p.purpose)).reduce((t, p) => t + n(p.ok_requests), 0)
    return {
      provider, label: LABEL[provider], requests, failed: rows.reduce((t, r) => t + r.failed, 0), credits: rows.reduce((t, r) => t + r.credits, 0), tokens, cost,
      unitCost: provider === 'openai' ? ratio(cost, profiles) : ratio(cost, requests),
      unitLabel: provider === 'openai' ? 'per AI profile' : 'per request',
    }
  })

  const table = ops.map((row): TableRow => ({
    provider: row.provider, label: LABEL[row.provider], operation: OP_LABEL[row.operation] ?? row.operation, requests: row.requests,
    creditsOrTokens: row.provider === 'serper' ? `${row.credits.toLocaleString('en-US')} credits` : row.provider === 'openai' ? `${(row.input_tokens + row.output_tokens).toLocaleString('en-US')} tokens` : 'priced per billing event',
    cost: row.cost, unitCost: ratio(row.cost, row.requests), unitLabel: 'per request', unpriced: row.unpriced,
  }))

  const discoveryCost = sum(ops.filter((row) => row.provider !== 'openai'))
  const aiRows = purposes.filter((p) => p.provider === 'openai')
  const aiCost = aiRows.reduce((t, p) => t + n(p.cost), 0)
  const aiProfiles = aiRows.filter((p) => PROFILE_PURPOSES.has(p.purpose)).reduce((t, p) => t + n(p.ok_requests), 0)
  const profileCost = aiRows.filter((p) => PROFILE_PURPOSES.has(p.purpose)).reduce((t, p) => t + n(p.cost), 0)

  // Daily series, one point per calendar day of the range (days with no activity are zero, not missing).
  const byDay = new Map<string, SeriesPoint>()
  const deliveredByDay = new Map((raw.daily_delivered ?? []).map((row) => [row.day, n(row.delivered)]))
  const ensure = (day: string) => {
    if (!byDay.has(day)) byDay.set(day, { day, serper: 0, google_places: 0, openai: 0, total: 0, requests: 0, costPerBusiness: null, delivered: deliveredByDay.get(day) ?? 0 })
    return byDay.get(day)!
  }
  for (const row of raw.daily ?? []) {
    const point = ensure(row.day)
    point[row.provider] += n(row.cost); point.total += n(row.cost); point.requests += n(row.requests)
  }
  for (const day of deliveredByDay.keys()) ensure(day)
  const discoveryByDay = new Map<string, number>()
  for (const row of raw.daily ?? []) if (row.provider !== 'openai') discoveryByDay.set(row.day, (discoveryByDay.get(row.day) ?? 0) + n(row.cost))
  const series = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  for (const point of series) point.costPerBusiness = ratio(discoveryByDay.get(point.day) ?? 0, point.delivered)

  const skuCounts = raw.google_sku_events ?? {}
  const googleSkuEvents = Object.keys(skuCounts)
    .sort((a, b) => (SKU_ORDER.indexOf(a) === -1 ? 99 : SKU_ORDER.indexOf(a)) - (SKU_ORDER.indexOf(b) === -1 ? 99 : SKU_ORDER.indexOf(b)))
    .map((sku): SkuEventRow => ({ sku, label: SKU_LABEL[sku] ?? sku, events: n(skuCounts[sku]) }))

  const monthSpend = new Map((raw.month_by_provider ?? []).map((row) => [row.provider, n(row.cost)]))
  const monthAll = [...monthSpend.values()].reduce((t, v) => t + v, 0)
  const limitStatus = limits.map((limit): LimitStatus => {
    const spent = limit.scope === 'monthly' ? (limit.provider === 'all' ? monthAll : monthSpend.get(limit.provider as Provider) ?? 0) : null
    const percent = spent === null ? null : (spent / limit.limit_usd) * 100
    const state: LimitStatus['state'] = percent === null ? 'not_measured' : percent >= 100 ? 'over' : percent >= limit.alert_at_percent ? 'approaching' : 'ok'
    return { scope: limit.scope, provider: limit.provider, limitUsd: n(limit.limit_usd), spentUsd: spent, percent, alertAtPercent: limit.alert_at_percent, state, enforced: false }
  })

  // Earlier research spending: only for days before call-level tracking began, so the same dollars are never counted twice.
  const trackingSince = raw.first_event_at
  const earlier = (history?.daily ?? []).filter((row) => !trackingSince || row.day < trackingSince.slice(0, 10)).map((row) => ({ day: row.day, cost: n(row.cost), settled: n(row.settled) }))
  const histTotal = earlier.reduce((t, row) => t + row.cost, 0)

  return {
    pricingAsOf: PRICING_AS_OF,
    basis: 'estimate',
    trackingSince,
    headline: {
      totalCost: sum(ops), delivered, costPerDelivered: ratio(discoveryCost, delivered), discoveryCost, aiCost, aiProfiles,
      aiCostPerProfile: ratio(profileCost, aiProfiles), runs: n(raw.runs?.count), duplicates: n(raw.runs?.duplicates), rejected: n(raw.runs?.rejected),
    },
    contribution: { available: false, reason: 'No reliable revenue figure is connected: subscription revenue is not read from Stripe here, so a margin would be a guess.' },
    now: {
      today: spendNow(raw.today_by_provider),
      month: spendNow(raw.month_by_provider),
      monthDelivered: n(raw.month_delivered),
      monthCostPerDelivered: ratio(
        (raw.month_by_provider ?? []).filter((row) => row.provider !== 'openai').reduce((t, row) => t + n(row.cost), 0),
        n(raw.month_delivered)
      ),
    },
    googleSkuEvents,
    providers, table, series, limits: limitStatus,
    history: {
      available: earlier.length > 0,
      note: earlier.length > 0
        ? 'Research spending recorded by the research billing records before request-level tracking began. Estimates from token counts; discovery (Serper, Google) was not recorded then and is not shown.'
        : 'No spending was recorded before request-level tracking began, and none is reconstructed.',
      daily: earlier, total: histTotal,
    },
  }
}
