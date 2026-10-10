// Discover V3 / A2.2a — email quality and honest results.
//
// Regression tests for the two real misses found in a live search (Cirrus Consulting Group and ProViso
// Consulting), plus the honesty and category changes made alongside them. Fully offline: no network, no
// Supabase, and robots.txt timing is driven by fake timers, so a 5-second response takes no real time.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { mock } from 'node:test'

import {
  createEmailTransport,
  createRobotsFetcher,
  enrichEmail,
  enrichEmailV2,
  enrichEmailWithInspection,
  ROBOTS_TIMEOUT_MS,
} from '../lib/scraper/email-enrichment.ts'
import {
  decodeRot13Email,
  extractEmailCandidatesV2,
  pickBestEmailCandidateV2,
} from '../lib/scraper/email-intelligence.ts'
import { inspectionFromOutcome, isEmailInspection, mergeInspection } from '../lib/scraper/email-inspection.ts'
import { buildLeadInsertPayload, cleanCategory, toLeadRow } from '../lib/scraper/lead-payload.ts'
import {
  countUnreadableWebsites,
  describeEmailStatus,
  describeLead,
  describeSettledNote,
  EMAIL_WORDING,
  toResultRow,
} from '../lib/scraper/results-summary.ts'
import { firstProviderCategory, providerCategory, serperPlaceCategory } from '../lib/sources/category.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const rot13 = (text) => text.replace(/[a-z]/gi, (letter) => String.fromCharCode(((letter.charCodeAt(0) - (letter <= 'Z' ? 65 : 97) + 13) % 26) + (letter <= 'Z' ? 65 : 97)))
const encode = (address) => rot13(address.split('@')[0]) + '[at]' + rot13(address.split('@')[1])

// ProViso's Contact page, as found in the investigation: no mailto, no literal address, just this attribute.
const PROVISO_MARKUP =
  '<h4 class="ui-e-title"><a href="javascript:;" data-enc-email="vasb[at]cebivfb.pn" class="mail-link" data-wpel-link="ignore">Email Us</a></h4>'

const extract = (html, host = 'proviso.ca', url = 'https://proviso.ca/contact-proviso') =>
  extractEmailCandidatesV2({ html, pageUrl: url, websiteHost: host })

// ---------------------------------------------------------------------------------------------
// 1. ROT13 data-enc-email (ProViso)
// ---------------------------------------------------------------------------------------------

test('the exact ProViso markup now yields info@proviso.ca', () => {
  assert.equal(decodeRot13Email('vasb[at]cebivfb.pn'), 'info@proviso.ca')
  const candidates = extract(PROVISO_MARKUP)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].value, 'info@proviso.ca')
  assert.equal(candidates[0].evidence, 'obfuscated')
  assert.equal(candidates[0].domainMatch, true)
  assert.equal(candidates[0].relevance, 'business-domain')
  assert.equal(pickBestEmailCandidateV2(candidates).value, 'info@proviso.ca')
})

test('the decoded address is classified by the existing rules, not given a confidence of its own', () => {
  // Generic local part on the business's own domain: medium, exactly as the same address in a mailto link.
  const encoded = extract(PROVISO_MARKUP)[0]
  const viaMailto = extract('<a href="mailto:info@proviso.ca">Email Us</a>')[0]
  assert.equal(encoded.emailConfidence, 'medium')
  assert.equal(encoded.emailConfidence, viaMailto.emailConfidence)
  assert.equal(encoded.isGenericEmail, viaMailto.isGenericEmail)

  // A personal address on the same domain is high: proof the value is not forced to medium.
  const personal = extract(`<a href="javascript:;" data-enc-email="${encode('john@proviso.ca')}">Email John</a>`)[0]
  assert.equal(personal.value, 'john@proviso.ca')
  assert.equal(personal.emailConfidence, 'high')
  assert.equal(personal.emailConfidence, extract('<a href="mailto:john@proviso.ca">x</a>')[0].emailConfidence)
})

test('an encoded address on an unrelated domain is only low confidence and never beats the business domain', () => {
  const unrelated = extract(`<a data-enc-email="${encode('info@acme-staffing.com')}">Email</a>`)[0]
  assert.equal(unrelated.relevance, 'unrelated')
  assert.equal(unrelated.emailConfidence, 'low')
  assert.equal(unrelated.domainMatch, false)

  const both = extract(`<a data-enc-email="${encode('info@acme-staffing.com')}">a</a>${PROVISO_MARKUP}`)
  assert.equal(both.length, 2)
  assert.equal(pickBestEmailCandidateV2(both).value, 'info@proviso.ca')
  // the same two addresses as mailto links are ranked identically
  const viaMailto = extract('<a href="mailto:info@acme-staffing.com">a</a><a href="mailto:info@proviso.ca">b</a>')
  assert.equal(pickBestEmailCandidateV2(viaMailto).value, pickBestEmailCandidateV2(both).value)
})

test('placeholder, technical and no-reply addresses are still rejected when encoded', () => {
  for (const address of ['info@example.com', 'noreply@proviso.ca', 'someone@sentry.io', 'you@yourdomain.com']) {
    assert.equal(extract(`<a data-enc-email="${encode(address)}">x</a>`).length, 0, address)
  }
})

test('malformed or ambiguous encoded values produce no address', () => {
  const bad = [
    '', ' ', 'vasb[at]', '[at]cebivfb.pn', 'vasb[at]cebivfb', 'vasb[at]cebivfb.pn extra words', 'a[at]b[at]cebivfb.pn',
    'vasb (at) cebivfb.pn', // not the bracketed form this plugin writes
    'info@proviso.ca', // already contains "@": not an encoded value, not guessed at
    `${'a'.repeat(300)}[at]cebivfb.pn`,
    'vasb[at]cebivfb.p', // top-level domain too short
    '<script>[at]x.pn', 'vasb[at]ceb ivfb.pn',
  ]
  for (const value of bad) {
    assert.equal(decodeRot13Email(value), null, JSON.stringify(value))
    assert.equal(extract(`<a data-enc-email="${value.replace(/"/g, '')}">x</a>`).length, 0, JSON.stringify(value))
  }
})

test('an encoded address inside a "site by" credit is treated like a credited mailto: not the business\'s', () => {
  const credit = (anchor) => `<footer><p>Website by Acme Web ${anchor}</p></footer>`
  const encoded = extract(credit(`<a data-enc-email="${encode('hello@acmeweb.com')}">hello</a>`))
  const mailto = extract(credit('<a href="mailto:hello@acmeweb.com">hello</a>'))
  assert.equal(encoded[0].emailConfidence, 'low')
  assert.equal(encoded[0].emailConfidence, mailto[0].emailConfidence)
})

test('existing formats are unaffected', () => {
  assert.equal(extract('<a href="mailto:info@proviso.ca">x</a>')[0].evidence, 'mailto')
  assert.equal(extract('<p>Email: info[at]proviso.ca</p>')[0].evidence, 'obfuscated')
  assert.equal(extract('<p>Email: info@proviso.ca</p>')[0].evidence, 'text')
  assert.equal(extract('<p>No address here</p>').length, 0)
})

// ---------------------------------------------------------------------------------------------
// 2. Robots.txt timeout (Cirrus)
// ---------------------------------------------------------------------------------------------

const PUBLIC = async () => ['93.184.216.34']
const flush = async () => {
  for (let index = 0; index < 25; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

/** Runs `body` with a fake clock. `advance(ms)` moves it forward and lets the pending work run. */
async function withClock(body) {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    return await body(async (ms) => {
      await flush()
      mock.timers.tick(ms)
      await flush()
    })
  } finally {
    mock.timers.reset()
  }
}

/** A site whose robots.txt takes `robotsDelayMs`; pages answer at once. Records every path requested. */
function slowSite({ robotsDelayMs, robotsBody = 'User-agent: *\nDisallow:\n', pages = {} }) {
  const requested = []
  const fetchImpl = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input))
    requested.push(url.pathname)
    if (url.pathname === '/robots.txt') {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(robotsBody, { status: 200, headers: { 'content-type': 'text/plain' } })), robotsDelayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    }
    const html = pages[url.pathname]
    return Promise.resolve(
      html === undefined
        ? new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
        : new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    )
  }
  return { fetchImpl, requested }
}

test('the robots.txt limit is six seconds', () => {
  assert.equal(ROBOTS_TIMEOUT_MS, 6_000)
  assert.match(read('lib/scraper/email-enrichment.ts'), /export const ROBOTS_TIMEOUT_MS = 6_000/)
})

test('Cirrus: a robots.txt that answers in 3.02 s (just over the old limit) is now read', async () => {
  const site = slowSite({ robotsDelayMs: 3_020 })
  await withClock(async (advance) => {
    // The previous limit reproduces the original failure...
    const before = createRobotsFetcher('cirrusconsultinggroup.com', { fetchImpl: site.fetchImpl, resolveHostname: PUBLIC, cache: null, timeoutMs: 3_000 })
    const old = before('https://www.cirrusconsultinggroup.com/')
    await advance(3_001)
    assert.deepEqual([(await old).kind, (await old).reason], ['unknown', 'timeout'])

    // ...and the default does not.
    const now = createRobotsFetcher('cirrusconsultinggroup.com', { fetchImpl: site.fetchImpl, resolveHostname: PUBLIC, cache: null })
    const current = now('https://www.cirrusconsultinggroup.com/')
    await advance(3_020)
    assert.equal((await current).kind, 'rules')
  })
})

test('a robots.txt that takes 4 to 5.9 seconds is read; one that takes longer than 6 seconds is unknown', async () => {
  for (const [delay, expected] of [[4_000, 'rules'], [4_500, 'rules'], [5_900, 'rules'], [6_100, 'unknown'], [9_000, 'unknown']]) {
    const site = slowSite({ robotsDelayMs: delay })
    await withClock(async (advance) => {
      // the default transport, exactly as production builds it: no timeout passed in
      const transport = createEmailTransport('example-consulting.com', { fetchImpl: site.fetchImpl, resolveHostname: PUBLIC, robotsCache: null })
      const pending = transport.fetchRobots('https://example-consulting.com/')
      await advance(delay >= 6_000 ? 6_001 : delay)
      const policy = await pending
      assert.equal(policy.kind, expected, `${delay} ms`)
      if (expected === 'unknown') assert.equal(policy.reason, 'timeout')
    })
  }
})

test('Cirrus end to end: with a 3.02 s robots.txt the site is read and its mailto address is found', async () => {
  const site = slowSite({
    robotsDelayMs: 3_020,
    pages: {
      '/': '<html><body><a href="mailto:info@cirrusconsultinggroup.com">Contact us</a></body></html>',
      '/contact': '<html><body><a href="mailto:info@cirrusconsultinggroup.com">Email</a></body></html>',
    },
  })
  await withClock(async (advance) => {
    const pending = enrichEmailWithInspection('https://www.cirrusconsultinggroup.com/', {
      v1: async () => ({ record: null, inspection: null }),
      v2: async (website) => {
        const outcome = await enrichEmailV2(website, { transportOptions: { fetchImpl: site.fetchImpl, resolveHostname: PUBLIC, robotsCache: null } })
        return { record: outcome.best, inspection: inspectionFromOutcome(outcome) }
      },
    })
    await advance(3_020)
    await flush()
    const { record, inspection } = await pending
    assert.equal(record.value, 'info@cirrusconsultinggroup.com')
    assert.equal(record.emailConfidence, 'medium') // generic address on the business's domain: the existing rule
    assert.deepEqual(inspection, { state: 'checked', partial: false })
  })
})

test('a robots.txt that never answers in time fails closed: no page of the site is requested', async () => {
  const site = slowSite({ robotsDelayMs: 30_000, pages: { '/': '<a href="mailto:info@slow-site.com">x</a>' } })
  await withClock(async (advance) => {
    const pending = enrichEmailV2('https://slow-site.com/', { transportOptions: { fetchImpl: site.fetchImpl, resolveHostname: PUBLIC, robotsCache: null } })
    await advance(6_001)
    await flush()
    const outcome = await pending
    assert.equal(outcome.robots, 'unknown')
    assert.equal(outcome.robotsReason, 'timeout')
    assert.equal(outcome.pagesRequested, 0)
    assert.equal(outcome.best, null)
    assert.equal(outcome.accessFailure, 'timeout')
    assert.deepEqual(site.requested, ['/robots.txt'], 'only robots.txt was requested')
    assert.deepEqual(inspectionFromOutcome(outcome), { state: 'unreadable', partial: false })
  })
})

test('there is still no retry: a timed-out robots.txt is requested exactly once', async () => {
  const site = slowSite({ robotsDelayMs: 30_000 })
  await withClock(async (advance) => {
    const transport = createEmailTransport('slow-site.com', { fetchImpl: site.fetchImpl, resolveHostname: PUBLIC, robotsCache: null })
    const pending = transport.fetchRobots('https://slow-site.com/')
    await advance(6_001)
    await pending
    await advance(5_000)
    assert.equal(site.requested.filter((path) => path === '/robots.txt').length, 1)
  })
})

test('the transport protections are untouched', () => {
  const source = read('lib/scraper/email-enrichment.ts')
  for (const kept of ['MAX_PAGE_BYTES = 1_500_000', 'FETCH_TIMEOUT_MS = 6_000', 'isRedirectAllowed', 'hostsClearlyRelated', 'createPinnedFetch', "RETRYABLE: ReadonlyArray<string> = ['network', 'server_error']"]) {
    assert.ok(source.includes(kept), kept)
  }
  assert.ok(!/ROBOTS_RETRY|robotsRetries|retryTimeout/i.test(source.replace(/ROBOTS_RETRY_DELAY_MS/g, '')), 'no new retry logic')
})

// ---------------------------------------------------------------------------------------------
// 3. Honest inspection states
// ---------------------------------------------------------------------------------------------

const BASE = 'https://acme-consulting.com/'
const okPage = (html) => ({ ok: true, page: { html, resolvedUrl: BASE } })
const allowAll = async () => []

async function inspectSite(pages, options = {}) {
  const outcome = await enrichEmailV2(options.website === undefined ? BASE : options.website, {
    fetchRobots: options.fetchRobots ?? allowAll,
    fetchPage: async (url) => {
      const path = new URL(url).pathname
      const handler = pages[path] ?? pages['*']
      return typeof handler === 'function' ? handler(url) : handler ?? { ok: false, failure: 'not_found' }
    },
  })
  return { outcome, inspection: inspectionFromOutcome(outcome) }
}

test('a site that was read and has no email is "checked", not partial and not unreadable', async () => {
  const { outcome, inspection } = await inspectSite({ '/': okPage('<html><body>Hello</body></html>'), '*': { ok: false, failure: 'not_found' } })
  assert.equal(outcome.best, null)
  assert.deepEqual(inspection, { state: 'checked', partial: false }) // missing guessed pages are routine, not a limit
})

test('partial inspection: some pages could not be read and nothing was found on the others', async () => {
  const { outcome, inspection } = await inspectSite({ '/': okPage('<html><body>Hello</body></html>'), '*': { ok: false, failure: 'timeout' } })
  assert.equal(outcome.best, null)
  assert.deepEqual(inspection, { state: 'checked', partial: true })
})

test('email found during a partial inspection: the address and the partial flag coexist', async () => {
  const { outcome, inspection } = await inspectSite({
    '/': okPage('<html><body><a href="mailto:info@acme-consulting.com">Email</a></body></html>'),
    '*': { ok: false, failure: 'timeout' },
  })
  assert.equal(outcome.best.value, 'info@acme-consulting.com')
  assert.deepEqual(inspection, { state: 'checked', partial: true })
  // and the confidence is exactly what the extractor decided, unaffected by the partial inspection
  const clean = await inspectSite({ '/': okPage('<html><body><a href="mailto:info@acme-consulting.com">Email</a></body></html>') })
  assert.equal(outcome.best.emailConfidence, clean.outcome.best.emailConfidence)
  assert.deepEqual(clean.inspection, { state: 'checked', partial: false })
})

test('a page refused by robots.txt makes the inspection partial, never complete', async () => {
  const { inspection } = await inspectSite(
    { '/': okPage('<html><body>Hello</body></html>'), '*': { ok: false, failure: 'not_found' } },
    { fetchRobots: async () => [{ allow: false, pattern: '/contact' }] }
  )
  assert.deepEqual(inspection, { state: 'checked', partial: true })
})

test('an oversized page that had to be cut short is a partial inspection', async () => {
  const { inspection } = await inspectSite({ '/': { ok: true, page: { html: '<html><body>Hello</body></html>', resolvedUrl: BASE, truncated: true } }, '*': { ok: false, failure: 'not_found' } })
  assert.deepEqual(inspection, { state: 'checked', partial: true })
})

test('a completely unreadable website is "unreadable", never "checked"', async () => {
  for (const failure of ['timeout', 'blocked', 'unavailable', 'unsupported', 'too_large']) {
    const { outcome, inspection } = await inspectSite({ '*': { ok: false, failure } })
    assert.equal(outcome.best, null, failure)
    assert.equal(outcome.pagesLoaded, 0, failure)
    assert.deepEqual(inspection, { state: 'unreadable', partial: false }, failure)
  }
})

test('no website supplied, or only a social or directory page, is "no website"', async () => {
  for (const website of [null, '', '   ', 'https://www.facebook.com/acmeconsulting']) {
    const { inspection } = await inspectSite({ '*': okPage('<html></html>') }, { website })
    assert.deepEqual(inspection, { state: 'no_website', partial: false }, JSON.stringify(website))
  }
})

test('the better inspection wins when a business is inspected twice', () => {
  const clean = { state: 'checked', partial: false }
  const partial = { state: 'checked', partial: true }
  const unreadable = { state: 'unreadable', partial: false }
  assert.deepEqual(mergeInspection(null, partial), partial)
  assert.deepEqual(mergeInspection(clean, unreadable), clean, 'a later failure never hides an earlier read')
  assert.deepEqual(mergeInspection(unreadable, partial), partial)
  assert.deepEqual(mergeInspection(partial, clean), clean)
  assert.equal(mergeInspection(undefined, null), null)
})

test('stored or untrusted values are validated before the interface trusts them', () => {
  assert.equal(isEmailInspection({ state: 'checked', partial: false }), true)
  for (const bad of [null, undefined, 'checked', {}, { state: 'checked' }, { state: 'bogus', partial: false }, { state: 'checked', partial: 'yes' }]) {
    assert.equal(isEmailInspection(bad), false, JSON.stringify(bad))
  }
})

test('the single-switch entry point still returns the record, and V1 reports no inspection', async () => {
  const record = { value: 'a@b.example', emailSource: 'https://b.example', emailConfidence: 'high', isGenericEmail: false }
  assert.equal(await enrichEmail('https://b.example', { v1: async () => record, v2: async () => record }), record)
  const detailed = await enrichEmailWithInspection('https://b.example', {
    v1: async () => ({ record, inspection: null }),
    v2: async () => ({ record, inspection: { state: 'checked', partial: false } }),
  })
  assert.equal(detailed.record, record)
})

// ---- what the customer sees -------------------------------------------------------------------

const lead = (overrides = {}) => ({
  id: 'l1', company_name: 'Acme', city: 'Toronto', industry: null, email: null, email_source: null, email_confidence: null,
  is_generic_email: false, phone: null, website: 'https://acme.example', status: 'new', pipeline_stage: null, close_reason: null,
  source: null, cost_estimate: null, created_at: '', ...overrides,
})

test('each inspection state has its own plain wording; an unreadable site is never described as inspected', () => {
  const checked = describeEmailStatus(lead({ email_inspection: { state: 'checked', partial: false } }))
  const partial = describeEmailStatus(lead({ email_inspection: { state: 'checked', partial: true } }))
  const unreadable = describeEmailStatus(lead({ email_inspection: { state: 'unreadable', partial: false } }))
  const none = describeEmailStatus(lead({ website: null }))
  const unknown = describeEmailStatus(lead())

  assert.equal(checked.missing, EMAIL_WORDING.noneChecked)
  assert.equal(partial.missing, EMAIL_WORDING.nonePartial)
  assert.equal(unreadable.missing, EMAIL_WORDING.unreadable)
  assert.equal(none.missing, EMAIL_WORDING.noWebsite)
  assert.equal(unknown.missing, EMAIL_WORDING.unknown, 'nothing is claimed when nothing is known')
  assert.equal(new Set([checked.missing, partial.missing, unreadable.missing, none.missing, unknown.missing]).size, 5)
  // only the "checked" sentences say the pages were read
  assert.match(EMAIL_WORDING.noneChecked, /pages we checked/)
  assert.doesNotMatch(EMAIL_WORDING.unreadable, /checked|no email/i)
})

test('an address and a partial-inspection note can be shown together; a complete inspection adds no note', () => {
  const row = toResultRow(lead({ email: 'info@acme.example', email_confidence: 'medium', email_inspection: { state: 'checked', partial: true } }))
  assert.equal(row.email.address, 'info@acme.example')
  assert.equal(row.email.possible, false)
  assert.equal(row.emailNote, EMAIL_WORDING.partialNote)
  assert.equal(row.emailMissing, null)
  assert.equal(toResultRow(lead({ email: 'info@acme.example', email_confidence: 'medium', email_inspection: { state: 'checked', partial: false } })).emailNote, null)
  assert.equal(toResultRow(lead({ email: 'info@acme.example', email_confidence: 'medium' })).emailNote, null)
  // a possible (low confidence) address keeps its marker and may carry the note too
  const possible = toResultRow(lead({ email: 'x@other.example', email_confidence: 'low', email_inspection: { state: 'checked', partial: true } }))
  assert.equal(possible.email.possible, true)
  assert.equal(possible.emailNote, EMAIL_WORDING.partialNote)
})

test('customer wording contains no technical codes or jargon', () => {
  for (const text of Object.values(EMAIL_WORDING)) {
    assert.doesNotMatch(text, /timeout|timed out|robots|http|error|failure|code|unsafe|too_large|blocked|unavailable|\d{3}/i, text)
  }
})

test('the results show how many websites could not be read, only when there are some', () => {
  const leads = [
    lead({ email_inspection: { state: 'unreadable', partial: false } }),
    lead({ email_inspection: { state: 'checked', partial: true } }),
    lead({ website: null, email_inspection: { state: 'unreadable', partial: false } }), // no website: not counted
    lead(),
  ]
  assert.equal(countUnreadableWebsites(leads), 1)
  assert.equal(describeSettledNote({ discovered: 10, added: 10, duplicates: 0, invalid: 0, unreadable: 2 }), "2 websites couldn't be read")
  assert.equal(describeSettledNote({ discovered: 10, added: 10, duplicates: 0, invalid: 0, unreadable: 1 }), "1 website couldn't be read")
  assert.equal(describeSettledNote({ discovered: 10, added: 10, duplicates: 0, invalid: 0, unreadable: 0 }), null)
  assert.equal(describeSettledNote({ discovered: 10, added: 9, duplicates: 1, invalid: 0, unreadable: 1 }), "9 added to your results · 1 duplicate removed · 1 website couldn't be read")
})

test('the inspection travels in the stream and results payload, and is not stored', () => {
  // the route builds every result and guest lead through the one pure builder...
  assert.match(read('app/api/scrape/route.ts'), /return buildResultLead\(lead, crypto\.randomUUID\(\)\)/)
  // ...which carries the real confidence and the inspection
  const payload = read('lib/scraper/lead-payload.ts')
  assert.match(payload, /email_inspection: lead\.email_inspection \?\? null/)
  assert.match(payload, /email_confidence: lead\.email \? lead\.email_confidence : null/)
  const shared = read('lib/scraper/run-scraper-shared.ts')
  assert.match(shared, /enrichEmailWithInspection\(lead\.website\)/)
  assert.match(shared, /lead\.email_inspection = mergeInspection\(lead\.email_inspection, inspection\)/)
  assert.match(shared, /email_inspection: websiteChanged \? null/)
  // the existing log line, and the progress counters built from it, are unchanged
  assert.match(shared, /send\(`⛔ no email: \$\{lead\.company_name\}`\)/)
  // not a database column: neither the insert builder nor the row builder mentions it
  const insertSide = payload.slice(payload.indexOf('export function buildLeadInsertPayload'))
  assert.doesNotMatch(insertSide, /email_inspection/)
  const rows = read('components/scraper/ResultsIndex.tsx')
  assert.match(rows, /row\.emailNote/)
  assert.match(rows, /row\.emailMissing \?\? 'No email found'/)
})

// ---------------------------------------------------------------------------------------------
// 4. Business category
// ---------------------------------------------------------------------------------------------

test('a provider category is preserved as supplied and tidied only for display', () => {
  assert.equal(providerCategory('Management consultant'), 'Management consultant')
  assert.equal(providerCategory('  Business management consultant '), 'Business management consultant')
  assert.equal(providerCategory('real_estate_agency'), 'Real estate agency')
  assert.equal(serperPlaceCategory({ type: 'Dentist', types: ['Cosmetic dentist'] }), 'Dentist')
  assert.equal(serperPlaceCategory({ types: ['Cosmetic dentist', 'Dentist'] }), 'Cosmetic dentist')
})

test('no category is invented: nothing supplied means null, and the search query is never used', () => {
  assert.equal(serperPlaceCategory({}), null)
  assert.equal(serperPlaceCategory({ type: '', types: [] }), null)
  assert.equal(serperPlaceCategory({ type: null, types: null }), null)
  for (const generic of ['point_of_interest', 'establishment', 'premise', 'political', '', '   ', null, undefined]) {
    assert.equal(providerCategory(generic), null, String(generic))
  }
  assert.equal(firstProviderCategory(['point_of_interest', 'establishment', 'lawyer']), 'Lawyer')
  assert.equal(firstProviderCategory(['point_of_interest', 'establishment']), null)
  assert.equal(firstProviderCategory(undefined), null)

  const serper = read('lib/sources/serper.ts')
  assert.match(serper, /industry: serperPlaceCategory\(place\)/)
  assert.doesNotMatch(serper, /industry:[^\n]*\|\| query/)
  assert.match(read('lib/sources/google.ts'), /industry: firstProviderCategory\(details\?\.types\)/)
})

test('the category survives saving: it is part of the row written to leads', () => {
  const discovered = {
    company_name: 'Satori Consulting Inc', email: null, phone: '+1 905-627-0555', website: 'https://satori.example', city: 'Toronto',
    industry: 'Management consultant', source: 'serper', email_confidence: null, email_source: null, is_generic_email: false, cost_estimate: 0.01,
  }
  const row = toLeadRow(buildLeadInsertPayload(discovered, 'user-1', () => '2026-10-10T00:00:00.000Z'))
  assert.equal(row.industry, 'Management consultant')
  assert.equal(row.email_confidence, 'low') // unchanged default for a lead without an email
  assert.equal(row.status, 'inbox')
  assert.equal(row.last_activity_at, '2026-10-10T00:00:00.000Z')

  // a provider that supplied nothing stores null, not the query and not a placeholder
  assert.equal(toLeadRow(buildLeadInsertPayload({ ...discovered, industry: null }, 'user-1')).industry, null)
  assert.equal(toLeadRow(buildLeadInsertPayload({ ...discovered, industry: undefined }, 'user-1')).industry, null)
  assert.equal(toLeadRow(buildLeadInsertPayload({ ...discovered, industry: '   ' }, 'user-1')).industry, null)
  assert.equal(cleanCategory('  A   B  '), 'A B')

  // every previously inserted column is still there, plus industry
  assert.deepEqual(
    Object.keys(row).sort(),
    ['city', 'company_name', 'cost_estimate', 'email', 'email_confidence', 'email_source', 'industry', 'is_generic_email', 'last_activity_at', 'phone', 'source', 'status', 'user_id', 'website']
  )
  assert.match(read('app/api/scrape/route.ts'), /const payload = toLeadRow\(buildLeadInsertPayload\(lead, userId\)\)/)
})

test('the category appears in the Discover results', () => {
  const resultLead = lead({ company_name: 'Satori Consulting Inc', industry: 'Management consultant' })
  assert.equal(describeLead(resultLead), 'Toronto · Management consultant')
  assert.equal(toResultRow(resultLead).descriptor, 'Toronto · Management consultant')
  assert.equal(toResultRow(lead({ industry: null })).descriptor, 'Toronto')
  // the results payload carries the discovered category
  assert.match(read('lib/scraper/lead-payload.ts'), /industry: cleanCategory\(lead\.industry\),\s*\n\s*email: lead\.email/)
})
