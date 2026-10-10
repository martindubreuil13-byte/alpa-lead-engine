// Business Profile research shares the secure fetch layer with email discovery. These tests run the
// real research code (extractWebsiteSnapshot) through the real pinned transport and through a plain
// fetch against the same local server, and require identical results. Nothing here calls OpenAI,
// Supabase, or any real website.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import { extractWebsiteSnapshot } from '../lib/commercial-intelligence/extract-website-snapshot.ts'
import { createPinnedFetch } from '../lib/commercial-intelligence/pinned-fetch.ts'
import { safeFetchWebsite, WebsiteFetchError } from '../lib/commercial-intelligence/safe-website-fetch.ts'
import { DEFAULT_WEBSITE_USER_AGENT } from '../lib/commercial-intelligence/user-agent.ts'

const LOOPBACK = '127.0.0.1'
const PUBLIC_RESOLVER = async () => ['93.184.216.34']

const PAGES = {
  '/': {
    body: `<html><head><title>Acme Plumbing</title><meta name="description" content="Plumbers in Calgary"></head><body>
      <nav><a href="/about-us">About</a> <a href="/services">Services</a> <a href="/get-in-touch">Contact</a></nav>
      <main><h1>Acme Plumbing</h1><p>Family plumbers serving Calgary since 1998. Emergency repairs, renovations and drain cleaning.</p></main></body></html>`,
  },
  '/about-us': { body: '<main><h2>About us</h2><p>We are a family business with licensed master plumbers.</p></main>', encoding: 'gzip' },
  '/services': { body: '<main><h2>Services</h2><ul><li>Water heaters</li><li>Drain cleaning</li></ul></main>', encoding: 'br' },
  '/get-in-touch': { redirect: '/contact-us' },
  '/contact-us': { body: '<main><h2>Contact</h2><p>Call 403-555-0100 for service.</p></main>', encoding: 'deflate' },
}

function listen(handler) {
  return new Promise((resolve) => {
    const hits = []
    const server = http.createServer((req, res) => {
      hits.push({ url: req.url, userAgent: req.headers['user-agent'], acceptEncoding: req.headers['accept-encoding'] })
      handler(req, res)
    }).listen(0, LOOPBACK, () => resolve({ server, hits, port: server.address().port, close: () => new Promise((done) => (server.closeAllConnections?.(), server.close(done))) }))
  })
}

function sitePages(req, res) {
  const page = PAGES[req.url.split('?')[0]]
  if (!page) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('not found') }
  if (page.redirect) { res.writeHead(301, { location: page.redirect }); return res.end() }
  const encoders = { gzip: zlib.gzipSync, br: zlib.brotliCompressSync, deflate: zlib.deflateSync }
  const headers = { 'content-type': 'text/html; charset=utf-8' }
  let payload = Buffer.from(page.body)
  if (page.encoding && String(req.headers['accept-encoding'] || '').includes(page.encoding)) {
    headers['content-encoding'] = page.encoding
    payload = encoders[page.encoding](payload)
  }
  res.writeHead(200, headers)
  res.end(payload)
}

/** Pinned transport that resolves every name to the local server (the policy allows loopback in tests). */
const pinnedToLocal = () => createPinnedFetch({ resolve: async () => [{ address: LOOPBACK, family: 4 }], isAddressAllowed: () => true })

/** Reference behaviour: Node's own fetch, with the same host mapping. */
const plainToLocal = () => (input, init) => fetch(String(input).replace('site.test', LOOPBACK), { ...init, headers: { ...init?.headers } })

const strip = (result) => JSON.parse(JSON.stringify(result, (key, value) => (key === 'extracted_at' || key === 'duration_ms' ? undefined : value)))

test('the research snapshot is identical through the pinned transport and through plain fetch', async () => {
  const server = await listen(sitePages)
  try {
    const url = `http://site.test:${server.port}/`
    const viaPinned = await extractWebsiteSnapshot(url, { fetchOptions: { fetchImpl: pinnedToLocal(), resolveHostname: PUBLIC_RESOLVER } })
    const viaPlain = await extractWebsiteSnapshot(url, { fetchOptions: { fetchImpl: plainToLocal(), resolveHostname: PUBLIC_RESOLVER } })

    assert.equal(viaPinned.ok, true)
    assert.equal(viaPlain.ok, true)
    assert.deepEqual(strip(viaPinned), strip(viaPlain))

    const kinds = viaPinned.data.research_pages.map((entry) => entry.kind).sort()
    assert.deepEqual(kinds, ['about', 'contact', 'homepage', 'services'], 'gzip, brotli, deflate and a same-site redirect were all read')
    assert.match(viaPinned.data.research_pages.find((entry) => entry.kind === 'contact').text, /403-555-0100/)
    assert.ok(viaPinned.data.html_hash && viaPinned.data.html_hash.length === 64)
  } finally {
    await server.close()
  }
})

test('error codes and messages that research stores are unchanged for HTTP, content and size failures', async () => {
  const server = await listen((req, res) => {
    const route = req.url
    if (route === '/500') { res.writeHead(500); return res.end('boom') }
    if (route === '/404') { res.writeHead(404); return res.end('nope') }
    if (route === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4') }
    if (route === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('x'.repeat(2_000_000)) }
    if (route === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>ok</p>')
  })
  const options = { fetchImpl: pinnedToLocal(), resolveHostname: PUBLIC_RESOLVER }
  const run = (route) => extractWebsiteSnapshot(`http://site.test:${server.port}${route}`, { fetchOptions: options })
  try {
    assert.deepEqual((await run('/500')).error, { code: 'FETCH_FAILED', message: 'Website returned HTTP 500' })
    assert.deepEqual((await run('/404')).error, { code: 'FETCH_FAILED', message: 'Website returned HTTP 404' })
    assert.equal((await run('/pdf')).error.code, 'INVALID_CONTENT_TYPE')
    assert.equal((await run('/big')).error.code, 'RESPONSE_TOO_LARGE', 'default 1 MB cap still rejects instead of truncating')
    assert.equal((await run('/loop')).error.code, 'TOO_MANY_REDIRECTS')
    assert.equal((await extractWebsiteSnapshot('http://127.0.0.1:1/', {})).error.code, 'UNSAFE_URL')
    assert.equal((await extractWebsiteSnapshot('', {})).error.code, 'NO_WEBSITE')
  } finally {
    await server.close()
  }
})

test('connection refusals and timeouts are reported as FETCH_FAILED, as before', async () => {
  const idle = await listen(() => {})
  const closed = await listen(() => {})
  const closedPort = closed.port
  await closed.close()
  try {
    const slow = await extractWebsiteSnapshot(`http://site.test:${idle.port}/`, { fetchOptions: { fetchImpl: pinnedToLocal(), resolveHostname: PUBLIC_RESOLVER, timeoutMs: 150 } })
    assert.equal(slow.ok, false)
    assert.equal(slow.error.code, 'FETCH_FAILED')

    const refused = await extractWebsiteSnapshot(`http://site.test:${closedPort}/`, { fetchOptions: { fetchImpl: pinnedToLocal(), resolveHostname: PUBLIC_RESOLVER } })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'FETCH_FAILED')
  } finally {
    await idle.close()
  }
})

test('the transport never retries: one failing request is exactly one request', async () => {
  const server = await listen((_req, res) => { res.writeHead(503); res.end('busy') })
  try {
    await extractWebsiteSnapshot(`http://site.test:${server.port}/`, { fetchOptions: { fetchImpl: pinnedToLocal(), resolveHostname: PUBLIC_RESOLVER } })
    assert.equal(server.hits.length, 1)
  } finally {
    await server.close()
  }
})

test('research keeps its defaults: strict HTML only, no bot-challenge reinterpretation, 1 MB cap, 3 redirects, 8 s', async () => {
  const challenge = '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'
  const server = await listen((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(challenge) })
  try {
    const page = await safeFetchWebsite(`http://site.test:${server.port}/`, { fetchImpl: pinnedToLocal(), resolveHostname: PUBLIC_RESOLVER })
    assert.equal(page.html, challenge, 'challenge detection is opt-in and off for research')
    assert.equal(typeof page.responseTimeMs, 'number')
    assert.equal(page.statusCode, 200)
    assert.ok(page.url.startsWith('http://site.test:'))
  } finally {
    await server.close()
  }
  const source = fs.readFileSync(new URL('../lib/commercial-intelligence/safe-website-fetch.ts', import.meta.url), 'utf8')
  assert.match(source, /DEFAULT_TIMEOUT_MS = 8_000/)
  assert.match(source, /DEFAULT_MAX_BYTES = 1_000_000/)
  assert.match(source, /DEFAULT_MAX_REDIRECTS = 3/)
})

test('requests identify ALPA by default and the agent is configurable', async () => {
  const server = await listen((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>hi</p>') })
  const options = { fetchImpl: pinnedToLocal(), resolveHostname: PUBLIC_RESOLVER }
  const previous = process.env.ALPA_FETCH_USER_AGENT
  try {
    delete process.env.ALPA_FETCH_USER_AGENT
    await safeFetchWebsite(`http://site.test:${server.port}/`, options)
    process.env.ALPA_FETCH_USER_AGENT = 'AcmeBot-Research/2.1 (+https://example-research.org/bot)'
    await safeFetchWebsite(`http://site.test:${server.port}/`, options)
    process.env.ALPA_FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    await safeFetchWebsite(`http://site.test:${server.port}/`, options)
    await safeFetchWebsite(`http://site.test:${server.port}/`, { ...options, userAgent: 'Explicit-Agent/1.0 (+https://example.org)' })
  } finally {
    if (previous === undefined) delete process.env.ALPA_FETCH_USER_AGENT
    else process.env.ALPA_FETCH_USER_AGENT = previous
    await server.close()
  }
  assert.deepEqual(server.hits.map((hit) => hit.userAgent), [
    DEFAULT_WEBSITE_USER_AGENT,
    'AcmeBot-Research/2.1 (+https://example-research.org/bot)',
    DEFAULT_WEBSITE_USER_AGENT, // an impersonation attempt in configuration is ignored
    'Explicit-Agent/1.0 (+https://example.org)',
  ])
  assert.ok(server.hits.every((hit) => /gzip/.test(hit.acceptEncoding)))
})

test('every research entry point still reaches the network only through safeFetchWebsite', () => {
  for (const file of ['extract-website-snapshot.ts', 'generate-business-signals.ts']) {
    const source = fs.readFileSync(new URL(`../lib/commercial-intelligence/${file}`, import.meta.url), 'utf8')
    assert.match(source, /safeFetchWebsite\(/, file)
    assert.ok(!/[^.\w]fetch\(/.test(source.replace(/safeFetchWebsite\(/g, '')), `${file} must not call fetch() directly`)
  }
  const queue = fs.readFileSync(new URL('../lib/commercial-intelligence/queue-manager.ts', import.meta.url), 'utf8')
  assert.ok(!/safe-website-fetch|pinned-fetch/.test(queue), 'retry policy lives in the queue, not in the transport')
})
