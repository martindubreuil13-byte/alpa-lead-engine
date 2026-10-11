import assert from 'node:assert/strict'
import { register } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { applyDiscoveryLog, confirmDiscoveryResult, getDiscoveredCount, getStageViews, INITIAL_DISCOVERY_PROGRESS } from '../lib/scraper/discover-progress.ts'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const shim = 'data:text/javascript,' + encodeURIComponent(`
export async function searchSerperMaps(input) { return globalThis.quantityFixture.serper(input) }
export async function searchGooglePlaces(input) { return globalThis.quantityFixture.google(input) }
export async function enrichEmailWithInspection(website) {
  if (globalThis.quantityFixture.enrich) return globalThis.quantityFixture.enrich(website)
  return { record: { value: 'alex@' + new URL(website).hostname, emailSource: website,
    emailConfidence: 'high', isGenericEmail: false }, inspection: { state: 'checked', partial: false } }
}
`)
register('data:text/javascript,' + encodeURIComponent(`
const ROOT = ${JSON.stringify(ROOT)}
const shim = ${JSON.stringify(shim)}
const mocked = new Set(['@/lib/sources/serper', '@/lib/sources/google', '@/lib/scraper/email-enrichment'])
export async function resolve(specifier, context, next) {
  if (mocked.has(specifier)) return { url: shim, shortCircuit: true }
  if (specifier.startsWith('@/')) specifier = 'file://' + ROOT + '/' + specifier.slice(2)
  try { return await next(specifier, context) }
  catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && !/\\.\\w+$/.test(specifier)) return next(specifier + '.ts', context)
    throw error
  }
}
`), pathToFileURL(ROOT + '/'))
const { runSharedProspectorDiscovery } = await import('../lib/scraper/run-scraper-shared.ts')
const business = (id) => ({ company_name: `Agency ${id}`, website: `https://agency${id}.example`, phone: '+1 416 555 0100', city: 'Toronto' })
const businesses = (start, count) => Array.from({ length: count }, (_, i) => business(start + i))
async function run(maxLeads, serper, google = () => [], enrich, query = 'agency') {
  const calls = { serper: [], google: [] }
  globalThis.quantityFixture = {
    enrich,
    serper: (input) => { calls.serper.push(input); return serper(input, calls.serper.length) },
    google: (input) => { calls.google.push(input); return google(input) },
  }
  const logs = []
  const result = await runSharedProspectorDiscovery({ query, defaultCity: 'Toronto', region: '', country: 'Canada', maxLeads, mode: 'deep' }, (line) => logs.push(line))
  return { result, calls, logs }
}

for (const requested of [10, 25, 50]) {
  test(`initial discovery honors ${requested} requested businesses`, async () => {
    const { result, calls } = await run(requested, ({ maxResults }) => businesses(1, maxResults))
    assert.equal(calls.serper[0].maxResults, requested)
    assert.equal(result.discoveredCount, requested)
    assert.equal(result.enrichedCount, requested)
    assert.equal(calls.google.length, 0)
  })
}

test('strong contact quality cannot stop a quantity-short initial stage', async () => {
  const { result, calls, logs } = await run(25, () => businesses(1, 10), ({ maxResults }) => businesses(11, maxResults))
  assert.deepEqual(calls.serper.map((call) => call.maxResults), [25, 15])
  assert.equal(calls.google.length, 1)
  assert.equal(result.discoveredCount, 25)
  assert.ok(logs.includes('📦 discovered: 10'))
  assert.ok(logs.includes('📦 discovered: 25'))
})

test('overlap and exhaustion retain an honest short count within existing stage limits', async () => {
  const { result, calls, logs } = await run(25, () => businesses(1, 10), () => businesses(5, 12))
  assert.equal(calls.serper.length, 2)
  assert.equal(calls.google.length, 1)
  assert.equal(result.discoveredCount, 16)
  assert.ok(logs.includes('📦 discovered: 16'))
})

test('additional candidates grow the live count and final server count reconciles it', () => {
  let progress = { ...INITIAL_DISCOVERY_PROGRESS }
  for (let i = 0; i < 10; i++) progress = applyDiscoveryLog(progress, `📥 Agency ${i}`)
  progress = applyDiscoveryLog(progress, '📦 discovered: 10')
  progress = applyDiscoveryLog(progress, 'Improving results')
  for (let i = 10; i < 16; i++) progress = applyDiscoveryLog(progress, `📥 Agency ${i}`)
  assert.equal(getDiscoveredCount(progress, 25), 16)
  assert.equal(getStageViews(progress, 25, { running: true })[0].value, '16 of 25')
  progress = confirmDiscoveryResult(progress, 15)
  assert.equal(getDiscoveredCount(progress, 25), 15)
  assert.equal(progress.searchingMore, false)
  assert.equal(confirmDiscoveryResult(progress, 0).discoveredFinal, 0)
  assert.equal(confirmDiscoveryResult(progress, NaN).discoveredFinal, 15)
})

test('real Serper adapter can return more than ten while respecting requested quantity and tile bounds', async () => {
  const priorKey = process.env.SERPER_API_KEY
  const priorFetch = globalThis.fetch
  process.env.SERPER_API_KEY = 'offline-fixture'
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls++
    return { ok: true, json: async () => ({ places: businesses(fetchCalls === 1 ? 1 : 9, fetchCalls === 1 ? 8 : 30).map((lead) => ({ title: lead.company_name, website: lead.website, phoneNumber: lead.phone })) }) }
  }
  try {
    const { searchSerperMaps } = await import('../lib/sources/serper.ts')
    const leads = await searchSerperMaps({ query: 'agency', city: 'Toronto', maxResults: 25, mode: 'deep' })
    assert.equal(leads.length, 25)
    assert.equal(new Set(leads.map((lead) => lead.website)).size, 25)
    assert.equal(fetchCalls, 2)
  } finally {
    globalThis.fetch = priorFetch
    if (priorKey === undefined) delete process.env.SERPER_API_KEY
    else process.env.SERPER_API_KEY = priorKey
  }
})


test('live confidence totals match final business totals with possible, failed and absent websites', async () => {
  const listings = businesses(1, 5)
  listings[3].website = null
  globalThis.quantityFixture = {
    serper: () => listings,
    google: () => [],
    enrich: (website) => {
      const id = Number(new URL(website).hostname.match(/agency(\d+)/)[1])
      if (id === 5) return { record: null, inspection: { state: 'unreadable', partial: false } }
      return { record: { value: 'contact@' + new URL(website).hostname, emailSource: website,
        emailConfidence: id === 3 ? 'low' : id === 2 ? 'medium' : 'high', isGenericEmail: true },
        inspection: { state: 'checked', partial: false } }
    },
  }
  const events = []
  const result = await runSharedProspectorDiscovery({ query: 'agency', defaultCity: 'Toronto', region: '', country: 'Canada', maxLeads: 5, mode: 'deep' }, () => {}, (event) => events.push(event))
  const { summarizeContacts } = await import('../lib/scraper/results-summary.ts')
  const summary = summarizeContacts(result.finalEnrichedLeads)
  const last = events.at(-1)
  assert.deepEqual([last.planned, last.completed, last.emailsFound, last.possibleEmails], [4, 4, 2, 1])
  assert.equal(last.emailsFound, summary.emails)
  assert.equal(last.possibleEmails, summary.possibleEmails)
  assert.ok(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence))
})


test('contact-rich initial results cannot hide unusable candidates from bounded refill', async () => {
  const initial = businesses(1, 10).map((lead) => ({ ...lead, phone: null }))
  const enrich = (website) => {
    const id = Number(new URL(website).hostname.match(/agency(\d+)/)[1])
    return { record: id >= 6 && id <= 10 ? null : { value: 'alex@' + new URL(website).hostname,
      emailSource: website, emailConfidence: 'high', isGenericEmail: false }, inspection: { state: 'checked', partial: false } }
  }
  const { result, calls } = await run(10, () => initial, ({ maxResults }) => businesses(11, maxResults), enrich)
  assert.equal(calls.google.length, 1, 'five good emails do not satisfy ten usable businesses')
  assert.equal(calls.google[0].maxResults, 7)
  assert.equal(result.discoveredCount, 17)
  assert.equal(result.filteredOutWithoutContactCount, 5)
  assert.equal(result.finalEnrichedLeads.length, 10, 'replacement candidates cannot inflate output above the request')
  assert.equal(result.stopReason, 'target_reached')
})

test('bounded overlap shortfall reports the search limit rather than pretending quantity was reached', async () => {
  const { result, calls } = await run(25, () => businesses(1, 10), () => businesses(5, 12))
  assert.equal(result.enrichedCount, 16)
  assert.equal(result.stopReason, 'search_limit')
  assert.equal(calls.serper.length, 2)
  assert.equal(calls.google.length, 1)
})

test('an improvement provider exception preserves partial results and reports provider failure', async () => {
  const { result } = await run(25, () => businesses(1, 10), () => { throw new Error('offline provider failure') })
  assert.equal(result.enrichedCount, 10)
  assert.equal(result.stopReason, 'provider_error')
})

test('provider adapters returning an error log and empty results also report partial failure', async () => {
  const { result } = await run(25, () => businesses(1, 10), ({ send }) => {
    send('❌ Google API error: OVER_QUERY_LIMIT')
    return []
  })
  assert.equal(result.stopReason, 'provider_error')
})


test('refill uses the unspent second query after filtered candidates and overlapping improvement', async () => {
  const initial = businesses(1, 10).map((lead) => ({ ...lead, phone: null }))
  const enrich = (website) => {
    const id = Number(new URL(website).hostname.match(/agency(\d+)/)[1])
    return { record: id >= 6 && id <= 10 ? null : { value: 'alex@' + new URL(website).hostname,
      emailSource: website, emailConfidence: 'high', isGenericEmail: false }, inspection: { state: 'checked', partial: false } }
  }
  const { result, calls } = await run(10, (_, call) => call === 1 ? initial : businesses(11, 5), () => businesses(1, 5), enrich)
  assert.equal(calls.serper.length, 2)
  assert.equal(calls.serper[1].maxResults, 5)
  assert.equal(calls.google.length, 1)
  assert.equal(result.enrichedCount, 10)
  assert.equal(result.filteredOutWithoutContactCount, 5)
  assert.equal(result.stopReason, 'target_reached')
})


test('consultant conflicts are removed before website enrichment and bounded refill replaces them', async () => {
 const rejected={...business(90),company_name:'Options Consulting',industry:'Employment agency'}
 const matched={...business(91),company_name:'Management Advisory',industry:'Business management consultant'}
 const inspected=[]
 const {result,calls}=await run(1,()=>[rejected],()=>[matched],async website=>{
  inspected.push(website)
  return {record:{value:'alex@example.com',emailConfidence:'high',isGenericEmail:false},inspection:{state:'checked',partial:false}}
 },'consultant')
 assert.equal(result.finalEnrichedLeads.length,1)
 assert.equal(result.finalEnrichedLeads[0].company_name,'Management Advisory')
 assert.equal(result.finalEnrichedLeads[0].industry,'Business management consultant')
 assert.equal(result.filteredOutRelevanceCount,1)
 assert.equal(inspected.includes(rejected.website),false)
 assert.ok(calls.serper.length<=3 && calls.google.length<=1)
})

test('relevance filtering also covers Google improvement', async ()=>{
 const wrong={...business(92),industry:'Employment agency'}
 const good={...business(93),company_name:'Strategy Consultant',industry:'Business management consultant'}
 const {result,calls}=await run(1,(_input,call)=>[wrong],()=>[wrong,good],undefined,'consultant')
 assert.equal(result.finalEnrichedLeads[0].company_name,'Strategy Consultant')
 assert.equal(result.filteredOutRelevanceCount,1)
 assert.equal(calls.serper.length,2)
 assert.equal(calls.google.length,1)
})

test('SEO evidence is ranked ahead of adjacent marketing and uncertainty is disclosed',async ()=>{
 const uncertain={...business(94),company_name:'Digital Agency',industry:'Marketing agency'}
 const exact={...business(95),company_name:'SEO Company',industry:'Internet marketing service'}
 const {result}=await run(2,()=>[uncertain,exact],()=>[],undefined,'SEO agency')
 assert.equal(result.finalEnrichedLeads[0].company_name,'SEO Company')
 assert.equal(result.finalEnrichedLeads.length,2)
 assert.match(result.detailLine,/Business type could not be confirmed for 1 result/)
})

test('unused Serper refill filters conflicts before enrichment',async ()=>{
 const initial=[{...business(101),industry:'Business management consultant'},{...business(102),phone:null,industry:'Business management consultant'}]
 const wrong={...business(103),industry:'Employment agency'}
 const good={...business(104),industry:'Business management consultant'}
 const inspected=[]
 const {result,calls}=await run(2,(_input,call)=>call===1?initial:[wrong,good],()=>[wrong],async website=>{
  inspected.push(website)
  return {record:website===initial[1].website?{value:null}:{value:'alex@example.com',emailConfidence:'high',isGenericEmail:false},inspection:{state:'checked',partial:false}}
 },'consultant')
 assert.equal(calls.serper.length,2)
 assert.equal(inspected.includes(wrong.website),false)
 assert.equal(result.filteredOutRelevanceCount,1)
 // The existing refill provider limit is respected even when an adapter returns too many candidates.
 assert.equal(result.enrichedCount,2)
})
