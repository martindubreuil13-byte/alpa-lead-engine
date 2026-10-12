import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildExistingBusinessIndex,
  isKnownBusiness,
  knownBusinessKey,
  loadExistingBusinessIndex,
  normalizeCity,
  normalizeName,
  normalizePhoneDigits,
  normalizeSite,
} from '../lib/scraper/existing-business-index.ts'

const library = [
  { company_name: 'Acme  Dental', city: 'Toronto', phone: '+1 (416) 555-0100', website: 'https://www.acmedental.ca/' },
  { company_name: 'Maple Web Studio', city: '', phone: null, website: 'maplestudio.com' },
]
const index = buildExistingBusinessIndex(library)

test('normalisation mirrors the save function: case, spacing, phone digits, scheme, www and trailing slashes', () => {
  assert.equal(normalizeName('  Acme   DENTAL '), 'acme dental')
  assert.equal(normalizeCity(null), '')
  assert.equal(normalizeCity('  TORONTO '), 'toronto')
  assert.equal(normalizePhoneDigits('+1 (416) 555-0100'), '14165550100')
  assert.equal(normalizeSite('HTTPS://WWW.AcmeDental.ca///'), 'acmedental.ca')
  assert.equal(normalizeSite('http://acmedental.ca'), 'acmedental.ca')
})

test('a business is known only with the same name AND city AND the same phone or website', () => {
  assert.equal(isKnownBusiness(index, { company_name: 'acme dental', city: 'toronto', phone: '416-555-0100' }), false) // 14165550100 vs 4165550100
  assert.equal(isKnownBusiness(index, { company_name: 'Acme Dental', city: 'Toronto', phone: '1 416 555 0100' }), true)
  assert.equal(isKnownBusiness(index, { company_name: 'Acme Dental', city: 'Toronto', website: 'http://acmedental.ca' }), true)
  assert.equal(isKnownBusiness(index, { company_name: 'Maple Web Studio', city: null, website: 'https://www.maplestudio.com/' }), true) // unknown city equals unknown city, as in the save
})

test('never on a name alone: branches and look-alikes are not skipped', () => {
  assert.equal(isKnownBusiness(index, { company_name: 'Acme Dental', city: 'Toronto' }), false) // no evidence
  assert.equal(isKnownBusiness(index, { company_name: 'Acme Dental', city: 'Toronto', phone: '905 555 0199', website: 'acmedental-north.ca' }), false) // another branch
  assert.equal(isKnownBusiness(index, { company_name: 'Acme Dental', city: 'Mississauga', phone: '1 416 555 0100' }), false) // other city
  assert.equal(isKnownBusiness(index, { company_name: 'Acme Dental Group', city: 'Toronto', phone: '1 416 555 0100' }), false) // other name
  assert.equal(isKnownBusiness(index, { company_name: 'Acme Dental', city: 'Toronto', phone: '', website: '' }), false) // empty evidence matches nothing
  assert.equal(isKnownBusiness(index, { company_name: 'Maple Web Studio', city: 'Toronto', website: 'maplestudio.com' }), false) // known city differs
  assert.equal(isKnownBusiness(null, { company_name: 'Acme Dental', city: 'Toronto', phone: '1 416 555 0100' }), false) // no index: skip nothing
})

test('each skipped business is counted once however many providers returned it', () => {
  const a = knownBusinessKey({ company_name: 'Acme  Dental', city: 'TORONTO', phone: '+1 416 555 0100' })
  const b = knownBusinessKey({ company_name: 'acme dental', city: 'toronto', phone: '1 (416) 555-0100' })
  assert.equal(a, b)
  assert.equal(new Set([a, b]).size, 1)
})

// A stand-in for the customer's session client that records every request.
function fakeClient(total, { failAtRange = null, countError = false } = {}) {
  const calls = []
  const rows = Array.from({ length: total }, (_, i) => ({ company_name: `Business ${i}`, city: 'Toronto', phone: `416555${String(i).padStart(4, '0')}`, website: null }))
  return {
    calls,
    from(table) {
      assert.equal(table, 'leads')
      const query = { filters: {}, range: null, head: false }
      const builder = {
        select(columns, options) { query.head = Boolean(options?.head); query.columns = columns; return builder },
        eq(column, value) { query.filters[column] = value; return builder },
        order(column) { query.order = column; return builder },
        range(from, to) { query.range = [from, to]; return builder },
        then(resolve) {
          calls.push({ ...query })
          if (query.head) return resolve(countError ? { error: { message: 'x' }, count: null } : { count: total, error: null })
          if (failAtRange !== null && query.range[0] === failAtRange) return resolve({ error: { message: 'boom' }, data: null })
          return resolve({ data: rows.slice(query.range[0], query.range[1] + 1), error: null })
        },
      }
      return builder
    },
  }
}

test('a large library is read completely in bounded 1,000-row ranges, never one unbounded query', async () => {
  const client = fakeClient(10_250)
  const loaded = await loadExistingBusinessIndex(client, 'user-1')
  assert.equal(loaded.size, 10_250)
  assert.equal(loaded.complete, true)
  assert.equal(isKnownBusiness(loaded, { company_name: 'Business 9999', city: 'Toronto', phone: '4165559999' }), true)
  const pages = client.calls.filter((call) => !call.head)
  assert.equal(pages.length, 11)
  for (const page of pages) {
    assert.ok(page.range[1] - page.range[0] + 1 <= 1000, 'every read is a bounded range')
    assert.equal(page.filters.user_id, 'user-1')
    assert.equal(page.order, 'id') // a stable order, so ranges neither overlap nor skip
  }
  assert.equal(client.calls.filter((call) => call.head).length, 1) // counted once first
})

test('past the safety ceiling the index says it is incomplete instead of silently truncating', async () => {
  const loaded = await loadExistingBusinessIndex(fakeClient(5_000), 'user-1', { maxRows: 2_000 })
  assert.equal(loaded.size, 2_000)
  assert.equal(loaded.complete, false)
})

test('an empty library, or any read failure, skips nothing and never throws', async () => {
  assert.equal((await loadExistingBusinessIndex(fakeClient(0), 'u')).size, 0)
  assert.equal(await loadExistingBusinessIndex(fakeClient(3_000, { failAtRange: 1000 }), 'u'), null)
  assert.equal(await loadExistingBusinessIndex(fakeClient(10, { countError: true }), 'u'), null)
  assert.equal(await loadExistingBusinessIndex({ from() { throw new Error('down') } }, 'u'), null)
})

const shared = readFileSync('lib/scraper/run-scraper-shared.ts', 'utf8')
const route = readFileSync('app/api/scrape/route.ts', 'utf8')

test('known businesses are skipped before enrichment on every ingestion path, and never enter the discovered totals', () => {
  assert.equal((shared.match(/if \(skipsKnownBusiness\(lead\)\) continue/g) ?? []).length, 3) // Serper pass, Google (after Details), Serper refill
  const skipIndex = shared.indexOf('const skipsKnownBusiness')
  assert.ok(skipIndex > 0)
  assert.match(shared, /const key = knownBusinessKey\(identity\)[\s\S]*knownSkipped\.add\(key\)/) // counted once, by identity
  assert.match(shared, /company_name: cleanBusinessName\(lead\.company_name\)/) // compared as it will be saved
  assert.match(shared, /city: lead\.city \|\| null/) // the provider's city, never the searched one
  assert.match(shared, /alreadySavedSkippedCount: knownSkipped\.size/)
})

test('provider-call decisions count a skipped business as before: no new Serper or Google calls, same cost ceiling', () => {
  assert.match(shared, /const MAX_SERPER_QUERIES = 2/)
  assert.match(shared, /const MAX_GOOGLE_CALLS = 1/)
  assert.match(shared, /if \(seenTotal\(\) >= serperLeadTarget\)/)
  assert.match(shared, /maxResults: Math\.max\(1, serperLeadTarget - seenTotal\(\)\)/)
  assert.match(shared, /usableLeads\(validDiscoveredLeads\)\.length \+ knownSkipped\.size >= maxLeads/)
  assert.equal((shared.match(/maxLeads - usableLeads\(validDiscoveredLeads\)\.length - knownSkipped\.size/g) ?? []).length, 2) // Google sizing and refill
})

test('the final database check stays authoritative, and skipped businesses are reported with the save\'s own duplicates', () => {
  assert.match(route, /const alreadySavedBeforeSave = discovery\.alreadySavedSkippedCount/)
  assert.match(route, /duplicates: \$\{duplicateCount \+ alreadySavedBeforeSave\}/)
  assert.match(route, /duplicates: duplicateCount \+ alreadySavedBeforeSave,/)
  assert.match(route, /saveDiscoverResults\(createAdminClient\(\)/) // the atomic save is unchanged
  assert.match(route, /userId && !options\?\.guestMode \? loadExistingBusinessIndex\(supabase, userId\) : null/) // signed-in customers only, own session
})

test('credits, research authorization, the profile cap and the schema are untouched', () => {
  for (const file of ['lib/commercial-intelligence/run-authorization.ts', 'lib/commercial-intelligence/queue-manager.ts', 'lib/scraper/save-discover-results.ts']) {
    assert.ok(!/existing-business-index|knownSkipped|alreadySavedSkipped/.test(readFileSync(file, 'utf8')), file)
  }
})

// ---- customer-facing counts: previously saved businesses stay in "found" -------------------------------------------------
import { applyDiscoveryLog, confirmDiscoveryResult, getDiscoveredCount, INITIAL_DISCOVERY_PROGRESS } from '../lib/scraper/discover-progress.ts'
import { describeOutcomeLines, describeSearchOutcome } from '../lib/scraper/results-summary.ts'

function replay(lines, resultDiscoveredCount) {
  let progress = INITIAL_DISCOVERY_PROGRESS
  for (const line of lines) progress = applyDiscoveryLog(progress, line)
  const live = getDiscoveredCount(progress, 25)
  progress = confirmDiscoveryResult(progress, resultDiscoveredCount)
  return { live, final: getDiscoveredCount(progress, 25), progress }
}
const found = (n, prefix) => Array.from({ length: n }, (_, i) => `📥 ${prefix} ${i}`)

test('repeat search, some already saved: found = new + previously saved, from the first live line to the final result', () => {
  // 24 found by the providers: 22 recognised as already saved (announced once each, then skipped) and 2 new.
  const lines = [...found(22, 'Known'), ...found(2, 'New'), '📦 discovered: 24', '💾 saved: 2, duplicates: 22, invalid: 0, db errors: 0']
  const { live, final } = replay(lines, 24)
  assert.equal(live, 24)
  assert.equal(final, 24)
  const outcome = describeSearchOutcome({ saved: 2, alreadySaved: 22 })
  assert.deepEqual([outcome.kind, outcome.found, outcome.saved, outcome.alreadySaved], ['mixed', 24, 2, 22])
  assert.deepEqual(describeOutcomeLines(outcome), ['24 found · 22 already in My Leads'])
})

test('repeat search, everything already saved: the count stays 24, it is not a failed search, and nothing is saved or charged', () => {
  const lines = [...found(24, 'Known'), '📦 discovered: 24', '💾 saved: 0, duplicates: 24, invalid: 0, db errors: 0']
  const { live, final } = replay(lines, 24)
  assert.equal(live, 24)
  assert.equal(final, 24)
  assert.ok(!lines.includes('⚠️ no leads found'))
  const outcome = describeSearchOutcome({ saved: 0, alreadySaved: 24 })
  assert.deepEqual(describeOutcomeLines(outcome), ['All 24 are already in My Leads', 'No new businesses added'])
})

test('without the corrections the count would have dropped to the new businesses only (what this guards against)', () => {
  const dropped = replay([...found(2, 'New'), '📦 discovered: 2'], 2)
  assert.equal(dropped.final, 2) // 24 found, but only the 2 new would have been counted
})

test('the server reports found, previously saved and new consistently, and "no leads found" only when nothing was found at all', () => {
  assert.equal((shared.match(/send\(`📦 discovered: \$\{validDiscoveredLeads\.length \+ knownSkipped\.size\}`\)/g) ?? []).length, 3)
  assert.match(shared, /if \(!knownSkipped\.has\(key\)\) send\(`📥 \$\{identity\.company_name\}`\)/)
  assert.equal((shared.match(/validDiscoveredLeads\.length === 0 && knownSkipped\.size === 0/g) ?? []).length, 2)
  assert.match(route, /discoveredCount: validDiscoveredLeads\.length \+ alreadySavedBeforeSave,/)
  assert.match(route, /validDiscoveredLeads\.length === 0 && alreadySavedBeforeSave === 0/)
})

test('an incomplete or unavailable index is visible in the server log and can only mean fewer skips', () => {
  assert.match(shared, /index unavailable; no business is skipped before the save/)
  assert.match(shared, /library larger than the index ceiling; only part is indexed/)
  assert.match(readFileSync('lib/scraper/existing-business-index.ts', 'utf8'), /could not read the library/)
})
