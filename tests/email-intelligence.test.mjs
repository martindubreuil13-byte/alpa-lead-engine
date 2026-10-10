import assert from 'node:assert/strict'
import test from 'node:test'

import { safeFetchWebsite, WebsiteFetchError } from '../lib/commercial-intelligence/safe-website-fetch.ts'
import { extractEmailCandidatesFromHtml, pickBestEmailCandidate } from '../lib/validation.ts'
import { enrichEmailV1, fetchHtmlV1 } from '../lib/scraper/email-enrichment-v1.ts'
import { createSafePageFetcher, enrichEmail, enrichEmailV2 } from '../lib/scraper/email-enrichment.ts'
import {
  classifyEmailOutcome,
  decodeCloudflareEmail,
  deobfuscateEmailText,
  detectPageLanguage,
  extractEmailCandidatesV2,
  isRejectedEmail,
  normalizeCandidateEmail,
  pickBestEmailCandidateV2,
  planFollowUpUrls,
  planStageOneUrls,
  summarizeEmailCoverage,
  summarizeLeadEmailCoverage,
} from '../lib/scraper/email-intelligence.ts'
import { cfEncode, createFixtureFetch, PUBLIC_RESOLVER, SITES } from './fixtures/email-sites.mjs'
import { runBenchmark } from '../scripts/benchmark-email-intelligence.mjs'

const extract = (html, host = 'acmeplumbing.ca', url = `https://${host}/`) =>
  extractEmailCandidatesV2({ html, pageUrl: url, websiteHost: host })

const values = (candidates) => candidates.map((candidate) => candidate.value).sort()
const site = (id) => SITES.find((entry) => entry.id === id)

// ---------------------------------------------------------------------------------------------
// Cloudflare
// ---------------------------------------------------------------------------------------------

test('decodes Cloudflare-protected addresses from the attribute and the link form', () => {
  assert.equal(decodeCloudflareEmail(cfEncode('info@acmeplumbing.ca')), 'info@acmeplumbing.ca')
  assert.equal(decodeCloudflareEmail(cfEncode('a@b.co', 0x01)), 'a@b.co')

  const attribute = extract(`<a class="__cf_email__" data-cfemail="${cfEncode('quotes@acmeplumbing.ca')}">[email protected]</a>`)
  assert.deepEqual(values(attribute), ['quotes@acmeplumbing.ca'])
  assert.equal(attribute[0].evidence, 'cloudflare')

  const link = extract(`<a href="/cdn-cgi/l/email-protection#${cfEncode('sales@acmeplumbing.ca', 0x77)}">Email</a>`)
  assert.deepEqual(values(link), ['sales@acmeplumbing.ca'])
})

test('rejects malformed Cloudflare payloads without throwing', () => {
  assert.equal(decodeCloudflareEmail(''), null)
  assert.equal(decodeCloudflareEmail('zz'), null)
  assert.equal(decodeCloudflareEmail('4f1'), null)
  assert.equal(decodeCloudflareEmail('4f4f4f4f'), null) // decodes to text with no @
  assert.deepEqual(extract('<a data-cfemail="nothex">[email protected]</a>'), [])
  assert.deepEqual(extract('<span>[email protected]</span>'), [])
})

// ---------------------------------------------------------------------------------------------
// Obfuscated addresses
// ---------------------------------------------------------------------------------------------

test('recognises bracketed [at]/(at) and [dot]/(dot) forms', () => {
  assert.equal(deobfuscateEmailText('name [at] company [dot] com'), 'name@company.com')
  assert.equal(deobfuscateEmailText('name (at) company (dot) com'), 'name@company.com')
  assert.equal(deobfuscateEmailText('name{at}company{dot}ca'), 'name@company.ca')

  const found = extract('<p>Reach name [at] acmeplumbing [dot] ca today</p><p>Or sales (at) acmeplumbing.ca</p>')
  assert.deepEqual(values(found), ['name@acmeplumbing.ca', 'sales@acmeplumbing.ca'])
  assert.ok(found.every((candidate) => candidate.evidence === 'obfuscated'))
})

test('does not turn ordinary prose into email addresses', () => {
  const prose = [
    'Meet me at the park dot com later',
    'We look at the options and then point at the answer',
    'Open (at) the weekend, closed (dot) on Mondays',
    'The cat sat at home dot dot dot',
    'price @ 5 dollars, call 555.0100',
  ]
  for (const sentence of prose) {
    assert.deepEqual(extract(`<p>${sentence}</p>`), [], sentence)
  }
})

// ---------------------------------------------------------------------------------------------
// JSON-LD, microdata and mailto
// ---------------------------------------------------------------------------------------------

test('reads email fields from valid business JSON-LD, including @graph and contactPoint', () => {
  const html = `<script type="application/ld+json">{"@graph":[
    {"@type":"Dentist","name":"X","email":"mailto:front@acmeplumbing.ca","contactPoint":{"@type":"ContactPoint","email":"billing@acmeplumbing.ca"}}]}</script>`
  assert.deepEqual(values(extract(html)), ['billing@acmeplumbing.ca', 'front@acmeplumbing.ca'])
})

test('ignores authors, reviews, malformed JSON-LD and arbitrary scripts', () => {
  const html = `
    <script type="application/ld+json">{"@type":"BlogPosting","author":{"@type":"Person","email":"writer@elsewhere.io"}}</script>
    <script type="application/ld+json">{"@type":"Review","email":"customer@elsewhere.io"}</script>
    <script type="application/ld+json">{ this is not json,, }</script>
    <script type="application/ld+json">{"email":"untyped@acmeplumbing.ca"}</script>
    <script>var contact = "hidden@acmeplumbing.ca"; window.mail="x@acmeplumbing.ca"</script>`
  assert.deepEqual(extract(html), [])
})

test('reads microdata email only inside a business item scope', () => {
  const business = extract(`<div itemscope itemtype="https://schema.org/Plumber"><span itemprop="email">pipes@acmeplumbing.ca</span></div>`)
  assert.deepEqual(values(business), ['pipes@acmeplumbing.ca'])
  assert.equal(business[0].evidence, 'microdata')
  // Visible text is still read, but the structured-data evidence is only granted inside a business scope.
  const review = extract(`<div itemscope itemtype="https://schema.org/Review"><span itemprop="email">fan@elsewhere.io</span></div>`)
  assert.equal(review[0].evidence, 'text')
  assert.equal(review[0].emailConfidence, 'low')
  assert.equal(extract(`<span itemprop="email">loose@acmeplumbing.ca</span>`)[0].evidence, 'text')
})

test('extracts, decodes and normalises mailto links', () => {
  const html = `
    <a href="mailto:Sales%40AcmePlumbing.CA?subject=Hi%20there&body=x">one</a>
    <a href=" mailto:two@acmeplumbing.ca ">two</a>
    <a href="mailto:a@acmeplumbing.ca,b@acmeplumbing.ca;c@acmeplumbing.ca">many</a>
    <a href="mailto:">empty</a><a href="mailto:?subject=only">none</a>`
  assert.deepEqual(values(extract(html)), [
    'a@acmeplumbing.ca', 'b@acmeplumbing.ca', 'c@acmeplumbing.ca', 'sales@acmeplumbing.ca', 'two@acmeplumbing.ca',
  ])
})

test('block boundaries never fuse neighbouring text into an address', () => {
  const found = extract('<h2>Contact</h2><p>info@acmeplumbing.ca</p><p>Call us</p>')
  assert.deepEqual(values(found), ['info@acmeplumbing.ca'])
  // V1 behaviour this fixes:
  const v1 = extractEmailCandidatesFromHtml({
    html: '<p>info@acmeplumbing.ca</p><p>Call us</p>', pageUrl: 'https://acmeplumbing.ca/', websiteHost: 'acmeplumbing.ca',
  })
  assert.notDeepEqual(v1.map((candidate) => candidate.value), ['info@acmeplumbing.ca'])
})

// ---------------------------------------------------------------------------------------------
// Relevance
// ---------------------------------------------------------------------------------------------

test('keeps V1 confidence for business-domain addresses exactly', () => {
  const found = extract('<a href="mailto:jane@acmeplumbing.ca">j</a> <a href="mailto:info@acmeplumbing.ca">i</a> <a href="mailto:x@shop.acmeplumbing.ca">s</a>')
  const byValue = Object.fromEntries(found.map((candidate) => [candidate.value, candidate.emailConfidence]))
  assert.equal(byValue['jane@acmeplumbing.ca'], 'high')
  assert.equal(byValue['info@acmeplumbing.ca'], 'medium')
  assert.equal(byValue['x@shop.acmeplumbing.ca'], 'high')

  const v1 = extractEmailCandidatesFromHtml({
    html: '<a href="mailto:jane@acmeplumbing.ca">j</a><a href="mailto:info@acmeplumbing.ca">i</a>', pageUrl: 'https://acmeplumbing.ca/', websiteHost: 'acmeplumbing.ca',
  })
  assert.equal(pickBestEmailCandidate(v1).emailConfidence, 'high')
})

test('accepts legitimate external mailbox providers when the page gives evidence', () => {
  const mailto = extract('<a href="mailto:acme.plumbing@gmail.com">Email us</a>')
  assert.equal(mailto[0].emailConfidence, 'medium')
  assert.equal(mailto[0].relevance, 'external-provider')

  const labelled = extract('<p>Courriel : acmeplumbing@hotmail.com</p>')
  assert.equal(labelled[0].emailConfidence, 'medium')

  const jsonld = extract('<script type="application/ld+json">{"@type":"Plumber","email":"acme@outlook.com"}</script>')
  assert.equal(jsonld[0].emailConfidence, 'medium')
})

test('keeps unlabelled external addresses low so they do not count as coverage', () => {
  const stray = extract('<nav><a href="/contact">Contact</a></nav><blockquote>wrote fan88@gmail.com in her review</blockquote>')
  assert.equal(stray[0].emailConfidence, 'low')
  assert.equal(summarizeEmailCoverage([{ best: stray[0], analyzed: true, hasWebsite: true }]).withRelevantEmail, 0)
})

test('treats a third-party agency address as unrelated and low', () => {
  const found = extract('<footer>Site by <a href="mailto:hello@webcraftagency.io">WebCraft</a></footer>')
  assert.equal(found[0].relevance, 'unrelated')
  assert.equal(found[0].emailConfidence, 'low')
  assert.equal(found[0].emailConfidence, pickBestEmailCandidateV2(found).emailConfidence)
})

test('treats the same brand on another TLD as medium, never high', () => {
  const found = extractEmailCandidatesV2({ html: '<a href="mailto:orders@larkspurflowers.ca">o</a>', pageUrl: 'https://larkspurflowers.com/', websiteHost: 'larkspurflowers.com' })
  assert.equal(found[0].relevance, 'associated')
  assert.equal(found[0].emailConfidence, 'medium')
  // Short or generic labels are not treated as a brand match.
  const generic = extractEmailCandidatesV2({ html: '<a href="mailto:a@dental.ca">o</a>', pageUrl: 'https://dental.com/', websiteHost: 'dental.com' })
  assert.equal(generic[0].emailConfidence, 'low')
})

test('filters placeholders, technical addresses, image names, hashes and no-reply senders', () => {
  const rejected = [
    'your@email.com', 'name@domain.com', 'john@example.com', 'user@example.org', 'yourname@gmail.com',
    'logo@2x.png', 'sprite@3x.jpg', 'errors@sentry.io', 'a1b2c3d4e5f60718293a4b5c6d7e8f90@sentry.wixpress.com',
    'noreply@acmeplumbing.ca', 'no-reply@acmeplumbing.ca', 'do_not_reply@acmeplumbing.ca', 'postmaster@acmeplumbing.ca',
    'abc@local.test', 'x@y.invalid',
  ]
  for (const email of rejected) assert.equal(isRejectedEmail(email), true, email)
  for (const email of ['info@acmeplumbing.ca', 'owner@gmail.com', 'frontdesk@clinic-central.com']) {
    assert.equal(isRejectedEmail(email), false, email)
  }
  assert.deepEqual(extract(`<p>${rejected.slice(0, 11).join(' ')}</p>`), [])
})

test('de-duplicates an address seen several ways and keeps the strongest evidence', () => {
  const found = extract(`
    <p>info@acmeplumbing.ca</p>
    <a href="mailto:INFO@acmeplumbing.ca">Email</a>
    <a data-cfemail="${cfEncode('info@acmeplumbing.ca')}">[email protected]</a>
    <script type="application/ld+json">{"@type":"Plumber","email":"info@acmeplumbing.ca"}</script>`)
  assert.equal(found.length, 1)
  assert.equal(found[0].evidence, 'jsonld')
})

test('normalises and validates candidate shapes', () => {
  assert.equal(normalizeCandidateEmail('  MAILTO:Info@Acme.CA, '), 'info@acme.ca')
  assert.equal(normalizeCandidateEmail('("a@b.co")'), 'a@b.co')
  for (const bad of ['a@b', 'a..b@c.com', '@c.com', 'a@-c.com', 'a@c.123', 'a b@c.com', `${'x'.repeat(70)}@c.com`, '.a@c.com']) {
    assert.equal(normalizeCandidateEmail(bad), null, bad)
  }
})

test('survives malformed and hostile HTML', () => {
  const inputs = [
    '', '<', '<<<>>>', '<a href="mailto:x@acmeplumbing.ca', '<div><p>unclosed <b>x@acmeplumbing.ca<i>',
    `<p>${'<'.repeat(5000)}</p>`, `<p>${'a@'.repeat(5000)}</p>`, '\u0000￿<script>', '<a href>',
  ]
  for (const html of inputs) assert.doesNotThrow(() => extract(html), html.slice(0, 30))
  assert.deepEqual(values(extract('<div><p>unclosed <b>x@acmeplumbing.ca<i>')), ['x@acmeplumbing.ca'])
})

test('bounds the cost of a very large page', () => {
  const huge = `<div>${'<p>filler</p>'.repeat(120_000)}</div><a href="mailto:end@acmeplumbing.ca">e</a>`
  const started = performance.now()
  const found = extract(huge)
  assert.ok(performance.now() - started < 1500, 'large page extraction must stay linear')
  assert.deepEqual(values(found), ['end@acmeplumbing.ca'])
})

// ---------------------------------------------------------------------------------------------
// Page planning: privacy / legal / international
// ---------------------------------------------------------------------------------------------

test('plans the homepage plus the known contact paths for the first round', () => {
  assert.deepEqual(planStageOneUrls('https://acmeplumbing.ca'), [
    'https://acmeplumbing.ca', 'https://acmeplumbing.ca/contact', 'https://acmeplumbing.ca/contact-us', 'https://acmeplumbing.ca/about',
  ])
  assert.deepEqual(planStageOneUrls('https://facebook.com/acme'), [])
  assert.deepEqual(planStageOneUrls('not a url at all ::'), [])
})

test('follows links the homepage advertises, in several languages', () => {
  const homepage = (html) => ({ html, resolvedUrl: 'https://acmeplumbing.ca/' })
  const plan = (html, lang) =>
    planFollowUpUrls({ base: 'https://acmeplumbing.ca', homepage: homepage(html), alreadyRequested: ['https://acmeplumbing.ca', 'https://acmeplumbing.ca/contact'] })

  assert.deepEqual(plan('<a href="/nous-joindre">Nous joindre</a><a href="/mentions-legales">Mentions légales</a>'), [
    'https://acmeplumbing.ca/nous-joindre', 'https://acmeplumbing.ca/mentions-legales',
  ])
  assert.deepEqual(plan('<a href="/kontakt">Kontakt</a><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a>').slice(0, 2), [
    'https://acmeplumbing.ca/kontakt', 'https://acmeplumbing.ca/impressum',
  ])
  assert.deepEqual(plan('<a href="/politica-de-privacidad">Privacidad</a>')[0], 'https://acmeplumbing.ca/politica-de-privacidad')
  assert.deepEqual(plan('<a href="/privacy-policy">Privacy</a>')[0], 'https://acmeplumbing.ca/privacy-policy')
})

test('guesses privacy paths by page language when nothing is linked', () => {
  const guess = (html, host) =>
    planFollowUpUrls({ base: `https://${host}`, homepage: { html, resolvedUrl: `https://${host}/` }, alreadyRequested: [] })

  assert.deepEqual(guess('<html lang="de"><body>x</body></html>', 'firma.com'), ['https://firma.com/impressum', 'https://firma.com/datenschutz'])
  assert.deepEqual(guess('<html lang="fr-CA"><body>x</body></html>', 'firme.ca'), ['https://firme.ca/politique-de-confidentialite', 'https://firme.ca/mentions-legales'])
  assert.deepEqual(guess('<html><body>x</body></html>', 'firme.com'), ['https://firme.com/privacy-policy', 'https://firme.com/privacy'])
  assert.equal(detectPageLanguage(null, 'unternehmen.de'), 'de')
  assert.equal(detectPageLanguage('<html lang="pt-BR">', 'empresa.com'), 'pt')
})

test('respects the page budget and never repeats or leaves the site', () => {
  const links = Array.from({ length: 40 }, (_, index) => `<a href="/contact-${index}">Contact ${index}</a>`).join('')
  const plan = planFollowUpUrls({
    base: 'https://acmeplumbing.ca',
    homepage: { html: links, resolvedUrl: 'https://acmeplumbing.ca/' },
    alreadyRequested: ['https://acmeplumbing.ca/contact-0'],
  })
  assert.equal(plan.length, 2)
  assert.ok(!plan.includes('https://acmeplumbing.ca/contact-0'))

  const unsafe = planFollowUpUrls({
    base: 'https://acmeplumbing.ca',
    homepage: {
      html: `<a href="https://evil.example/contact">Contact</a><a href="http://169.254.169.254/contact">Contact</a>
        <a href="javascript:alert(1)">Contact</a><a href="mailto:x@y.com">Contact</a><a href="https://facebook.com/acme/contact">Contact</a>
        <a href="/files/contact.pdf">Contact</a><a href="https://user:pw@acmeplumbing.ca/contact">Contact</a><a href="https://sub.acmeplumbing.ca/contact">Contact</a>`,
      resolvedUrl: 'https://acmeplumbing.ca/',
    },
    alreadyRequested: [],
    limit: 10,
  })
  assert.ok(unsafe.every((url) => url.startsWith('https://sub.acmeplumbing.ca/') || url.startsWith('https://acmeplumbing.ca/')), unsafe.join(','))
  assert.ok(!unsafe.some((url) => url.includes('evil') || url.includes('169.254') || url.includes('facebook') || url.endsWith('.pdf') || url.includes('pw@')))
})

// ---------------------------------------------------------------------------------------------
// Coverage metrics
// ---------------------------------------------------------------------------------------------

test('classifies and summarises email coverage without counting low-confidence addresses', () => {
  const outcome = (confidence, over = {}) => ({ best: confidence ? { emailConfidence: confidence } : null, analyzed: true, hasWebsite: true, ...over })
  assert.equal(classifyEmailOutcome(outcome('high')), 'high')
  assert.equal(classifyEmailOutcome(outcome('medium')), 'medium')
  assert.equal(classifyEmailOutcome(outcome('low')), 'low_or_unrelated')
  assert.equal(classifyEmailOutcome(outcome(null)), 'none')
  assert.equal(classifyEmailOutcome(outcome(null, { analyzed: false })), 'unanalyzable')
  assert.equal(classifyEmailOutcome(outcome('high', { hasWebsite: false })), 'unanalyzable')

  const summary = summarizeEmailCoverage([outcome('high'), outcome('medium'), outcome('low'), outcome(null), outcome(null, { analyzed: false })])
  assert.equal(summary.discovered, 5)
  assert.equal(summary.withRelevantEmail, 2)
  assert.equal(summary.coverage, 0.4)
  assert.equal(summary.analyzableCoverage, 0.5)
  assert.deepEqual(summarizeEmailCoverage([]).coverage, 0)
})

test('summarises coverage from existing saved leads (backward compatible)', () => {
  const summary = summarizeLeadEmailCoverage([
    { website: 'a.com', email: 'x@a.com', email_confidence: 'high' },
    { website: 'b.com', email: 'y@gmail.com', email_confidence: 'low' },
    { website: 'c.com', email: null, email_confidence: null },
    { website: null, email: null, email_confidence: null },
    { website: 'd.com', email: 'z@d.com', email_confidence: null },
  ])
  assert.equal(summary.high, 1)
  assert.equal(summary.lowOrUnrelated, 2)
  assert.equal(summary.none, 1)
  assert.equal(summary.unanalyzable, 1)
  assert.equal(summary.withRelevantEmail, 1)
})

// ---------------------------------------------------------------------------------------------
// Fetching: concurrency, rounds, safety
// ---------------------------------------------------------------------------------------------

function fetcherFor(fixture, requests = []) {
  const host = new URL(fixture.website).hostname
  return createSafePageFetcher(host, {
    fetchImpl: createFixtureFetch(fixture, { requests, latency: 20 }),
    resolveHostname: PUBLIC_RESOLVER,
  })
}

test('requests the homepage and known contact paths concurrently, in one round', async () => {
  const requests = []
  const fixture = site('contact-page-only')
  const outcome = await enrichEmailV2(fixture.website, { fetchPage: fetcherFor(fixture, requests) })

  assert.equal(outcome.best.value, 'owner@brightleafcafe.com')
  assert.equal(outcome.rounds, 1)
  assert.equal(requests.length, 4)
  const starts = requests.map((request) => request.at)
  assert.ok(Math.max(...starts) - Math.min(...starts) < 15, 'first-round requests must start together')
})

test('runs a second round only when no relevant email was found, within budget', async () => {
  const requests = []
  const fixture = site('privacy-linked-in-footer')
  const outcome = await enrichEmailV2(fixture.website, { fetchPage: fetcherFor(fixture, requests) })

  assert.equal(outcome.best.value, 'privacy@redcedarmovers.com')
  assert.equal(outcome.rounds, 2)
  assert.ok(outcome.pagesRequested <= 6)
  const hrefs = requests.map((request) => request.href)
  assert.equal(new Set(hrefs).size, hrefs.length, 'no URL is requested twice')

  const first = await enrichEmailV2(site('plain-mailto').website, { fetchPage: fetcherFor(site('plain-mailto')) })
  assert.equal(first.rounds, 1)
})

test('does not run a second round for an unreachable site', async () => {
  const fixture = site('unreachable')
  const outcome = await enrichEmailV2(fixture.website, { fetchPage: fetcherFor(fixture) })
  assert.equal(outcome.best, null)
  assert.equal(outcome.rounds, 1)
  assert.equal(outcome.coverageClass, 'unanalyzable')
})

test('classifies a readable site with no email as none, and a stray low address as low', async () => {
  const none = await enrichEmailV2(site('form-only-no-email').website, { fetchPage: fetcherFor(site('form-only-no-email')) })
  assert.equal(none.coverageClass, 'none')
  const low = await enrichEmailV2(site('agency-credit-only').website, { fetchPage: fetcherFor(site('agency-credit-only')) })
  assert.equal(low.coverageClass, 'low_or_unrelated')
})

test('does not follow a redirect to a different site', async () => {
  const requests = []
  const fixture = site('offsite-redirect')
  const outcome = await enrichEmailV2(fixture.website, { fetchPage: fetcherFor(fixture, requests) })
  assert.equal(outcome.best, null)
  assert.ok(!requests.some((request) => request.href.includes('parkedpages-hosting.com')), 'off-site target must never be requested')
  assert.equal(outcome.accessFailure, 'unavailable', 'a site that moved elsewhere is unavailable, not a security failure')

  const www = site('www-redirect')
  assert.equal((await enrichEmailV2(www.website, { fetchPage: fetcherFor(www) })).best.value, 'book@juniperhillsalon.com')
})

test('refuses unsafe URLs without making a request', async () => {
  const unsafe = [
    'http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/',
    'http://192.168.1.1/', 'http://[::1]/', 'https://metadata.internal/', 'https://printer.local/',
    'https://user:pw@acmeplumbing.ca/', 'ftp://acmeplumbing.ca/', 'file:///etc/passwd',
  ]
  for (const website of unsafe) {
    let called = 0
    const host = (() => { try { return new URL(/^[a-z]+:\/\//.test(website) ? website : `https://${website}`).hostname } catch { return 'x' } })()
    const fetchPage = createSafePageFetcher(host, {
      fetchImpl: async () => { called += 1; return new Response('<a href="mailto:a@b.com">x</a>', { headers: { 'content-type': 'text/html' } }) },
      resolveHostname: async () => ['10.0.0.8'],
    })
    const outcome = await enrichEmailV2(website, { fetchPage })
    assert.equal(outcome.best, null, website)
    assert.equal(called, 0, `${website} must not reach the network`)
  }
})

test('blocks hosts that resolve to private addresses and redirects into private ranges', async () => {
  const resolver = async (hostname) => (hostname === 'rebind.acmeplumbing.ca' ? ['10.1.2.3'] : ['93.184.216.34'])
  let calls = 0
  const rebind = createSafePageFetcher('acmeplumbing.ca', { fetchImpl: async () => { calls += 1; return new Response('x') }, resolveHostname: resolver })
  assert.deepEqual(await rebind('https://rebind.acmeplumbing.ca/'), { ok: false, failure: 'unsafe', challenge: false })
  assert.equal(calls, 0)

  const toPrivate = createSafePageFetcher('acmeplumbing.ca', {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    resolveHostname: PUBLIC_RESOLVER,
  })
  assert.deepEqual(await toPrivate('https://acmeplumbing.ca/'), { ok: false, failure: 'unsafe', challenge: false })
})

test('times out hung requests and returns no page', async () => {
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const fetchPage = createSafePageFetcher('acmeplumbing.ca', { fetchImpl: hang, resolveHostname: PUBLIC_RESOLVER, timeoutMs: 40 })
  const started = performance.now()
  assert.deepEqual(await fetchPage('https://acmeplumbing.ca/'), { ok: false, failure: 'timeout', challenge: false })
  assert.ok(performance.now() - started < 400)

  const outcome = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage })
  assert.equal(outcome.best, null)
  assert.equal(outcome.coverageClass, 'unanalyzable')
})

test('truncates oversized responses and reads what fits instead of dropping the page', async () => {
  const body = `<a href="mailto:early@acmeplumbing.ca">e</a>${'<p>x</p>'.repeat(2000)}<a href="mailto:late@acmeplumbing.ca">l</a>`
  const respond = async () => new Response(body, { headers: { 'content-type': 'text/html' } })
  const fetchPage = createSafePageFetcher('acmeplumbing.ca', { fetchImpl: respond, resolveHostname: PUBLIC_RESOLVER, maxBytes: 3000 })
  const result = await fetchPage('https://acmeplumbing.ca/')
  assert.equal(result.ok, true)
  assert.equal(result.page.truncated, true)
  assert.ok(result.page.html.includes('early@') && !result.page.html.includes('late@'))
  assert.ok(result.page.html.length <= 3000)

  const huge = site('email-late-in-huge-page')
  const outcome = await enrichEmailV2(huge.website, { fetchPage: fetcherFor(huge) })
  assert.equal(outcome.best, null, 'known limit: addresses beyond the byte cap are not read')
})

test('safeFetchWebsite keeps rejecting oversized pages unless truncation is requested', async () => {
  const respond = async () => new Response('x'.repeat(5000), { headers: { 'content-type': 'text/html' } })
  await assert.rejects(
    safeFetchWebsite('https://acmeplumbing.ca', { fetchImpl: respond, resolveHostname: PUBLIC_RESOLVER, maxBytes: 1000 }),
    (error) => error instanceof WebsiteFetchError && error.code === 'RESPONSE_TOO_LARGE'
  )
  const truncated = await safeFetchWebsite('https://acmeplumbing.ca', {
    fetchImpl: respond, resolveHostname: PUBLIC_RESOLVER, maxBytes: 1000, truncateAtMaxBytes: true,
  })
  assert.equal(truncated.html.length, 1000)
})

test('safeFetchWebsite content-type handling stays strict unless lenient is requested', async () => {
  const noType = async () => new Response('<p>hi</p>', { headers: {} })
  const json = async () => new Response('{}', { headers: { 'content-type': 'application/json' } })
  await assert.rejects(safeFetchWebsite('https://acmeplumbing.ca', { fetchImpl: noType, resolveHostname: PUBLIC_RESOLVER }), /HTML/)
  const lenient = await safeFetchWebsite('https://acmeplumbing.ca', { fetchImpl: noType, resolveHostname: PUBLIC_RESOLVER, lenientContentType: true })
  assert.match(lenient.html, /hi/)
  await assert.rejects(safeFetchWebsite('https://acmeplumbing.ca', { fetchImpl: json, resolveHostname: PUBLIC_RESOLVER, lenientContentType: true }), /HTML/)
})

// ---------------------------------------------------------------------------------------------
// V1 behaviour is preserved
// ---------------------------------------------------------------------------------------------

test('V1 enrichment still behaves as before (baseline and rollback path)', async () => {
  const fixture = site('plain-mailto')
  const fixtureFetch = createFixtureFetch(fixture, { latency: 1 })
  const best = await enrichEmailV1(fixture.website, (url) => fetchHtmlV1(url, fixtureFetch))
  assert.equal(best.value, 'service@maplewoodplumbing.ca')
  assert.equal(best.emailConfidence, 'high')
  assert.equal(await enrichEmailV1(null), null)
  assert.equal(await enrichEmailV1('https://facebook.com/acme'), null)
})

test('enrichEmail dispatches on EMAIL_INTELLIGENCE_VERSION and returns the V1 result shape', async () => {
  const previous = process.env.EMAIL_INTELLIGENCE_VERSION
  try {
    delete process.env.EMAIL_INTELLIGENCE_VERSION
    assert.equal(await enrichEmail(null), null)
    assert.equal(await enrichEmail('https://facebook.com/acme'), null)
    process.env.EMAIL_INTELLIGENCE_VERSION = 'v1'
    assert.equal(await enrichEmail(null), null)
  } finally {
    if (previous === undefined) delete process.env.EMAIL_INTELLIGENCE_VERSION
    else process.env.EMAIL_INTELLIGENCE_VERSION = previous
  }

  const found = (await enrichEmailV2(site('plain-mailto').website, { fetchPage: fetcherFor(site('plain-mailto')) })).best
  for (const key of ['value', 'emailSource', 'emailConfidence', 'isGenericEmail', 'domainMatch']) assert.ok(key in found, key)
})

// ---------------------------------------------------------------------------------------------
// V1 vs V2 on the shared fixtures
// ---------------------------------------------------------------------------------------------

test('V2 never loses a V1 relevant result except the documented size-cap case', async () => {
  const result = await runBenchmark()
  assert.deepEqual(result.regressed, ['email-late-in-huge-page'])
  assert.ok(result.v2.relevantCorrect > result.v1.relevantCorrect)
  assert.ok(result.v2.relevantWrong <= result.v1.relevantWrong)
  assert.ok(result.v2.extractor.falsePositiveRate < result.v1.extractor.falsePositiveRate)
  assert.ok(result.v2.extractor.recall >= result.v1.extractor.recall)
})

// ---------------------------------------------------------------------------------------------
// V2.1: access failure classification
// ---------------------------------------------------------------------------------------------

const okPage = (html, url = 'https://acmeplumbing.ca/', extra = {}) => ({ ok: true, page: { html, resolvedUrl: url, ...extra } })
const failed = (failure) => ({ ok: false, failure })

function stubFetcher(map, fallback = failed('not_found')) {
  return async (url) => {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/'
    return map[path] ?? fallback
  }
}

test('an unreadable website is never reported as having no published email', async () => {
  const cases = [
    ['blocked', { '/': failed('blocked') }, 'blocked'],
    ['timeout', { '/': failed('timeout') }, 'timeout'],
    ['unsupported', { '/': failed('unsupported') }, 'unsupported'],
    ['unavailable', { '/': failed('unavailable') }, 'unavailable'],
    ['too_large', { '/': failed('too_large') }, 'too_large'],
    ['everything missing', {}, 'unavailable'],
  ]
  for (const [label, pages, expected] of cases) {
    const outcome = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: stubFetcher(pages) })
    assert.equal(outcome.best, null, label)
    assert.equal(outcome.accessFailure, expected, label)
    assert.equal(outcome.coverageClass, 'unanalyzable', label)
    assert.equal(outcome.pagesLoaded, 0, label)
  }
})

test('when several pages fail, the most informative reason wins', async () => {
  const outcome = await enrichEmailV2('https://acmeplumbing.ca', {
    fetchPage: stubFetcher({ '/': failed('unavailable'), '/contact': failed('blocked'), '/contact-us': failed('timeout') }),
  })
  assert.equal(outcome.accessFailure, 'blocked')
})

test('a readable site with no email is "none", and partial access is reported separately', async () => {
  const clean = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: stubFetcher({ '/': okPage('<p>Hello</p>') }) })
  assert.equal(clean.coverageClass, 'none')
  assert.equal(clean.accessFailure, null)
  assert.equal(clean.partialAccess, false, 'missing guessed paths are ordinary')

  const partial = await enrichEmailV2('https://acmeplumbing.ca', {
    fetchPage: stubFetcher({ '/': okPage('<p>Hello</p>'), '/contact': failed('blocked') }),
  })
  assert.equal(partial.coverageClass, 'none')
  assert.equal(partial.accessFailure, null)
  assert.equal(partial.partialAccess, true)
})

test('an oversized page with no email found is inconclusive, not "none"', async () => {
  const outcome = await enrichEmailV2('https://acmeplumbing.ca', {
    fetchPage: stubFetcher({ '/': okPage('<p>start</p>', 'https://acmeplumbing.ca/', { truncated: true }) }),
  })
  assert.equal(outcome.truncated, true)
  assert.equal(outcome.accessFailure, 'too_large')
  assert.equal(outcome.coverageClass, 'unanalyzable')

  const found = await enrichEmailV2('https://acmeplumbing.ca', {
    fetchPage: stubFetcher({ '/': okPage('<a href="mailto:info@acmeplumbing.ca">x</a>', 'https://acmeplumbing.ca/', { truncated: true }) }),
  })
  assert.equal(found.best.value, 'info@acmeplumbing.ca')
  assert.equal(found.accessFailure, null)
  assert.equal(found.truncated, true)
})

test('a redirect to another site is not counted as having read the business website', async () => {
  const outcome = await enrichEmailV2('https://acmeplumbing.ca', {
    fetchPage: stubFetcher({ '/': okPage('<a href="mailto:sales@parked-domains.com">buy</a>', 'https://parked-domains.com/') }),
  })
  assert.equal(outcome.best, null)
  assert.equal(outcome.pagesLoaded, 0)
  assert.equal(outcome.coverageClass, 'unanalyzable')
})

test('legacy fetchers that return a page or null keep working', async () => {
  const legacy = async (url) => (new URL(url).pathname === '/' ? { html: '<a href="mailto:info@acmeplumbing.ca">x</a>', resolvedUrl: url } : null)
  const outcome = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: legacy })
  assert.equal(outcome.best.value, 'info@acmeplumbing.ca')
})

// ---------------------------------------------------------------------------------------------
// V2.1: relevance context (credits, testimonials, external providers, privacy contacts)
// ---------------------------------------------------------------------------------------------

test('website-credit lines and testimonials never produce a medium-confidence external address', () => {
  const thirdParty = [
    '<footer><p>Website by <a href="mailto:studio@gmail.com">our designer</a></p></footer>',
    '<footer><p>Site designed by <a href="mailto:hello@gmail.com">Studio</a></p></footer>',
    '<footer><p>Développé par <a href="mailto:dev@hotmail.com">Dev</a></p></footer>',
    '<footer>Powered by <a href="mailto:support@someagency.io">Agency</a></footer>',
    '<blockquote>Great service! <a href="mailto:happy@gmail.com">happy@gmail.com</a></blockquote>',
    '<div class="testimonial-card"><a href="mailto:customer@yahoo.com">Jane</a></div>',
    '<section id="reviews"><a href="mailto:reviewer@outlook.com">r</a></section>',
    '<p>Jane wrote jane.doe88@gmail.com about the visit</p>',
    '<p>Website by jane.designer@gmail.com</p>',
  ]
  for (const html of thirdParty) {
    const found = extract(html)
    assert.ok(found.length > 0, html)
    assert.ok(found.every((candidate) => candidate.emailConfidence === 'low'), html)
  }
})

test('a business mailbox next to ordinary contact wording still earns medium', () => {
  const real = [
    '<p>Questions? <a href="mailto:acmeplumbing@gmail.com">Email us</a></p>',
    '<footer><p>Call 555-0100 · <a href="mailto:acmeplumbing@gmail.com">acmeplumbing@gmail.com</a></p></footer>',
    '<p>Courriel : acmeplumbing@hotmail.com</p>',
    '<div class="contact-info"><a href="mailto:acmeplumbing@outlook.com">Write to us</a></div>',
  ]
  for (const html of real) {
    assert.equal(extract(html)[0].emailConfidence, 'medium', html)
  }
})

test('credit and testimonial context never downgrades an address on the business own domain', () => {
  const found = extract('<footer><p>Website by <a href="mailto:owner@acmeplumbing.ca">us</a></p></footer><blockquote><a href="mailto:info@acmeplumbing.ca">i</a></blockquote>')
  assert.deepEqual(found.map((candidate) => candidate.emailConfidence).sort(), ['high', 'medium'])
})

test('privacy and legal contacts on the business domain keep their normal confidence', () => {
  const html = '<p>Privacy officer: privacy@acmeplumbing.ca. Legal representative: counsel@acmeplumbing.ca</p>'
  const found = extract(html, 'acmeplumbing.ca', 'https://acmeplumbing.ca/privacy-policy')
  assert.deepEqual(found.map((candidate) => candidate.value).sort(), ['counsel@acmeplumbing.ca', 'privacy@acmeplumbing.ca'])
  assert.ok(found.every((candidate) => candidate.relevance === 'business-domain'))
})

test('a third-party privacy or compliance contact is not treated as the business', () => {
  const found = extract('<p>Our data processor: dpo@big-vendor.com, privacy@termly.io</p>')
  assert.ok(found.every((candidate) => candidate.emailConfidence === 'low'))
})

// ---------------------------------------------------------------------------------------------
// V2.1: glued text found on real websites
// ---------------------------------------------------------------------------------------------

test('a label in a neighbouring element is never glued onto the address', () => {
  const html = '<p><span>Email</span><a href="#">hello@acmeplumbing.ca</a></p><div><b>Contact</b><i>info@acmeplumbing.ca</i></div>'
  assert.deepEqual(values(extract(html)), ['hello@acmeplumbing.ca', 'info@acmeplumbing.ca'])
})

test('a phone number in a neighbouring element is not glued onto the address', () => {
  const found = extract('<li><span>+1 514-555-1234</span><span>info@acmeplumbing.ca</span></li><li>8188<a>sales@acmeplumbing.ca</a></li>')
  assert.deepEqual(values(found), ['info@acmeplumbing.ca', 'sales@acmeplumbing.ca'])
})

test('a phone number glued inside one text run is rejected rather than guessed at', () => {
  assert.equal(isRejectedEmail('514-555-1234info@acmeplumbing.ca'), true)
  assert.equal(isRejectedEmail('8188info@acmeplumbing.ca'), false) // too short to prove it is a phone number
  assert.equal(isRejectedEmail('24hours@acmeplumbing.ca'), false)
  assert.deepEqual(extract('<p>Tel 514-555-1234info@acmeplumbing.ca</p>'), [])
})

test('text run together with the page text after the domain is dropped, not reported', () => {
  for (const glued of ['info@acmeplumbing.combook', 'info@acmeplumbing.commidtown', 'info@acmeplumbing.cales', 'info@acmeplumbing.cabook now']) {
    const found = extract(`<p>${glued}</p>`)
    assert.ok(found.every((candidate) => candidate.value === 'info@acmeplumbing.ca' || candidate.value === 'info@acmeplumbing.com'), glued)
    assert.ok(!found.some((candidate) => /combook|commidtown|cales/.test(candidate.value)), glued)
  }
})

test('real top-level domains are still accepted, including new gTLDs and country codes', () => {
  for (const domain of ['acme.com', 'acme.co.uk', 'acme.ca', 'acme.com.au', 'acme.dental', 'acme.clinic', 'acme.agency', 'acme.marketing', 'acme.online', 'acme.io', 'acme.co.th', 'acme.fr', 'acme.de']) {
    assert.ok(normalizeCandidateEmail(`info@${domain}`), domain)
  }
  assert.equal(normalizeCandidateEmail('info@acme.combook'), null)
  assert.equal(normalizeCandidateEmail('info@acme.notatld'), null)
})

test('a weaker text sighting that is a stronger sighting with junk glued in front is suppressed', () => {
  const html = '<a href="mailto:hello@acmeplumbing.ca">Write</a><p>emailhello@acmeplumbing.ca</p>'
  assert.deepEqual(values(extract(html)), ['hello@acmeplumbing.ca'])
  // Two genuinely different addresses on one page are both kept.
  const both = extract('<a href="mailto:info@acmeplumbing.ca">i</a><p>billinginfo@acmeplumbing.ca</p>')
  assert.equal(both.length, 1, 'suffix rule applies only when the shorter address has stronger evidence')
  const independent = extract('<a href="mailto:info@acmeplumbing.ca">i</a><p>sales@acmeplumbing.ca</p>')
  assert.equal(independent.length, 2)
})
