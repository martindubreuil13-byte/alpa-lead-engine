import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { extractWebsiteSnapshot } from '../lib/commercial-intelligence/extract-website-snapshot.ts'
import { hasSufficientResearchEvidence } from '../lib/commercial-intelligence/commercial-profile-core.ts'
import { describeIntelligence, summarizeRun, toProfileReason, buildProfileCard } from '../lib/intelligence/run-progress.ts'

const rows = (counts) => Object.entries(counts).flatMap(([state, n]) => Array.from({ length: n }, (_, i) => ({ lead_id: `${state}${i}`, state })))
const NOW = Date.parse('2026-10-12T10:00:00Z')

test('the four outcomes are counted separately, from the run record', () => {
  const summary = summarizeRun(rows({ ready: 7, failed: 3, unavailable: 25 }), NOW)
  const stage = describeIntelligence(summary, true, { noWebsite: 2, overLimit: 23 })
  assert.equal(stage.phase, 'complete')
  assert.equal(stage.headline, '7 business profiles generated')
  assert.equal(stage.detail, '3 research attempts unsuccessful · 23 not researched (run limit) · 2 with no website')
  assert.ok(!/without a website to read/.test(stage.detail)) // the over-limit leads are not described as having no website
  assert.equal(stage.progress, 1) // only the 10 authorized count: complete because none is unresolved
})

test('singular wording, absent categories, and nothing hidden', () => {
  const one = describeIntelligence(summarizeRun(rows({ ready: 9, failed: 1 }), NOW), true, { noWebsite: 0, overLimit: 0 })
  assert.equal(one.detail, '1 research attempt unsuccessful')
  assert.equal(describeIntelligence(summarizeRun(rows({ ready: 10 }), NOW), true, { noWebsite: 0, overLimit: 0 }).detail, '')
  // pending work is still never "complete", whatever was left out
  const running = describeIntelligence(summarizeRun(rows({ ready: 7, researching: 1, unavailable: 25 }), NOW), true, { noWebsite: 2, overLimit: 23 })
  assert.notEqual(running.phase, 'complete')
  assert.ok(running.progress < 1)
})

test('without the run record the old caller still gets a neutral, non-misleading label', () => {
  const stage = describeIntelligence(summarizeRun(rows({ ready: 2, unavailable: 3 }), NOW), true)
  assert.equal(stage.detail, '3 unavailable')
})

test('each business gets its own reason: run limit or no website, from the run record', () => {
  assert.equal(toProfileReason('unavailable', null, 'skipped_limit'), 'run_limit')
  assert.equal(toProfileReason('unavailable', null, 'skipped_existing'), 'run_limit')
  assert.equal(toProfileReason('unavailable', null, 'unavailable_no_website'), 'no_website')
  assert.equal(toProfileReason('unavailable', null), null)
  assert.equal(toProfileReason('failed', 'x', 'queued'), 'research_failed')
  assert.equal(toProfileReason('ready', null, 'queued'), null)
})

const publicHost = async () => ['93.184.216.34']
// Filler is realistic markup (many small elements), not one unbroken run of characters.
const page = (text, fillerBytes = 0) => `<html><head><title>Big Co</title></head><body><main><h1>Big Co</h1><p>${text}</p></main>${'<script>var tracker=1;</script>\n'.repeat(Math.ceil(fillerBytes / 33))}</body></html>`
const respond = (html) => async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
const COPY = 'Big Co builds custom software for logistics companies and offers integration, analytics and support services. '.repeat(8)

test('an oversized page used to fail the whole profile; with truncation it is read up to the limit and flagged', async () => {
  const huge = page(COPY, 1_500_000) // well over the 1 MB read limit
  const strict = await extractWebsiteSnapshot('https://bigco.example', { fetchOptions: { fetchImpl: respond(huge), resolveHostname: publicHost } })
  assert.equal(strict.ok, false)
  assert.match(strict.error.message, /exceeded the size limit/)

  const truncating = await extractWebsiteSnapshot('https://bigco.example', { fetchOptions: { fetchImpl: respond(huge), resolveHostname: publicHost, truncateAtMaxBytes: true } })
  assert.equal(truncating.ok, true)
  assert.equal(truncating.data.content_truncated, true)
  assert.match(truncating.data.research_pages[0].text, /custom software for logistics/)
  assert.equal(hasSufficientResearchEvidence(truncating.data), true)
})

test('a normal page is unaffected and is not flagged', async () => {
  const normal = await extractWebsiteSnapshot('https://bigco.example', { fetchOptions: { fetchImpl: respond(page(COPY)), resolveHostname: publicHost, truncateAtMaxBytes: true } })
  assert.equal(normal.ok, true)
  assert.equal('content_truncated' in normal.data, false)
})

test('truncated content with too little readable text still produces no profile: nothing is invented', async () => {
  const hollow = `<html><body><main><p>Welcome</p></main>${'<script>var tracker=1;</script>\n'.repeat(45_000)}</body></html>`
  const result = await extractWebsiteSnapshot('https://bigco.example', { fetchOptions: { fetchImpl: respond(hollow), resolveHostname: publicHost, truncateAtMaxBytes: true } })
  assert.equal(result.ok, true)
  assert.equal(hasSufficientResearchEvidence(result.data), false) // the existing evidence guard stops generation
})

test('the profile card says when a page was only read in part', () => {
  const card = buildProfileCard({ commercial_profile: { summary: 'Big Co builds software.' }, website_snapshot: { content_truncated: true, research_pages: [{ kind: 'homepage' }] } })
  assert.ok(card.limitations.some((line) => /read in part/.test(line)))
  assert.ok(!buildProfileCard({ commercial_profile: { summary: 'Big Co builds software.' }, website_snapshot: {} }).limitations.some((line) => /read in part/.test(line)))
})

test('both research fetches use truncation, with the 1 MB limit and the 5 s timeout unchanged', () => {
  for (const file of ['lib/commercial-intelligence/enrich-lead-direct.ts', 'lib/commercial-intelligence/generate-business-signals.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /truncateAtMaxBytes: true/, file)
    assert.match(source, /totalTimeoutMs: RESEARCH_FETCH_TIMEOUT_MS/, file)
    assert.ok(!/maxBytes/.test(source), file)
  }
  assert.match(readFileSync('lib/commercial-intelligence/safe-website-fetch.ts', 'utf8'), /DEFAULT_MAX_BYTES = 1_000_000/)
})

test('a long unbroken run (an inline base64 image) cannot stall the parser: it stays fast and still finds a real address', async () => {
  const blob = `<img src="data:image/png;base64,${'A'.repeat(900_000)}">`
  const html = `<html><head><title>Big Co</title></head><body><main><h1>Big Co</h1><p>${COPY} Write to sales@bigco.example today.</p></main>${blob}</body></html>`
  const started = Date.now()
  const result = await extractWebsiteSnapshot('https://bigco.example', { fetchOptions: { fetchImpl: respond(html), resolveHostname: publicHost, truncateAtMaxBytes: true } })
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started}ms`) // was minutes before the lookbehind
  assert.equal(result.ok, true)
  assert.equal(result.data.visible_email, 'sales@bigco.example')
})

test('the same lookbehind guards the business-signals scan', () => {
  const source = readFileSync('lib/commercial-intelligence/generate-business-signals.ts', 'utf8')
  assert.match(source, /emailRegex = \/\(\?<!\[a-zA-Z0-9\._%\+-\]\)/)
  const regex = /(?<![a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  const started = Date.now()
  assert.equal(regex.test('A'.repeat(900_000)), false)
  assert.ok(Date.now() - started < 1000)
  assert.equal(regex.test('write to jane.doe+x@mail.example.com now'), true)
})
