import assert from 'node:assert/strict'
import fs from 'node:fs'
import {register} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const href = (file) => pathToFileURL(path.join(ROOT, file)).href
process.env.STRIPE_SECRET_KEY = 'sk_test_offline_fixture'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-fixture-key'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://offline.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-fixture'
process.env.OPENAI_API_KEY = 'sk-offline-fixture'
process.env.GUEST_PROFILES_ENABLED = 'true'
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the profile test') }
register('data:text/javascript,' + encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}
export async function resolve(specifier,context,next) {
 if(['next/server','next/headers','@supabase/ssr','@/lib/guest/server'].includes(specifier))return {url:${JSON.stringify(href('tests/fixtures/guest/server.mjs'))},shortCircuit:true}
 if(specifier==='@/lib/ai/openai')return {url:${JSON.stringify(href('tests/fixtures/guest/openai.mjs'))},shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`), pathToFileURL(ROOT + '/'))

const lib = await import('../lib/guest/light-profile.ts')
const {POST: profile} = await import('../app/api/guest/profile/route.ts')
const {POST: claim} = await import('../app/api/guest/claim/route.ts')
const {state} = await import('./fixtures/guest/server.mjs')
const {ai} = await import('./fixtures/guest/openai.mjs')
const {guestDossierModel, memberDossierModel} = await import('../lib/my-leads/dossier-model.ts')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const FACTS = {
  title: 'Clinique Laval | Family dental care',
  description: 'Family dental care in Laval: teeth whitening, dental implants, orthodontics and emergency dentistry for children and adults.',
  headings: ['Teeth whitening', 'Dental implants', 'Orthodontics', 'Emergency dentistry'],
  source_urls: ['https://clinique.example/'],
}
const GOOD = JSON.stringify({
  summary: 'Clinique Laval is a family dental clinic in Laval. According to its website, it offers teeth whitening, dental implants, orthodontics and emergency dentistry for both children and adults.',
  tags: ['Teeth whitening', 'Dental implants', 'Orthodontics', 'Emergency dentistry', 'Invisalign', 'Cosmetic surgery'],
})
const lead = (id, facts = FACTS) => ({id, company_name: 'Clinique Laval', city: 'Laval', industry: 'Dentist', email: 'info@clinique.example', phone: '+1 450 555 0100', website: 'https://clinique.example', website_intelligence: facts, email_confidence: 'medium', is_generic_email: false, source: 'serper', cost_estimate: 0})
const reset = (leads = [lead('b1')]) => {
  Object.assign(state, {leads, used: leads.length, noCookie: false, profileAttempts: 0, dailyUsed: 0, profileCalls: [], expired: false, user: null, claimed: undefined, lightProfileColumn: true, factsColumn: true, existingLeads: [], otherTrials: [], profile: null})
  Object.assign(ai, {calls: [], content: GOOD, delayMs: 0, fail: false})
}
const post = (body, {origin = 'https://alpa.example'} = {}) => profile(new Request('https://alpa.example/api/guest/profile', {method: 'POST', headers: {origin, 'Content-Type': 'application/json'}, body: JSON.stringify(body)}))

// ------------------------------------------------------------------------------------------------------ evidence quality
test('a profile needs at least 30 words of stored website text, and sends the model no more than 1,200 characters', () => {
  assert.equal(lib.hasEnoughEvidence(FACTS), true)
  assert.equal(lib.hasEnoughEvidence({title: 'Home', description: 'Welcome to our website.', headings: []}), false)
  assert.equal(lib.hasEnoughEvidence(null), false)
  const huge = {title: 'T '.repeat(200), description: 'word '.repeat(300), headings: new Array(20).fill('Heading words here')}
  assert.ok(lib.profileEvidence(huge).text.length <= lib.LIGHT_PROFILE_LIMITS.maxEvidenceChars)
  const prompt = lib.buildLightProfilePrompt('Clinique Laval', lib.profileEvidence(huge).text)
  assert.ok(prompt.length < 2200, 'a bounded prompt (about 550 tokens)')
})

test('the model answer is kept only if it is 25-40 words, grounded in the website text, and its tags are mentioned there', () => {
  const evidence = lib.profileEvidence(FACTS).text
  const ok = lib.parseLightProfile(GOOD, evidence, 'Clinique Laval')
  assert.ok(ok)
  assert.deepEqual(ok.tags, ['Teeth whitening', 'Dental implants', 'Orthodontics', 'Emergency dentistry'], 'tags the website never mentioned are dropped; at most five')
  assert.equal(lib.parseLightProfile('not json', evidence, 'X'), null)
  assert.equal(lib.parseLightProfile(JSON.stringify({summary: 'Too short to be a profile.', tags: []}), evidence, 'X'), null)
  const invented = JSON.parse(GOOD); invented.summary += ' Founded in 1998 with 40 dentists on staff.'
  assert.equal(lib.parseLightProfile(JSON.stringify(invented), evidence, 'Clinique Laval'), null, 'figures not in the text are refused')
  const ungrounded = {summary: 'This enterprise delivers comprehensive blockchain infrastructure, quantum consulting, cryptocurrency custody, aerospace logistics, pharmaceutical manufacturing and maritime insurance worldwide for multinational corporations seeking transformation.', tags: []}
  assert.equal(lib.parseLightProfile(JSON.stringify(ungrounded), evidence, 'Clinique Laval'), null, 'text that drifts away from the evidence is refused')
  const seven = JSON.parse(GOOD); seven.tags = ['Teeth whitening', 'Dental implants', 'Orthodontics', 'Emergency dentistry', 'Family dental', 'Children', 'Adults']
  assert.ok(lib.parseLightProfile(JSON.stringify(seven), evidence, 'Clinique Laval').tags.length <= 5)
})

test('cost is bounded: a capped prompt and answer cost a fraction of a cent, and the limits are fixed', () => {
  const {LIGHT_PROFILE_LIMITS: L} = lib
  assert.equal(L.maxProfilesPerTrial, 25); assert.equal(L.maxOutputTokens, 160)
  const worst = lib.estimateLightProfileCost(700, L.maxOutputTokens)
  assert.ok(worst < 0.0003, `worst single profile ${worst}`)
  assert.ok(worst * L.maxProfilesPerTrial < 0.01, 'a whole trial costs under one cent')
  assert.ok(worst * L.dailyCeiling < 0.3, 'the daily ceiling bounds total spend')
})

// ------------------------------------------------------------------------------------------------------ the route
test('authentication boundary: a request without the signed trial cookie, from another origin, or with a bad body, spends nothing', async () => {
  reset(); state.noCookie = true
  assert.equal((await post({leadId: 'b1'})).status, 401)
  reset()
  assert.equal((await post({leadId: 'b1'}, {origin: 'https://evil.example'})).status, 403)
  assert.equal((await post({})).status, 400)
  assert.equal((await post({leadId: 'x'.repeat(200)})).status, 400)
  state.expired = true
  assert.equal((await post({leadId: 'b1'})).status, 410)
  assert.equal(ai.calls.length, 0)
})

test('forged or foreign business ids are refused before any model call or database claim', async () => {
  reset()
  for (const id of ['forged', '../b1', 'b2', "b1' or '1'='1"]) {
    const response = await post({leadId: id})
    assert.equal(response.status, 404, id)
  }
  assert.equal(ai.calls.length, 0); assert.equal(state.profileCalls.length, 0); assert.equal(state.profileAttempts, 0)
  // the request body cannot supply website text: only the stored trial is read
  const response = await post({leadId: 'b2', website_intelligence: FACTS, light_profile: {summary: 'x'}})
  assert.equal(response.status, 404)
})

test('insufficient evidence is skipped: no model call, no attempt used, nothing stored', async () => {
  reset([lead('thin', {title: 'Home', description: null, headings: []}), lead('none', null)])
  for (const id of ['thin', 'none']) {
    const response = await post({leadId: id})
    assert.equal(response.status, 422); assert.equal((await response.json()).code, 'insufficient')
  }
  assert.equal(ai.calls.length, 0); assert.equal(state.profileAttempts, 0); assert.equal(state.leads.some((l) => l.light_profile), false)
})

test('the feature is off unless it is switched on, and then nothing is spent', async () => {
  reset(); process.env.GUEST_PROFILES_ENABLED = 'false'
  try { assert.equal((await post({leadId: 'b1'})).status, 503) } finally { process.env.GUEST_PROFILES_ENABLED = 'true' }
  assert.equal(ai.calls.length, 0)
})

test('a successful profile is stored on that business, labelled with its model, and bounded in what is sent', async () => {
  reset()
  const response = await post({leadId: 'b1'})
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.cached, false); assert.ok(body.profile.summary.split(/\s+/).length >= 25 && body.profile.summary.split(/\s+/).length <= 40)
  assert.ok(body.profile.tags.length <= 5)
  assert.deepEqual(state.leads[0].light_profile, body.profile, 'persisted on the trial row')
  assert.equal(state.leads[0].profile_claim, undefined, 'no claim left behind')
  assert.equal(ai.calls.length, 1)
  const {params, options} = ai.calls[0]
  assert.equal(params.model, 'gpt-4o-mini'); assert.ok(params.max_tokens <= 160); assert.deepEqual(params.response_format, {type: 'json_object'})
  assert.equal(options.maxRetries, 0); assert.ok(options.timeout <= 15_000)
  const sent = params.messages.map((m) => m.content).join(' ')
  assert.doesNotMatch(sent, /info@clinique\.example|\+1 450/, 'contact details are never sent to the model')
})

test('caching: opening the same business again returns the saved profile and does not call the model', async () => {
  reset()
  await post({leadId: 'b1'})
  const second = await post({leadId: 'b1'})
  assert.equal(second.status, 200); assert.equal((await second.json()).cached, true)
  assert.equal(ai.calls.length, 1); assert.equal(state.profileAttempts, 1)
})

test('concurrency: two simultaneous opens of one business make exactly one model call', async () => {
  reset(); ai.delayMs = 40
  const [a, b] = await Promise.all([post({leadId: 'b1'}), post({leadId: 'b1'})])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  assert.equal(ai.calls.length, 1); assert.equal(state.profileAttempts, 1)
  const retry = await post({leadId: 'b1'})
  assert.equal((await retry.json()).cached, true, 'the loser gets the saved result on its next ask')
})

test('concurrency: more generations at once than the server allows are turned away without calling the model', async () => {
  reset(Array.from({length: 10}, (_, i) => lead(`c${i}`))); ai.delayMs = 60
  const responses = await Promise.all(Array.from({length: 10}, (_, i) => post({leadId: `c${i}`})))
  const statuses = responses.map((r) => r.status)
  assert.equal(statuses.filter((s) => s === 200).length, 6)
  assert.equal(statuses.filter((s) => s === 503).length, 4)
  assert.equal(ai.calls.length, 6)
})

test('limits: 25 profiles and 40 attempts per trial, and a shared daily ceiling, each refused before the model', async () => {
  reset(Array.from({length: 25}, (_, i) => ({...lead(`d${i}`), light_profile: {version: 1, summary: 's', tags: [], generated_at: new Date().toISOString(), model: 'm'}})))
  state.leads.push(lead('extra')) // a 26th business can never exist in a real trial; the cap still holds
  assert.equal((await post({leadId: 'extra'})).status, 429)
  reset(); state.profileAttempts = 40
  assert.equal((await (await post({leadId: 'b1'})).json()).code, 'limit')
  reset(); state.dailyUsed = 1000
  assert.equal((await (await post({leadId: 'b1'})).json()).code, 'budget')
  assert.equal(ai.calls.length, 0)
})

test('a model failure or an off-evidence answer stores nothing, releases the claim, counts the attempt, and can be retried', async () => {
  reset(); ai.fail = true
  assert.equal((await post({leadId: 'b1'})).status, 502)
  assert.equal(state.leads[0].light_profile, undefined); assert.equal(state.leads[0].profile_claim, undefined)
  ai.fail = false; ai.content = JSON.stringify({summary: 'Short and invented.', tags: ['Blockchain']})
  assert.equal((await post({leadId: 'b1'})).status, 502)
  assert.equal(state.profileAttempts, 2, 'failures use attempts, so retries cannot run up cost')
  ai.content = GOOD
  assert.equal((await post({leadId: 'b1'})).status, 200)
})

test('the claim bookkeeping (a private run id) is never sent to the browser', () => {
  assert.match(read('lib/guest/server.ts'), /profile_claim/)
  assert.match(read('lib/guest/server.ts'), /never sent to the browser/)
})

// ------------------------------------------------------------------------------------------------------ persistence after signup
test('signup keeps the profile with the business; a missing column never breaks signup or the website facts', async () => {
  reset([{...lead('b1'), light_profile: lib.parseLightProfile(GOOD, lib.profileEvidence(FACTS).text, 'Clinique Laval')}])
  state.user = {id: 'f418184a-7d53-49de-a560-24c571aabc28'}
  const request = () => claim(new Request('https://alpa.example/api/guest/claim', {method: 'POST', headers: {origin: 'https://alpa.example', 'Content-Type': 'application/json'}, body: JSON.stringify({leads: [{company_name: 'FORGED', light_profile: {summary: 'FORGED'}}]})}))
  assert.equal((await request()).status, 200)
  assert.match(state.claimed[0].light_profile.summary, /family dental clinic/)
  assert.ok(state.claimed[0].website_facts)
  assert.doesNotMatch(JSON.stringify(state.claimed), /FORGED/)
  assert.equal(state.claimed[0].commercial_profile, undefined, 'the paid Business Intelligence column is never written')

  state.lightProfileColumn = false; state.claimed = undefined
  assert.equal((await request()).status, 200)
  assert.equal(state.claimed[0].light_profile, undefined); assert.ok(state.claimed[0].website_facts, 'the facts survive a missing profile column')
})

test('a member sees the saved free-trial profile until paid Business Intelligence exists, which always wins', () => {
  const saved = lib.parseLightProfile(GOOD, lib.profileEvidence(FACTS).text, 'Clinique Laval')
  const base = {id: 'x', company_name: 'Clinique Laval', industry: 'Dentist', city: 'Laval', website: null, contact: {name: null, email: null, phone: null, website: 'https://clinique.example', source_url: null, email_source: null, email_confidence: null, is_generic_email: false}, intelligence: {state: 'not_started', label: 'Not started', reason: null, researched_at: null, card: null, profile: null}}
  const without = memberDossierModel({...base, lightProfile: saved})
  assert.match(without.what.ai.text, /family dental clinic/); assert.ok(without.what.ai.tags.includes('Dental implants')); assert.equal(without.what.aiNote, null)
  const paid = memberDossierModel({...base, lightProfile: saved, intelligence: {...base.intelligence, card: {summary: 'Paid research summary.'}, profile: {core_services: ['A'], target_customer: null}}})
  assert.equal(paid.what.ai.text, 'Paid research summary.')
  assert.equal(memberDossierModel({...base, lightProfile: null}).what.ai, null)
  assert.match(guestDossierModel({...lead('b1'), light_profile: saved}).what.ai.text, /family dental clinic/)
  assert.equal(guestDossierModel(lead('b1')).what.ai, null)
})

// ------------------------------------------------------------------------------------------------------ the screens
test('the interface: opens request a profile, the loading and failure lines are quiet, and Stage 3 says "Ready to explore"', () => {
  const workspace = read('components/guest/GuestWorkspace.tsx')
  assert.match(workspace, /profiles\.request\(lead\)/); assert.match(workspace, /profileState=\{profiles\.states/)
  const hook = read('components/guest/useLightProfiles.ts')
  assert.match(hook, /hasEnoughEvidence/); assert.match(hook, /inFlight/); assert.match(hook, /response\.status === 409/)
  const view = read('components/my-leads/DossierView.tsx')
  assert.match(view, /Writing a short summary…/); assert.match(view, /couldn't be written just now/); assert.match(view, /aria-live="polite"/)
  assert.doesNotMatch(view, /role="alert"/)
  const rail = read('components/scraper/EngineRail.tsx')
  assert.match(rail, /Ready to explore/); assert.match(rail, /Open a business for its profile/)
  assert.match(read('components/trial/TrialExperience.tsx'), /profilesOnDemand/)
  assert.doesNotMatch(read('components/scraper/DiscoverEngine.tsx'), /Ready to explore/, 'members keep their own wording')
})

test('paid Business Intelligence, the research queue and billing are untouched by this release', () => {
  const route = read('app/api/guest/profile/route.ts')
  assert.doesNotMatch(route, /commercial-intelligence|enrich|kickResearch|stripe|subscription|checkout/i)
  assert.doesNotMatch(read('lib/guest/light-profile.ts').replace(/^\s*\/\/.*$/gm, ''), /fetch\(|commercial-intelligence|safeFetch/)
})

test('Phase 7.1: with a free-trial profile the website information collapses; otherwise nothing changes', () => {
  const view = read('components/my-leads/DossierView.tsx')
  assert.match(view, /<details className="group/); assert.match(view, /View original website information/); assert.match(view, /Hide original website information/)
  assert.match(view, /collapseSite = Boolean\(ai\?\.collapseSite && site\)/)
  assert.doesNotMatch(view.slice(view.indexOf('<details')), /fetch\(|useState|onClick/, 'a native disclosure: no script, no requests')
  const guest = guestDossierModel({...lead('b1'), light_profile: lib.parseLightProfile(GOOD, lib.profileEvidence(FACTS).text, 'Clinique Laval')})
  assert.equal(guest.what.ai.collapseSite, true); assert.ok(guest.what.site, 'the website words are still in the model')
  assert.equal(guestDossierModel(lead('b1')).what.ai, null, 'no profile: the website information stays the visible description')
})
