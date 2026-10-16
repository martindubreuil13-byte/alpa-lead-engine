'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { PurchaseView, ReconciliationRow, ReconciliationView } from '@/lib/costs/reconcile'
import { PROVIDER_LABEL, RECONCILE_PROVIDERS } from '@/lib/costs/reconcile'

const GOLD = '#c9a24b'
type Payload = { state: 'ready'; view: ReconciliationView } | { state: 'not_enabled' } | { state: 'error'; message: string }

function usd(value: number | null) {
  if (value === null) return '—'
  const abs = Math.abs(value)
  return `${value < 0 ? '−' : ''}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: abs < 1 ? 4 : 2 })}`
}
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${usd(Math.abs(value))}`
const tzNow = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: tzNow(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
function previousMonth() {
  const [y, m] = todayLocal().split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

const field = 'min-h-10 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-slate-100 [color-scheme:dark] placeholder:text-slate-500'
const label = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400'

export default function CostReconciliation() {
  const [month, setMonth] = useState(previousMonth())
  const [payload, setPayload] = useState<Payload | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/costs/reconciliation?month=${month}&tz=${encodeURIComponent(tzNow())}`, { cache: 'no-store' })
      const body = (await response.json()) as Payload
      setPayload(body.state ? body : { state: 'error', message: 'The reconciliation could not be loaded.' })
    } catch {
      setPayload({ state: 'error', message: 'The reconciliation could not be loaded.' })
    }
  }, [month])
  useEffect(() => { setPayload(null); setEditing(null); setMessage(null); void load() }, [load])

  async function send(url: string, method: 'PUT' | 'POST' | 'PATCH', body: Record<string, unknown>) {
    setMessage(null)
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, tz: tzNow() }) })
      const result = await response.json()
      if (!response.ok) {
        setMessage({ tone: 'bad', text: result.error || result.message || 'It could not be saved.' })
        if (response.status === 409 && result.status === 'stale') await load() // show what the purchase looks like now
        return false
      }
      if (result.state === 'ready' && method !== 'PATCH') setPayload(result)
      else await load()
      setMessage({ tone: 'ok', text: result.status === 'unchanged' ? 'Nothing was changed.' : 'Saved.' })
      return true
    } catch {
      setMessage({ tone: 'bad', text: 'It could not be saved.' })
      return false
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-6" aria-labelledby="recon-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="recon-title" className="text-base font-semibold">Monthly reconciliation</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">How close the estimates were to what was actually charged. Enter the verified amount from each provider&rsquo;s bill. Free allowances, credits, taxes and adjustments can explain a difference. Entering a bill never changes the recorded usage.</p>
        </div>
        <div>
          <label htmlFor="recon-month" className={label}>Billing month</label>
          <input id="recon-month" type="month" value={month} max={todayLocal().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${field} mt-1 sm:w-44`} />
        </div>
      </div>

      {message ? <div role={message.tone === 'bad' ? 'alert' : 'status'} className="mt-4 rounded-xl px-3 py-2 text-sm" style={message.tone === 'bad' ? { background: 'rgba(251,191,36,.1)', color: '#fde68a' } : { background: 'rgba(52,211,153,.1)', color: '#a7f3d0' }}>{message.text}</div> : null}

      {!payload ? <div className="mt-4 h-24 animate-pulse rounded-2xl bg-white/[0.04]" aria-label="Loading reconciliation" /> : null}
      {payload?.state === 'not_enabled' ? <p className="mt-4 text-sm text-slate-300"><strong className="font-semibold">Not switched on yet.</strong> The reconciliation tables have not been created in this database.</p> : null}
      {payload?.state === 'error' ? <p role="alert" className="mt-4 text-sm text-amber-200">{payload.message}</p> : null}
      {payload?.state === 'ready' ? (
        <>
          <ul className="mt-4 space-y-3" data-testid="recon-rows">
            {payload.view.rows.map((row) => (
              <li key={row.provider} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <Row row={row} editing={editing === row.provider} onEdit={() => setEditing(editing === row.provider ? null : row.provider)} />
                {editing === row.provider ? (
                  <ProviderForm row={row} month={month} onSave={async (body) => { const ok = await send('/api/admin/costs/reconciliation', 'PUT', body); if (ok) setEditing(null) }} />
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-400">{payload.view.summary.reconciled} of {payload.view.summary.total} providers reconciled · estimated {usd(payload.view.summary.estimatedUsd)}{payload.view.summary.billedUsd !== null ? ` · billed ${usd(payload.view.summary.billedUsd)}` : ''}.</p>
          <Purchases view={payload.view} onAdd={(body) => send('/api/admin/costs/purchases', 'POST', body)} onEdit={(id, body) => send(`/api/admin/costs/purchases/${id}`, 'PATCH', body)} />
        </>
      ) : null}
    </section>
  )
}

function Row({ row, editing, onEdit }: { row: ReconciliationRow; editing: boolean; onEdit: () => void }) {
  const done = row.status === 'Reconciled'
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{row.label}</h3>
        <span className="flex items-center gap-3">
          <span data-testid={`status-${row.provider}`} className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={done ? { background: 'rgba(52,211,153,.14)', color: '#a7f3d0' } : { background: 'rgba(201,162,75,.14)', color: '#e8dcc0' }}>{row.status}</span>
          <button type="button" onClick={onEdit} aria-expanded={editing} className="min-h-9 rounded-lg px-3 text-xs font-medium underline-offset-4 hover:underline" style={{ color: GOLD }}>{editing ? 'Close' : done ? 'Edit' : 'Enter bill'}</button>
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className={label}>Estimated cost</dt><dd className="mt-1 tabular-nums">{usd(row.estimatedUsd)}{row.unpricedRequests > 0 ? <span className="ml-1 text-xs text-amber-300" title="Some requests have no known price">*</span> : null}</dd></div>
        <div><dt className={label}>Actual billed cost</dt><dd className="mt-1 tabular-nums" data-testid={`billed-${row.provider}`}>{row.billedUsd === null ? <span className="text-slate-300">Not reconciled</span> : usd(row.billedUsd)}{row.original && row.original.currency !== 'USD' ? <span className="block text-xs text-slate-400">{row.original.amount.toLocaleString('en-US')} {row.original.currency} @ {row.original.rate}</span> : null}</dd></div>
        <div><dt className={label}>Difference</dt><dd className="mt-1 tabular-nums" data-testid={`diff-${row.provider}`}>{row.differenceUsd === null ? '—' : <>{signed(row.differenceUsd)}{row.differencePercent !== null ? <span className="ml-1 text-xs text-slate-400">({row.differencePercent > 0 ? '+' : ''}{row.differencePercent.toFixed(1)}%)</span> : null}</>}</dd></div>
        <div><dt className={label}>Reconciled on</dt><dd className="mt-1">{row.reconciledOn ?? '—'}</dd></div>
      </dl>
      {row.reportedCredits !== null ? <p className="mt-2 text-xs text-slate-400">Credits: provider reported {row.reportedCredits.toLocaleString('en-US')}, ALPA estimated {row.estimatedCredits.toLocaleString('en-US')} ({row.creditDifference! > 0 ? '+' : ''}{row.creditDifference!.toLocaleString('en-US')}).</p> : null}
      {row.estimateChangedSinceUsd !== null ? <p className="mt-2 text-xs text-amber-200">The estimate has changed by {signed(row.estimateChangedSinceUsd)} since this was reconciled (usage was recorded afterwards, or prices were revised).</p> : null}
      {row.note ? <p className="mt-2 text-xs leading-5 text-slate-300">Note: {row.note}</p> : null}
      {row.provider === 'google_places' && !done ? <p className="mt-2 text-xs leading-5 text-slate-400">The estimate is before Google&rsquo;s free allowance, which is shared with other applications in the same Google project; a $0 bill is expected while usage stays inside it.</p> : null}
      {row.provider === 'serper' ? <p className="mt-2 text-xs leading-5 text-slate-400">Serper is prepaid: enter the value of the credits consumed that month (credits used × price per credit), not the purchase price.</p> : null}
    </div>
  )
}

function ProviderForm({ row, month, onSave }: { row: ReconciliationRow; month: string; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [amount, setAmount] = useState(row.original ? String(row.original.amount) : '')
  const [currency, setCurrency] = useState(row.original?.currency ?? 'USD')
  const [rate, setRate] = useState(row.original && row.original.currency !== 'USD' ? String(row.original.rate) : '')
  const [on, setOn] = useState(row.reconciledOn ?? todayLocal())
  const [credits, setCredits] = useState(row.reportedCredits !== null ? String(row.reportedCredits) : '')
  const [note, setNote] = useState(row.note ?? '')
  const [saving, setSaving] = useState(false)
  const foreign = currency.trim().toUpperCase() !== 'USD' && currency.trim() !== ''
  const id = (name: string) => `${row.provider}-${name}`
  return (
    <form className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault(); setSaving(true)
      await onSave({ month, provider: row.provider, billedAmount: amount, currency, exchangeRate: foreign ? rate : undefined, reconciledOn: on, reportedCredits: credits, note })
      setSaving(false)
    }}>
      <div><label htmlFor={id('amount')} className={label}>Billed amount (verified)</label><input id={id('amount')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Leave empty to keep pending" className={`${field} mt-1`} /></div>
      <div><label htmlFor={id('currency')} className={label}>Currency</label><input id={id('currency')} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={`${field} mt-1`} /></div>
      {foreign ? <div><label htmlFor={id('rate')} className={label}>Exchange rate used (USD per 1 {currency || '…'})</label><input id={id('rate')} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={`${field} mt-1`} /></div> : null}
      <div><label htmlFor={id('date')} className={label}>Reconciled on</label><input id={id('date')} type="date" value={on} max={todayLocal()} onChange={(e) => setOn(e.target.value)} className={`${field} mt-1`} /></div>
      {row.provider === 'serper' ? <div><label htmlFor={id('credits')} className={label}>Credits used (per Serper dashboard)</label><input id={id('credits')} inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} className={`${field} mt-1`} /></div> : null}
      <div className="sm:col-span-2"><label htmlFor={id('note')} className={label}>Note (optional)</label><textarea id={id('note')} value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="e.g. covered by Google's free allowance" className={`${field} mt-1 py-2`} /></div>
      <div className="sm:col-span-2"><button type="submit" disabled={saving} className="min-h-10 rounded-full px-5 text-sm font-semibold disabled:opacity-60" style={{ background: GOLD, color: '#0b1730' }}>{saving ? 'Saving…' : 'Save reconciliation'}</button></div>
    </form>
  )
}

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`)

function Purchases({ view, onAdd, onEdit }: { view: ReconciliationView; onAdd: (body: Record<string, unknown>) => Promise<boolean>; onEdit: (id: number, body: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [showHistory, setShowHistory] = useState<number | null>(null)
  return (
    <div className="mt-6 border-t border-white/10 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Prepaid credit purchases</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">Recorded separately. Buying credits is not that month&rsquo;s usage expense, and it is never added to the estimates or to a reconciliation. A purchase can be corrected but not deleted; every earlier version is kept.</p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-9 shrink-0 rounded-lg px-3 text-xs font-medium underline-offset-4 hover:underline" style={{ color: GOLD }}>{open ? 'Close' : 'Add purchase'}</button>
      </div>
      {view.purchases.length === 0 ? <p className="mt-3 text-sm text-slate-400">No purchases recorded.</p> : (
        <ul className="mt-3 space-y-3 text-sm" data-testid="purchases">
          {view.purchases.map((p) => (
            <li key={p.id} data-testid={`purchase-${p.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span>{p.purchasedOn} · {p.label}{p.credits !== null ? ` · ${p.credits.toLocaleString('en-US')} credits` : ''}{p.note ? <span className="text-slate-400"> · {p.note}</span> : null}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-slate-300">{p.paid} · {usd(p.amountUsd)}</span>
                  <button type="button" onClick={() => { setEditing(editing === p.id ? null : p.id); setShowHistory(null) }} aria-expanded={editing === p.id} className="min-h-9 rounded-lg px-2 text-xs font-medium underline-offset-4 hover:underline" style={{ color: GOLD }}>{editing === p.id ? 'Close' : 'Edit'}</button>
                </span>
              </div>
              {p.history.length > 0 ? (
                <div className="mt-1 text-xs text-slate-400">
                  Edited {p.history.length} {p.history.length === 1 ? 'time' : 'times'}{p.updatedAt ? `, last ${new Date(p.updatedAt).toLocaleDateString('en-CA')}` : ''} ·{' '}
                  <button type="button" onClick={() => setShowHistory(showHistory === p.id ? null : p.id)} aria-expanded={showHistory === p.id} className="underline underline-offset-4" style={{ color: GOLD }}>{showHistory === p.id ? 'Hide history' : 'Show history'}</button>
                </div>
              ) : null}
              {showHistory === p.id ? <History purchase={p} /> : null}
              {editing === p.id ? <EditPurchase purchase={p} onSave={async (body) => { const ok = await onEdit(p.id, body); if (ok) setEditing(null); return ok }} /> : null}
            </li>
          ))}
        </ul>
      )}
      {open ? <NewPurchase onAdd={async (body) => { const ok = await onAdd(body); if (ok) setOpen(false); return ok }} /> : null}
    </div>
  )
}

function History({ purchase }: { purchase: PurchaseView }) {
  return (
    <ol data-testid={`history-${purchase.id}`} className="mt-2 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-300">
      {purchase.history.map((h) => (
        <li key={h.replacedVersion}>
          <span className="font-medium text-slate-100">{h.replacedVersion === 1 ? 'Original' : `Version ${h.replacedVersion}`}:</span>{' '}
          {h.purchasedOn} · {h.paid} ({usd(h.amountUsd)}){h.credits !== null ? ` · ${h.credits.toLocaleString('en-US')} credits` : ''}{h.note ? ` · ${h.note}` : ''}
          <span className="block text-slate-400">Replaced {new Date(h.changedAt).toLocaleString('en-CA')}{h.changedBy ? ` by ${h.changedBy}` : ''}</span>
        </li>
      ))}
    </ol>
  )
}

type PurchaseFormValues = { date: string; amount: string; currency: string; rate: string; credits: string; note: string }

function PurchaseFields({ v, set, idPrefix }: { v: PurchaseFormValues; set: (patch: Partial<PurchaseFormValues>) => void; idPrefix: string }) {
  const foreign = v.currency.trim().toUpperCase() !== 'USD' && v.currency.trim() !== ''
  const id = (name: string) => `${idPrefix}-${name}`
  return (
    <>
      <div><label htmlFor={id('date')} className={label}>Purchased on</label><input id={id('date')} type="date" value={v.date} max={todayLocal()} onChange={(e) => set({ date: e.target.value })} className={`${field} mt-1`} /></div>
      <div><label htmlFor={id('amount')} className={label}>Amount paid</label><input id={id('amount')} inputMode="decimal" value={v.amount} onChange={(e) => set({ amount: e.target.value })} className={`${field} mt-1`} /></div>
      <div><label htmlFor={id('currency')} className={label}>Currency</label><input id={id('currency')} value={v.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} className={`${field} mt-1`} /></div>
      {foreign ? <div><label htmlFor={id('rate')} className={label}>Exchange rate used (USD per 1 {v.currency || '…'})</label><input id={id('rate')} inputMode="decimal" value={v.rate} onChange={(e) => set({ rate: e.target.value })} className={`${field} mt-1`} /></div> : null}
      <div><label htmlFor={id('credits')} className={label}>Credits purchased</label><input id={id('credits')} inputMode="decimal" value={v.credits} onChange={(e) => set({ credits: e.target.value })} className={`${field} mt-1`} /></div>
      <div className="sm:col-span-2"><label htmlFor={id('note')} className={label}>Note (optional)</label><input id={id('note')} value={v.note} maxLength={1000} onChange={(e) => set({ note: e.target.value })} className={`${field} mt-1`} /></div>
    </>
  )
}

function NewPurchase({ onAdd }: { onAdd: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [provider, setProvider] = useState('serper')
  const [v, setV] = useState<PurchaseFormValues>({ date: todayLocal(), amount: '', currency: 'USD', rate: '', credits: '', note: '' })
  const key = useRef(newKey()) // one key per opening of the form: a double click or a repeated submit stores one purchase
  const [saving, setSaving] = useState(false)
  const foreign = v.currency.trim().toUpperCase() !== 'USD' && v.currency.trim() !== ''
  return (
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault()
      if (saving) return
      setSaving(true)
      await onAdd({ requestKey: key.current, provider, purchasedOn: v.date, amountPaid: v.amount, currency: v.currency, exchangeRate: foreign ? v.rate : undefined, credits: v.credits, note: v.note })
      setSaving(false)
    }}>
      <div><label htmlFor="p-provider" className={label}>Provider</label><select id="p-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={`${field} mt-1`}>{RECONCILE_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}</select></div>
      <PurchaseFields v={v} set={(patch) => setV({ ...v, ...patch })} idPrefix="p" />
      <div className="sm:col-span-2"><button type="submit" disabled={saving} className="min-h-10 rounded-full px-5 text-sm font-semibold disabled:opacity-60" style={{ background: GOLD, color: '#0b1730' }}>{saving ? 'Saving…' : 'Save purchase'}</button></div>
    </form>
  )
}

function EditPurchase({ purchase, onSave }: { purchase: PurchaseView; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [v, setV] = useState<PurchaseFormValues>({
    date: purchase.form.purchasedOn, amount: String(purchase.form.amountPaid), currency: purchase.form.currency,
    rate: purchase.form.exchangeRate === null ? '' : String(purchase.form.exchangeRate), credits: purchase.credits === null ? '' : String(purchase.credits), note: purchase.note ?? '',
  })
  const key = useRef(newKey())
  const [saving, setSaving] = useState(false)
  const foreign = v.currency.trim().toUpperCase() !== 'USD' && v.currency.trim() !== ''
  return (
    <form className="mt-3 grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-2" aria-label={`Edit purchase ${purchase.id}`} onSubmit={async (event) => {
      event.preventDefault()
      if (saving) return
      setSaving(true)
      const ok = await onSave({ requestKey: key.current, expectedVersion: purchase.version, provider: purchase.provider, purchasedOn: v.date, amountPaid: v.amount, currency: v.currency, exchangeRate: foreign ? v.rate : undefined, credits: v.credits, note: v.note })
      if (!ok) setSaving(false) // after a refused save the same request key may be used again for the same, corrected, attempt
    }}>
      <p className="text-xs leading-5 text-slate-400 sm:col-span-2">Saving keeps the current values in this purchase&rsquo;s history. It does not change any recorded API usage, estimate or reconciliation.</p>
      <PurchaseFields v={v} set={(patch) => setV({ ...v, ...patch })} idPrefix={`e${purchase.id}`} />
      <div className="sm:col-span-2"><button type="submit" disabled={saving} className="min-h-10 rounded-full px-5 text-sm font-semibold disabled:opacity-60" style={{ background: GOLD, color: '#0b1730' }}>{saving ? 'Saving…' : 'Save correction'}</button></div>
    </form>
  )
}
