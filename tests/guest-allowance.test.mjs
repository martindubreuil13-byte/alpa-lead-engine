import assert from 'node:assert/strict'
import fs from 'node:fs'
import {register} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const server = pathToFileURL(path.join(ROOT, 'tests/fixtures/guest/server.mjs')).href
const network = pathToFileURL(path.join(ROOT, 'tests/fixtures/guest/network.mjs')).href
process.env.STRIPE_SECRET_KEY = 'sk_test_offline_fixture'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-fixture-key'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://offline.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-fixture'
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the allowance test') }
register('data:text/javascript,' + encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}
export async function resolve(specifier,context,next) {
 if(['next/server','next/headers','@supabase/ssr','@/lib/guest/server'].includes(specifier))return {url:${JSON.stringify(server)},shortCircuit:true}
 if(['@/lib/sources/serper','@/lib/sources/google','@/lib/scraper/email-enrichment'].includes(specifier))return {url:${JSON.stringify(network)},shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`), pathToFileURL(ROOT + '/'))

const {countOptions, describeAllowance, remainingNotice, searchButtonLabel} = await import('../lib/guest/snapshot.ts')
const {buildConversionCopy} = await import('../lib/billing/first-month-offer.ts')
const {classifyReserveRefusal} = await import('../lib/guest/reserve-refusal.ts')
const {POST: search} = await import('../app/api/scrape/route.ts')
const {GET: download} = await import('../app/api/guest/export/route.ts')
const {state} = await import('./fixtures/guest/server.mjs')

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const view = (used, attempts) => describeAllowance({used, attempts, leads: new Array(used).fill({})})

test('every remaining allowance offers a choice that never exceeds it and never demands a minimum of 10', () => {
  for (const [remaining, expected] of [[25, ['10', '25']], [15, ['10', '15']], [5, ['5']], [1, ['1']], [9, ['9']], [10, ['10']]]) {
    assert.deepEqual(countOptions(remaining), expected, `remaining ${remaining}`)
    for (const option of expected) assert.ok(Number(option) <= remaining)
  }
})

test('fresh, 15, 5, 1 and 0 remaining', () => {
  assert.equal(view(0, 0).remaining, 25); assert.equal(view(0, 0).exhausted, false)
  assert.equal(view(10, 1).remaining, 15); assert.equal(view(10, 1).lastBusiness, false)
  assert.equal(view(20, 2).remaining, 5); assert.equal(view(20, 2).exhausted, false)
  const last = view(24, 2)
  assert.equal(last.remaining, 1); assert.equal(last.lastBusiness, true); assert.equal(last.exhausted, false)
  assert.equal(searchButtonLabel(last), 'Find my last business →')
  assert.equal(searchButtonLabel(view(10, 1)), 'Find businesses')
  assert.equal(view(25, 2).remaining, 0); assert.equal(view(25, 2).exhausted, true); assert.equal(view(25, 2).lastBusiness, false)
})

test('returning-visitor wording follows the delivered count', () => {
  assert.equal(remainingNotice(view(24, 2)), "You've discovered 24 businesses. You have 1 free business remaining.")
  assert.equal(remainingNotice(view(10, 1)), "You've discovered 10 businesses. You have 15 free businesses remaining.")
  const done = buildConversionCopy({kind: 'allowance', saved: 25, eligible: true})
  assert.equal(done.headline, "You've discovered your 25 free businesses.")
  assert.equal(done.primaryCta, 'Explore ALPA plans →')
  assert.match(done.offerLine, /50% off/)
  assert.match(done.inactiveNotice, /not active yet/, 'the offer stays a preview')
})

test('three searches used before 25: said plainly, and never implies 25 were delivered', () => {
  const state3 = view(12, 3)
  assert.equal(state3.exhausted, true); assert.equal(state3.remaining, 13)
  const copy = buildConversionCopy({kind: 'searches', saved: 12, eligible: true})
  assert.match(copy.headline, /three free searches/)
  assert.match(copy.support, /discovered 12 businesses/)
  assert.doesNotMatch(copy.headline + copy.support, /25 free businesses/)
  assert.equal(classifyReserveRefusal({created_at: new Date().toISOString(), attempts: 3, used: 12, active_until: null}), 'GUEST_SEARCHES_USED', 'no silent extra search')
})

test('the page offers the last business and keeps the three-search limit', () => {
  const page = read('components/trial/TrialExperience.tsx')
  assert.match(page, /searchButtonLabel\(allowance\)/); assert.match(page, /hideCount=\{allowance\.lastBusiness\}/)
  assert.match(page, /allowance\.exhausted \|\| limitSeen/)
  assert.match(read('components/trial/TrialPanels.tsx'), /Find my last business →/)
})

const post = (maxLeads) => search(new Request('https://alpa.example/api/scrape', {
  method: 'POST',
  headers: {origin: 'https://alpa.example', 'Content-Type': 'application/json'},
  body: JSON.stringify({query: 'businesses', defaultCity: 'Toronto', maxLeads, existingLeadCount: 0, guestTrial: true}),
}))
const leadsOf = async (response) => (await response.text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6))).filter((e) => e.type === 'lead')

test('a one-business request works end to end, is never exceeded, and the CSV holds only what was delivered', async () => {
  Object.assign(state, {leads: [], used: 24})
  const response = await post(1)
  assert.equal(response.status, 200)
  const leads = await leadsOf(response)
  assert.equal(leads.length, 1)
  assert.equal(state.used, 25, 'allowance counts the one delivered business')
  assert.equal(state.leads.length, 1)
  const csv = await (await download(new Request('https://alpa.example/api/guest/export'))).text()
  assert.equal(csv.trim().split('\n').length, 2, 'header plus the one delivered business')
})

test('asking for more than is left is capped by the server, and a short result is refunded', async () => {
  Object.assign(state, {leads: [], used: 24})
  const leads = await leadsOf(await post(25))
  assert.equal(leads.length, 1, 'requested 25, one was left')
  assert.equal(state.used, 25)

  // A search that delivers fewer than reserved: the unused businesses are returned to the allowance (the reservation function's rule).
  Object.assign(state, {leads: [], used: 0})
  const {guestDb} = await import('./fixtures/guest/server.mjs')
  const reserved = (await guestDb().rpc('reserve_guest_trial', {p_count: 10})).data
  await guestDb().rpc('finish_guest_trial', {p_reserved: reserved, p_leads: new Array(4).fill({company_name: 'x'})})
  assert.equal(state.used, 4, 'only the four delivered count')
})

test('signing up cannot reset or bypass the allowance: the claim never touches used or attempts', () => {
  const claim = read('app/api/guest/claim/route.ts')
  assert.doesNotMatch(claim, /used\s*:\s*0|attempts\s*:\s*0|\.delete\(\)/)
  assert.match(claim, /FREE_TRIAL_LEAD_LIMIT/)
})

test('a returning visitor is recognised from the signed cookie and server record, not from the browser', () => {
  const security = read('lib/guest/security.ts')
  assert.match(security, /GUEST_MAX_AGE/)
  const guest = read('lib/guest/server.ts')
  assert.match(guest, /readGuestId\(store\.get\(GUEST_COOKIE\)/)
  assert.match(guest, /maxAge:GUEST_MAX_AGE/, 'a persistent cookie survives closing and reopening the browser')
  assert.doesNotMatch(read('components/trial/TrialExperience.tsx'), /localStorage|getItem/, 'the allowance is never read from browser storage')
})
