// Cost intelligence: what is recorded for each provider request, how it is priced, how the report is built and who may see it.
// The real Serper and Google modules run here with a stubbed network; nothing reaches a provider or a database.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
register('data:text/javascript,' + encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}
export async function resolve(specifier,context,next) {
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`), pathToFileURL(ROOT + '/'))

process.env.SERPER_API_KEY = 'serper-secret-key-for-test'
process.env.GOOGLE_PLACES_API_KEY = 'google-secret-key-for-test'
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const pricing = await import('../lib/costs/pricing.ts')
const { setCostSink, flushCostRecords, recordApiUsage, recordDiscoveryRun, toUsageRow, costRecordingStats } = await import('../lib/costs/record.ts')
const { runWithCostContext } = await import('../lib/costs/context.ts')
const { recordOpenAiCompletion } = await import('../lib/costs/openai.ts')
const { buildCostReport, resolveRange } = await import('../lib/costs/report.ts')
const { searchSerperMaps } = await import('../lib/sources/serper.ts')
const { searchGooglePlaces } = await import('../lib/sources/google.ts')

const events = []
const runs = []
setCostSink({ usage: async (rows) => { events.push(...rows) }, run: async (row) => { runs.push(row) } })
const reset = () => { events.length = 0; runs.length = 0 }
const RUN = '00000000-0000-4000-8000-000000000042'
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('pricing: Serper at 3 credits per map search and $0.001 per credit, Google SKU sums, an unknown operation or model is never given an invented price', () => {
  assert.equal(pricing.serperUsdPerCredit(), 0.001)
  assert.equal(pricing.serperConfiguredCredits('maps_search'), 3)
  assert.equal(pricing.serperCostOf(3), 0.003)
  assert.equal(pricing.serperCostOf(pricing.serperConfiguredCredits('maps_search')), 0.003)
  assert.equal(pricing.serperConfiguredCredits('place_details'), null, 'an operation that is not configured is not assumed to cost anything')
  assert.equal(pricing.serperCostOf(pricing.serperConfiguredCredits('place_details')), null)
  assert.equal(pricing.serperUsdPerCredit([{ credits: 50000, priceUsd: 50 }, { credits: 100000, priceUsd: 75 }]), 0.00075, 'a newer package changes the rate')
  assert.equal(pricing.googleCostOf(['text_search', 'basic_data', 'contact_data', 'atmosphere_data']), 0.04)
  assert.equal(pricing.googleCostOf(['place_details', 'basic_data', 'contact_data']), 0.02)
  assert.deepEqual(pricing.googleDetailsSkus('name,formatted_phone_number,website,types,address_components,url'), ['place_details', 'basic_data', 'contact_data'])
  assert.deepEqual(pricing.googleDetailsSkus('name,types'), ['place_details', 'basic_data'])
  assert.deepEqual(pricing.googleDetailsSkus('name,rating,website'), ['place_details', 'basic_data', 'contact_data', 'atmosphere_data'])
  assert.equal(pricing.openAiCostOf('gpt-4o-mini', 1_000_000, 1_000_000), 0.75)
  assert.equal(pricing.openAiCostOf('gpt-4o-mini-2024-07-18', 1000, 0), 0.00015)
  assert.equal(pricing.openAiCostOf('some-future-model', 1000, 1000), null)
})

test('Google billing events reproduce what Google reported for the shared project: 38 text searches and 225 details are 263 contact and 38 atmosphere events', () => {
  const events = {}
  const bill = (skus, requests) => { for (const sku of skus) events[sku] = (events[sku] ?? 0) + requests }
  bill(pricing.GOOGLE_TEXT_SEARCH_SKUS, 38)
  bill(pricing.googleDetailsSkus('name,formatted_phone_number,website,types,address_components,url'), 225)
  assert.equal(events.text_search, 38); assert.equal(events.place_details, 225)
  assert.equal(events.contact_data, 263, '225 details + 38 text searches'); assert.equal(events.atmosphere_data, 38)
  assert.equal(38 + 225, 263, 'the 263 contact events came from 263 requests, not 263 extra requests')
  const listCost = 38 * pricing.googleCostOf(pricing.GOOGLE_TEXT_SEARCH_SKUS) + 225 * pricing.googleCostOf(pricing.googleDetailsSkus('name,formatted_phone_number,website'))
  assert.ok(Math.abs(listCost - (38 * 0.04 + 225 * 0.02)) < 1e-9, 'estimated usage cost before free allowances; the billed amount was $0')
})

test('the research profile estimate used by the pipeline agrees with the dashboard price list', async () => {
  const { estimateProfileCost } = await import('../lib/commercial-intelligence/commercial-profile-core.ts')
  assert.ok(Math.abs(estimateProfileCost(1234, 321) - pricing.openAiCostOf('gpt-4o-mini', 1234, 321)) < 1e-6)
})

test('Serper: every real request is recorded once with the credits it consumed, failed ones cost nothing, and the key is never stored', async () => {
  reset()
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push(url); return calls.length === 1 ? json({ places: [{ title: 'A Dental', website: 'https://a.ca' }, { title: 'B Dental', website: 'https://b.ca' }] }) : json({}, 429) }
  await runWithCostContext({ runId: RUN, userId: null, purpose: 'discovery', audience: 'member' }, () => searchSerperMaps({ query: 'dentist', city: 'Laval', region: '', countryCode: 'CA', maxResults: 50, send: () => {} }))
  await flushCostRecords()
  assert.equal(events.length, calls.length, 'one row per HTTP request, whatever the number of leads')
  assert.equal(events[0].provider, 'serper'); assert.equal(events[0].credits, 3); assert.equal(events[0].credits_basis, 'configured'); assert.equal(events[0].estimated_cost_usd, 0.003); assert.equal(events[0].results_returned, 2); assert.equal(events[0].run_id, RUN)
  assert.equal(events[1].ok, false); assert.equal(events[1].estimated_cost_usd, 0); assert.equal(events[1].http_status, 429); assert.equal(events[1].credits, 0)
  assert.doesNotMatch(JSON.stringify(events), /serper-secret-key-for-test|dentist|A Dental|a\.ca/)
})

test('Serper: credits the provider reports for a request are used and marked as reported; requests are counted separately from credits', async () => {
  reset()
  globalThis.fetch = async () => json({ places: [{ title: 'X' }], credits: 4 })
  await searchSerperMaps({ query: 'q', city: 'c', region: '', countryCode: undefined, maxResults: 1, send: () => {} })
  await flushCostRecords()
  assert.equal(events[0].request_count, 1); assert.equal(events[0].credits, 4); assert.equal(events[0].credits_basis, 'reported'); assert.equal(events[0].estimated_cost_usd, 0.004)
})

test('a search that returns no businesses is still recorded and still costs money', async () => {
  reset()
  globalThis.fetch = async () => json({ places: [] })
  await runWithCostContext({ runId: RUN, userId: null, purpose: 'discovery', audience: 'guest' }, () => searchSerperMaps({ query: 'x', city: 'Nowhere', region: '', countryCode: undefined, maxResults: 5, send: () => {} }))
  await flushCostRecords()
  assert.ok(events.length >= 1); assert.ok(events.every((e) => e.estimated_cost_usd === 0.003 && e.credits === 3 && e.results_returned === 0 && e.audience === 'guest'))
})

test('Google: a text search is one request per page, a details request is ONE event listing its SKUs, and totals are not double counted', async () => {
  reset()
  const seen = []
  globalThis.fetch = async (url) => {
    seen.push(String(url))
    if (String(url).includes('textsearch')) return json({ status: 'OK', results: [{ place_id: 'p1', name: 'One' }, { place_id: 'p2', name: 'Two' }] })
    return json({ status: 'OK', result: { name: 'X', website: 'https://x.ca', formatted_phone_number: '+1 450 555 0100' } })
  }
  await runWithCostContext({ runId: RUN, userId: null, purpose: 'discovery', audience: 'member' }, () => searchGooglePlaces({ query: 'dentist', city: 'Laval', region: 'QC', country: 'Canada', countryCode: 'CA', maxResults: 10, send: () => {} }))
  await flushCostRecords()
  assert.equal(seen.length, 3, 'one text search page + two details')
  assert.equal(events.length, 3, 'one event per request: SKUs are not separate events')
  const search = events.filter((e) => e.operation === 'text_search'); const details = events.filter((e) => e.operation === 'place_details')
  assert.equal(search.length, 1); assert.equal(search[0].estimated_cost_usd, 0.04); assert.equal(search[0].results_returned, 2); assert.equal(search[0].request_count, 1)
  assert.deepEqual(search[0].skus, ['text_search', 'basic_data', 'contact_data', 'atmosphere_data'])
  assert.equal(details.length, 2); assert.ok(details.every((d) => d.request_count === 1 && d.estimated_cost_usd === 0.02 && JSON.stringify(d.skus) === '["place_details","basic_data","contact_data"]'))
  assert.ok(Math.abs(events.reduce((t, e) => t + e.estimated_cost_usd, 0) - 0.08) < 1e-9)
  assert.equal(events.reduce((t, e) => t + e.request_count, 0), 3, 'three HTTP requests, however many billing events they generated')
  assert.doesNotMatch(JSON.stringify(events), /google-secret-key-for-test|\+1 450|x\.ca|dentist/)
})

test('Google: an error status is recorded but not billed', async () => {
  reset()
  globalThis.fetch = async () => json({ status: 'REQUEST_DENIED', results: [] })
  await searchGooglePlaces({ query: 'q', city: 'c', region: '', country: '', countryCode: 'CA', maxResults: 5, send: () => {} })
  await flushCostRecords()
  assert.ok(events.length >= 1 && events.every((e) => e.ok === false && e.estimated_cost_usd === 0))
})

test('OpenAI: provider token counts are recorded, cost is an estimate, an unpriced model is recorded without a made-up cost', async () => {
  reset()
  await recordOpenAiCompletion('gpt-4o-mini', { id: 'chatcmpl-a', usage: { prompt_tokens: 2000, completion_tokens: 300 } }, 'research_profile')
  await recordOpenAiCompletion('mystery-model', { id: 'chatcmpl-b', usage: { prompt_tokens: 10, completion_tokens: 5 } }, 'agent')
  assert.deepEqual([events[0].input_tokens, events[0].output_tokens, events[0].purpose, events[0].cost_basis, events[0].event_key], [2000, 300, 'research_profile', 'estimate', 'openai:chatcmpl-a'])
  assert.ok(Math.abs(events[0].estimated_cost_usd - 0.00048) < 1e-9)
  assert.equal(events[1].estimated_cost_usd, null)
})

// A destination that behaves like the table: a unique event_key, new keys stored, repeats ignored.
function uniqueSink({ failFirst = 0, hang = false, missing = false } = {}) {
  const stored = new Map(); let calls = 0
  return {
    stored, get calls() { return calls },
    usage: async (rows) => {
      calls += 1
      if (hang) return new Promise(() => {})
      if (missing) { const e = new Error('relation does not exist'); throw Object.assign(e, { code: '42P01' }) }
      if (calls <= failFirst) throw new Error('connection reset')
      for (const row of rows) if (!stored.has(row.event_key)) stored.set(row.event_key, row)
    },
    run: async () => {},
  }
}
const withSink = async (sink, work) => { setCostSink(sink); try { return await work() } finally { setCostSink({ usage: async (rows) => { events.push(...rows) }, run: async (row) => { runs.push(row) } }) } }

test('retries: a write that fails once is retried and stored once; recording the same response twice counts it once; a second real call counts', async () => {
  const sink = uniqueSink({ failFirst: 1 })
  await withSink(sink, async () => {
    await recordOpenAiCompletion('gpt-4o-mini', { id: 'chatcmpl-1', usage: { prompt_tokens: 100, completion_tokens: 10 } }, 'research_profile')
    assert.equal(sink.stored.size, 1, 'the first attempt failed, the retry landed')
    await recordOpenAiCompletion('gpt-4o-mini', { id: 'chatcmpl-1', usage: { prompt_tokens: 100, completion_tokens: 10 } }, 'research_profile')
    assert.equal(sink.stored.size, 1, 'the same completion recorded again is the same event')
    await recordOpenAiCompletion('gpt-4o-mini', { id: 'chatcmpl-2', usage: { prompt_tokens: 100, completion_tokens: 10 } }, 'research_profile')
    assert.equal(sink.stored.size, 2, 'a repeated call to OpenAI is a new, separately billed response')
    recordApiUsage({ provider: 'serper', operation: 'maps_search', credits: 3, estimatedCostUsd: 0.003, ok: true, eventKey: 'serper:fixed' })
    recordApiUsage({ provider: 'serper', operation: 'maps_search', credits: 3, estimatedCostUsd: 0.003, ok: true, eventKey: 'serper:fixed' })
    await flushCostRecords()
    assert.equal(sink.stored.size, 3, 'one event written twice is stored once')
  })
})

test('a record that cannot be written is given up on within the bound and never delays or fails the customer', async () => {
  const sink = uniqueSink({ hang: true })
  await withSink(sink, async () => {
    const started = Date.now()
    await recordOpenAiCompletion('gpt-4o-mini', { id: 'chatcmpl-slow', usage: { prompt_tokens: 1, completion_tokens: 1 } }, 'research_profile')
    const waited = Date.now() - started
    assert.ok(waited >= 1500 && waited < 3500, `waited ${waited} ms: bounded by the write budget`)
    assert.ok(costRecordingStats().dropped >= 1)
  })
})

test('tables not created yet: the first write finds out, later writes are skipped instead of failing on every request', async () => {
  const sink = uniqueSink({ missing: true })
  await withSink(sink, async () => {
    await recordApiUsage({ provider: 'serper', operation: 'maps_search', credits: 3, estimatedCostUsd: 0.003, ok: true })
    await recordApiUsage({ provider: 'serper', operation: 'maps_search', credits: 3, estimatedCostUsd: 0.003, ok: true })
    assert.equal(sink.calls, 1, 'the second request did not touch the database')
  })
})

test('recording can never break a request: a failing destination, or a missing one, is swallowed', async () => {
  setCostSink({ usage: async () => { throw new Error('database is down') }, run: async () => { throw new Error('database is down') } })
  assert.doesNotThrow(() => recordApiUsage({ provider: 'serper', operation: 'maps_search', estimatedCostUsd: 0.001, ok: true }))
  assert.doesNotThrow(() => recordDiscoveryRun({ runId: RUN, userId: null, audience: 'member', delivered: 1, duplicates: 0, rejected: 0 }))
  await flushCostRecords()
  setCostSink({ usage: async (rows) => { events.push(...rows) }, run: async (row) => { runs.push(row) } })
  const row = toUsageRow({ provider: 'openai', operation: 'chat_completion', estimatedCostUsd: 0, ok: true, context: { runId: RUN } })
  assert.deepEqual(Object.keys(row).sort(), ['audience', 'credits', 'credits_basis', 'event_key', 'estimated_cost_usd', 'cost_basis', 'http_status', 'input_tokens', 'model', 'ok', 'operation', 'output_tokens', 'provider', 'purpose', 'request_count', 'results_returned', 'run_id', 'skus', 'user_id'].sort(), 'the row has only the allow-listed columns')
})

test('the discovery route records the run outcome and wraps the run; recording is not awaited by providers', () => {
  const route = read('app/api/scrape/route.ts')
  assert.match(route, /runWithCostContext\(/); assert.match(route, /recordDiscoveryRun\(/); assert.match(route, /flushCostRecords\(\)/)
  assert.match(route, /delivered: addedCount/); assert.match(route, /duplicates: duplicateCount \+ alreadySavedBeforeSave/)
  for (const file of ['lib/commercial-intelligence/generate-commercial-profile.ts', 'app/api/guest/profile/route.ts', 'lib/agent/generate-outreach-draft.ts', 'app/api/agent/icp/route.ts', 'app/api/agent/setup/route.ts']) {
    assert.match(read(file), /await recordOpenAiCompletion\(/, `${file} records its OpenAI usage and waits for the bounded write`)
  }
})

// ---- report
const raw = (over = {}) => ({
  by_operation: [
    { provider: 'serper', operation: 'maps_search', requests: 10, failed: 1, credits: 27, input_tokens: 0, output_tokens: 0, cost: 0.027, unpriced: 0 },
    { provider: 'google_places', operation: 'text_search', requests: 2, failed: 0, credits: 0, input_tokens: 0, output_tokens: 0, cost: 0.08, unpriced: 0 },
    { provider: 'google_places', operation: 'place_details', requests: 20, failed: 0, credits: 0, input_tokens: 0, output_tokens: 0, cost: 0.4, unpriced: 0 },
    { provider: 'openai', operation: 'chat_completion', requests: 4, failed: 0, credits: 0, input_tokens: 8000, output_tokens: 1200, cost: 0.00192, unpriced: 0 },
  ],
  by_purpose: [{ provider: 'openai', purpose: 'research_profile', requests: 4, ok_requests: 4, cost: 0.00192 }],
  daily: [
    { day: '2026-10-05', provider: 'serper', requests: 10, cost: 0.027 }, { day: '2026-10-05', provider: 'google_places', requests: 22, cost: 0.48 },
    { day: '2026-10-06', provider: 'openai', requests: 4, cost: 0.00192 },
  ],
  daily_delivered: [{ day: '2026-10-05', runs: 2, delivered: 8 }],
  runs: { count: 2, delivered: 8, duplicates: 3, rejected: 5 },
  first_event_at: '2026-10-05T10:00:00Z',
  today_by_provider: [{ provider: 'serper', cost: 0.006 }, { provider: 'google_places', cost: 0.1 }],
  month_by_provider: [{ provider: 'google_places', cost: 0.48 }, { provider: 'serper', cost: 0.027 }],
  month_delivered: 8,
  google_sku_events: { text_search: 2, place_details: 20, contact_data: 22, atmosphere_data: 2, basic_data: 22 },
  ...over,
})
const RANGE = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z'), days: 31 }

test('report: headline numbers, units, per-business cost, and no margin without reliable revenue', () => {
  const r = buildCostReport(raw(), null, [], RANGE)
  assert.equal(r.basis, 'estimate')
  assert.ok(Math.abs(r.headline.totalCost - 0.50892) < 1e-9)
  assert.equal(r.headline.delivered, 8)
  assert.ok(Math.abs(r.headline.costPerDelivered - (0.027 + 0.48) / 8) < 1e-9, 'discovery cost only, over delivered businesses')
  assert.ok(Math.abs(r.headline.aiCostPerProfile - 0.00048) < 1e-9)
  assert.equal(r.contribution.available, false)
  const serper = r.providers.find((p) => p.provider === 'serper'); assert.equal(serper.credits, 27); assert.ok(Math.abs(serper.unitCost - 0.0027) < 1e-12)
  assert.ok(Math.abs(r.series.find((p) => p.day === '2026-10-05').costPerBusiness - 0.507 / 8) < 1e-12)
  assert.equal(r.series.find((p) => p.day === '2026-10-06').costPerBusiness, null, 'a day with no delivery has no per-business cost')
})

test('report: today and this month so far; Google billing events are shown as events and no project-wide allowance is computed; ceilings alert but never enforce', () => {
  const r = buildCostReport(raw(), null, [
    { scope: 'monthly', provider: 'google_places', limit_usd: 0.5, alert_at_percent: 80, enforce: true },
    { scope: 'monthly', provider: 'serper', limit_usd: 100, alert_at_percent: 80, enforce: false },
    { scope: 'run', provider: 'all', limit_usd: 1, alert_at_percent: 80, enforce: false },
  ], RANGE)
  assert.ok(Math.abs(r.now.today.total - 0.106) < 1e-12); assert.equal(r.now.today.byProvider.google_places, 0.1)
  assert.ok(Math.abs(r.now.month.total - 0.507) < 1e-12); assert.equal(r.now.monthDelivered, 8)
  assert.ok(Math.abs(r.now.monthCostPerDelivered - 0.507 / 8) < 1e-12, 'discovery providers only')
  assert.deepEqual(r.googleSkuEvents.map((e) => [e.sku, e.events]), [['text_search', 2], ['place_details', 20], ['basic_data', 22], ['contact_data', 22], ['atmosphere_data', 2]])
  assert.equal('allowances' in r, false, "Google's free allowance is shared with other applications, so ALPA's own counts are never presented as what remains")
  assert.deepEqual(r.limits.map((l) => l.state), ['approaching', 'ok', 'not_measured'])
  assert.ok(r.limits.every((l) => l.enforced === false), 'enforcement is off in this version even if a row says otherwise')
})

test('report: history is shown only for days before tracking began, and is never invented', () => {
  const history = { daily: [{ day: '2026-09-30', settled: 3, cost: 0.0012 }, { day: '2026-10-06', settled: 4, cost: 0.002 }], first_settled_at: '2026-09-30T00:00:00Z' }
  const r = buildCostReport(raw(), history, [], RANGE)
  assert.deepEqual(r.history.daily.map((d) => d.day), ['2026-09-30'], 'later days are already covered by request-level tracking')
  assert.equal(buildCostReport(raw({ first_event_at: null }), { daily: [], first_settled_at: null }, [], RANGE).history.available, false)
  const empty = buildCostReport(raw({ by_operation: [], by_purpose: [], daily: [], daily_delivered: [], runs: { count: 0, delivered: 0, duplicates: 0, rejected: 0 }, first_event_at: null }), null, [], RANGE)
  assert.equal(empty.headline.totalCost, 0); assert.equal(empty.headline.costPerDelivered, null); assert.equal(empty.table.length, 0)
})

test('date ranges: presets, custom inclusive days, time zones and refusals', () => {
  const now = new Date('2026-10-15T15:00:00Z')
  const today = resolveRange({ preset: 'today', tz: 'UTC' }, now); assert.equal(today.range.from.toISOString(), '2026-10-15T00:00:00.000Z'); assert.equal(today.range.to.toISOString(), '2026-10-16T00:00:00.000Z')
  const week = resolveRange({ preset: '7d', tz: 'UTC' }, now); assert.equal(week.range.from.toISOString(), '2026-10-09T00:00:00.000Z'); assert.equal(week.range.days, 7)
  assert.equal(resolveRange({ preset: '30d', tz: 'UTC' }, now).range.from.toISOString(), '2026-09-16T00:00:00.000Z')
  const toronto = resolveRange({ preset: 'today', tz: 'America/Toronto' }, now); assert.equal(toronto.range.from.toISOString(), '2026-10-15T04:00:00.000Z')
  const custom = resolveRange({ preset: 'custom', from: '2026-10-01', to: '2026-10-03', tz: 'UTC' }, now); assert.equal(custom.range.days, 3); assert.equal(custom.range.to.toISOString(), '2026-10-04T00:00:00.000Z')
  assert.equal(resolveRange({ preset: 'custom', from: '2026-10-05', to: '2026-10-01' }, now).ok, false)
  assert.equal(resolveRange({ preset: 'custom', from: '2024-01-01', to: '2026-10-01' }, now).ok, false, 'a range of years is refused')
  assert.equal(resolveRange({ preset: 'custom', from: 'nope', to: '2026-10-01' }, now).ok, false)
  assert.equal(resolveRange({ preset: 'forever' }, now).ok, false)
  assert.equal(resolveRange({ preset: 'today', tz: 'Not/AZone' }, now).range.from.toISOString(), '2026-10-15T00:00:00.000Z', 'an invalid zone falls back to UTC')
})

test('access: the page and the API are administrator-only, and the API never returns raw rows', () => {
  const page = read('app/admin/costs/page.tsx'); assert.match(page, /isAdmin\(profile\)/); assert.match(page, /redirect\('\/dashboard'\)/)
  const api = read('app/api/admin/costs/route.ts')
  assert.ok(api.indexOf('requireAdmin(') > 0 && api.indexOf('requireAdmin(') < api.indexOf('loadCostReport('), 'the guard comes before any data is read')
  assert.match(api, /no-store/)
  const load = read('lib/costs/load.ts'); assert.match(load, /rpc\('admin_cost_overview'/); assert.doesNotMatch(load, /from\('api_usage_events'\)/, 'no raw event rows are loaded')
  assert.match(read('components/dashboard/DashboardShell.tsx'), /\/admin\/costs/)
  const sql = read('supabase/proposed/20261017_api_cost_intelligence.sql'); assert.match(sql, /REVOKE ALL ON public\.api_usage_events/); assert.doesNotMatch(sql, /TO (anon|authenticated|PUBLIC)/)
})

test('nothing in this phase changes spending limits, pricing, Stripe or entitlements, and no migration is applied', () => {
  const sql = read('supabase/proposed/20261017_api_cost_intelligence.sql')
  assert.doesNotMatch(sql, /ci_research_controls|set_ci_research|DROP TABLE(?! IF EXISTS public\.api_)/)
  assert.match(sql, /enforce boolean NOT NULL DEFAULT false/)
  assert.equal(fs.existsSync(path.join(ROOT, 'supabase/migrations/20261017_api_cost_intelligence.sql')), false)
})
