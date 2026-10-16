// The proposed cost-intelligence migration, run for real in an in-process Postgres (PGlite): the aggregate function must count a Google
// request once however many data SKUs it generated, split days in the requested time zone, and expose nothing to customers.
// Skipped where @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite@0.2.17 to run it).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

let PGlite = null
try { ({ PGlite } = await import('@electric-sql/pglite')) } catch { /* optional dependency */ }
const skip = PGlite ? false : 'set up @electric-sql/pglite to run the cost intelligence SQL tests'

async function database() {
  const db = new PGlite()
  await db.exec("create role anon; create role authenticated; create role service_role;")
  // The existing production table the history function reads (structure only).
  await db.exec("create table discover_save_receipts (run_id uuid primary key, user_id uuid, created_at timestamptz not null default now())")
  await db.exec("create table ci_research_charges (queue_id uuid, attempt int, run_id uuid, user_id uuid, reserved_usd numeric, actual_usd numeric, state text, created_at timestamptz default now(), settled_at timestamptz)")
  await db.exec(fs.readFileSync('supabase/proposed/20261017_api_cost_intelligence.sql', 'utf8'))
  return db
}
let seq = 0
const add = (db, row) => db.query(
  `insert into api_usage_events (event_key, created_at, provider, operation, purpose, run_id, request_count, credits, input_tokens, output_tokens, skus, estimated_cost_usd, ok)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [row.key ?? `k${++seq}`, row.at, row.provider, row.operation, row.purpose ?? 'discovery', row.run ?? null, row.n ?? 1, row.credits ?? null, row.in ?? null, row.out ?? null, row.skus ?? null, row.cost ?? null, row.ok ?? true])
const overview = async (db, from, to, tz = 'UTC') => (await db.query('select admin_cost_overview($1::timestamptz,$2::timestamptz,$3) as o', [from, to, tz])).rows[0].o
const RUN = '00000000-0000-4000-8000-000000000001'

test('the migration applies cleanly and its rollback removes only what it added', { skip }, async () => {
  const db = await database()
  const tables = (await db.query("select table_name from information_schema.tables where table_name like 'api_%' order by 1")).rows.map((r) => r.table_name)
  assert.deepEqual(tables, ['api_billing_reconciliations', 'api_cost_limits', 'api_prepaid_purchase_history', 'api_prepaid_purchases', 'api_tracking_failures', 'api_usage_events', 'api_usage_runs'])
  await db.exec(fs.readFileSync('supabase/proposed/20261017_api_cost_intelligence_rollback.sql', 'utf8'))
  assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_name like 'api_%'")).rows[0].n, 0)
})

test('an empty ledger gives an empty, well-formed answer', { skip }, async () => {
  const db = await database()
  const o = await overview(db, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')
  assert.deepEqual(o.by_operation, []); assert.deepEqual(o.daily, []); assert.equal(o.runs.count, 0); assert.equal(o.first_event_at, null)
})

test('totals, units, failed requests and a Google details request that carries several SKUs counted once', { skip }, async () => {
  const db = await database()
  await add(db, { at: '2026-10-05T12:00:00Z', provider: 'serper', operation: 'maps_search', credits: 3, cost: 0.003, run: RUN })
  await add(db, { at: '2026-10-05T12:00:01Z', provider: 'serper', operation: 'maps_search', credits: 0, cost: 0, ok: false })
  await add(db, { at: '2026-10-05T12:00:02Z', provider: 'google_places', operation: 'text_search', skus: ['text_search', 'basic_data', 'contact_data', 'atmosphere_data'], cost: 0.04, run: RUN })
  await add(db, { at: '2026-10-05T12:00:03Z', provider: 'google_places', operation: 'place_details', skus: ['place_details', 'basic_data', 'contact_data'], cost: 0.02, run: RUN })
  await add(db, { at: '2026-10-05T12:00:04Z', provider: 'openai', operation: 'chat_completion', purpose: 'research_profile', in: 1000, out: 200, cost: 0.00027 })
  await add(db, { at: '2026-10-05T12:00:05Z', provider: 'openai', operation: 'chat_completion', purpose: 'research_profile', in: 500, out: 100, cost: null })
  await db.query("insert into api_usage_runs (run_id, created_at, delivered, duplicates, rejected) values ($1, '2026-10-05T12:01:00Z', 7, 2, 3)", [RUN])
  const o = await overview(db, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')
  const op = (p, n) => o.by_operation.find((r) => r.provider === p && r.operation === n)
  assert.equal(op('serper', 'maps_search').requests, 2); assert.equal(op('serper', 'maps_search').failed, 1); assert.equal(Number(op('serper', 'maps_search').credits), 3)
  assert.equal(op('google_places', 'place_details').requests, 1, 'one details request, however many SKUs it generated')
  assert.equal(Number(op('google_places', 'place_details').cost), 0.02)
  assert.equal(Number(op('openai', 'chat_completion').input_tokens), 1500); assert.equal(op('openai', 'chat_completion').unpriced, 1, 'an unknown price is reported, not invented')
  assert.deepEqual(o.runs, { count: 1, delivered: 7, duplicates: 2, rejected: 3 })
  assert.deepEqual(o.google_sku_events, { text_search: 1, basic_data: 2, contact_data: 2, atmosphere_data: 1, place_details: 1 }, 'billing events per SKU; two requests produced five events')
  const totalCost = o.by_operation.reduce((sum, r) => sum + Number(r.cost), 0)
  assert.ok(Math.abs(totalCost - 0.06327) < 1e-9)
})

test('the range is half-open and days follow the requested time zone', { skip }, async () => {
  const db = await database()
  await add(db, { at: '2026-10-05T03:30:00Z', provider: 'serper', operation: 'maps_search', credits: 1, cost: 0.001 }) // Oct 4 in Toronto
  await add(db, { at: '2026-10-05T15:00:00Z', provider: 'serper', operation: 'maps_search', credits: 1, cost: 0.001 })
  await add(db, { at: '2026-10-06T00:00:00Z', provider: 'serper', operation: 'maps_search', credits: 1, cost: 0.001 }) // the end bound: excluded
  const utc = await overview(db, '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z')
  assert.deepEqual(utc.daily.map((d) => [d.day, d.requests]), [['2026-10-05', 2]])
  const toronto = await overview(db, '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z', 'America/Toronto')
  assert.deepEqual(toronto.daily.map((d) => [d.day, d.requests]), [['2026-10-04', 1], ['2026-10-05', 1]])
})

test('customers and anonymous callers can read and write nothing; limits start empty and unenforced', { skip }, async () => {
  const db = await database()
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['api_usage_events', 'api_usage_runs', 'api_cost_limits', 'api_billing_reconciliations', 'api_prepaid_purchases', 'api_prepaid_purchase_history', 'api_tracking_failures']) {
      const rows = (await db.query("select has_table_privilege($1, $2, 'select') s, has_table_privilege($1, $2, 'insert') i", [role, table])).rows[0]
      assert.deepEqual(rows, { s: false, i: false }, `${role} on ${table}`)
    }
    for (const fn of ['admin_cost_overview(timestamptz,timestamptz,text)', 'admin_research_history(timestamptz,timestamptz,text)', 'admin_reconciliation_overview(date,text)', 'admin_tracking_health()', 'admin_edit_prepaid_purchase(bigint,integer,date,numeric,text,numeric,numeric,text,uuid,text,text)']) {
      assert.equal((await db.query("select has_function_privilege($1, $2, 'execute') x", [role, fn])).rows[0].x, false, `${role} on ${fn}`)
    }
  }
  assert.equal((await db.query('select count(*)::int n from api_cost_limits')).rows[0].n, 0)
  assert.equal((await db.query("select column_default d from information_schema.columns where table_name='api_cost_limits' and column_name='enforce'")).rows[0].d, 'false')
})

test('research history: only settled charges, grouped by day; reservations that never settled are not spending', { skip }, async () => {
  const db = await database()
  const row = (state, actual, at) => db.query("insert into ci_research_charges (queue_id, attempt, run_id, user_id, reserved_usd, actual_usd, state, settled_at) values (gen_random_uuid(), 0, gen_random_uuid(), gen_random_uuid(), 0.002, $1, $2, $3)", [actual, state, at])
  await row('settled', 0.0004, '2026-10-02T10:00:00Z'); await row('settled', 0.0006, '2026-10-02T11:00:00Z')
  await row('reserved', null, null); await row('settled', 0.001, '2026-09-01T10:00:00Z')
  const h = (await db.query("select admin_research_history('2026-10-01T00:00:00Z','2026-11-01T00:00:00Z','UTC') h")).rows[0].h
  assert.equal(h.daily.length, 1); assert.equal(h.daily[0].settled, 2); assert.equal(Number(h.daily[0].cost), 0.001)
  assert.equal(h.first_settled_at.slice(0, 10), '2026-09-01')
})

test('the same event written twice is stored once (retries and repeated flushes cannot double count)', { skip }, async () => {
  const db = await database()
  const write = () => db.query(`insert into api_usage_events (event_key, provider, operation, estimated_cost_usd) values ('openai:chatcmpl-1', 'openai', 'chat_completion', 0.001) on conflict (event_key) do nothing`)
  await write(); await write(); await write()
  assert.equal((await db.query('select count(*)::int n from api_usage_events')).rows[0].n, 1)
  await assert.rejects(db.query(`insert into api_usage_events (event_key, provider, operation) values ('openai:chatcmpl-1', 'openai', 'chat_completion')`), /unique|duplicate/i, 'a plain duplicate insert is refused by the database')
})

test('today and this month are measured up to now, whatever range is being viewed; delivered is this month only', { skip }, async () => {
  const db = await database()
  await db.query("insert into api_usage_events (event_key, provider, operation, estimated_cost_usd, created_at) values ('t1','serper','maps_search',0.003, now()), ('t2','google_places','text_search',0.04, now()), ('t3','openai','chat_completion',0.0005, now() - interval '70 days')")
  await db.query("insert into api_usage_runs (run_id, delivered) values (gen_random_uuid(), 9)")
  const o = await overview(db, '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z')
  const byProvider = (rows) => Object.fromEntries(rows.map((r) => [r.provider, Number(r.cost)]))
  assert.deepEqual(byProvider(o.today_by_provider), { serper: 0.003, google_places: 0.04 })
  assert.deepEqual(byProvider(o.month_by_provider), { serper: 0.003, google_places: 0.04 }, 'the 70-day-old OpenAI row is not this month')
  assert.equal(Number(o.month_delivered), 9)
  assert.deepEqual(o.by_operation, [], 'the viewed range itself is empty')
})

// ---- reconciliation
const recon = (db, over = {}) => {
  const r = { month: '2026-10-01', provider: 'google_places', status: 'reconciled', amount: 0, currency: 'USD', rate: 1, on: '2026-11-02', ...over }
  return db.query(`insert into api_billing_reconciliations (billing_month, provider, status, billed_amount, billed_currency, exchange_rate_to_usd, reconciled_on, estimated_usd_at_reconciliation, note)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [r.month, r.provider, r.status, r.amount, r.currency, r.rate, r.on, r.est ?? null, r.note ?? null])
}

test('reconciliation rows: the USD figure is derived from the original amount and rate, a foreign amount needs its rate, one row per provider and month', { skip }, async () => {
  const db = await database()
  await recon(db, { provider: 'openai', amount: 12.5, currency: 'CAD', rate: 0.72 })
  const row = (await db.query("select billed_amount::float a, billed_currency c, exchange_rate_to_usd::float r, billed_usd::float u from api_billing_reconciliations")).rows[0]
  assert.deepEqual(row, { a: 12.5, c: 'CAD', r: 0.72, u: 9 }, 'billed_usd = 12.50 x 0.72, the original amount and currency are kept')
  await assert.rejects(recon(db, { provider: 'serper', amount: 10, currency: 'CAD', rate: 1 }), /check/i, 'CAD at a rate of 1 would silently treat it as USD')
  await assert.rejects(recon(db, { provider: 'serper', amount: 10, currency: 'usd' }), /check/i, 'a currency is a three-letter capital code')
  await assert.rejects(recon(db, { provider: 'serper', amount: 10, rate: 0 }), /check/i)
  await assert.rejects(recon(db, { provider: 'serper', amount: -1 }), /check/i)
  await assert.rejects(recon(db, { provider: 'openai', amount: 1 }), /unique|duplicate/i, 'one row per provider and month')
  await assert.rejects(recon(db, { provider: 'serper', month: '2026-10-15', amount: 1 }), /check/i, 'the month is its first day')
  await assert.rejects(recon(db, { provider: 'serper', status: 'reconciled', amount: null }), /check/i, 'reconciled needs an amount')
  await assert.rejects(recon(db, { provider: 'serper', status: 'reconciled', amount: 1, on: null }), /check/i, 'reconciled needs a date')
  await recon(db, { provider: 'serper', status: 'pending', amount: null, on: null })
  assert.equal((await db.query("select billed_usd from api_billing_reconciliations where provider='serper'")).rows[0].billed_usd, null, 'pending has no billed figure')
})

test('reconciliation overview: the month window follows the time zone, estimates come from the log, entered bills and purchases come back, and the log is not changed', { skip }, async () => {
  const db = await database()
  await add(db, { at: '2026-10-01T03:00:00Z', provider: 'serper', operation: 'maps_search', credits: 3, cost: 0.003 }) // Sept 30 in Toronto
  await add(db, { at: '2026-10-15T12:00:00Z', provider: 'serper', operation: 'maps_search', credits: 3, cost: 0.003 })
  await add(db, { at: '2026-11-01T03:00:00Z', provider: 'serper', operation: 'maps_search', credits: 3, cost: 0.003 }) // Oct 31 in Toronto
  await add(db, { at: '2026-11-01T06:00:00Z', provider: 'google_places', operation: 'text_search', cost: 0.04 }) // November
  await recon(db, { provider: 'serper', amount: 0.01, est: 0.006 })
  await db.query("insert into api_prepaid_purchases (request_key, provider, purchased_on, amount_paid, credits) values ('purchase-key-1', 'serper', '2026-10-02', 50, 50000)")
  const before = (await db.query('select count(*)::int n, sum(estimated_cost_usd)::float s from api_usage_events')).rows[0]
  const get = async (month, tz) => (await db.query('select admin_reconciliation_overview($1::date, $2) o', [month, tz])).rows[0].o
  const utc = await get('2026-10-20', 'UTC')
  assert.equal(utc.month, '2026-10-01'); assert.equal(utc.estimated.find((e) => e.provider === 'serper').requests, 2)
  const toronto = await get('2026-10-20', 'America/Toronto')
  assert.equal(toronto.estimated.find((e) => e.provider === 'serper').requests, 2, 'Oct 1 03:00Z is Sept 30 locally, Nov 1 03:00Z is Oct 31 locally')
  assert.equal(toronto.estimated.find((e) => e.provider === 'google_places'), undefined)
  assert.equal(toronto.reconciliations.length, 1); assert.equal(Number(toronto.reconciliations[0].billed_usd), 0.01)
  assert.equal(toronto.reconciliations[0].updated_by, undefined, 'who entered it is not sent to the page')
  assert.equal(toronto.purchases.length, 1); assert.equal(Number(toronto.purchases[0].amount_usd), 50)
  assert.deepEqual((await db.query('select count(*)::int n, sum(estimated_cost_usd)::float s from api_usage_events')).rows[0], before, 'reconciliation never alters the request-level records')
  assert.equal(Number(toronto.estimated.find((e) => e.provider === 'serper').cost) < 50, true, 'a $50 purchase is not that month\'s usage')
})

test('prepaid purchases: foreign currency keeps its original amount and rate, and checks apply', { skip }, async () => {
  const db = await database()
  await db.query("insert into api_prepaid_purchases (request_key, provider, purchased_on, amount_paid, currency, exchange_rate_to_usd, credits) values ('purchase-key-2', 'serper', '2026-10-02', 68.5, 'CAD', 0.73, 50000)")
  assert.equal((await db.query('select amount_usd::float u from api_prepaid_purchases')).rows[0].u, 50.005)
  await assert.rejects(db.query("insert into api_prepaid_purchases (request_key, provider, purchased_on, amount_paid, currency, exchange_rate_to_usd) values ('purchase-key-3', 'serper','2026-10-02', 50, 'EUR', 1)"), /check/i)
  await assert.rejects(db.query("insert into api_prepaid_purchases (request_key, provider, purchased_on, amount_paid) values ('purchase-key-4', 'serper','2026-10-02', 0)"), /check/i)
})

// ---- editing prepaid purchases
const ADMIN = '11111111-1111-4111-8111-111111111111'
const addPurchase = async (db, key = 'purchase-key-a') => (await db.query("insert into api_prepaid_purchases (request_key, provider, purchased_on, amount_paid, credits, note) values ($1, 'serper', '2026-10-01', 50, 50000, 'first pack') returning id", [key])).rows[0].id
const edit = async (db, id, over = {}) => {
  const e = { version: 1, on: '2026-10-02', amount: 55, currency: 'USD', rate: 1, credits: 55000, note: 'corrected', key: 'edit-request-1', ...over }
  return (await db.query('select admin_edit_prepaid_purchase($1,$2,$3::date,$4::numeric,$5,$6::numeric,$7::numeric,$8,$9::uuid,$10,$11) r', [id, e.version, e.on, e.amount, e.currency, e.rate, e.credits, e.note, ADMIN, 'owner@example.com', e.key])).rows[0].r
}

test('editing a purchase keeps the original in an append-only history with who and when, and bumps the version', { skip }, async () => {
  const db = await database()
  const id = await addPurchase(db)
  assert.deepEqual(await edit(db, id), { status: 'updated', version: 2 })
  const now = (await db.query('select purchased_on::text d, amount_paid::float a, credits::float c, note, version, updated_by::text u, updated_at is not null t from api_prepaid_purchases')).rows[0]
  assert.deepEqual(now, { d: '2026-10-02', a: 55, c: 55000, note: 'corrected', version: 2, u: ADMIN, t: true })
  const history = (await db.query('select replaced_version v, purchased_on::text d, amount_paid::float a, amount_usd::float u, credits::float c, note, changed_by::text who, changed_by_label l, changed_at is not null t from api_prepaid_purchase_history')).rows
  assert.deepEqual(history, [{ v: 1, d: '2026-10-01', a: 50, u: 50, c: 50000, note: 'first pack', who: ADMIN, l: 'owner@example.com', t: true }], 'the ORIGINAL values are preserved')
  assert.deepEqual(await edit(db, id, { version: 2, amount: 56, key: 'edit-request-2' }), { status: 'updated', version: 3 })
  assert.equal((await db.query('select count(*)::int n from api_prepaid_purchase_history')).rows[0].n, 2, 'every edit adds a row')
  const overview = (await db.query("select admin_reconciliation_overview('2026-10-01','UTC') o")).rows[0].o
  assert.equal(overview.purchases[0].version, 3); assert.equal(overview.purchases[0].history.length, 2)
  assert.equal(overview.purchases[0].history[0].amount_paid, 50, 'the page can show the original')
  assert.equal(overview.purchases[0].updated_by, undefined); assert.equal(overview.purchases[0].history[0].changed_by, undefined, 'internal ids are not sent to the page')
})

test('a repeated submission applies once; a stale form is refused; an unchanged form changes nothing', { skip }, async () => {
  const db = await database()
  const id = await addPurchase(db)
  assert.equal((await edit(db, id)).status, 'updated')
  assert.deepEqual(await edit(db, id), { status: 'duplicate', version: 2 }, 'the same request key again is not applied again')
  assert.deepEqual(await edit(db, id, { key: 'edit-request-9' }), { status: 'stale', version: 2 }, 'a second tab still holding version 1')
  assert.deepEqual(await edit(db, id, { version: 2, on: '2026-10-02', amount: 55, credits: 55000, note: 'corrected', key: 'edit-request-3' }), { status: 'unchanged', version: 2 })
  assert.equal((await db.query('select count(*)::int n from api_prepaid_purchase_history')).rows[0].n, 1)
  assert.equal((await edit(db, 9999, { key: 'edit-request-4' })).status, 'not_found')
  const second = await db.query("insert into api_prepaid_purchases (request_key, provider, purchased_on, amount_paid) values ('purchase-key-a', 'serper', '2026-10-05', 99) on conflict (request_key) do nothing returning id")
  assert.equal(second.rows.length, 0, 'creating the same purchase twice stores one')
  await assert.rejects(edit(db, id, { version: 2, currency: 'CAD', rate: 1, key: 'edit-request-5' }), /check/i, 'a foreign currency still needs its rate')
  await assert.rejects(edit(db, id, { version: 2, amount: 0, key: 'edit-request-6' }), /check/i)
  assert.equal((await db.query('select version from api_prepaid_purchases')).rows[0].version, 2, 'a refused edit changes nothing and leaves no history row')
})

test('a purchase can never be deleted, truncated or changed outside the audited function; the history is append-only', { skip }, async () => {
  const db = await database()
  const id = await addPurchase(db)
  await edit(db, id)
  await assert.rejects(db.query('delete from api_prepaid_purchases'), /cannot be deleted/i)
  await assert.rejects(db.query('truncate api_prepaid_purchases'), /cannot be deleted|cannot truncate/i, 'refused by the trigger, and by the foreign key from the history')
  await assert.rejects(db.query('update api_prepaid_purchases set amount_paid = 1'), /audited|admin_edit_prepaid_purchase/i, 'a direct update would skip the audit trail')
  await assert.rejects(db.query('delete from api_prepaid_purchase_history'), /append-only/i)
  await assert.rejects(db.query("update api_prepaid_purchase_history set note = 'x'"), /append-only/i)
  await assert.rejects(db.query('truncate api_prepaid_purchase_history'), /append-only/i)
  assert.equal((await db.query('select amount_paid::float a from api_prepaid_purchases')).rows[0].a, 55)
  // the service role is not even granted delete
  assert.equal((await db.query("select has_table_privilege('service_role','api_prepaid_purchases','delete') d, has_table_privilege('service_role','api_prepaid_purchase_history','update') u, has_table_privilege('service_role','api_prepaid_purchase_history','delete') x")).rows[0].d, false)
})

test('editing a purchase changes no recorded consumption, no estimate and no reconciliation', { skip }, async () => {
  const db = await database()
  await add(db, { at: '2026-10-05T12:00:00Z', provider: 'serper', operation: 'maps_search', credits: 3, cost: 0.003 })
  await add(db, { at: '2026-10-06T12:00:00Z', provider: 'google_places', operation: 'text_search', skus: ['text_search'], cost: 0.04 })
  await recon(db, { provider: 'serper', amount: 0.01, est: 0.003 })
  const id = await addPurchase(db)
  const snapshot = async () => JSON.stringify([
    (await db.query('select * from api_usage_events order by id')).rows, (await db.query('select * from api_billing_reconciliations order by id')).rows,
    (await db.query('select * from api_usage_runs order by run_id')).rows,
    (await db.query("select admin_cost_overview('2026-10-01','2026-11-01','UTC') o")).rows[0].o.by_operation,
    (await db.query("select admin_reconciliation_overview('2026-10-01','UTC') o")).rows[0].o.estimated,
  ])
  const before = await snapshot()
  await edit(db, id, { amount: 500, credits: 1, note: 'big change' })
  assert.equal(await snapshot(), before, 'usage events, estimates and the reconciliation are byte-for-byte unchanged')
})

// ---- tracking health
test('tracking health facts: events, expected member runs after tracking began and how many were recorded, failures and the latest', { skip }, async () => {
  const db = await database()
  const empty = (await db.query('select admin_tracking_health() h')).rows[0].h
  assert.deepEqual([empty.first_event_at, empty.last_event_at, empty.events_24h, empty.expected_runs, empty.failures_30d, empty.last_failure_at], [null, null, 0, 0, 0, null])
  // a run from before tracking began is not expected to be recorded
  await db.query("insert into discover_save_receipts (run_id, user_id, created_at) values (gen_random_uuid(), gen_random_uuid(), now() - interval '5 days')")
  await db.query("insert into api_usage_events (event_key, provider, operation, estimated_cost_usd, created_at) values ('h1','serper','maps_search',0.003, now() - interval '2 days'), ('h2','serper','maps_search',0.003, now() - interval '1 hour')")
  const runs = []
  for (const minutesAgo of [600, 300, 120, 5]) runs.push((await db.query("insert into discover_save_receipts (run_id, user_id, created_at) values (gen_random_uuid(), gen_random_uuid(), now() - ($1 || ' minutes')::interval) returning run_id", [String(minutesAgo)])).rows[0].run_id)
  await db.query("insert into api_usage_runs (run_id, delivered) values ($1, 3), ($2, 2)", [runs[0], runs[2]])
  await db.query("insert into api_tracking_failures (occurred_first_at, occurred_last_at, failed_count, kind, detail_code) values (now() - interval '3 days', now() - interval '3 days' + interval '1 minute', 4, 'timeout', null), (now() - interval '40 days', now() - interval '40 days', 9, 'write_failed', '57014')")
  const h = (await db.query('select admin_tracking_health() h')).rows[0].h
  assert.equal(h.events_24h, 1)
  assert.equal(h.expected_runs, 3, 'the 5-day-old run predates tracking; the run from 5 minutes ago is still within the 15-minute grace')
  assert.equal(h.covered_runs, 2, 'two of the three expected runs were recorded')
  assert.equal(h.failures_7d, 4); assert.equal(h.failures_30d, 4, 'the 40-day-old failures are outside both windows'); assert.ok(h.last_failure_at)
})
