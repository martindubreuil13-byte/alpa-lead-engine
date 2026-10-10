// A2.2a final verification: one real-shaped, offline run of the whole chain.
//
//   listing -> category -> website pages -> real extractor -> confidence -> inspection state
//     -> results payload -> JSON (the stream and browser storage) -> saved row -> what the customer reads
//
// The REAL discovery worker (runSharedProspectorDiscovery), extractor, classifier, inspection mapping,
// payload builders and display model run. Only the network edge is replaced: the search provider returns
// canned, invented listings and every website is a fixture (see tests/fixtures/a22a). A module loader
// swaps those three modules; nothing here opens a socket, calls an API or touches a database.

import assert from 'node:assert/strict'
import { register } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const SHIMS = pathToFileURL(path.join(ROOT, 'tests/fixtures/a22a/shims.mjs')).href

register(
  'data:text/javascript,' +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(ROOT)}
const SHIMMED = new Set(['@/lib/sources/serper', '@/lib/sources/google', '@/lib/scraper/email-enrichment'])
export async function resolve(specifier, context, next) {
  if (SHIMMED.has(specifier)) return { url: ${JSON.stringify(SHIMS)}, shortCircuit: true }
  if (specifier.startsWith('@/')) specifier = 'file://' + ROOT + '/' + specifier.slice(2)
  try {
    return await next(specifier, context)
  } catch (error) {
    if (error && error.code === 'ERR_MODULE_NOT_FOUND' && !/\\.\\w+$/.test(specifier)) return next(specifier + '.ts', context)
    throw error
  }
}
`),
  pathToFileURL(ROOT + '/')
)

const { runSharedProspectorDiscovery } = await import('../lib/scraper/run-scraper-shared.ts')
const { buildLeadInsertPayload, buildResultLead, toLeadRow } = await import('../lib/scraper/lead-payload.ts')
const { countUnreadableWebsites, describeContacts, describePossibleEmails, describeSettledNote, EMAIL_WORDING, summarizeContacts, toResultRow } =
  await import('../lib/scraper/results-summary.ts')
const { decodeRot13Email } = await import('../lib/scraper/email-intelligence.ts')

// ---- run the real worker ---------------------------------------------------------------------------

const logs = []
const progress = []
const discovery = await runSharedProspectorDiscovery(
  { query: 'consultant', defaultCity: 'Toronto', region: '', country: '', maxLeads: 10, mode: 'deep' },
  (message) => logs.push(message),
  (event) => progress.push(event)
)
const byName = (name) => discovery.finalEnrichedLeads.find((lead) => lead.company_name === name)

// what the stream and browser storage carry: the payload, serialized
const results = discovery.finalEnrichedLeads.map((lead, index) => JSON.parse(JSON.stringify(buildResultLead(lead, `lead-${index + 1}`))))
const row = (name) => toResultRow(results.find((lead) => lead.company_name === name))

test('the fixture world is what the test says it is (the encoded address really decodes)', () => {
  assert.equal(decodeRot13Email('vasb[at]abegutngrfgnssvat.pn'), 'info@northgatestaffing.ca')
  assert.equal(discovery.discoveredCount, 7)
  assert.equal(discovery.finalEnrichedLeads.length, 7, 'every business has a phone number, so none is filtered')
})

// ---- email -> confidence ---------------------------------------------------------------------------

test('ProViso case: the ROT13 address on the Contact page is found, with the confidence the rules give it', () => {
  const lead = byName('Northgate Staffing')
  assert.equal(lead.email, 'info@northgatestaffing.ca')
  assert.equal(lead.email_confidence, 'medium') // generic local part on the business's own domain
  assert.equal(lead.is_generic_email, true)
  assert.match(lead.email_source, /northgatestaffing\.ca\/contact-northgate/)
})

test('confidence is exactly what the classifier decided, per business', () => {
  assert.equal(byName('Harbourfront Partners').email_confidence, 'medium') // hello@ on its own domain
  assert.equal(byName('Rosedale Partners').email_confidence, 'high') // a personal address
  assert.equal(byName('Shoreline Consulting Group').email, 'info@bayviewmail.com')
  assert.equal(byName('Shoreline Consulting Group').email_confidence, 'low') // an unrelated domain
  for (const name of ['Lakeshore Advisory', 'Queen Street Strategy', 'Dufferin Advisors']) assert.equal(byName(name).email, null, name)
})

// ---- inspection state ------------------------------------------------------------------------------

test('each business carries the right inspection state, and it never changes a confidence', () => {
  assert.deepEqual(byName('Northgate Staffing').email_inspection, { state: 'checked', partial: false })
  assert.deepEqual(byName('Queen Street Strategy').email_inspection, { state: 'checked', partial: false })
  assert.deepEqual(byName('Harbourfront Partners').email_inspection, { state: 'checked', partial: true })
  assert.deepEqual(byName('Lakeshore Advisory').email_inspection, { state: 'unreadable', partial: false }) // robots.txt unknown: nothing read
  assert.deepEqual(byName('Shoreline Consulting Group').email_inspection, { state: 'checked', partial: false })
  assert.equal(byName('Dufferin Advisors').email_inspection ?? null, null, 'no website: there was nothing to inspect')
})

// ---- category ---------------------------------------------------------------------------------------

test('the category is the provider\'s own, and absent when the provider gave none', () => {
  assert.equal(byName('Northgate Staffing').industry, 'Staffing agency')
  assert.equal(byName('Lakeshore Advisory').industry, 'Consultant')
  assert.equal(byName('Harbourfront Partners').industry, 'Management consultant') // from types[0]
  assert.equal(byName('Shoreline Consulting Group').industry, 'Business consultant')
  assert.equal(byName('Queen Street Strategy').industry ?? null, null, 'never the search query ("consultant")')
})

// ---- the results payload (and its JSON round trip) -------------------------------------------------

test('the results payload carries real confidence, inspection and category through serialization', () => {
  const northgate = results.find((lead) => lead.company_name === 'Northgate Staffing')
  assert.equal(northgate.email, 'info@northgatestaffing.ca')
  assert.equal(northgate.email_confidence, 'medium')
  assert.deepEqual(northgate.email_inspection, { state: 'checked', partial: false })
  assert.equal(northgate.industry, 'Staffing agency')
  assert.equal(northgate.city, 'Toronto')
  // a business without an address carries no confidence at all
  assert.equal(results.find((lead) => lead.company_name === 'Queen Street Strategy').email_confidence, null)
})

// ---- what is saved ---------------------------------------------------------------------------------

test('the saved row keeps the category and confidence, and does not store the inspection', () => {
  const saved = (name) => toLeadRow(buildLeadInsertPayload(byName(name), 'user-1', () => '2026-10-10T00:00:00.000Z'))
  assert.equal(saved('Northgate Staffing').industry, 'Staffing agency')
  assert.equal(saved('Northgate Staffing').email, 'info@northgatestaffing.ca')
  assert.equal(saved('Northgate Staffing').email_confidence, 'medium')
  assert.equal(saved('Queen Street Strategy').industry, null)
  assert.equal(saved('Queen Street Strategy').email_confidence, 'low') // the long-standing default for a lead with no email
  for (const name of discovery.finalEnrichedLeads.map((lead) => lead.company_name)) {
    assert.ok(!('email_inspection' in saved(name)), `${name}: the inspection is not a database column`)
  }
})

// ---- what the customer reads -----------------------------------------------------------------------

test('Northgate (ProViso case) reads as a business with a real address and its category', () => {
  const northgate = row('Northgate Staffing')
  assert.equal(northgate.descriptor, 'Toronto · Staffing agency')
  assert.deepEqual([northgate.email.address, northgate.email.possible], ['info@northgatestaffing.ca', false])
  assert.equal(northgate.emailMissing, null)
  assert.equal(northgate.emailNote, null)
})

test('Lakeshore (Cirrus case) says the site could not be read, never that no email exists', () => {
  const lakeshore = row('Lakeshore Advisory')
  assert.equal(lakeshore.email, null)
  assert.equal(lakeshore.emailMissing, EMAIL_WORDING.unreadable)
  assert.doesNotMatch(lakeshore.emailMissing, /No email/)
})

test('each other state reads correctly', () => {
  assert.equal(row('Queen Street Strategy').emailMissing, EMAIL_WORDING.noneChecked)
  assert.equal(row('Queen Street Strategy').descriptor, 'Toronto')
  assert.equal(row('Dufferin Advisors').emailMissing, EMAIL_WORDING.noWebsite)

  const harbourfront = row('Harbourfront Partners')
  assert.equal(harbourfront.email.address, 'hello@harbourfrontpartners.com')
  assert.equal(harbourfront.emailNote, EMAIL_WORDING.partialNote) // an address and a partial warning together
  assert.equal(harbourfront.descriptor, 'Toronto · Management consultant')

  const shoreline = row('Shoreline Consulting Group')
  assert.equal(shoreline.email.possible, true)
  assert.equal(shoreline.emailNote, null)
})

test('the summary counts only confident addresses as emails, and reports unreadable sites', () => {
  const summary = summarizeContacts(results)
  assert.deepEqual(summary, { businesses: 7, websites: 6, emails: 3, possibleEmails: 1, phones: 7 })
  assert.deepEqual(describeContacts(summary), ['6 websites', '3 emails', '7 phone numbers'])
  assert.equal(describePossibleEmails(summary), '1 possible email not counted above (lower confidence)')
  assert.equal(countUnreadableWebsites(results), 1)
  assert.equal(
    describeSettledNote({ discovered: discovery.discoveredCount, added: results.length, duplicates: 0, invalid: 0, unreadable: countUnreadableWebsites(results) }),
    "1 website couldn't be read"
  )
})

// ---- the live stream is unchanged ------------------------------------------------------------------

test('the log lines and progress counters the live view depends on are unchanged', () => {
  assert.ok(logs.includes('⛔ no email: Lakeshore Advisory'))
  assert.ok(logs.includes('⛔ no email: Queen Street Strategy'))
  assert.ok(logs.includes('✨ Northgate Staffing'))
  // a business with no website is never queued for a website check (so it is not counted in the totals)
  assert.ok(!logs.some((line) => line.includes('Dufferin Advisors') && (line.startsWith('🔬') || line.startsWith('⛔ no email'))))
  const checks = progress.filter((event) => event.stage === 'checking').at(-1)
  // six websites were checked; four of them produced an address (including the one that is only possible)
  assert.deepEqual([checks.planned, checks.completed, checks.emailsFound], [6, 6, 4])
})
