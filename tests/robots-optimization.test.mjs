import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createPinnedFetch } from '../lib/commercial-intelligence/pinned-fetch.ts'
import {
  createRobotsCache,
  interpretRobotsResponse,
  isAllowedByPolicy,
  isPathAllowed,
  parseRobots,
  selectRobotsRules,
} from '../lib/commercial-intelligence/robots.ts'
import { DEFAULT_WEBSITE_USER_AGENT } from '../lib/commercial-intelligence/user-agent.ts'
import { createRobotsFetcher, enrichEmailV2, formatEmailIntelLog } from '../lib/scraper/email-enrichment.ts'

const ALPA = DEFAULT_WEBSITE_USER_AGENT
const LOOPBACK = '127.0.0.1'
const PUBLIC_RESOLVER = async () => ['93.184.216.34']
const rulesFor = (text, agent = ALPA) => selectRobotsRules(parseRobots(text), agent)
const allowed = (text, pathname, agent = ALPA) => isPathAllowed(rulesFor(text, agent), pathname)

// ---------------------------------------------------------------------------------------------
// Parser correctness
// ---------------------------------------------------------------------------------------------

test('user-agent matching: the most specific ALPA group wins, same-agent groups are merged, * is the fallback', () => {
  const text = [
    'User-agent: *', 'Disallow: /',
    'User-agent: alpa', 'Disallow: /generic',
    'User-agent: ALPA-Business-Intelligence', 'Disallow: /specific-1',
    'User-agent: alpa-business-intelligence', 'Disallow: /specific-2', // same agent, separate group: combined
  ].join('\n')
  assert.equal(allowed(text, '/anything-else'), true, 'the specific group replaces * entirely')
  assert.equal(allowed(text, '/specific-1/x'), false)
  assert.equal(allowed(text, '/specific-2/x'), false)
  assert.equal(allowed(text, '/generic/x'), true, 'the shorter "alpa" group is less specific and is not used')
  assert.equal(allowed(text, '/x', 'OtherBot/1.0 (+https://o.org)'), false, 'other agents fall back to *')
  assert.equal(allowed('User-agent: alpa\nDisallow: /a', '/a'), false, 'a product-token prefix names us when it is the best match')
  assert.equal(allowed('User-agent: googlebot\nDisallow: /', '/'), true, 'other crawlers\' rules do not apply to us')
  assert.equal(allowed('User-agent: a\nUser-agent: alpa-business-intelligence\nDisallow: /shared', '/shared'), false, 'several agents can share one group')
})

test('rule precedence: longest match wins, Allow wins ties, wildcards, end anchors and query strings', () => {
  const text = 'User-agent: *\nDisallow: /folder\nAllow: /folder/open\nDisallow: /*.pdf$\nDisallow: /search?q=*\nAllow: /a\nDisallow: /a'
  assert.equal(allowed(text, '/folder/secret'), false)
  assert.equal(allowed(text, '/folder/open/page'), true)
  assert.equal(allowed(text, '/doc.pdf'), false)
  assert.equal(allowed(text, '/doc.pdf?download=1'), true, '$ anchors the end of path + query')
  assert.equal(allowed(text, '/search?q=plumber'), false)
  assert.equal(allowed(text, '/search'), true)
  assert.equal(allowed(text, '/a'), true, 'equal length: Allow wins')
  assert.equal(allowed(text, '/contact'), true)
  assert.equal(allowed('User-agent: *\nDisallow: /contact', '/contact-us'), false, 'rules are prefixes')
  assert.equal(allowed('User-agent: *\nDisallow: /Contact', '/contact'), true, 'paths are case-sensitive')
  assert.equal(allowed('User-agent: *\nDisallow: /', '/'), false)
  assert.equal(allowed('User-agent: *\nDisallow:\n', '/anything'), true, 'an empty Disallow allows everything')
})

test('percent-encoding is compared by octet and sloppy patterns are repaired', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /folder', '/%66older/x'), false)
  assert.equal(allowed('User-agent: *\nDisallow: /a%7Eb', '/a~b'), false)
  assert.equal(allowed('User-agent: *\nDisallow: /a%2fb', '/a%2Fb'), false)
  assert.equal(allowed('User-agent: *\nDisallow: /a%2Fb', '/a/b'), true, 'an encoded slash is not a slash')
  assert.equal(allowed('User-agent: *\nDisallow: private/', '/private/x'), false, '"private/" is read as "/private/"')
})

test('hostile or huge robots.txt files stay cheap and bounded', () => {
  const hostile = `User-agent: *\nDisallow: ${'*a'.repeat(300)}b$`
  const started = performance.now()
  assert.equal(allowed(hostile, `/${'a'.repeat(5000)}`), true)
  assert.ok(performance.now() - started < 200, 'pathological wildcards must not backtrack exponentially')

  const many = `User-agent: *\n${Array.from({ length: 20_000 }, (_, i) => `Disallow: /p${i}`).join('\n')}`
  assert.ok(parseRobots(many)[0].rules.length <= 5_000)
  assert.equal(parseRobots('User-agent: *\r\rDisallow: /x\r')[0].rules.length, 1, 'bare CR line endings are lines')
  assert.equal(parseRobots(`User-agent: *\nDisallow: /${'x'.repeat(5000)}`)[0].rules.length, 0, 'absurdly long patterns are dropped')
})

test('response interpretation: unknown is never permission', () => {
  const kind = (response) => interpretRobotsResponse(response).kind
  assert.equal(kind({ status: 200, body: 'User-agent: *\nDisallow: /x', contentType: 'text/plain' }), 'rules')
  assert.equal(kind({ status: 200, body: '<!doctype html><html><body>Welcome</body></html>', contentType: 'text/html' }), 'allow_all', 'a homepage served for /robots.txt is not a policy')
  assert.equal(kind({ status: 200, body: '{"a":1}', contentType: 'application/json' }), 'unknown')
  for (const status of [404, 410, 401, 403, 418]) assert.equal(kind({ status }), 'allow_all', String(status))
  for (const status of [429, 500, 502, 503, 504]) assert.equal(kind({ status }), 'unknown', String(status))
  for (const status of [301, 302, 100]) assert.equal(kind({ status }), 'unknown', `unfollowed ${status}`)

  assert.equal(isAllowedByPolicy({ kind: 'unknown', reason: 'timeout' }, ALPA, 'https://x.com/'), false)
  assert.equal(isAllowedByPolicy({ kind: 'allow_all', reason: 'not_found' }, ALPA, 'https://x.com/anything'), true)
  const policy = interpretRobotsResponse({ status: 200, body: 'User-agent: *\nDisallow: /private', contentType: 'text/plain' })
  assert.equal(isAllowedByPolicy(policy, ALPA, 'https://x.com/private?x=1'), false, 'query strings are part of the match')
  assert.equal(isAllowedByPolicy(policy, ALPA, 'https://x.com/public?next=/private'), true)
})

// ---------------------------------------------------------------------------------------------
// Cache: expiry, bounds, isolation, in-flight de-duplication
// ---------------------------------------------------------------------------------------------

const policyOf = (text) => interpretRobotsResponse({ status: 200, body: text, contentType: 'text/plain' })

test('cache: hits, misses, TTL expiry and a short TTL for unknown answers', async () => {
  let clock = 0
  const cache = createRobotsCache({ ttlMs: 1000, unknownTtlMs: 100, now: () => clock })
  let loads = 0
  const load = (policy) => async () => (loads += 1, policy)

  await cache.get('https://a.com', load(policyOf('User-agent: *\nDisallow: /x')))
  await cache.get('https://a.com', load(policyOf('never used')))
  assert.equal(loads, 1)
  assert.deepEqual({ hits: cache.stats().hits, misses: cache.stats().misses }, { hits: 1, misses: 1 })

  clock = 999
  await cache.get('https://a.com', load(policyOf('x')))
  assert.equal(loads, 1, 'still fresh just before the TTL')
  clock = 1001
  await cache.get('https://a.com', load(policyOf('User-agent: *\nDisallow: /y')))
  assert.equal(loads, 2, 'expired entries are fetched again')

  await cache.get('https://u.com', load({ kind: 'unknown', reason: 'timeout' }))
  clock += 50
  await cache.get('https://u.com', load({ kind: 'unknown', reason: 'timeout' }))
  assert.equal(loads, 3, 'unknown is reused briefly')
  clock += 60
  await cache.get('https://u.com', load(policyOf('')))
  assert.equal(loads, 4, 'unknown expires quickly, so a transient failure is retried soon')
})

test('cache: bounded size with least-recently-used eviction', async () => {
  const cache = createRobotsCache({ maxEntries: 3 })
  let loads = 0
  const get = (origin) => cache.get(origin, async () => (loads += 1, policyOf('User-agent: *\nDisallow:')))
  for (const origin of ['https://a.com', 'https://b.com', 'https://c.com']) await get(origin)
  await get('https://a.com') // refresh a: b is now the oldest
  await get('https://d.com') // evicts b
  assert.equal(cache.stats().size, 3)
  assert.equal(cache.stats().evictions, 1)
  const before = loads
  await get('https://a.com')
  await get('https://c.com')
  await get('https://d.com')
  assert.equal(loads, before, 'recently used entries survived')
  await get('https://b.com')
  assert.equal(loads, before + 1, 'the evicted entry is simply fetched again')
  for (let i = 0; i < 50; i += 1) await get(`https://bulk${i}.com`)
  assert.ok(cache.stats().size <= 3, 'never grows past its bound')
})

test('cache: origins are isolated (scheme, host, port) and keys are case-insensitive', async () => {
  const cache = createRobotsCache()
  const policies = {
    'https://a.com': policyOf('User-agent: *\nDisallow: /one'),
    'http://a.com': policyOf('User-agent: *\nDisallow: /two'),
    'https://a.com:8443': policyOf('User-agent: *\nDisallow: /three'),
    'https://b.com': policyOf('User-agent: *\nDisallow: /four'),
    'https://www.a.com': policyOf('User-agent: *\nDisallow: /five'),
  }
  for (const [origin, policy] of Object.entries(policies)) await cache.get(origin, async () => policy)
  for (const [origin, policy] of Object.entries(policies)) assert.equal(await cache.get(origin, async () => assert.fail('must be cached')), policy, origin)
  assert.equal(cache.stats().size, 5)
  assert.equal(await cache.get('HTTPS://A.COM/', async () => assert.fail('same origin, different spelling')), policies['https://a.com'])
  assert.equal(isAllowedByPolicy(policies['https://a.com'], ALPA, 'https://b.com/one'), false, 'policy is evaluated for the URL it is given; callers key by origin')
})

test('cache: one cached policy serves different user agents with different answers', async () => {
  const cache = createRobotsCache()
  const policy = policyOf('User-agent: *\nDisallow: /\n\nUser-agent: alpa-business-intelligence\nAllow: /\nDisallow: /private')
  await cache.get('https://a.com', async () => policy)
  const cached = await cache.get('https://a.com', async () => assert.fail('cached'))
  assert.equal(isAllowedByPolicy(cached, ALPA, 'https://a.com/contact'), true)
  assert.equal(isAllowedByPolicy(cached, ALPA, 'https://a.com/private'), false)
  assert.equal(isAllowedByPolicy(cached, 'SomeoneElse/2.0 (+https://s.org)', 'https://a.com/contact'), false)
})

test('cache: concurrent lookups for one origin share a single request; failures are not cached', async () => {
  const cache = createRobotsCache()
  let loads = 0
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const slow = async () => (loads += 1, await gate, policyOf('User-agent: *\nDisallow:'))
  const pending = Array.from({ length: 10 }, () => cache.get('https://a.com', slow))
  release()
  const results = await Promise.all(pending)
  assert.equal(loads, 1)
  assert.ok(results.every((result) => result === results[0]))
  assert.equal(cache.stats().joined, 9)

  const failing = createRobotsCache()
  await assert.rejects(failing.get('https://x.com', async () => { throw new Error('boom') }))
  assert.equal((await failing.get('https://x.com', async () => policyOf(''))).kind, 'rules', 'a failed load is not cached and does not wedge the origin')
})

test('cache: it is an optimisation only, so a fresh process or cleared cache just fetches again', async () => {
  const first = createRobotsCache()
  const second = createRobotsCache() // a new serverless instance starts empty
  let loads = 0
  const load = async () => (loads += 1, policyOf(''))
  await first.get('https://a.com', load)
  await second.get('https://a.com', load)
  first.clear()
  await first.get('https://a.com', load)
  assert.equal(loads, 3)
})

// ---------------------------------------------------------------------------------------------
// The robots fetcher: policy, retry, redirects, shared cache
// ---------------------------------------------------------------------------------------------

function scripted(responses) {
  const seen = []
  const impl = async (url) => {
    const entry = typeof responses === 'function' ? responses(String(url), seen.length) : responses
    seen.push(String(url))
    if (entry instanceof Error) throw entry
    return entry instanceof Response ? entry.clone() : new Response(entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers ?? { 'content-type': 'text/plain' } })
  }
  return { impl, seen }
}

const fetcherFor = (impl, extra = {}) => createRobotsFetcher('acmeplumbing.ca', { fetchImpl: impl, resolveHostname: PUBLIC_RESOLVER, retryDelayMs: 1, ...extra })

test('robots fetcher: fast failures get exactly one retry; timeouts and definite answers get none', async () => {
  const recovering = scripted((_url, count) => (count === 0 ? { status: 503 } : { status: 200, body: 'User-agent: *\nDisallow: /x' }))
  assert.equal((await fetcherFor(recovering.impl)('https://acmeplumbing.ca/')).kind, 'rules')
  assert.equal(recovering.seen.length, 2)

  const dead = scripted({ status: 500 })
  assert.deepEqual(await fetcherFor(dead.impl)('https://acmeplumbing.ca/'), { kind: 'unknown', reason: 'server_error' })
  assert.equal(dead.seen.length, 2, 'one retry, then give up and do not crawl')

  const network = scripted(() => new TypeError('fetch failed'))
  assert.deepEqual(await fetcherFor(network.impl)('https://acmeplumbing.ca/'), { kind: 'unknown', reason: 'network' })
  assert.equal(network.seen.length, 2)

  let attempts = 0
  const hang = (_url, init) => { attempts += 1; return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) }
  assert.deepEqual(await fetcherFor(hang, { timeoutMs: 40 })('https://acmeplumbing.ca/'), { kind: 'unknown', reason: 'timeout' })
  assert.equal(attempts, 1, 'a timeout is not retried: a slow server would only double the wait')

  for (const [status, kind] of [[404, 'allow_all'], [403, 'allow_all'], [429, 'unknown']]) {
    const single = scripted({ status })
    assert.equal((await fetcherFor(single.impl)('https://acmeplumbing.ca/')).kind, kind, String(status))
    assert.equal(single.seen.length, 1, `status ${status} is not retried`)
  }
})

test('robots fetcher: redirects stay on the site, and the canonical origin is reported', async () => {
  const onsite = scripted((url) =>
    url === 'http://acmeplumbing.ca/robots.txt'
      ? new Response(null, { status: 301, headers: { location: 'https://www.acmeplumbing.ca/robots.txt' } })
      : { status: 200, body: 'User-agent: *\nDisallow: /private' }
  )
  const policy = await fetcherFor(onsite.impl)('http://acmeplumbing.ca/')
  assert.equal(policy.kind, 'rules')
  assert.equal(policy.canonicalOrigin, 'https://www.acmeplumbing.ca')

  const offsite = scripted(() => new Response(null, { status: 302, headers: { location: 'https://other-company.com/robots.txt' } }))
  const refused = await fetcherFor(offsite.impl)('https://acmeplumbing.ca/')
  assert.deepEqual(refused, { kind: 'unknown', reason: 'off_site' })
  assert.ok(!offsite.seen.some((url) => url.includes('other-company')), 'an off-site robots.txt is never requested')

  const toPrivate = scripted(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/robots.txt' } }))
  assert.equal((await fetcherFor(toPrivate.impl)('https://acmeplumbing.ca/')).kind, 'unknown')
  assert.equal(toPrivate.seen.length, 1)
})

test('robots fetcher: leads on the same origin share one request; other origins and expired entries fetch again', async () => {
  let clock = 0
  const cache = createRobotsCache({ ttlMs: 1000, now: () => clock })
  const net = scripted({ status: 200, body: 'User-agent: *\nDisallow: /x' })
  const fetch = fetcherFor(net.impl, { cache })

  await Promise.all([fetch('https://acmeplumbing.ca/'), fetch('https://acmeplumbing.ca/location/2'), fetch('https://acmeplumbing.ca/?utm=1')])
  assert.equal(net.seen.length, 1, 'three concurrent leads, one robots.txt request')
  await fetch('https://acmeplumbing.ca/again')
  assert.equal(net.seen.length, 1, 'a later lead on the same origin hits the cache')

  await fetch('http://acmeplumbing.ca/')
  assert.equal(net.seen.length, 2, 'a different origin (scheme) is never served another origin\'s policy')
  clock = 2000
  await fetch('https://acmeplumbing.ca/')
  assert.equal(net.seen.length, 3, 'expired')

  // Injected networks do not use the process-wide cache by default, so tests cannot leak into each other.
  const first = scripted({ status: 200, body: 'User-agent: *\nDisallow: /a' })
  const second = scripted({ status: 200, body: 'User-agent: *\nDisallow: /b' })
  await fetcherFor(first.impl)('https://isolated.example/')
  await fetcherFor(second.impl)('https://isolated.example/')
  assert.equal(first.seen.length + second.seen.length, 2)
})

// ---------------------------------------------------------------------------------------------
// Real sockets: connection pre-opening
// ---------------------------------------------------------------------------------------------

function listen(handler, { tls } = {}) {
  return new Promise((resolve) => {
    const state = { connections: 0, requests: [], sockets: new Set() }
    const server = (tls ? https.createServer(tls, onRequest) : http.createServer(onRequest)).listen(0, LOOPBACK, () => {
      resolve({ server, state, port: server.address().port, close: () => new Promise((done) => (server.closeAllConnections?.(), server.close(done))) })
    })
    server.on(tls ? 'secureConnection' : 'connection', (socket) => {
      state.connections += 1
      state.sockets.add(socket)
      socket.on('close', () => state.sockets.delete(socket))
    })
    function onRequest(req, res) {
      state.requests.push({ url: req.url, at: performance.now(), host: req.headers.host })
      handler(req, res, state)
    }
  })
}

const everythingLocal = (extra = {}) =>
  createPinnedFetch({ resolve: async () => [{ address: LOOPBACK, family: 4 }], isAddressAllowed: () => true, ...extra })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('warm: connections are opened without sending any request, then used by the real requests', async () => {
  const server = await listen((_req, res) => res.end('ok'))
  try {
    const pinned = everythingLocal()
    pinned.warm(`http://acmeplumbing.ca:${server.port}/`, 4)
    await sleep(100)
    assert.equal(server.state.connections, 4, 'four connections are open')
    assert.equal(server.state.requests.length, 0, 'but nothing has been requested')

    const responses = await Promise.all(
      ['/', '/contact', '/contact-us', '/about'].map((pathname) => pinned(`http://acmeplumbing.ca:${server.port}${pathname}`, { redirect: 'manual' }))
    )
    assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ['ok', 'ok', 'ok', 'ok'])
    assert.equal(server.state.connections, 4, 'the requests used the pre-opened connections; no new ones were opened')
    assert.equal(server.state.requests.length, 4)
    assert.deepEqual({ opened: pinned.warmStats().opened, used: pinned.warmStats().used }, { opened: 4, used: 4 })

    await pinned(`http://acmeplumbing.ca:${server.port}/fifth`, { redirect: 'manual' })
    assert.equal(server.state.connections, 5, 'a fifth request opens a normal connection; nothing is pooled or reused')
  } finally {
    await server.close()
  }
})

test('warm: unused connections are closed on request, and expire on their own', async () => {
  const server = await listen((_req, res) => res.end('ok'))
  try {
    const pinned = everythingLocal()
    pinned.warm(`http://acmeplumbing.ca:${server.port}/`, 3)
    await sleep(60)
    assert.equal(server.state.sockets.size, 3)
    pinned.closeWarm()
    await sleep(60)
    assert.equal(server.state.sockets.size, 0, 'closeWarm released them')
    assert.equal(pinned.warmStats().discarded, 3)

    const shortLived = everythingLocal({ warmTtlMs: 40 })
    shortLived.warm(`http://acmeplumbing.ca:${server.port}/`, 2)
    await sleep(200)
    assert.equal(server.state.sockets.size, 0, 'idle warm connections do not outlive their TTL')
  } finally {
    await server.close()
  }
})

test('warm: a pre-opened connection is only used for its own origin', async () => {
  const server = await listen((_req, res) => res.end('ok'))
  try {
    const pinned = everythingLocal()
    pinned.warm(`http://one.test:${server.port}/`, 1)
    await sleep(60)
    await pinned(`http://two.test:${server.port}/`, { redirect: 'manual' })
    assert.equal(pinned.warmStats().used, 0, 'a different hostname did not take the connection opened for another')
    assert.equal(server.state.connections, 2)
    await pinned(`http://one.test:${server.port}/`, { redirect: 'manual' })
    assert.equal(pinned.warmStats().used, 1)
    assert.deepEqual(server.state.requests.map((request) => request.host), [`two.test:${server.port}`, `one.test:${server.port}`])
  } finally {
    await server.close()
  }
})

test('warm: DNS pinning and address safety hold for pre-opened connections', async () => {
  const internal = await listen((_req, res) => res.end('INTERNAL'))
  try {
    // Unsafe by policy: no connection is made at all.
    for (const answer of [[LOOPBACK], ['203.0.113.7', LOOPBACK]]) {
      const guarded = createPinnedFetch({ resolve: async () => answer.map((address) => ({ address, family: 4 })), isAddressAllowed: (address) => address !== LOOPBACK })
      guarded.warm(`http://rebind.test:${internal.port}/`, 2)
      await sleep(60)
      assert.equal(internal.state.connections, 0, answer.join(','))
      await assert.rejects(guarded(`http://rebind.test:${internal.port}/`, { redirect: 'manual' }), (error) => error.code === 'ERR_UNSAFE_ADDRESS')
    }
    // IP literals and unsafe schemes are refused by warm() itself.
    const defaultPolicy = createPinnedFetch({ resolve: async () => [{ address: LOOPBACK, family: 4 }] })
    for (const url of [`http://127.0.0.1:${internal.port}/`, `http://[::1]:${internal.port}/`, `http://[::ffff:7f00:1]:${internal.port}/`, `http://user:pw@acmeplumbing.ca:${internal.port}/`, 'ftp://acmeplumbing.ca/', 'file:///etc/passwd']) {
      defaultPolicy.warm(url, 2)
    }
    defaultPolicy.warm(`http://acmeplumbing.ca:${internal.port}/`, 2) // resolves to loopback, which the default policy refuses
    await sleep(80)
    assert.equal(internal.state.connections, 0)
    assert.equal(defaultPolicy.warmStats().used, 0)

    // The single validated resolution is what the connection uses; the later request does not resolve again.
    let resolutions = 0
    const counting = createPinnedFetch({ resolve: async () => (resolutions += 1, [{ address: LOOPBACK, family: 4 }]), isAddressAllowed: () => true })
    counting.warm(`http://count.test:${internal.port}/`, 1)
    await sleep(60)
    await counting(`http://count.test:${internal.port}/`, { redirect: 'manual' })
    assert.equal(resolutions, 1)
  } finally {
    await internal.close()
  }
})

test('warm: a pre-opened connection the server dropped is replaced by a fresh one, transparently', async () => {
  let first = true
  const server = await listen((_req, res) => res.end('ok'))
  server.server.on('connection', (socket) => {
    if (first) { first = false; setTimeout(() => socket.destroy(), 20) }
  })
  try {
    const pinned = everythingLocal()
    pinned.warm(`http://acmeplumbing.ca:${server.port}/`, 1)
    await sleep(120)
    const response = await pinned(`http://acmeplumbing.ca:${server.port}/`, { redirect: 'manual' })
    assert.equal(await response.text(), 'ok')
  } finally {
    await server.close()
  }
})

function makeCertificate(commonName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpa-tls-'))
  const config = path.join(dir, 'openssl.cnf')
  fs.writeFileSync(config, `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=${commonName}\n[v3]\nsubjectAltName=DNS:${commonName}\nbasicConstraints=critical,CA:TRUE\n`)
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-config', config], { stdio: 'ignore' })
    return { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }
  } catch {
    return null
  }
}

test('warm: TLS certificate and hostname verification still apply to pre-opened connections', async (t) => {
  const pair = makeCertificate('secure.test')
  if (!pair) return t.skip('openssl unavailable')
  const server = await listen((_req, res) => res.end('secure-ok'), { tls: { key: pair.key, cert: pair.cert } })
  try {
    const trusting = everythingLocal({ tls: { ca: pair.cert } })
    trusting.warm(`https://secure.test:${server.port}/`, 2)
    await sleep(250)
    assert.equal(server.state.connections, 2, 'TLS handshakes finished ahead of the requests')
    const good = await trusting(`https://secure.test:${server.port}/`, { redirect: 'manual' })
    assert.equal(await good.text(), 'secure-ok')
    assert.equal(trusting.warmStats().used, 1)
    assert.equal(server.state.connections, 2, 'the request reused the finished handshake')

    // A connection opened for another hostname fails verification and is never handed to a request.
    const wrongName = everythingLocal({ tls: { ca: pair.cert } })
    wrongName.warm(`https://wrong.test:${server.port}/`, 1)
    await sleep(250)
    await assert.rejects(wrongName(`https://wrong.test:${server.port}/`, { redirect: 'manual' }), (error) => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID')

    // Without trust in the certificate, warming cannot be used to get around verification.
    const untrusting = everythingLocal()
    untrusting.warm(`https://secure.test:${server.port}/`, 1)
    await sleep(250)
    await assert.rejects(untrusting(`https://secure.test:${server.port}/`, { redirect: 'manual' }), (error) => /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/.test(String(error.code)))
  } finally {
    await server.close()
  }
  assert.ok(!/rejectUnauthorized\s*:\s*false/.test(fs.readFileSync(new URL('../lib/commercial-intelligence/pinned-fetch.ts', import.meta.url), 'utf8')))
})

// ---------------------------------------------------------------------------------------------
// End to end on local servers: ordering, compliance, redirects, timeouts
// ---------------------------------------------------------------------------------------------

const PAGE = (body) => `<html><body>${body}</body></html>`
function siteHandler({ robots, robotsDelayMs = 0, redirectRobotsTo = null }) {
  return (req, res) => {
    if (req.url === '/robots.txt') {
      if (redirectRobotsTo) { res.writeHead(301, { location: redirectRobotsTo }); return res.end() }
      return setTimeout(() => {
        if (robots === 'hang') return
        res.writeHead(robots.status ?? 200, { 'content-type': 'text/plain' })
        res.end(robots.body ?? '')
      }, robotsDelayMs)
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE(req.url === '/' ? '<a href="mailto:owner@acmeplumbing.ca">mail</a>' : `<p>${req.url}</p>`))
  }
}
const visit = (port, extra = {}) =>
  enrichEmailV2(`http://acmeplumbing.ca:${port}/`, {
    transportOptions: {
      fetchImpl: everythingLocal(), resolveHostname: PUBLIC_RESOLVER, robotsCache: null, robotsTimeoutMs: 200, robotsRetryDelayMs: 5, userAgent: ALPA,
      ...extra,
    },
  })

test('end to end: robots.txt is answered before any page is requested, even though connections were opened early', async () => {
  const server = await listen(siteHandler({ robots: { body: 'User-agent: *\nDisallow:' }, robotsDelayMs: 120 }))
  try {
    const started = performance.now()
    const outcome = await visit(server.port)
    assert.equal(outcome.best.value, 'owner@acmeplumbing.ca')
    const robotsAt = server.state.requests.find((request) => request.url === '/robots.txt').at
    const firstPageAt = Math.min(...server.state.requests.filter((request) => request.url !== '/robots.txt').map((request) => request.at))
    assert.ok(firstPageAt >= robotsAt + 100, `pages (${Math.round(firstPageAt - started)}ms) must wait for the delayed robots.txt answer (${Math.round(robotsAt - started)}ms + 120ms)`)
    assert.equal(server.state.connections, 5, 'one for robots.txt plus four for the page round, all opened together')
    assert.deepEqual(outcome.warmed, { opened: 5, used: 5 })
    assert.equal(outcome.robots, 'rules')
  } finally {
    await server.close()
  }
})

test('end to end: disallowed pages are never requested and unused connections are released', async () => {
  const server = await listen(siteHandler({ robots: { body: 'User-agent: *\nDisallow: /contact\nDisallow: /about' } }))
  try {
    const outcome = await visit(server.port)
    const paths = server.state.requests.map((request) => request.url).sort()
    assert.ok(paths.includes('/') && paths.includes('/robots.txt'))
    assert.ok(!paths.some((url) => url.startsWith('/contact') || url.startsWith('/about')), `requested: ${paths.join(' ')}`)
    assert.equal(outcome.failureCounts.robots, 3)
    await sleep(60)
    assert.equal(server.state.sockets.size, 0, 'no connection is left open after the visit')
  } finally {
    await server.close()
  }
})

test('end to end: a site that disallows everything gets robots.txt and nothing else', async () => {
  const server = await listen(siteHandler({ robots: { body: 'User-agent: *\nDisallow: /' } }))
  try {
    const outcome = await visit(server.port)
    assert.deepEqual(server.state.requests.map((request) => request.url), ['/robots.txt'])
    assert.equal(outcome.accessFailure, 'robots')
    assert.equal(outcome.rounds, 0)
    await sleep(60)
    assert.equal(server.state.sockets.size, 0, 'the connections opened ahead were closed, not left hanging')
  } finally {
    await server.close()
  }
})

test('end to end: a robots.txt that cannot be read means no page is requested', async () => {
  const cases = [
    ['hang', { robots: 'hang' }, 'timeout'],
    ['500', { robots: { status: 500 } }, 'unavailable'],
    ['429', { robots: { status: 429 } }, 'blocked'],
  ]
  for (const [label, config, expected] of cases) {
    const server = await listen(siteHandler(config))
    try {
      const outcome = await visit(server.port)
      assert.equal(server.state.requests.filter((request) => request.url !== '/robots.txt').length, 0, `${label}: no page may be requested`)
      assert.equal(outcome.robots, 'unknown', label)
      assert.equal(outcome.accessFailure, expected, label)
      assert.equal(outcome.coverageClass, 'unanalyzable', label)
      assert.match(formatEmailIntelLog('http://acmeplumbing.ca/', outcome), /robots=unknown:/, label)
    } finally {
      await server.close()
    }
  }
})

test('end to end: a missing or forbidden robots.txt means no policy, so pages are read', async () => {
  for (const status of [404, 403]) {
    const server = await listen(siteHandler({ robots: { status } }))
    try {
      const outcome = await visit(server.port)
      assert.equal(outcome.best?.value, 'owner@acmeplumbing.ca', String(status))
      assert.equal(outcome.robots, 'allow_all')
    } finally {
      await server.close()
    }
  }
})

test('end to end: robots.txt that redirects to the canonical origin moves the page requests there', async () => {
  const canonical = await listen(siteHandler({ robots: { body: 'User-agent: *\nDisallow: /private' } }))
  const legacy = await listen((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(301, { location: `http://www.acmeplumbing.ca:${canonical.port}/robots.txt` }); return res.end() }
    res.writeHead(301, { location: `http://www.acmeplumbing.ca:${canonical.port}${req.url}` })
    res.end()
  })
  try {
    const base = { fetchImpl: everythingLocal(), resolveHostname: PUBLIC_RESOLVER, robotsCache: null, robotsTimeoutMs: 500, userAgent: ALPA }
    const withRebase = await enrichEmailV2(`http://acmeplumbing.ca:${legacy.port}/`, { transportOptions: base })
    assert.equal(withRebase.rebased, true)
    assert.equal(withRebase.best.value, 'owner@acmeplumbing.ca')
    const legacyPages = legacy.state.requests.filter((request) => request.url !== '/robots.txt').length
    assert.equal(legacyPages, 0, 'no page request was wasted on the redirecting origin')

    legacy.state.requests.length = 0
    const without = await enrichEmailV2(`http://acmeplumbing.ca:${legacy.port}/`, { transportOptions: { ...base, fetchImpl: everythingLocal() }, optimizations: { rebase: false } })
    assert.equal(without.rebased, false)
    assert.ok(legacy.state.requests.filter((request) => request.url !== '/robots.txt').length >= 3, 'without it, every page pays the redirect')
  } finally {
    await legacy.close()
    await canonical.close()
  }
})

test('end to end: robots.txt policy follows a redirect only within the site', async () => {
  const other = await listen(siteHandler({ robots: { body: 'User-agent: *\nDisallow:' } }))
  const server = await listen(siteHandler({ robots: {}, redirectRobotsTo: `http://other-company.com:${other.port}/robots.txt` }))
  try {
    const outcome = await visit(server.port)
    assert.equal(outcome.robots, 'unknown')
    assert.equal(outcome.robotsReason, 'off_site')
    assert.equal(other.state.requests.length, 0)
    assert.equal(server.state.requests.filter((request) => request.url !== '/robots.txt').length, 0)
  } finally {
    await server.close()
    await other.close()
  }
})

test('end to end: the same visit gives the same emails with and without the transport optimisations', async () => {
  const server = await listen(siteHandler({ robots: { body: 'User-agent: *\nDisallow: /private' } }))
  try {
    const optimised = await visit(server.port)
    const baseline = await visit(server.port, { fetchImpl: everythingLocal() }).then(async () =>
      enrichEmailV2(`http://acmeplumbing.ca:${server.port}/`, {
        optimizations: { warm: false, rebase: false },
        transportOptions: { fetchImpl: everythingLocal(), resolveHostname: PUBLIC_RESOLVER, robotsCache: null, robotsTimeoutMs: 200, userAgent: ALPA },
      })
    )
    assert.equal(optimised.best.value, baseline.best.value)
    assert.equal(optimised.best.emailConfidence, baseline.best.emailConfidence)
    assert.equal(baseline.warmed.opened, 0)
  } finally {
    await server.close()
  }
})

test('warm: a pre-opened TLS connection has the same handshake as a normal one (no fingerprint difference)', async (t) => {
  const pair = makeCertificate('secure.test')
  if (!pair) return t.skip('openssl unavailable')

  // The server offers ALPN, so it can see whether the client asked for it. A client that adds or drops
  // extensions compared with a normal request is a different TLS fingerprint, which some bot protection
  // treats as a different (and unwelcome) client.
  const seen = []
  const server = await listen((_req, res) => res.end('ok'), { tls: { key: pair.key, cert: pair.cert, ALPNProtocols: ['h2', 'http/1.1'] } })
  server.server.on('secureConnection', (socket) => seen.push({ alpn: socket.alpnProtocol, sni: socket.servername, version: socket.getProtocol(), cipher: socket.getCipher()?.name }))
  try {
    const pinned = everythingLocal({ tls: { ca: pair.cert } })

    await pinned(`https://secure.test:${server.port}/cold`, { redirect: 'manual' }) // a normal, cold request
    pinned.warm(`https://secure.test:${server.port}/`, 1)
    await sleep(250)
    await pinned(`https://secure.test:${server.port}/warm`, { redirect: 'manual' }) // the pre-opened connection
    assert.equal(pinned.warmStats().used, 1)

    assert.equal(seen.length, 2)
    assert.deepEqual(seen[1], seen[0], 'ALPN, SNI, protocol version and cipher match a normal request')
    assert.equal(seen[1].alpn, false, 'no ALPN extension is added')
  } finally {
    await server.close()
  }
  const source = fs.readFileSync(new URL('../lib/commercial-intelligence/pinned-fetch.ts', import.meta.url), 'utf8')
  assert.ok(!/ALPNProtocols/.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'warm sockets must not hand-build a TLS handshake')
})
