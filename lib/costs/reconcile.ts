import type { Provider } from './pricing.ts'

// Monthly reconciliation: what a provider actually charged, entered by an administrator, set against ALPA's estimate. Pure: validation of
// what is typed in, and the figures shown. Nothing here touches the request-level usage records.

export const RECONCILE_PROVIDERS: Provider[] = ['serper', 'google_places', 'openai']
export const PROVIDER_LABEL: Record<Provider, string> = { serper: 'Serper', google_places: 'Google Places', openai: 'OpenAI' }

export type ReconciliationInput = {
  billingMonth: string // YYYY-MM-01
  provider: Provider
  /** null clears the figure and leaves the month pending. */
  billedAmount: number | null
  currency: string
  exchangeRateToUsd: number
  reportedCredits: number | null
  reconciledOn: string | null
  note: string | null
}
export type PurchaseInput = {
  /** Identifies one submission of the form: sending it twice stores or applies it once. */
  requestKey: string
  provider: Provider
  purchasedOn: string
  amountPaid: number
  currency: string
  exchangeRateToUsd: number
  credits: number | null
  note: string | null
}
export type PurchaseEditInput = PurchaseInput & { expectedVersion: number }
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const YMD = /^\d{4}-\d{2}-\d{2}$/
const isDate = (value: unknown): value is string => typeof value === 'string' && YMD.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const cents4 = (value: number) => Math.round(value * 10_000) / 10_000
const MAX_AMOUNT = 1_000_000_000

function number(value: unknown): number | null | undefined {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function money(raw: { currency?: unknown; exchangeRate?: unknown }): Parsed<{ currency: string; rate: number }> {
  const currency = String(raw.currency ?? 'USD').trim().toUpperCase() || 'USD'
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'The currency must be a three-letter code such as USD or CAD.' }
  const rate = number(raw.exchangeRate)
  if (currency === 'USD') {
    if (rate !== null && rate !== undefined && rate !== 1) return { ok: false, error: 'An amount in USD needs no exchange rate.' }
    return { ok: true, value: { currency, rate: 1 } }
  }
  // A foreign amount is never treated as USD by default: the rate used must be stated.
  if (rate === null || rate === undefined || rate <= 0 || rate > 1_000_000 || rate === 1) return { ok: false, error: `Enter the exchange rate used to convert ${currency} to USD (USD per 1 ${currency}).` }
  return { ok: true, value: { currency, rate: Math.round(rate * 1e6) / 1e6 } }
}

const cleanNote = (value: unknown) => {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return text ? text.slice(0, 1000) : null
}

/** `today` is the administrator's current date (YYYY-MM-DD); a bill or a purchase cannot be dated after it. */
export function parseReconciliationInput(body: any, today: string): Parsed<ReconciliationInput> {
  const monthText = String(body?.month ?? '')
  const month = /^\d{4}-\d{2}$/.test(monthText) ? `${monthText}-01` : monthText
  if (!isDate(month) || !month.endsWith('-01')) return { ok: false, error: 'Choose the billing month.' }
  if (month > `${today.slice(0, 7)}-01`) return { ok: false, error: 'A month that has not started cannot be reconciled.' }
  const provider = body?.provider as Provider
  if (!RECONCILE_PROVIDERS.includes(provider)) return { ok: false, error: 'Choose Serper, Google Places or OpenAI.' }

  const amount = number(body?.billedAmount)
  if (amount === undefined || (amount !== null && (amount < 0 || amount > MAX_AMOUNT))) return { ok: false, error: 'Enter the billed amount as a number, or leave it empty to keep the month pending.' }
  const credits = number(body?.reportedCredits)
  if (credits === undefined || (credits !== null && (credits < 0 || credits > MAX_AMOUNT))) return { ok: false, error: 'Credits used must be a number.' }

  const currency = money({ currency: body?.currency, exchangeRate: body?.exchangeRate })
  if (!currency.ok) return currency

  let reconciledOn: string | null = null
  if (amount !== null) {
    reconciledOn = String(body?.reconciledOn ?? today)
    if (!isDate(reconciledOn)) return { ok: false, error: 'Enter the date this was reconciled.' }
    if (reconciledOn > today) return { ok: false, error: 'The reconciliation date cannot be in the future.' }
  }
  return {
    ok: true,
    value: {
      billingMonth: month, provider, billedAmount: amount === null ? null : cents4(amount), currency: currency.value.currency,
      exchangeRateToUsd: currency.value.rate, reportedCredits: credits, reconciledOn, note: cleanNote(body?.note),
    },
  }
}

const REQUEST_KEY = /^[A-Za-z0-9_-]{8,64}$/

export function parsePurchaseInput(body: any, today: string): Parsed<PurchaseInput> {
  const requestKey = String(body?.requestKey ?? '')
  if (!REQUEST_KEY.test(requestKey)) return { ok: false, error: 'Reload the page and try again.' }
  const provider = body?.provider as Provider
  if (!RECONCILE_PROVIDERS.includes(provider)) return { ok: false, error: 'Choose Serper, Google Places or OpenAI.' }
  const purchasedOn = String(body?.purchasedOn ?? '')
  if (!isDate(purchasedOn)) return { ok: false, error: 'Enter the purchase date.' }
  if (purchasedOn > today) return { ok: false, error: 'The purchase date cannot be in the future.' }
  const amount = number(body?.amountPaid)
  if (amount === null || amount === undefined || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, error: 'Enter the amount paid.' }
  const credits = number(body?.credits)
  if (credits === undefined || (credits !== null && (credits <= 0 || credits > MAX_AMOUNT))) return { ok: false, error: 'Credits purchased must be a positive number.' }
  const currency = money({ currency: body?.currency, exchangeRate: body?.exchangeRate })
  if (!currency.ok) return currency
  return { ok: true, value: { requestKey, provider, purchasedOn, amountPaid: cents4(amount), currency: currency.value.currency, exchangeRateToUsd: currency.value.rate, credits, note: cleanNote(body?.note) } }
}

/** An edit: the same fields as a new purchase, plus the version the person was looking at (a stale form is refused). */
export function parsePurchaseEditInput(body: any, today: string): Parsed<PurchaseEditInput> {
  const parsed = parsePurchaseInput(body, today)
  if (!parsed.ok) return parsed
  const version = Number(body?.expectedVersion)
  if (!Number.isInteger(version) || version < 1 || version > 100_000) return { ok: false, error: 'Reload the page and try again.' }
  return { ok: true, value: { ...parsed.value, expectedVersion: version } }
}

// ---- what is shown ---------------------------------------------------------------------------------------------------------------
export type RawReconciliation = {
  month: string
  estimated: { provider: Provider; requests: number; credits: number; cost: number; unpriced: number }[]
  reconciliations: {
    provider: Provider; status: 'pending' | 'reconciled'; billed_amount: number | null; billed_currency: string; exchange_rate_to_usd: number
    billed_usd: number | null; reported_credits: number | null; reconciled_on: string | null; estimated_usd_at_reconciliation: number | null; note: string | null
  }[]
  purchases: {
    id: number; provider: Provider; purchased_on: string; amount_paid: number; currency: string; exchange_rate_to_usd: number; amount_usd: number
    credits: number | null; note: string | null; version?: number; updated_at?: string | null
    history?: { replaced_version: number; purchased_on: string; amount_paid: number; currency: string; exchange_rate_to_usd: number; amount_usd: number; credits: number | null; note: string | null; changed_by_label: string | null; changed_at: string }[]
  }[]
}

const num = (value: unknown) => { const v = Number(value); return Number.isFinite(v) ? v : 0 }

export type ReconciliationRow = {
  provider: Provider; label: string
  estimatedUsd: number; estimatedCredits: number; unpricedRequests: number
  /** Null until an administrator enters a verified figure: shown as "Not reconciled". */
  billedUsd: number | null
  original: { amount: number; currency: string; rate: number } | null
  differenceUsd: number | null
  differencePercent: number | null
  status: 'Pending' | 'Reconciled'
  reconciledOn: string | null
  note: string | null
  reportedCredits: number | null
  creditDifference: number | null
  /** The estimate has moved since it was reconciled (more usage was recorded for that month, or prices were revised). */
  estimateChangedSinceUsd: number | null
}
export type PurchaseView = {
  id: number; provider: Provider; label: string; purchasedOn: string; paid: string; amountUsd: number; credits: number | null; note: string | null
  /** What an edit form starts from. */
  form: { amountPaid: number; currency: string; exchangeRate: number | null; purchasedOn: string }
  version: number
  updatedAt: string | null
  /** The earlier values of this purchase, oldest first. The first entry is the original. */
  history: { replacedVersion: number; purchasedOn: string; paid: string; amountUsd: number; credits: number | null; note: string | null; changedBy: string | null; changedAt: string }[]
}
export type ReconciliationView = {
  month: string
  rows: ReconciliationRow[]
  purchases: PurchaseView[]
  purchasedUsd: number
  summary: { reconciled: number; total: number; estimatedUsd: number; billedUsd: number | null }
}

const paidText = (amount: number, currency: string, rate: number) =>
  currency === 'USD' ? `$${num(amount).toFixed(2)}` : `${num(amount).toFixed(2)} ${currency} @ ${num(rate)}`

export function buildReconciliationView(raw: RawReconciliation): ReconciliationView {
  const rows = RECONCILE_PROVIDERS.map((provider): ReconciliationRow => {
    const est = raw.estimated?.find((row) => row.provider === provider)
    const rec = raw.reconciliations?.find((row) => row.provider === provider)
    const estimatedUsd = num(est?.cost)
    const billedUsd = rec && rec.billed_usd !== null && rec.billed_usd !== undefined ? num(rec.billed_usd) : null
    const reconciled = rec?.status === 'reconciled' && billedUsd !== null
    const difference = reconciled && billedUsd !== null ? billedUsd - estimatedUsd : null
    const snapshot = rec?.estimated_usd_at_reconciliation
    const estimatedCredits = num(est?.credits)
    const reported = rec && rec.reported_credits !== null && rec.reported_credits !== undefined ? num(rec.reported_credits) : null
    return {
      provider, label: PROVIDER_LABEL[provider], estimatedUsd, estimatedCredits, unpricedRequests: num(est?.unpriced),
      billedUsd: reconciled ? billedUsd : null,
      original: reconciled && rec ? { amount: num(rec.billed_amount), currency: rec.billed_currency, rate: num(rec.exchange_rate_to_usd) } : null,
      differenceUsd: difference,
      differencePercent: difference !== null && estimatedUsd > 0 ? (difference / estimatedUsd) * 100 : null,
      status: reconciled ? 'Reconciled' : 'Pending',
      reconciledOn: reconciled ? rec?.reconciled_on ?? null : null,
      note: rec?.note ?? null,
      reportedCredits: reported,
      creditDifference: reported !== null ? reported - estimatedCredits : null,
      estimateChangedSinceUsd: reconciled && snapshot !== null && snapshot !== undefined && Math.abs(estimatedUsd - num(snapshot)) > 0.0005 ? estimatedUsd - num(snapshot) : null,
    }
  })
  const done = rows.filter((row) => row.status === 'Reconciled')
  return {
    month: raw.month,
    rows,
    purchases: (raw.purchases ?? []).map((p): PurchaseView => ({
      id: p.id, provider: p.provider, label: PROVIDER_LABEL[p.provider], purchasedOn: p.purchased_on, paid: paidText(p.amount_paid, p.currency, p.exchange_rate_to_usd),
      amountUsd: num(p.amount_usd), credits: p.credits === null ? null : num(p.credits), note: p.note,
      form: { amountPaid: num(p.amount_paid), currency: p.currency, exchangeRate: p.currency === 'USD' ? null : num(p.exchange_rate_to_usd), purchasedOn: p.purchased_on },
      version: p.version ?? 1, updatedAt: p.updated_at ?? null,
      history: (p.history ?? []).map((h) => ({
        replacedVersion: h.replaced_version, purchasedOn: h.purchased_on, paid: paidText(h.amount_paid, h.currency, h.exchange_rate_to_usd), amountUsd: num(h.amount_usd),
        credits: h.credits === null ? null : num(h.credits), note: h.note, changedBy: h.changed_by_label, changedAt: h.changed_at,
      })),
    })),
    purchasedUsd: (raw.purchases ?? []).reduce((t, p) => t + num(p.amount_usd), 0),
    summary: {
      reconciled: done.length, total: rows.length, estimatedUsd: rows.reduce((t, r) => t + r.estimatedUsd, 0),
      billedUsd: done.length === rows.length ? done.reduce((t, r) => t + (r.billedUsd ?? 0), 0) : null,
    },
  }
}
