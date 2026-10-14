import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { cleanSearchText, fetchLeadDossier, fetchLeadPage, isArchivedRow, LIST_COLUMNS, PAGE_SIZE_MAX, parseListParams } from '../lib/my-leads/list.ts'
import { createFakeClient } from './helpers/fake-postgrest.mjs'

const A = '35d2cccf-1de5-48d4-b61a-68de1db94432'
const B = '99999999-1111-4222-8333-444444444444'
const params = (query = '') => {
  const parsed = parseListParams(new URLSearchParams(query))
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  return parsed.params
}
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const bigProfile = (i) => ({ summary: `Summary ${i}. Builds software for logistics companies and offers integration, analytics and support.`, industry: 'Software', business_category: 'IT', primary_service: 'Custom software', core_services: ['Integration', 'Analytics'], target_customer: 'Logistics firms', keywords: ['logistics', 'ai', `kw${i % 50}`], competitive_advantage: 'Not shown to customers', generated_at: '2026-10-12' })

// -------------------------------------------------------------------------------------------------------- a realistic library
function library() {
  const leads = []
  const jobs = []
  const cities = ['Toronto', 'Laval', 'Montreal', 'Calgary', null]
  const industries = ['Dentist', 'Web designer', 'IT consulting', 'Marketing agency', null]
  for (let i = 0; i < 10_000; i += 1) {
    const archived = i % 7 === 0
    leads.push({
      id: uuid(i), user_id: A, company_name: `Business ${String(i % 4_000).padStart(4, '0')}`, industry: industries[Math.floor(i / 5) % 5], city: cities[i % 5],
      email: i % 3 === 0 ? `info${i}@example.com` : i % 3 === 1 ? '' : null, phone: i % 2 === 0 ? `+1 416 555 ${String(i).padStart(4, '0')}` : null,
      website: i % 5 === 4 ? null : `https://biz${i}.example.com`, status: archived ? 'closed_no_response' : 'inbox', pipeline_stage: i % 11 === 0 ? 'closed' : i % 13 === 0 ? 'contacted' : null,
      closed_at: null, created_at: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`, last_activity_at: i % 9 === 0 ? null : `2026-10-${String((i % 12) + 1).padStart(2, '0')}T12:00:00Z`,
      commercial_profile: i % 4 === 0 ? bigProfile(i) : null,
      website_snapshot: { research_pages: ['x'.repeat(5000)] }, business_signals: { has_blog: true },
    })
    if (i % 4 !== 0 && i % 5 !== 4 && i % 6 !== 5) {
      const mode = i % 4
      jobs.push({ id: `job${i}`, lead_id: uuid(i), user_id: A, run_id: 'run-1', created_at: '2026-10-12T10:00:00Z', retry_count: 0, status: mode === 1 ? 'pending' : mode === 2 ? 'processing' : 'failed', last_error: mode === 3 ? (i % 8 === 3 ? 'cancelled by customer' : 'Website response exceeded the size limit') : null })
    }
  }
  for (let i = 0; i < 5_000; i += 1) {
    leads.push({ id: uuid(100_000 + i), user_id: B, company_name: `Business ${String(i % 4_000).padStart(4, '0')}`, industry: 'Dentist', city: 'Toronto', email: 'x@example.com', phone: '1', website: 'https://other.example.com', status: 'inbox', pipeline_stage: null, closed_at: null, created_at: '2026-10-01T00:00:00Z', last_activity_at: '2026-10-11T00:00:00Z', commercial_profile: bigProfile(i), website_snapshot: {}, business_signals: {} })
    jobs.push({ id: `jobB${i}`, lead_id: uuid(100_000 + i), user_id: B, run_id: 'run-2', created_at: '2026-10-12T10:00:00Z', retry_count: 0, status: 'pending', last_error: null })
  }
  return { leads, jobs }
}
const data = library()
const client = () => createFakeClient({ leads: data.leads, commercial_intelligence_queue: data.jobs })
const mine = data.leads.filter((lead) => lead.user_id === A)

// ------------------------------------------------------------------------------------------------------------- parameters
test('query parameters are validated: unknown values are refused, sizes are clamped, search text is made safe', () => {
  const defaults = params('')
  assert.deepEqual([defaults.view, defaults.sort, defaults.page, defaults.pageSize, defaults.summary], ['active', 'activity', 1, 25, false])
  assert.equal(params('pageSize=5000').pageSize, PAGE_SIZE_MAX)
  for (const bad of ['view=everyone', 'sort=random', 'bi=magic', 'contact=fax', 'page=0', 'page=-1', 'page=abc', 'pageSize=0', 'pageSize=1.5', 'page=99999999']) {
    assert.equal(parseListParams(new URLSearchParams(bad)).ok, false, bad)
  }
  assert.deepEqual(params('contact=email,phone,email').contact, ['email', 'phone'])
  // characters that structure a filter can never reach it
  assert.deepEqual(params('q=a%2Cb)%2Bor(x%22y%5Cz*').words, ['a', 'b', '+or', 'x', 'y']) // structure characters become spaces; at most five words
  assert.equal(cleanSearchText('"(),*\\'), '')
  assert.equal(params(`q=${'w '.repeat(50)}`).words.length, 5)
  assert.ok(params(`q=${'x'.repeat(500)}`).words.join('').length <= 100)
})

// ----------------------------------------------------------------------------------------------------------------- pagination
test('10,000 leads: paging through returns every owned lead exactly once, in a stable order, with a constant total', async () => {
  const c = client()
  const seen = []
  let total = null
  for (let page = 1; ; page += 1) {
    const result = await fetchLeadPage(c, A, params(`view=all&pageSize=100&page=${page}&sort=newest`))
    total ??= result.total
    assert.equal(result.total, total)
    assert.ok(result.items.length <= 100)
    seen.push(...result.items.map((item) => item.id))
    if (!result.hasMore) break
    assert.equal(result.items.length, 100)
  }
  assert.equal(total, 10_000)
  assert.equal(seen.length, 10_000)
  assert.equal(new Set(seen).size, 10_000) // no repeats, no gaps
  assert.deepEqual([...seen].sort(), mine.map((lead) => lead.id).sort())
  // every read was a bounded window; none asked for the whole library
  const windows = c.requests.filter((request) => request.range)
  assert.equal(windows.length, 100)
  assert.ok(windows.every((request) => request.range[1] - request.range[0] + 1 <= 100))
})

test('out-of-range pages and tiny pages behave: empty items, the true total, no more pages', async () => {
  const beyond = await fetchLeadPage(client(), A, params('view=all&pageSize=100&page=500'))
  assert.deepEqual([beyond.items.length, beyond.total, beyond.hasMore], [0, 10_000, false])
  const one = await fetchLeadPage(client(), A, params('view=all&pageSize=1&page=2'))
  assert.deepEqual([one.items.length, one.page, one.pageSize, one.hasMore], [1, 2, 1, true])
})

// ------------------------------------------------------------------------------------------------------------------ sorting
test('sorting is deterministic: ties are broken by id, nulls last, and repeating a request returns the same order', async () => {
  const c = client()
  for (const sort of ['activity', 'newest', 'oldest', 'name', 'location']) {
    const first = await fetchLeadPage(c, A, params(`view=all&pageSize=100&sort=${sort}`))
    const again = await fetchLeadPage(c, A, params(`view=all&pageSize=100&sort=${sort}`))
    assert.deepEqual(first.items.map((item) => item.id), again.items.map((item) => item.id), sort)
  }
  const byName = await fetchLeadPage(c, A, params('view=all&pageSize=100&sort=name'))
  const names = byName.items.map((item) => item.company_name)
  assert.deepEqual(names, [...names].sort()) // ascending
  // two businesses share every name (4,000 names, 10,000 leads): equal names are ordered by id
  for (let i = 1; i < byName.items.length; i += 1) {
    if (names[i] === names[i - 1]) assert.ok(byName.items[i - 1].id < byName.items[i].id)
  }
  const byActivity = await fetchLeadPage(c, A, params('view=all&pageSize=100&sort=activity'))
  const times = byActivity.items.map((item) => Date.parse(item.last_activity_at))
  assert.deepEqual(times, [...times].sort((x, y) => y - x)) // most recent first
  const newest = await fetchLeadPage(c, A, params('view=all&pageSize=100&sort=newest'))
  const created = newest.items.map((item) => Date.parse(item.created_at))
  assert.deepEqual(created, [...created].sort((x, y) => y - x))
})

// ------------------------------------------------------------------------------------------------------------------ filtering
test('active and archived views follow the existing archive rule, including leads with no pipeline stage', async () => {
  const active = await fetchLeadPage(client(), A, params('view=active&pageSize=100'))
  const archived = await fetchLeadPage(client(), A, params('view=archived&pageSize=100'))
  const expectedArchived = mine.filter(isArchivedRow).length
  assert.equal(archived.total, expectedArchived)
  assert.equal(active.total, 10_000 - expectedArchived)
  assert.ok(active.items.every((item) => !item.archived))
  assert.ok(archived.items.every((item) => item.archived))
  assert.ok(mine.some((lead) => lead.pipeline_stage === null && lead.status === 'inbox')) // the NULL case is in the data
})

test('search words must all match, across name, city, industry, website and the saved profile (summary and keywords)', async () => {
  const toronto = await fetchLeadPage(client(), A, params('view=all&q=toronto&pageSize=100'))
  assert.equal(toronto.total, mine.filter((l) => l.city === 'Toronto').length + mine.filter((l) => l.city !== 'Toronto' && l.commercial_profile && /toronto/i.test(JSON.stringify(l.commercial_profile))).length)
  const narrowed = await fetchLeadPage(client(), A, params('view=all&q=toronto%20dentist&pageSize=100'))
  assert.equal(narrowed.total, mine.filter((l) => l.city === 'Toronto' && l.industry === 'Dentist').length)
  assert.ok(narrowed.total < toronto.total) // a second word narrows, never widens
  const keyword = await fetchLeadPage(client(), A, params('view=all&q=kw8&pageSize=100'))
  assert.equal(keyword.total, mine.filter((l) => l.commercial_profile && l.commercial_profile.keywords.includes("kw8")).length)
  assert.ok(keyword.total > 0)
  const byWebsite = await fetchLeadPage(client(), A, params('view=all&q=biz42.example&pageSize=100'))
  assert.ok(byWebsite.items.some((item) => item.website === 'https://biz42.example.com'))
  assert.equal((await fetchLeadPage(client(), A, params('view=all&q=zzzzqqqq'))).total, 0)
})

test('location, industry and contact-availability filters combine, and an empty email counts as missing', async () => {
  const result = await fetchLeadPage(client(), A, params('view=all&city=laval&industry=web&contact=email,phone,website&pageSize=100'))
  const expected = mine.filter((l) => /laval/i.test(l.city ?? '') && /web/i.test(l.industry ?? '') && l.email && l.phone && l.website)
  assert.equal(result.total, expected.length)
  assert.ok(result.items.every((item) => item.has.email && item.has.phone && item.has.website))
  const withEmail = await fetchLeadPage(client(), A, params('view=all&contact=email'))
  assert.equal(withEmail.total, mine.filter((l) => l.email).length) // neither '' nor NULL
})

test('Business Intelligence filters: ready, not ready, awaiting research, requiring attention (cancelled is not an alert)', async () => {
  const c = client()
  const ready = await fetchLeadPage(c, A, params('view=all&bi=ready&pageSize=100'))
  assert.equal(ready.total, mine.filter((l) => l.commercial_profile).length)
  assert.ok(ready.items.every((item) => item.intelligence.state === 'ready' && item.intelligence.preview))
  const notReady = await fetchLeadPage(c, A, params('view=all&bi=not_ready&pageSize=100'))
  assert.equal(notReady.total, 10_000 - ready.total)
  const jobOf = (id) => data.jobs.find((job) => job.lead_id === id && job.user_id === A)
  const awaiting = await fetchLeadPage(c, A, params('view=all&bi=awaiting&pageSize=100'))
  assert.equal(awaiting.total, mine.filter((l) => !l.commercial_profile && ['pending', 'processing'].includes(jobOf(l.id)?.status)).length)
  assert.ok(awaiting.items.every((item) => ['queued', 'researching'].includes(item.intelligence.state)))
  const attention = await fetchLeadPage(c, A, params('view=all&bi=attention&pageSize=100'))
  assert.equal(attention.total, mine.filter((l) => { const j = jobOf(l.id); return !l.commercial_profile && j?.status === 'failed' && !/^cancelled/i.test(j.last_error ?? '') }).length)
  assert.ok(attention.items.every((item) => item.intelligence.state === 'failed'))
})

// ------------------------------------------------------------------------------------------------------------------ ownership
test('another customer is never visible: not in any page, filter, count or summary, even when their data matches the search', async () => {
  const c = client()
  const otherIds = new Set(data.leads.filter((l) => l.user_id === B).map((l) => l.id))
  for (const query of ['view=all&pageSize=100', 'view=all&q=dentist&pageSize=100', 'view=all&bi=ready&pageSize=100', 'view=all&bi=awaiting&pageSize=100', 'view=archived&city=toronto&pageSize=100']) {
    const result = await fetchLeadPage(c, A, params(query))
    assert.ok(result.items.every((item) => !otherIds.has(item.id)), query)
  }
  const asB = await fetchLeadPage(c, B, params('view=all&pageSize=100'))
  assert.equal(asB.total, 5_000)
  assert.ok(asB.items.every((item) => otherIds.has(item.id)))
  const summaryA = (await fetchLeadPage(c, A, params('summary=1&pageSize=1'))).summary
  assert.equal(summaryA.total, 10_000)
  // an unknown customer sees nothing
  assert.equal((await fetchLeadPage(c, uuid(42), params('view=all'))).total, 0)
})

test('every read names the owner, and the customer endpoints use the customer session only (no service role)', () => {
  const list = readFileSync('lib/my-leads/list.ts', 'utf8')
  assert.equal((list.match(/\.eq\('user_id', userId\)/g) ?? []).length, 6) // jobs, counts, page, dossier (twice: with and without the optional profile column), export
  assert.match(list, /\.select\(EXPORT_COLUMNS\)\.eq\('user_id', userId\)\.in\('id'/) // the export names the owner too
  assert.match(list, /\.eq\('id', id\)\.eq\('user_id', userId\)/)
  for (const file of ['lib/my-leads/list.ts', 'lib/my-leads/params.ts', 'app/api/my-leads/route.ts', 'app/api/my-leads/[id]/route.ts', 'app/api/my-leads/export/route.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.ok(!/createAdminClient|SERVICE_ROLE|supabase\/admin/.test(source), `${file} must not use elevated access`)
  }
  for (const file of ['app/api/my-leads/route.ts', 'app/api/my-leads/[id]/route.ts', 'app/api/my-leads/export/route.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /getUserProfile\(\)/)
    assert.match(source, /if \(!profile\) return NextResponse\.json\(\{ ok: false, error: 'UNAUTHORIZED' \}, \{ status: 401/)
    assert.match(source, /createServerClient\(\)/)
    assert.match(source, /'Cache-Control': 'no-store'/)
  }
})

// ----------------------------------------------------------------------------------------------------------- empty and summary
test('an empty library: no items, zero counts, nothing invented, and a search with no match is simply empty', async () => {
  const empty = createFakeClient({ leads: [], commercial_intelligence_queue: [] })
  const result = await fetchLeadPage(empty, A, params('summary=1'))
  assert.deepEqual([result.items, result.total, result.hasMore], [[], 0, false])
  assert.deepEqual(result.summary, { total: 0, archived: 0, ready: 0, awaiting: 0, attention: 0 })
  assert.equal((await fetchLeadPage(empty, A, params('q=anything&bi=awaiting&contact=email'))).total, 0)
})

test('the overview counts match the library: total, archived, and (active only) ready, awaiting research, requiring attention', async () => {
  const { summary } = await fetchLeadPage(client(), A, params('summary=1&pageSize=1'))
  const active = mine.filter((l) => !isArchivedRow(l))
  const jobOf = (id) => data.jobs.find((job) => job.lead_id === id && job.user_id === A)
  assert.equal(summary.total, 10_000)
  assert.equal(summary.archived, mine.filter(isArchivedRow).length)
  assert.equal(summary.ready, active.filter((l) => l.commercial_profile).length)
  assert.equal(summary.awaiting, active.filter((l) => !l.commercial_profile && ['pending', 'processing'].includes(jobOf(l.id)?.status)).length)
  assert.equal(summary.attention, active.filter((l) => { const j = jobOf(l.id); return !l.commercial_profile && j?.status === 'failed' && !/^cancelled/i.test(j.last_error ?? '') }).length)
  assert.equal((await fetchLeadPage(client(), A, params('pageSize=1'))).summary, undefined) // only when asked for
})

// ------------------------------------------------------------------------------------------------------------- lightweight
test('list responses are lightweight: only small fields, a short preview, never the stored profile, snapshot or signals', async () => {
  const c = client()
  const result = await fetchLeadPage(c, A, params('view=all&bi=ready&pageSize=100'))
  const allowed = ['id', 'company_name', 'industry', 'city', 'email', 'phone', 'website', 'has', 'archived', 'created_at', 'last_activity_at', 'intelligence'].sort()
  for (const item of result.items) {
    assert.deepEqual(Object.keys(item).sort(), allowed)
    assert.deepEqual(Object.keys(item.intelligence).sort(), ['label', 'preview', 'state'])
    assert.ok(item.intelligence.preview.length <= 220)
  }
  const json = JSON.stringify(result)
  for (const forbidden of ['website_snapshot', 'business_signals', 'competitive_advantage', 'research_pages', 'core_services', 'xxxxx']) assert.ok(!json.includes(forbidden), forbidden)
  // what the database was asked for: no whole-profile column in the select
  const select = c.requests.find((request) => request.range)?.columns ?? ''
  assert.ok(!/(^|[ ,])(commercial_profile|website_snapshot|business_signals)(,|$| )/.test(select.replace(/profile_summary:commercial_profile->>summary/, '')))
  assert.match(LIST_COLUMNS, /profile_summary:commercial_profile->>summary/)
  // against what the old page shipped for the same 100 leads
  const wholeRows = JSON.stringify(mine.filter((l) => l.commercial_profile).slice(0, 100))
  assert.ok(json.length * 3 < wholeRows.length * 1.0 + 40_000, `list ${json.length} bytes vs whole rows ${wholeRows.length}`)
})

// ---------------------------------------------------------------------------------------------------------------- dossier
test('the dossier loads one business on demand with its full contact and intelligence, never the raw payloads', async () => {
  const c = client()
  const ready = mine.find((l) => l.commercial_profile)
  const dossier = await fetchLeadDossier(c, A, ready.id)
  assert.equal(dossier.id, ready.id)
  assert.equal(dossier.intelligence.state, 'ready')
  assert.match(dossier.intelligence.card.summary, /^Summary \d+/)
  assert.deepEqual(dossier.intelligence.profile.core_services, ['Integration', 'Analytics'])
  assert.equal(dossier.intelligence.profile.target_customer, 'Logistics firms')
  assert.ok(dossier.intelligence.profile.keywords.includes('logistics'))
  assert.equal(dossier.contact.website, ready.website)
  const json = JSON.stringify(dossier)
  for (const forbidden of ['website_snapshot', 'business_signals', 'competitive_advantage', 'research_pages']) assert.ok(!json.includes(forbidden), forbidden)

  const queued = mine.find((l) => !l.commercial_profile && data.jobs.find((j) => j.lead_id === l.id && j.status === 'pending'))
  const waiting = await fetchLeadDossier(c, A, queued.id)
  assert.equal(waiting.intelligence.state, 'queued')
  assert.equal(waiting.intelligence.card, null) // nothing invented for a business with no profile
  assert.equal(waiting.intelligence.profile, null)

  const bare = mine.find((l) => !l.commercial_profile && !data.jobs.find((j) => j.lead_id === l.id) && l.website)
  assert.equal((await fetchLeadDossier(c, A, bare.id)).intelligence.state, 'not_started')
  const noSite = mine.find((l) => !l.commercial_profile && !l.website)
  assert.equal((await fetchLeadDossier(c, A, noSite.id)).intelligence.state, 'unavailable')
})

test('the dossier is owner-only: someone else\'s id and an unknown id answer identically (nothing to learn)', async () => {
  const c = client()
  const theirs = data.leads.find((l) => l.user_id === B).id
  assert.equal(await fetchLeadDossier(c, A, theirs), null)
  assert.equal(await fetchLeadDossier(c, A, uuid(987_654)), null)
  assert.ok(await fetchLeadDossier(c, B, theirs))
  const route = readFileSync('app/api/my-leads/[id]/route.ts', 'utf8')
  assert.match(route, /UUID\.test\(id\)/)
  assert.match(route, /status: 404/)
})

test('the full dossier is not fetched by the list, and the page no longer loads the library', () => {
  assert.ok(!/DOSSIER_COLUMNS/.test(readFileSync('lib/my-leads/list.ts', 'utf8').split('export async function fetchLeadPage')[1].split('// ----')[0]))
  const page = readFileSync('app/dashboard/my-leads/page.tsx', 'utf8')
  assert.ok(!/LEAD_SELECT|\.from\(/.test(page)) // no full-table read in the page
  assert.match(page, /MyLeadsWorkspace/)
  for (const file of ['app/api/scrape/route.ts', 'lib/commercial-intelligence/run-authorization.ts', 'lib/commercial-intelligence/kick-research.ts', 'lib/scraper/save-discover-results.ts']) {
    assert.ok(!/my-leads\/list/.test(readFileSync(file, 'utf8')), file)
  }
})



// ------------------------------------------------------------------------------------------------------------------ export
import { EXPORT_MAX, fetchLeadsForExport } from '../lib/my-leads/list.ts'

test('CSV export returns only the customer\'s own selected businesses, in the order selected, read in bounded chunks', async () => {
  const c = client()
  const own = mine.slice(0, 250).map((lead) => lead.id)
  const theirs = data.leads.find((l) => l.user_id === B).id
  const rows = await fetchLeadsForExport(c, A, [...own.slice(0, 120), theirs, uuid(777_777), ...own.slice(120), own[0]])
  assert.deepEqual(rows.map((row) => row.id), own) // another customer's id and an unknown id are simply absent; no duplicates
  assert.ok(rows[0].commercial_profile && rows[0].company_name) // what the CSV needs
  const reads = c.requests.filter((request) => request.columns.includes('ci_completed_at'))
  assert.equal(reads.length, 3) // 250 ids in chunks of 100
  assert.deepEqual(await fetchLeadsForExport(c, B, [mine[0].id]), []) // not the other customer's either way round
})

test('an export is capped, and the endpoint validates its input and uses the customer session only', async () => {
  const everything = mine.map((lead) => lead.id)
  const rows = await fetchLeadsForExport(client(), A, everything)
  assert.equal(rows.length, EXPORT_MAX)
  const route = readFileSync('app/api/my-leads/export/route.ts', 'utf8')
  assert.match(route, /ids\.length > EXPORT_MAX/)
  assert.match(route, /UUID\.test\(id\)/)
  assert.match(route, /status: 400/)
})
