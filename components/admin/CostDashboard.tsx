'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import CostReconciliation from '@/components/admin/CostReconciliation'
import { classifyTrackingHealth, type TrackingHealth } from '@/lib/costs/health'
import type { CostReport, LimitStatus, SeriesPoint, SpendNow } from '@/lib/costs/report'

type Preset = 'today' | '7d' | '30d' | 'custom'
type Payload =
  | { state: 'ready'; report: CostReport; range: { from: string; to: string; days: number } }
  | { state: 'not_enabled' }
  | { state: 'error'; message: string }

const NAVY = '#0b1730'
const GOLD = '#c9a24b'
const IVORY = '#f6f1e4'
const COLORS = { serper: '#7fa6e8', google_places: GOLD, openai: '#e9e2cf' } as const
const NAMES = { serper: 'Serper', google_places: 'Google Places', openai: 'OpenAI' } as const

/** Small amounts keep their precision: a fraction of a cent matters here. */
function usd(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  const abs = Math.abs(value)
  const digits = abs === 0 ? 2 : abs < 0.01 ? 5 : abs < 1 ? 4 : 2
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits === 5 ? 4 : Math.min(digits, 2), maximumFractionDigits: digits })}`
}
const int = (value: number) => Math.round(value).toLocaleString('en-US')

export const REFRESH_MS = 60_000

export default function CostDashboard() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const inFlight = useRef(false)
  const latest = useRef(0)

  const load = useCallback(async (silent = false) => {
    if (preset === 'custom' && (!from || !to)) return
    // A background refresh never overlaps another request; a choice the person just made always goes through, and only the newest answer is used.
    if (silent && inFlight.current) return
    const ticket = ++latest.current
    inFlight.current = true
    if (!silent) setLoading(true)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const query = new URLSearchParams({ range: preset, tz })
      if (preset === 'custom') { query.set('from', from); query.set('to', to) }
      const response = await fetch(`/api/admin/costs?${query}`, { cache: 'no-store' })
      const body = (await response.json()) as Partial<Payload> & { error?: string }
      if (ticket !== latest.current) return
      // A background refresh that fails keeps the figures already on screen and says they may be out of date.
      if (body.state && !(silent && body.state === 'error')) { setPayload(body as Payload); setFailed(null); if (body.state === 'ready') setUpdatedAt(new Date()) }
      else setFailed(silent ? 'The latest figures could not be loaded; the numbers below may be out of date.' : body.error || 'The cost figures could not be loaded.')
    } catch {
      if (ticket !== latest.current) return
      setFailed(silent ? 'The latest figures could not be loaded; the numbers below may be out of date.' : 'The cost figures could not be loaded.')
    } finally {
      if (ticket === latest.current) { inFlight.current = false; if (!silent) setLoading(false) }
    }
  }, [preset, from, to])

  useEffect(() => { void load() }, [load])

  // Refresh from ALPA's own database every 60 seconds while the page is open and visible. No provider is contacted.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(true) }
    const timer = window.setInterval(tick, REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible' && (!updatedAt || Date.now() - updatedAt.getTime() >= REFRESH_MS)) void load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load, updatedAt])

  return (
    <div className="space-y-6 pb-10" style={{ color: IVORY }}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>Admin</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Cost intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">What it costs to find and research businesses. Figures are estimates at list price from ALPA&rsquo;s own request log, not provider invoices.</p>
        </div>
        <Filters preset={preset} setPreset={setPreset} from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </header>

      {failed ? <Notice tone="warn">{failed}</Notice> : null}
      {payload?.state === 'not_enabled' ? <><HealthPanel health={classifyTrackingHealth(null, 'not_enabled')} /><NotEnabled /></> : null}
      {payload?.state === 'error' ? <Notice tone="warn">{payload.message}</Notice> : null}
      {payload?.state === 'ready' ? <Report report={payload.report} dim={loading} updatedAt={updatedAt} /> : null}
      <CostReconciliation />
      {!payload && loading ? <div className="h-40 animate-pulse rounded-3xl bg-white/[0.04]" aria-label="Loading" /> : null}
    </div>
  )
}

function Filters(props: { preset: Preset; setPreset: (p: Preset) => void; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const options: { id: Preset; label: string }[] = [{ id: 'today', label: 'Today' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }, { id: 'custom', label: 'Custom' }]
  return (
    <div className="flex flex-col gap-3 sm:items-end">
      <div role="group" aria-label="Date range" className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
        {options.map((option) => (
          <button key={option.id} type="button" onClick={() => props.setPreset(option.id)} aria-pressed={props.preset === option.id}
            className="min-h-9 rounded-full px-4 text-sm font-medium transition-colors"
            style={props.preset === option.id ? { background: GOLD, color: NAVY } : { color: '#cbd5e1' }}>
            {option.label}
          </button>
        ))}
      </div>
      {props.preset === 'custom' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="sr-only" htmlFor="cost-from">From</label>
          <input id="cost-from" type="date" value={props.from} max={props.to || undefined} onChange={(e) => props.setFrom(e.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-slate-100 [color-scheme:dark]" />
          <span className="text-slate-500">to</span>
          <label className="sr-only" htmlFor="cost-to">To</label>
          <input id="cost-to" type="date" value={props.to} min={props.from || undefined} onChange={(e) => props.setTo(e.target.value)} className="min-h-9 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-slate-100 [color-scheme:dark]" />
        </div>
      ) : null}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <div role={tone === 'warn' ? 'alert' : 'note'} className="rounded-2xl border px-4 py-3 text-sm leading-6"
      style={tone === 'warn' ? { borderColor: 'rgba(251,191,36,.35)', background: 'rgba(251,191,36,.08)', color: '#fde68a' } : { borderColor: 'rgba(201,162,75,.3)', background: 'rgba(201,162,75,.07)', color: '#e8dcc0' }}>
      {children}
    </div>
  )
}

function NotEnabled() {
  return (
    <Notice tone="info">
      <strong className="font-semibold">Request-level tracking is not switched on yet.</strong> The cost tables have not been created in this database, so no spending is shown rather than showing zeros that look real. Nothing is being estimated or reconstructed.
    </Notice>
  )
}

const HEALTH_STYLE = {
  healthy: { label: 'Healthy', border: 'rgba(52,211,153,.35)', bg: 'rgba(52,211,153,.06)', color: '#a7f3d0' },
  degraded: { label: 'Degraded', border: 'rgba(251,191,36,.45)', bg: 'rgba(251,191,36,.08)', color: '#fde68a' },
  unknown: { label: 'Unknown', border: 'rgba(148,163,184,.35)', bg: 'rgba(148,163,184,.06)', color: '#cbd5e1' },
} as const

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'none recorded'
}

function HealthPanel({ health }: { health: TrackingHealth }) {
  const style = HEALTH_STYLE[health.state]
  return (
    <section aria-label="Tracking health" data-testid="health" data-state={health.state} role={health.state === 'degraded' ? 'alert' : 'region'} className="rounded-2xl border p-4" style={{ borderColor: style.border, background: style.bg }}>
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="health-badge" className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: style.border, color: style.color }}>{style.label}</span>
        <h2 className="text-sm font-semibold" style={{ color: style.color }}>{health.headline}</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{health.detail}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Recorded, last 24 h</dt><dd className="mt-1 tabular-nums">{int(health.events24h)} requests</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Discovery runs checked</dt><dd className="mt-1 tabular-nums">{health.expectedRuns === 0 ? 'none to check' : `${int(health.coveredRuns)} of ${int(health.expectedRuns)} recorded`}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Known failed recordings</dt><dd className="mt-1 tabular-nums" data-testid="failure-count">{int(health.failures7d)} in 7 days · {int(health.failures30d)} in 30 days</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Most recent failure</dt><dd className="mt-1" data-testid="last-failure">{when(health.lastFailureAt)}</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-5 text-slate-400">{health.caveat}</p>
    </section>
  )
}

function NowStrip({ now }: { now: CostReport['now'] }) {
  const chips = (spend: SpendNow) => (['serper', 'google_places', 'openai'] as const).map((k) => (
    <span key={k} className="flex items-center gap-1.5 text-xs text-slate-300"><span className="inline-block size-2 rounded-full" style={{ background: COLORS[k] }} />{NAMES[k]} <span className="tabular-nums text-slate-100">{usd(spend.byProvider[k])}</span></span>
  ))
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Spending now">
      <div className="rounded-2xl border p-4" style={{ borderColor: 'rgba(201,162,75,.35)', background: 'rgba(201,162,75,.06)' }}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>Today · estimated</div>
        <div className="mt-2 text-3xl font-semibold tabular-nums" data-testid="today-total">{usd(now.today.total)}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{chips(now.today)}</div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">This month so far · estimated</div>
        <div className="mt-2 text-3xl font-semibold tabular-nums" data-testid="month-total">{usd(now.month.total)}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{chips(now.month)}</div>
        <div className="mt-2 text-xs text-slate-400">{int(now.monthDelivered)} businesses delivered · {usd(now.monthCostPerDelivered)} estimated per business</div>
      </div>
    </div>
  )
}

function Card({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums" style={accent ? { color: GOLD } : undefined}>{value}</div>
      {hint ? <div className="mt-1 text-xs leading-5 text-slate-400">{hint}</div> : null}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {note ? <p className="mt-1 text-xs leading-5 text-slate-400">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Report({ report, dim, updatedAt }: { report: CostReport; dim: boolean; updatedAt: Date | null }) {
  const h = report.headline
  const empty = report.table.length === 0
  return (
    <div className={`space-y-6 transition-opacity ${dim ? 'opacity-60' : ''}`}>
      <HealthPanel health={report.health} />
      <NowStrip now={report.now} />
      <div className="text-xs text-slate-400" data-testid="updated-at">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-CA')} · refreshes every 60 seconds from ALPA's own records` : 'Loading…'}</div>

      <Notice tone="info">
        <strong className="font-semibold">Estimated, not billed.</strong> Estimates use the prices configured as of {report.pricingAsOf}, before any free monthly allowance or credit; the monthly reconciliation below compares them with what was actually charged.{' '}
        {report.trackingSince ? <>Request-level tracking began {new Date(report.trackingSince).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}; nothing earlier is reconstructed.</> : <>No requests have been recorded yet.</>}
      </Notice>

      {report.limits.some((l) => l.state === 'approaching' || l.state === 'over') ? (
        <Notice tone="warn">{report.limits.filter((l) => l.state !== 'ok' && l.state !== 'not_measured').map((l) => `${labelFor(l)} is at ${Math.round(l.percent ?? 0)}% of its ${usd(l.limitUsd)} monthly ceiling`).join('. ')}. Alert only: nothing is blocked.</Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card label="Est. API spending" value={usd(h.totalCost)} hint="Estimated, selected range" accent />
        <Card label="Businesses delivered" value={int(h.delivered)} hint={`${int(h.runs)} runs · ${int(h.duplicates)} duplicates · ${int(h.rejected)} rejected`} />
        <Card label="Est. cost per business" value={usd(h.costPerDelivered)} hint="Serper + Google ÷ delivered" />
        <Card label="Est. AI research" value={usd(h.aiCost)} hint={h.aiProfiles > 0 ? `${int(h.aiProfiles)} profiles · ${usd(h.aiCostPerProfile)} each` : 'No profiles in range'} />
        <Card label="Gross contribution" value="Not available" hint={report.contribution.reason} />
      </div>

      {empty ? (
        <Section title="No requests in this range"><p className="text-sm text-slate-400">Nothing was recorded for the selected dates.</p></Section>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Daily spending" note="Estimated cost per day, by provider, before free allowances."><DailyBars series={report.series} pick="total" stacked /></Section>
            <Section title="Spending by provider"><ProviderBars report={report} /></Section>
            <Section title="Cost per delivered business" note="Discovery cost (Serper + Google) ÷ businesses delivered that day. Days without a delivery have no value."><LineChart series={report.series} /></Section>
            <Section title="Request volume" note="Provider requests per day."><DailyBars series={report.series} pick="requests" /></Section>
          </div>

          <Section title="Breakdown" note="A Google Place Details request is one request however many data SKUs it generated.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  <tr><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3">Operation</th><th className="py-2 pr-3 text-right">Requests</th><th className="py-2 pr-3 text-right">Credits / tokens</th><th className="py-2 pr-3 text-right">Est. cost</th><th className="py-2 text-right">Unit cost</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {report.table.map((row) => (
                    <tr key={`${row.provider}-${row.operation}`}>
                      <td className="py-2.5 pr-3 font-medium">{row.label}</td><td className="py-2.5 pr-3 text-slate-300">{row.operation}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{int(row.requests)}</td><td className="py-2.5 pr-3 text-right tabular-nums text-slate-300">{row.creditsOrTokens}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{usd(row.cost)}{row.unpriced > 0 ? <span className="ml-1 text-xs text-amber-300" title="Some requests have no known price">*</span> : null}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-300">{usd(row.unitCost)} <span className="text-xs text-slate-500">{row.unitLabel}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-white/10 font-semibold"><td className="py-2.5" colSpan={2}>Total</td><td className="py-2.5 pr-3 text-right tabular-nums">{int(report.table.reduce((t, r) => t + r.requests, 0))}</td><td /><td className="py-2.5 pr-3 text-right tabular-nums" style={{ color: GOLD }}>{usd(h.totalCost)}</td><td /></tr></tfoot>
              </table>
            </div>
            {report.table.some((r) => r.unpriced > 0) ? <p className="mt-3 text-xs text-amber-200/90">* Requests marked here used a model with no known price. Their tokens are counted; their cost is not invented.</p> : null}
          </Section>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Google billing events" note="One Google request generates several billing events (its base SKU plus data SKUs). They are events of a single request, not extra requests. Google's free monthly allowance is shared across the whole Google project, so it cannot be worked out from ALPA's own counts.">
          {report.googleSkuEvents.length === 0 ? <p className="text-sm text-slate-400">No Google requests in this range.</p> : (
            <ul className="space-y-3 text-sm">
              {report.googleSkuEvents.map((row) => (
                <li key={row.sku} className="flex items-baseline justify-between gap-3"><span>{row.label}</span><span className="tabular-nums text-slate-300">{int(row.events)} events</span></li>
              ))}
              <li className="border-t border-white/10 pt-3 text-xs text-slate-400">Actual billed amount: <span className="text-slate-200">Not reconciled</span> until entered in the monthly reconciliation.</li>
            </ul>
          )}
        </Section>
        <Section title="Spending ceilings" note="Alerts only, measured against this month's estimated spending before free allowances. Nothing is enforced or blocked.">
          {report.limits.length === 0 ? <p className="text-sm text-slate-400">No ceilings are configured.</p> : (
            <ul className="space-y-3 text-sm">
              {report.limits.map((limit) => (
                <li key={`${limit.scope}-${limit.provider}`} className="flex items-baseline justify-between gap-3">
                  <span>{labelFor(limit)}</span>
                  <span className="tabular-nums text-slate-300">{limit.spentUsd === null ? 'per-run (not measured here)' : `${usd(limit.spentUsd)} of ${usd(limit.limitUsd)}`} · {limit.state.replace('_', ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Earlier research spending" note={report.history.note}>
        {report.history.available ? (
          <p className="text-sm text-slate-300"><span className="tabular-nums" style={{ color: GOLD }}>{usd(report.history.total)}</span> across {int(report.history.daily.reduce((t, r) => t + r.settled, 0))} settled research charges on {report.history.daily.length} {report.history.daily.length === 1 ? "day" : "days"} in this range (estimates from token counts).</p>
        ) : <p className="text-sm text-slate-400">Nothing earlier than request-level tracking exists for this range.</p>}
      </Section>
    </div>
  )
}

function labelFor(limit: Pick<LimitStatus, 'scope' | 'provider'>) {
  const name = limit.provider === 'all' ? 'All providers' : NAMES[limit.provider as keyof typeof NAMES] ?? limit.provider
  return `${name} (${limit.scope})`
}

const W = 520
const H = 190
const PAD = { l: 44, r: 8, t: 8, b: 24 }

function DailyBars({ series, pick, stacked }: { series: SeriesPoint[]; pick: 'total' | 'requests'; stacked?: boolean }) {
  const max = Math.max(...series.map((p) => (pick === 'total' ? p.total : p.requests)), 0.0000001)
  const band = (W - PAD.l - PAD.r) / Math.max(series.length, 1)
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max)
  const summary = pick === 'total' ? `Daily estimated spending, peak ${usd(max)}` : `Daily requests, peak ${int(max)}`
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full">
        <Axis max={max} fmt={pick === 'total' ? usd : int} />
        {series.map((p, i) => {
          const x = PAD.l + band * i + band * 0.15
          const bw = Math.max(1, band * 0.7)
          if (pick === 'requests') return <rect key={p.day} x={x} y={y(p.requests)} width={bw} height={H - PAD.b - y(p.requests)} fill={GOLD} rx={1.5}><title>{`${p.day}: ${int(p.requests)} requests`}</title></rect>
          let base = H - PAD.b
          return (
            <g key={p.day}>
              {(['serper', 'google_places', 'openai'] as const).map((k) => {
                const height = (H - PAD.t - PAD.b) * (p[k] / max)
                base -= height
                return height > 0 ? <rect key={k} x={x} y={base} width={bw} height={height} fill={COLORS[k]}><title>{`${p.day} · ${NAMES[k]}: ${usd(p[k])}`}</title></rect> : null
              })}
            </g>
          )
        })}
        <XLabels series={series} band={band} />
      </svg>
      {stacked ? <Legend /> : null}
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}

function LineChart({ series }: { series: SeriesPoint[] }) {
  const pts = series.map((p, i) => ({ p, i })).filter(({ p }) => p.costPerBusiness !== null)
  if (pts.length === 0) return <p className="text-sm text-slate-400">No deliveries in this range.</p>
  const max = Math.max(...pts.map(({ p }) => p.costPerBusiness as number), 0.0000001)
  const band = (W - PAD.l - PAD.r) / Math.max(series.length, 1)
  const x = (i: number) => PAD.l + band * i + band / 2
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max)
  const d = pts.map(({ p, i }, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.costPerBusiness as number).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cost per delivered business, peak ${usd(max)}`} className="h-auto w-full">
      <Axis max={max} fmt={usd} />
      <path d={d} fill="none" stroke={GOLD} strokeWidth={2} />
      {pts.map(({ p, i }) => <circle key={p.day} cx={x(i)} cy={y(p.costPerBusiness as number)} r={3} fill={GOLD}><title>{`${p.day}: ${usd(p.costPerBusiness)} per business (${int(p.delivered)} delivered)`}</title></circle>)}
      <XLabels series={series} band={band} />
    </svg>
  )
}

function ProviderBars({ report }: { report: CostReport }) {
  const max = Math.max(...report.providers.map((p) => p.cost), 0.0000001)
  return (
    <ul className="space-y-4">
      {report.providers.map((p) => (
        <li key={p.provider}>
          <div className="flex items-baseline justify-between text-sm"><span className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-full" style={{ background: COLORS[p.provider] }} />{p.label}</span><span className="tabular-nums">{usd(p.cost)}</span></div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${(p.cost / max) * 100}%`, background: COLORS[p.provider] }} /></div>
          <div className="mt-1 text-xs text-slate-400 tabular-nums">{int(p.requests)} requests{p.failed > 0 ? ` (${int(p.failed)} failed)` : ''}{p.provider === 'serper' ? ` · ${int(p.credits)} credits` : ''}{p.provider === 'openai' ? ` · ${int(p.tokens)} tokens` : ''} · {usd(p.unitCost)} {p.unitLabel}</div>
        </li>
      ))}
    </ul>
  )
}

function Legend() {
  return <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">{(['serper', 'google_places', 'openai'] as const).map((k) => <span key={k} className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: COLORS[k] }} />{NAMES[k]}</span>)}</div>
}

function Axis({ max, fmt }: { max: number; fmt: (v: number) => string }) {
  return (
    <g stroke="rgba(255,255,255,.12)" fontSize={10} fill="#94a3b8">
      {[0, 0.5, 1].map((t) => {
        const yy = PAD.t + (H - PAD.t - PAD.b) * (1 - t)
        return <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} /><text x={PAD.l - 6} y={yy + 3} textAnchor="end" stroke="none">{fmt(max * t)}</text></g>
      })}
    </g>
  )
}

function XLabels({ series, band }: { series: SeriesPoint[]; band: number }) {
  if (series.length === 0) return null
  const step = Math.max(1, Math.ceil(series.length / 6))
  return <g fontSize={10} fill="#94a3b8">{series.map((p, i) => (i % step === 0 ? <text key={p.day} x={PAD.l + band * i + band / 2} y={H - 8} textAnchor="middle">{p.day.slice(5)}</text> : null))}</g>
}
