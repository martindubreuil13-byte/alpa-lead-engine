// Monthly reconciliation and prepaid purchases: what may be typed in, what is shown, who may write, and what is never touched.
// The real route handlers run against a fake administrator check and database that records every write.
import assert from 'node:assert/strict'
import { register } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const WORLD = pathToFileURL(path.join(ROOT, 'tests/fixtures/costs/recon-world.mjs')).href
register('data:text/javascript,' + encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}, WORLD=${JSON.stringify(WORLD)}
const MAP=new Set(['@/lib/auth/require-admin','@/lib/supabase/server','@/lib/supabase/admin'])
export async function resolve(specifier,context,next) {
 if(specifier==='next/server')return next('next/server.js',context)
 if(MAP.has(specifier))return {url:WORLD,shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`), pathToFileURL(ROOT + '/'))

const { world, reset } = await import('./fixtures/costs/recon-world.mjs')
const { parseReconciliationInput, parsePurchaseInput, parsePurchaseEditInput, buildReconciliationView } = await import('../lib/costs/reconcile.ts')
const reconciliationRoute = await import('../app/api/admin/costs/reconciliation/route.ts')
const purchasesRoute = await import('../app/api/admin/costs/purchases/route.ts')
const purchaseRoute = await import('../app/api/admin/costs/purchases/[id]/route.ts')

const TODAY = '2026-11-05'
const month = '2026-10'
const put = (body, init = {}) => reconciliationRoute.PUT(new Request('https://alpa.example/api/admin/costs/reconciliation', { method: 'PUT', headers: { 'content-type': 'application/json', host: 'alpa.example', ...init.headers }, body: JSON.stringify({ tz: 'UTC', ...body }) }))
const post = (body, init = {}) => purchasesRoute.POST(new Request('https://alpa.example/api/admin/costs/purchases', { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body: JSON.stringify({ tz: 'UTC', ...body }) }))
const patch = (id, body, init = {}) => purchaseRoute.PATCH(new Request(`https://alpa.example/api/admin/costs/purchases/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', host: 'alpa.example', ...init.headers }, body: JSON.stringify({ tz: 'UTC', ...body }) }), { params: Promise.resolve({ id: String(id) }) })
const KEY = (n) => `request-key-${n}`
const get = (m = month) => reconciliationRoute.GET(new Request(`https://alpa.example/api/admin/costs/reconciliation?month=${m}&tz=UTC`))
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
const lastMonth = () => { const [y, m] = today().split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }

test('input: a verified amount, in USD or another currency with the rate used, and nothing silently treated as USD', () => {
  const ok = parseReconciliationInput({ month, provider: 'openai', billedAmount: '12.50', currency: 'cad', exchangeRate: '0.72', reconciledOn: '2026-11-02', note: ' covered by credits ' }, TODAY)
  assert.deepEqual(ok.value, { billingMonth: '2026-10-01', provider: 'openai', billedAmount: 12.5, currency: 'CAD', exchangeRateToUsd: 0.72, reportedCredits: null, reconciledOn: '2026-11-02', note: 'covered by credits' })
  const usd = parseReconciliationInput({ month, provider: 'google_places', billedAmount: 0, reconciledOn: '2026-11-02' }, TODAY)
  assert.deepEqual([usd.ok, usd.value.billedAmount, usd.value.currency, usd.value.exchangeRateToUsd], [true, 0, 'USD', 1], 'a $0 bill is a real, reconciled figure')
  const no = (body, pattern) => { const r = parseReconciliationInput({ month, provider: 'serper', reconciledOn: '2026-11-02', ...body }, TODAY); assert.equal(r.ok, false); assert.match(r.error, pattern) }
  no({ billedAmount: 10, currency: 'CAD' }, /exchange rate/i)
  no({ billedAmount: 10, currency: 'CAD', exchangeRate: 1 }, /exchange rate/i)
  no({ billedAmount: 10, currency: 'USD', exchangeRate: 0.7 }, /no exchange rate/i)
  no({ billedAmount: 10, currency: 'CA' }, /three-letter/i)
  no({ billedAmount: 10, currency: 'CAD', exchangeRate: -2 }, /exchange rate/i)
  no({ billedAmount: -5 }, /number/i); no({ billedAmount: 'abc' }, /number/i); no({ billedAmount: 1e12 }, /number/i)
  no({ billedAmount: 5, reconciledOn: '2026-12-01' }, /future/i); no({ billedAmount: 5, reconciledOn: '2026-13-40' }, /date/i)
  no({ billedAmount: 5, reportedCredits: 'x' }, /credits/i)
  no({ month: '2026-12', billedAmount: 5 }, /not started/i); no({ month: 'nope', billedAmount: 5 }, /billing month/i)
  assert.equal(parseReconciliationInput({ month, provider: 'stripe', billedAmount: 5 }, TODAY).ok, false)
})

test('input: an empty amount keeps the month pending, notes are cleaned and bounded', () => {
  const pending = parseReconciliationInput({ month, provider: 'serper', billedAmount: '', note: 'waiting for the invoice' }, TODAY)
  assert.deepEqual([pending.ok, pending.value.billedAmount, pending.value.reconciledOn], [true, null, null])
  const noisy = parseReconciliationInput({ month, provider: 'serper', billedAmount: 1, reconciledOn: TODAY, note: `a\u0000b\n${'x'.repeat(2000)}` }, TODAY)
  assert.equal(noisy.value.note.length, 1000); assert.doesNotMatch(noisy.value.note, /[\u0000-\u001f]/)
  assert.equal(parseReconciliationInput({ month, provider: 'serper', billedAmount: 1.234567, reconciledOn: TODAY }, TODAY).value.billedAmount, 1.2346, 'amounts are kept to four decimals')
})

test('input: a prepaid purchase', () => {
  const ok = parsePurchaseInput({ requestKey: KEY(1), provider: 'serper', purchasedOn: '2026-10-01', amountPaid: '50', credits: '50,000', note: 'first pack' }, TODAY)
  assert.deepEqual(ok.value, { requestKey: KEY(1), provider: 'serper', purchasedOn: '2026-10-01', amountPaid: 50, currency: 'USD', exchangeRateToUsd: 1, credits: 50000, note: 'first pack' })
  const cad = parsePurchaseInput({ requestKey: KEY(2), provider: 'serper', purchasedOn: '2026-10-01', amountPaid: 68.5, currency: 'CAD', exchangeRate: 0.73 }, TODAY)
  assert.deepEqual([cad.value.amountPaid, cad.value.currency, cad.value.exchangeRateToUsd], [68.5, 'CAD', 0.73])
  for (const bad of [{ amountPaid: 0 }, { amountPaid: '' }, { purchasedOn: '2027-01-01' }, { purchasedOn: 'x' }, { currency: 'EUR' }, { credits: -1 }, { provider: 'nope' }, { requestKey: '' }, { requestKey: 'short' }, { requestKey: 'has spaces in it!!' }]) {
    assert.equal(parsePurchaseInput({ requestKey: KEY(3), provider: 'serper', purchasedOn: '2026-10-01', amountPaid: 50, ...bad }, TODAY).ok, false, JSON.stringify(bad))
  }
})

test('view: difference is actual minus estimated; a month without a bill is Pending and shows no billed figure; a purchase is not usage', () => {
  const view = buildReconciliationView({
    month: '2026-10-01',
    estimated: [{ provider: 'serper', requests: 100, credits: 300, cost: 0.3, unpriced: 0 }, { provider: 'google_places', requests: 400, credits: 0, cost: 12.4, unpriced: 0 }, { provider: 'openai', requests: 10, credits: 0, cost: 0.02, unpriced: 2 }],
    reconciliations: [
      { provider: 'serper', status: 'reconciled', billed_amount: 0.45, billed_currency: 'USD', exchange_rate_to_usd: 1, billed_usd: 0.45, reported_credits: 450, reconciled_on: '2026-11-02', estimated_usd_at_reconciliation: 0.3, note: 'dashboard says 450' },
      { provider: 'google_places', status: 'pending', billed_amount: null, billed_currency: 'USD', exchange_rate_to_usd: 1, billed_usd: null, reported_credits: null, reconciled_on: null, estimated_usd_at_reconciliation: null, note: 'waiting' },
    ],
    purchases: [{ id: 1, provider: 'serper', purchased_on: '2026-10-01', amount_paid: 50, currency: 'USD', exchange_rate_to_usd: 1, amount_usd: 50, credits: 50000, note: null }],
  })
  const row = (p) => view.rows.find((r) => r.provider === p)
  assert.deepEqual([row('serper').status, row('serper').billedUsd, Math.round(row('serper').differenceUsd * 100) / 100, Math.round(row('serper').differencePercent)], ['Reconciled', 0.45, 0.15, 50])
  assert.equal(row('serper').creditDifference, 150); assert.equal(row('serper').estimateChangedSinceUsd, null)
  assert.deepEqual([row('google_places').status, row('google_places').billedUsd, row('google_places').differenceUsd], ['Pending', null, null], 'Not reconciled: no billed figure and no difference')
  assert.equal(row('google_places').note, 'waiting')
  assert.equal(row('openai').status, 'Pending'); assert.equal(row('openai').unpricedRequests, 2)
  assert.equal(view.summary.reconciled, 1); assert.equal(view.summary.billedUsd, null, 'no combined billed total until every provider is reconciled')
  assert.ok(Math.abs(view.summary.estimatedUsd - 12.72) < 1e-9, 'the $50 purchase is not in the estimate')
  assert.equal(view.purchasedUsd, 50); assert.equal(view.purchases[0].credits, 50000)
})

test('view: a foreign-currency bill shows the original amount and the rate; later usage changes are flagged, not silently absorbed', () => {
  const view = buildReconciliationView({
    month: '2026-10-01',
    estimated: [{ provider: 'openai', requests: 10, credits: 0, cost: 9.5, unpriced: 0 }],
    reconciliations: [{ provider: 'openai', status: 'reconciled', billed_amount: 12.5, billed_currency: 'CAD', exchange_rate_to_usd: 0.72, billed_usd: 9, reported_credits: null, reconciled_on: '2026-11-02', estimated_usd_at_reconciliation: 8, note: null }],
    purchases: [],
  })
  const r = view.rows.find((x) => x.provider === 'openai')
  assert.deepEqual(r.original, { amount: 12.5, currency: 'CAD', rate: 0.72 }); assert.equal(r.billedUsd, 9)
  assert.equal(r.differenceUsd, 9 - 9.5)
  assert.equal(r.estimateChangedSinceUsd, 1.5, 'the estimate moved from 8 to 9.5 since it was reconciled')
})

test('routes: only an administrator may read or write, and a refused caller changes nothing', async () => {
  for (const who of ['anonymous', 'member']) {
    reset(); world.admin = who
    const status = who === 'anonymous' ? 401 : 403
    assert.equal((await get()).status, status, `${who} GET`)
    assert.equal((await put({ month, provider: 'serper', billedAmount: 1, reconciledOn: today() })).status, status, `${who} PUT`)
    assert.equal((await post({ requestKey: KEY(12), provider: 'serper', purchasedOn: today(), amountPaid: 50 })).status, status, `${who} POST`)
    assert.equal((await patch(1, { requestKey: KEY(13), expectedVersion: 1, provider: 'serper', purchasedOn: today(), amountPaid: 50 })).status, status, `${who} PATCH`)
    assert.deepEqual(world.writes, [], `${who} wrote nothing`)
  }
})

test('routes: saving a bill writes only the reconciliation row, derives nothing from the client, snapshots the estimate and records who', async () => {
  reset()
  const month0 = lastMonth()
  const response = await put({ month: month0, provider: 'openai', billedAmount: '12.5', currency: 'CAD', exchangeRate: '0.72', reconciledOn: today(), note: 'ok', billed_usd: 999, status: 'pending', updated_by: 'someone-else' })
  assert.equal(response.status, 200)
  assert.deepEqual(world.writes.map((w) => w.table), ['api_billing_reconciliations'], 'no usage record, no purchase')
  const row = world.writes[0].row
  assert.deepEqual([row.provider, row.billed_amount, row.billed_currency, row.exchange_rate_to_usd, row.status, row.billing_month], ['openai', 12.5, 'CAD', 0.72, 'reconciled', `${month0}-01`])
  assert.equal('billed_usd' in row, false, 'the USD figure is derived by the database, never taken from the client')
  assert.equal(row.updated_by, '11111111-1111-4111-8111-111111111111'); assert.notEqual(row.updated_by, 'someone-else')
  assert.equal(row.estimated_usd_at_reconciliation, 0, 'no OpenAI estimate exists for the month in this fake; the snapshot is whatever the log said')
  assert.equal(world.writes[0].options.onConflict, 'billing_month,provider', 'saving again updates the same month and provider')
  const view = (await response.json()).view
  assert.equal(view.rows.find((r) => r.provider === 'openai').billedUsd, 9)
})

test('routes: editing updates in place, clearing the amount returns the month to pending, estimates in the log are untouched', async () => {
  reset()
  const month0 = lastMonth()
  await put({ month: month0, provider: 'serper', billedAmount: 0.4, reconciledOn: today(), reportedCredits: 400 })
  let view = (await (await get(month0)).json()).view
  const serper = () => view.rows.find((r) => r.provider === 'serper')
  assert.equal(serper().status, 'Reconciled'); assert.ok(Math.abs(serper().differenceUsd - 0.04) < 1e-9, '0.40 actual minus 0.36 estimated'); assert.equal(serper().creditDifference, 40)
  await put({ month: month0, provider: 'serper', billedAmount: 0.5, reconciledOn: today(), note: 'revised invoice' })
  view = (await (await get(month0)).json()).view
  assert.equal(serper().billedUsd, 0.5); assert.equal(world.reconciliations.size, 1, 'one row per provider and month')
  await put({ month: month0, provider: 'serper', billedAmount: '' })
  view = (await (await get(month0)).json()).view
  assert.equal(serper().status, 'Pending'); assert.equal(serper().billedUsd, null)
  assert.ok(world.writes.every((w) => w.table === 'api_billing_reconciliations'))
  assert.deepEqual(world.estimates.serper, { requests: 120, credits: 360, cost: 0.36, unpriced: 0 }, 'the estimate is only ever read')
})

test('routes: invalid input and cross-site requests are refused before anything is written', async () => {
  reset()
  assert.equal((await put({ month: lastMonth(), provider: 'serper', billedAmount: 10, currency: 'CAD', reconciledOn: today() })).status, 400, 'a foreign amount without its rate')
  assert.equal((await put({ month: lastMonth(), provider: 'serper', billedAmount: -1 })).status, 400)
  assert.equal((await put({ month: '2099-01', provider: 'serper', billedAmount: 1 })).status, 400)
  const form = await reconciliationRoute.PUT(new Request('https://alpa.example/api/admin/costs/reconciliation', { method: 'PUT', headers: { 'content-type': 'text/plain', host: 'alpa.example' }, body: JSON.stringify({ month, provider: 'serper', billedAmount: 1 }) }))
  assert.equal(form.status, 415)
  assert.equal((await put({ month: lastMonth(), provider: 'serper', billedAmount: 1, reconciledOn: today() }, { headers: { origin: 'https://evil.example' } })).status, 415)
  assert.equal((await purchasesRoute.POST(new Request('https://alpa.example/api/admin/costs/purchases', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'provider=serper' }))).status, 415)
  assert.deepEqual(world.writes, [])
})

test('routes: a prepaid purchase is recorded separately and changes no estimate and no reconciliation', async () => {
  reset()
  const before = JSON.stringify(world.estimates)
  const response = await post({ requestKey: KEY(10), provider: 'serper', purchasedOn: today(), amountPaid: 50, credits: 50000, note: 'pack' })
  assert.equal(response.status, 200)
  assert.deepEqual(world.writes.map((w) => w.table), ['api_prepaid_purchases'])
  assert.deepEqual(world.writes[0].options, { onConflict: 'request_key', ignoreDuplicates: true })
  assert.equal(world.writes[0].row.created_by, '11111111-1111-4111-8111-111111111111')
  assert.equal(world.reconciliations.size, 0); assert.equal(JSON.stringify(world.estimates), before)
  const view = (await (await get(lastMonth())).json()).view
  assert.equal(view.purchasedUsd, 50)
  assert.ok(Math.abs(view.summary.estimatedUsd - 12.76) < 1e-9, 'a $50 purchase is not added to the month\'s estimated usage')
  assert.equal((await post({ requestKey: KEY(11), provider: 'serper', purchasedOn: today(), amountPaid: 68, currency: 'CAD' })).status, 400, 'a foreign purchase needs its rate')
})

test('routes: before the migration the answer is "not enabled", never an invented figure', async () => {
  reset(); world.rpcError = { code: 'PGRST202', message: 'Could not find the function' }
  assert.deepEqual(await (await get()).json(), { state: 'not_enabled' })
  const saved = await (await put({ month: lastMonth(), provider: 'serper', billedAmount: 1, reconciledOn: today() })).json()
  assert.equal(saved.state, 'not_enabled'); assert.deepEqual(world.writes, [], 'nothing was written')
})

test('purchases: a double submission stores one purchase', async () => {
  reset()
  await post({ requestKey: KEY(20), provider: 'serper', purchasedOn: today(), amountPaid: 50, credits: 50000 })
  await post({ requestKey: KEY(20), provider: 'serper', purchasedOn: today(), amountPaid: 50, credits: 50000 })
  assert.equal(world.purchases.length, 1)
  await post({ requestKey: KEY(21), provider: 'serper', purchasedOn: today(), amountPaid: 25 })
  assert.equal(world.purchases.length, 2, 'a different submission is a different purchase')
  assert.equal((await post({ provider: 'serper', purchasedOn: today(), amountPaid: 50 })).status, 400, 'a request without a key is refused')
})

const seedPurchase = async () => { reset(); await post({ requestKey: KEY(30), provider: 'serper', purchasedOn: '2026-10-01', amountPaid: 50, credits: 50000, note: 'first pack' }); world.writes.length = 0 }
const edit = (over = {}) => patch(1, { requestKey: KEY(40), expectedVersion: 1, provider: 'serper', purchasedOn: '2026-10-02', amountPaid: 55, credits: 55000, note: 'corrected', ...over })

test('edit input: the same checks as a new purchase, plus the version the form was built on', () => {
  const ok = parsePurchaseEditInput({ requestKey: KEY(1), expectedVersion: 3, provider: 'serper', purchasedOn: '2026-10-01', amountPaid: 50 }, TODAY)
  assert.equal(ok.value.expectedVersion, 3)
  for (const bad of [{ expectedVersion: 0 }, { expectedVersion: 'x' }, { expectedVersion: 1.5 }, { expectedVersion: undefined }, { currency: 'CAD' }, { amountPaid: 0 }]) {
    assert.equal(parsePurchaseEditInput({ requestKey: KEY(1), expectedVersion: 1, provider: 'serper', purchasedOn: '2026-10-01', amountPaid: 50, ...bad }, TODAY).ok, false, JSON.stringify(bad))
  }
})

test('edit route: an administrator corrects a purchase; the original is kept with who and when; only the audited function is called', async () => {
  await seedPurchase()
  const response = await edit()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual([body.status, body.version], ['updated', 2])
  assert.deepEqual(world.writes.map((w) => w.table), ['rpc:admin_edit_prepaid_purchase'], 'no usage record, reconciliation or direct table write')
  const call = world.editCalls[0]
  assert.deepEqual([call.p_id, call.p_expected_version, call.p_amount_paid, call.p_currency, call.p_rate, call.p_credits, call.p_note], [1, 1, 55, 'USD', 1, 55000, 'corrected'])
  assert.equal(call.p_admin, '11111111-1111-4111-8111-111111111111'); assert.equal(call.p_admin_label, 'owner@example.com')
  const p = body.view.purchases[0]
  assert.equal(p.version, 2); assert.equal(p.amountUsd, 55)
  assert.equal(p.history.length, 1); assert.deepEqual([p.history[0].replacedVersion, p.history[0].paid, p.history[0].credits, p.history[0].note, p.history[0].changedBy], [1, '$50.00', 50000, 'first pack', 'owner@example.com'], 'the original is preserved')
  assert.ok(p.history[0].changedAt)
})

test('edit route: a repeated submission applies once, a stale form is refused, and a refused edit changes nothing', async () => {
  await seedPurchase()
  assert.equal((await edit()).status, 200)
  const again = await edit()
  assert.equal(again.status, 200); assert.equal((await again.json()).status, 'duplicate')
  assert.equal(world.purchases[0].history.length, 1, 'the second identical submission added no history')
  const stale = await edit({ requestKey: KEY(41), amountPaid: 99 })
  assert.equal(stale.status, 409); assert.equal((await stale.json()).status, 'stale')
  assert.equal(world.purchases[0].amount_paid, 55, 'the stale form changed nothing')
  assert.equal((await edit({ requestKey: KEY(42), expectedVersion: 2, amountPaid: 56 })).status, 200)
  assert.equal(world.purchases[0].history.length, 2)
  assert.equal((await patch(99, { requestKey: KEY(43), expectedVersion: 1, provider: 'serper', purchasedOn: '2026-10-01', amountPaid: 1 })).status, 404)
})

test('edit route: invalid input and cross-site requests are refused before the database is called', async () => {
  await seedPurchase()
  const calls = () => world.editCalls.length
  assert.equal((await edit({ requestKey: '' })).status, 400)
  assert.equal((await edit({ expectedVersion: undefined })).status, 400)
  assert.equal((await edit({ currency: 'CAD' })).status, 400, 'a foreign amount without its rate')
  assert.equal((await edit({ amountPaid: -5 })).status, 400)
  assert.equal((await edit({ purchasedOn: '2099-01-01' })).status, 400)
  assert.equal((await patch('abc', { requestKey: KEY(50) })).status, 404)
  assert.equal((await purchaseRoute.PATCH(new Request('https://alpa.example/api/admin/costs/purchases/1', { method: 'PATCH', headers: { 'content-type': 'text/plain', host: 'alpa.example' }, body: '{}' }), { params: Promise.resolve({ id: '1' }) })).status, 415)
  assert.equal((await patch(1, { requestKey: KEY(51), expectedVersion: 1, provider: 'serper', purchasedOn: '2026-10-02', amountPaid: 55 }, { headers: { origin: 'https://evil.example' } })).status, 415)
  assert.equal(calls(), 0)
})

test('a purchase cannot be deleted: there is no delete route, and the delete handler refuses', async () => {
  await seedPurchase()
  const response = await purchaseRoute.DELETE()
  assert.equal(response.status, 405); assert.match((await response.json()).error, /cannot be deleted/i)
  assert.equal(world.purchases.length, 1); assert.deepEqual(world.writes, [])
  assert.equal(typeof purchasesRoute.DELETE, 'undefined', 'the collection route has no delete either')
})

test('editing a purchase never touches consumption, estimates or reconciliations', async () => {
  await seedPurchase()
  await put({ month: lastMonth(), provider: 'serper', billedAmount: 0.4, reconciledOn: today() })
  world.writes.length = 0
  const estimates = JSON.stringify(world.estimates); const recon = JSON.stringify([...world.reconciliations.entries()])
  await edit({ amountPaid: 5000, credits: 1 })
  assert.deepEqual(world.writes.map((w) => w.table), ['rpc:admin_edit_prepaid_purchase'])
  assert.equal(JSON.stringify(world.estimates), estimates); assert.equal(JSON.stringify([...world.reconciliations.entries()]), recon)
  const view = (await (await get(lastMonth())).json()).view
  assert.ok(Math.abs(view.summary.estimatedUsd - 12.76) < 1e-9, 'the month estimate is unchanged by a $5,000 purchase edit')
})

test('before the migration an edit answers "not enabled"', async () => {
  await seedPurchase(); world.rpcError = { code: 'PGRST202', message: 'Could not find the function' }
  const response = await edit()
  assert.equal(response.status, 409); assert.equal((await response.json()).state, 'not_enabled')
})
