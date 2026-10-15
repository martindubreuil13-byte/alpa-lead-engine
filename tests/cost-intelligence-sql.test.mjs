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
  await db.exec("create table ci_research_charges (queue_id uuid, attempt int, run_id uuid, user_id uuid, reserved_usd numeric, actual_usd numeric, state text, created_at timestamptz default now(), settled_at timestamptz)")
  await db.exec(fs.readFileSync('supabase/proposed/20261017_api_cost_intelligence.sql', 'utf8'))
  return db
}
const add = (db, row) => db.query(
  `insert into api_usage_events (created_at, provider, operation, purpose, run_id, request_count, credits, input_tokens, output_tokens, skus, estimated_cost_usd, ok)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [row.at, row.provider, row.operation, row.purpose ?? 'discovery', row.run ?? null, row.n ?? 1, row.credits ?? null, row.in ?? null, row.out ?? null, row.skus ?? null, row.cost ?? null, row.ok ?? true])
const overview = async (db, from, to, tz = 'UTC') => (await db.query('select admin_cost_overview($1::timestamptz,$2::timestamptz,$3) as o', [from, to, tz])).rows[0].o
const RUN = '00000000-0000-4000-8000-000000000001'

test('the migration applies cleanly and its rollback removes only what it added', { skip }, async () => {
  const db = await database()
  const tables = (await db.query("select table_name from information_schema.tables where table_name like 'api_%' order by 1")).rows.map((r) => r.table_name)
  assert.deepEqual(tables, ['api_cost_limits', 'api_usage_events', 'api_usage_runs'])
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
  await add(db, { at: '2026-10-05T12:00:00Z', provider: 'serper', operation: 'maps_search', credits: 1, cost: 0.001, run: RUN })
  await add(db, { at: '2026-10-05T12:00:01Z', provider: 'serper', operation: 'maps_search', credits: 0, cost: 0, ok: false })
  await add(db, { at: '2026-10-05T12:00:02Z', provider: 'google_places', operation: 'text_search', skus: ['text_search'], cost: 0.032, run: RUN })
  await add(db, { at: '2026-10-05T12:00:03Z', provider: 'google_places', operation: 'place_details', skus: ['place_details', 'contact_data'], cost: 0.02, run: RUN })
  await add(db, { at: '2026-10-05T12:00:04Z', provider: 'openai', operation: 'chat_completion', purpose: 'research_profile', in: 1000, out: 200, cost: 0.00027 })
  await add(db, { at: '2026-10-05T12:00:05Z', provider: 'openai', operation: 'chat_completion', purpose: 'research_profile', in: 500, out: 100, cost: null })
  await db.query("insert into api_usage_runs (run_id, created_at, delivered, duplicates, rejected) values ($1, '2026-10-05T12:01:00Z', 7, 2, 3)", [RUN])
  const o = await overview(db, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')
  const op = (p, n) => o.by_operation.find((r) => r.provider === p && r.operation === n)
  assert.equal(op('serper', 'maps_search').requests, 2); assert.equal(op('serper', 'maps_search').failed, 1); assert.equal(Number(op('serper', 'maps_search').credits), 1)
  assert.equal(op('google_places', 'place_details').requests, 1, 'one details request, however many SKUs it generated')
  assert.equal(Number(op('google_places', 'place_details').cost), 0.02)
  assert.equal(Number(op('openai', 'chat_completion').input_tokens), 1500); assert.equal(op('openai', 'chat_completion').unpriced, 1, 'an unknown price is reported, not invented')
  assert.deepEqual(o.runs, { count: 1, delivered: 7, duplicates: 2, rejected: 3 })
  assert.deepEqual(o.google_month_events, { text_search: 1, place_details: 1, contact_data: 1 })
  const totalCost = o.by_operation.reduce((sum, r) => sum + Number(r.cost), 0)
  assert.ok(Math.abs(totalCost - 0.05327) < 1e-9)
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
    for (const table of ['api_usage_events', 'api_usage_runs', 'api_cost_limits']) {
      const rows = (await db.query("select has_table_privilege($1, $2, 'select') s, has_table_privilege($1, $2, 'insert') i", [role, table])).rows[0]
      assert.deepEqual(rows, { s: false, i: false }, `${role} on ${table}`)
    }
    assert.equal((await db.query("select has_function_privilege($1, 'admin_cost_overview(timestamptz,timestamptz,text)', 'execute') x", [role])).rows[0].x, false)
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
