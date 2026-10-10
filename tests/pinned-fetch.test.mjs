import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import { isNonPublicAddress, parseIPv6 } from '../lib/commercial-intelligence/ip-safety.ts'
import {
  createPinnedFetch,
  createValidatingLookup,
  pinnedFetch,
  UnsafeAddressError,
} from '../lib/commercial-intelligence/pinned-fetch.ts'
import {
  looksLikeBotChallenge,
  safeFetchWebsite,
  WebsiteFetchError,
} from '../lib/commercial-intelligence/safe-website-fetch.ts'

const PUBLIC_RESOLVER = async () => ['93.184.216.34']
const LOOPBACK = '127.0.0.1'

// Test policy: pretend loopback is the "internal network" we must protect, and treat a
// TEST-NET address as the attacker's "public" answer. (The real policy is isNonPublicAddress.)
const LOOPBACK_IS_INTERNAL = (address) => address !== LOOPBACK
const LOOPBACK_IS_ALLOWED = () => true

function listen(handler, { tls } = {}) {
  return new Promise((resolve) => {
    const hits = { count: 0, urls: [], hosts: [] }
    const server = (tls ? https.createServer(tls, wrap) : http.createServer(wrap)).listen(0, LOOPBACK, () => {
      resolve({ server, hits, port: server.address().port, close: () => new Promise((done) => (server.closeAllConnections?.(), server.close(done))) })
    })
    function wrap(req, res) {
      hits.count += 1
      hits.urls.push(req.url)
      hits.hosts.push(req.headers.host)
      handler(req, res)
    }
  })
}

const sequence = (...answers) => {
  let calls = 0
  const resolve = async () => answers[Math.min(calls++, answers.length - 1)].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  return { resolve, calls: () => calls }
}

// ---------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------

test('classifies IPv4 ranges: private, loopback, link-local, multicast and reserved are refused', () => {
  const unsafe = [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.255.254',
    '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.10', '192.168.0.1',
    '192.168.255.255', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.255',
    '240.0.0.1', '255.255.255.255',
  ]
  const safe = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.169.0.1', '198.20.0.1', '11.0.0.1', '223.255.255.255']
  for (const address of unsafe) assert.equal(isNonPublicAddress(address), true, address)
  for (const address of safe) assert.equal(isNonPublicAddress(address), false, address)
})

test('classifies IPv6 ranges, including every textual form of IPv4-mapped addresses', () => {
  const unsafe = [
    '::', '::1', '0:0:0:0:0:0:0:1', 'fe80::1', 'fe80::abcd%en0', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', 'ff00::',
    '2001:db8::1', '2001::1', 'fec0::1', '100::1', '::7f00:1', // IPv4-compatible
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:7f00:0001',
    '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:192.168.1.1', '::ffff:c0a8:101',
    '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b:1::1', '2002:7f00:1::1', '2002::1', '3fff::1', '5f00::1', '[::1]',
  ]
  const safe = ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808']
  for (const address of unsafe) assert.equal(isNonPublicAddress(address), true, address)
  for (const address of safe) assert.equal(isNonPublicAddress(address), false, address)
})

test('treats anything that is not a valid IP literal as non-public', () => {
  for (const value of ['', 'abc', 'localhost', '999.1.1.1', '127.1', '1.2.3', '2130706433', '0x7f000001', '1.2.3.4.5', ':::', 'gggg::1', null, undefined]) {
    assert.equal(isNonPublicAddress(value), true, String(value))
  }
})

test('parses IPv6 into bytes correctly', () => {
  assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
  assert.deepEqual(parseIPv6('::ffff:1.2.3.4').slice(10), [0xff, 0xff, 1, 2, 3, 4])
  assert.deepEqual(parseIPv6('2001:db8::ff00:42:8329').slice(0, 4), [0x20, 0x01, 0x0d, 0xb8])
  assert.equal(parseIPv6('1:2:3:4:5:6:7:8:9'), null)
  assert.equal(parseIPv6('not-an-ip'), null)
})

// ---------------------------------------------------------------------------------------------
// The validating lookup (the only name resolution a pinned connection performs)
// ---------------------------------------------------------------------------------------------

test('lookup resolves once, returns the validated address and supports both callback shapes', async () => {
  const { resolve, calls } = sequence(['93.184.216.34'])
  const lookup = createValidatingLookup({ resolve })

  const single = await new Promise((done, fail) => lookup('example.test', {}, (error, address, family) => (error ? fail(error) : done({ address, family }))))
  assert.deepEqual(single, { address: '93.184.216.34', family: 4 })

  const all = await new Promise((done, fail) => lookup('example.test', { all: true }, (error, addresses) => (error ? fail(error) : done(addresses))))
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }])
  assert.equal(calls(), 2, 'one resolution per connection attempt, never an extra check')
})

test('lookup refuses a set that contains any non-public address', async () => {
  const cases = [
    ['127.0.0.1'], ['169.254.169.254'], ['10.0.0.5'], ['::1'], ['::ffff:7f00:1'], ['fe80::1'],
    ['93.184.216.34', '10.0.0.5'], // mixed answers are a classic rebinding setup
    ['2606:4700:4700::1111', '127.0.0.1'],
  ]
  for (const addresses of cases) {
    const lookup = createValidatingLookup({ resolve: sequence(addresses).resolve })
    const error = await new Promise((done) => lookup('evil.test', { all: true }, (failure) => done(failure)))
    assert.ok(error instanceof UnsafeAddressError, addresses.join(','))
    assert.equal(error.code, 'ERR_UNSAFE_ADDRESS')
  }
})

// ---------------------------------------------------------------------------------------------
// DNS rebinding, with real sockets
// ---------------------------------------------------------------------------------------------

/** The vulnerable pattern: resolve + check, then let the HTTP client resolve again on its own. */
function naiveValidateThenFetch(url, resolve, isAllowed) {
  return new Promise(async (done, fail) => {
    const target = new URL(url)
    const checked = await resolve(target.hostname)
    if (checked.some(({ address }) => !isAllowed(address))) return fail(new Error('blocked by pre-check'))

    http
      .get(
        url,
        {
          lookup: (hostname, options, callback) =>
            resolve(hostname).then((addresses) =>
              options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)
            ),
        },
        (res) => {
          let body = ''
          res.on('data', (chunk) => (body += chunk))
          res.on('end', () => done(body))
        }
      )
      .on('error', fail)
  })
}

test('REBINDING: a validate-then-fetch implementation is defeated, the pinned fetch is not', async () => {
  const internal = await listen((_req, res) => res.end('INTERNAL-SECRET'))
  try {
    // Attacker DNS: first answer is "public", every later answer is the internal address.
    const attack = () => sequence(['203.0.113.7'], [LOOPBACK])
    const isAllowed = LOOPBACK_IS_INTERNAL

    // 1. The naive pattern passes its pre-check on the first answer, then connects to the second.
    const naive = attack()
    const leaked = await naiveValidateThenFetch(
      `http://rebind.test:${internal.port}/`,
      async (hostname) => naive.resolve(hostname),
      isAllowed
    )
    assert.equal(leaked, 'INTERNAL-SECRET', 'the attack works against validate-then-fetch')
    assert.equal(internal.hits.count, 1)

    // 2. The pinned fetch has no separate check: its single resolution is the one validated and
    //    used. Whatever the attacker answers later is never consulted, so the loopback address is
    //    refused outright when it is the (validated) answer, and never reached otherwise.
    internal.hits.count = 0
    const pinnedSecond = sequence([LOOPBACK])
    const pinned = createPinnedFetch({ resolve: pinnedSecond.resolve, isAddressAllowed: isAllowed })
    await assert.rejects(pinned(`http://rebind.test:${internal.port}/`, { redirect: 'manual' }), (error) => error.code === 'ERR_UNSAFE_ADDRESS')
    assert.equal(internal.hits.count, 0, 'internal service must never receive a request')
  } finally {
    await internal.close()
  }
})

test('REBINDING: the connection uses the validated address and the name is never resolved again', async () => {
  const target = await listen((_req, res) => res.end('ok'))
  try {
    // Validated answer is loopback (allowed by this test's policy). Any second resolution
    // would return an address that is unsafe by the same policy.
    const answers = sequence([LOOPBACK], ['10.9.9.9'], ['10.9.9.9'])
    const pinned = createPinnedFetch({ resolve: answers.resolve, isAddressAllowed: LOOPBACK_IS_ALLOWED })

    const response = await pinned(`http://pinned.test:${target.port}/page`, { redirect: 'manual' })
    assert.equal(await response.text(), 'ok')
    assert.equal(answers.calls(), 1, 'exactly one resolution for the connection')
    assert.deepEqual(target.hits.hosts, [`pinned.test:${target.port}`], 'Host header keeps the original name')
    assert.equal(target.hits.count, 1)
  } finally {
    await target.close()
  }
})

test('REBINDING: mixed public/private answers and private-only answers never reach the socket', async () => {
  const internal = await listen((_req, res) => res.end('INTERNAL'))
  try {
    for (const answer of [[LOOPBACK], ['203.0.113.7', LOOPBACK], [LOOPBACK, '203.0.113.7']]) {
      const pinned = createPinnedFetch({ resolve: sequence(answer).resolve, isAddressAllowed: LOOPBACK_IS_INTERNAL })
      await assert.rejects(pinned(`http://mixed.test:${internal.port}/`, { redirect: 'manual' }), (error) => error.code === 'ERR_UNSAFE_ADDRESS', answer.join(','))
    }
    assert.equal(internal.hits.count, 0)
  } finally {
    await internal.close()
  }
})

test('IP literals are validated even though they skip name resolution', async () => {
  const internal = await listen((_req, res) => res.end('INTERNAL'))
  try {
    const guarded = createPinnedFetch({ resolve: sequence([LOOPBACK]).resolve }) // default policy
    for (const url of [
      `http://127.0.0.1:${internal.port}/`, `http://[::1]:${internal.port}/`, `http://[::ffff:7f00:1]:${internal.port}/`,
      `http://[::ffff:127.0.0.1]:${internal.port}/`, `http://2130706433:${internal.port}/`, `http://0x7f.1:${internal.port}/`,
      `http://0177.0.0.1:${internal.port}/`, 'http://169.254.169.254/latest/meta-data/', 'http://[fe80::1]/', 'http://10.1.2.3/',
    ]) {
      await assert.rejects(guarded(url, { redirect: 'manual' }), (error) => error.code === 'ERR_UNSAFE_ADDRESS', url)
    }
    assert.equal(internal.hits.count, 0)
  } finally {
    await internal.close()
  }
})

test('safeFetchWebsite with the default transport refuses unsafe URLs before any connection', async () => {
  const internal = await listen((_req, res) => res.end('INTERNAL'))
  try {
    const urls = [
      `http://127.0.0.1:${internal.port}/`, `http://localhost:${internal.port}/`, `http://localhost.:${internal.port}/`,
      `http://[::1]:${internal.port}/`, `http://[::ffff:7f00:1]:${internal.port}/`, `http://2130706433:${internal.port}/`,
      `http://0x7f.1:${internal.port}/`, `http://user:pw@127.0.0.1:${internal.port}/`, 'ftp://example.com/', 'file:///etc/passwd',
      'gopher://example.com/', 'javascript:alert(1)', 'http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/',
      'http://printer.local/', 'http://[fd00::1]/',
    ]
    for (const url of urls) {
      await assert.rejects(safeFetchWebsite(url), (error) => error instanceof WebsiteFetchError && ['UNSAFE_URL', 'INVALID_URL'].includes(error.code) && error.failure === 'unsafe', url)
    }
    assert.equal(internal.hits.count, 0, 'no unsafe URL may produce a connection')
  } finally {
    await internal.close()
  }
})

// ---------------------------------------------------------------------------------------------
// Redirect validation
// ---------------------------------------------------------------------------------------------

function redirecting(locations) {
  const requested = []
  const impl = async (input) => {
    requested.push(String(input))
    const next = locations[requested.length - 1]
    return next
      ? new Response(null, { status: 302, headers: { location: next } })
      : new Response('<p>final</p>', { headers: { 'content-type': 'text/html' } })
  }
  return { impl, requested }
}

test('every redirect destination is validated before it is requested', async () => {
  const targets = [
    'http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/admin', 'http://[::1]/', 'http://[::ffff:7f00:1]/',
    'http://10.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://localhost/', 'file:///etc/passwd', 'ftp://example.com/',
    'http://user:pw@example.com/', 'http://[fe80::1]/', 'http://metadata.internal/',
  ]
  for (const target of targets) {
    const hops = redirecting([target])
    await assert.rejects(
      safeFetchWebsite('https://acmeplumbing.ca/', { fetchImpl: hops.impl, resolveHostname: PUBLIC_RESOLVER }),
      (error) => error instanceof WebsiteFetchError && ['UNSAFE_URL', 'INVALID_URL'].includes(error.code),
      target
    )
    assert.equal(hops.requested.length, 1, `${target} must not be requested`)
  }
})

test('a redirect to a hostname that resolves privately is refused at the redirect hop', async () => {
  const hops = redirecting(['https://rebind.acmeplumbing.ca/'])
  const resolver = async (hostname) => (hostname.startsWith('rebind.') ? ['10.1.2.3'] : ['93.184.216.34'])
  await assert.rejects(
    safeFetchWebsite('https://acmeplumbing.ca/', { fetchImpl: hops.impl, resolveHostname: resolver }),
    (error) => error.code === 'UNSAFE_URL'
  )
  assert.equal(hops.requested.length, 1)
})

test('redirect limit and same-site policy are enforced', async () => {
  const loop = redirecting(Array(10).fill('https://acmeplumbing.ca/next'))
  await assert.rejects(
    safeFetchWebsite('https://acmeplumbing.ca/', { fetchImpl: loop.impl, resolveHostname: PUBLIC_RESOLVER, maxRedirects: 3 }),
    (error) => error.code === 'TOO_MANY_REDIRECTS'
  )
  assert.equal(loop.requested.length, 4)

  const offsite = redirecting(['https://other-business.com/'])
  await assert.rejects(
    safeFetchWebsite('https://acmeplumbing.ca/', {
      fetchImpl: offsite.impl, resolveHostname: PUBLIC_RESOLVER, isRedirectAllowed: (target) => target.hostname.endsWith('acmeplumbing.ca'),
    }),
    (error) => error.code === 'UNSAFE_URL'
  )
  assert.equal(offsite.requested.length, 1)

  const relative = redirecting(['/moved', 'https://www.acmeplumbing.ca/final'])
  const result = await safeFetchWebsite('https://acmeplumbing.ca/', { fetchImpl: relative.impl, resolveHostname: PUBLIC_RESOLVER })
  assert.equal(result.url, 'https://www.acmeplumbing.ca/final')
})

test('the pinned fetch validates redirects it follows itself, hop by hop', async () => {
  const internal = await listen((_req, res) => res.end('INTERNAL'))
  const front = await listen((_req, res) => {
    res.writeHead(302, { location: `http://hop2.test:${internal.port}/secret` })
    res.end()
  })
  try {
    // hop1.test resolves to an allowed address; hop2.test resolves to a forbidden one.
    const pinned = createPinnedFetch({
      resolve: async (hostname) => [{ address: hostname === 'hop1.test' ? LOOPBACK : '10.9.9.9', family: 4 }],
      isAddressAllowed: (address) => address === LOOPBACK,
    })
    await assert.rejects(pinned(`http://hop1.test:${front.port}/`), (error) => error.code === 'ERR_UNSAFE_ADDRESS')
    assert.equal(front.hits.count, 1, 'the first hop was legitimately requested')
    assert.equal(internal.hits.count, 0, 'the redirect target must never be contacted')
  } finally {
    await front.close()
    await internal.close()
  }
})

// ---------------------------------------------------------------------------------------------
// TLS: certificate and hostname verification stay on
// ---------------------------------------------------------------------------------------------

function makeCertificate(commonName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpa-tls-'))
  const config = path.join(dir, 'openssl.cnf')
  fs.writeFileSync(
    config,
    `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=${commonName}\n[v3]\nsubjectAltName=DNS:${commonName}\nbasicConstraints=critical,CA:TRUE\n`
  )
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-config', config], { stdio: 'ignore' })
    return { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }
  } catch {
    return null
  }
}

test('TLS: the certificate must match the requested hostname (and cannot be skipped)', async (t) => {
  const pair = makeCertificate('secure.test')
  if (!pair) return t.skip('openssl unavailable')

  const server = await listen((_req, res) => res.end('secure-ok'), { tls: { key: pair.key, cert: pair.cert } })
  const resolve = async () => [{ address: LOOPBACK, family: 4 }]
  try {
    const trusting = createPinnedFetch({ resolve, isAddressAllowed: LOOPBACK_IS_ALLOWED, tls: { ca: pair.cert } })

    const good = await trusting(`https://secure.test:${server.port}/`, { redirect: 'manual' })
    assert.equal(await good.text(), 'secure-ok')

    // Same server, same certificate, different hostname: must fail hostname verification.
    await assert.rejects(trusting(`https://wrong.test:${server.port}/`, { redirect: 'manual' }), (error) => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID')

    // A certificate the client does not trust must fail (no silent fallback).
    const untrusting = createPinnedFetch({ resolve, isAddressAllowed: LOOPBACK_IS_ALLOWED })
    await assert.rejects(untrusting(`https://secure.test:${server.port}/`, { redirect: 'manual' }), (error) => /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/.test(String(error.code)))
  } finally {
    await server.close()
  }

  const source = fs.readFileSync(new URL('../lib/commercial-intelligence/pinned-fetch.ts', import.meta.url), 'utf8')
  assert.ok(!/rejectUnauthorized\s*:\s*false/.test(source), 'TLS verification must not be disabled')
  assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED/.test(source))
})

// ---------------------------------------------------------------------------------------------
// Transport behaviour: compression, size limits, timeouts, classification
// ---------------------------------------------------------------------------------------------

function policyFetch(port) {
  // Resolves every name to loopback; the shared pre-check resolver pretends names are public.
  return createPinnedFetch({ resolve: async () => [{ address: LOOPBACK, family: 4 }], isAddressAllowed: LOOPBACK_IS_ALLOWED })
}

const fetchSite = (port, pathName, options = {}) =>
  safeFetchWebsite(`http://site.test:${port}${pathName}`, {
    fetchImpl: policyFetch(port),
    resolveHostname: PUBLIC_RESOLVER,
    ...options,
  })

test('decompresses gzip, deflate and brotli responses', async () => {
  const html = '<p>hello contact@acmeplumbing.ca</p>'
  const server = await listen((req, res) => {
    const encoding = req.url.slice(1)
    const encoders = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync }
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': encoding })
    res.end(encoders[encoding](html))
  })
  try {
    for (const encoding of ['gzip', 'deflate', 'br']) {
      assert.equal((await fetchSite(server.port, `/${encoding}`)).html, html, encoding)
    }
  } finally {
    await server.close()
  }
})

test('a decompression bomb is cut off by the size limit and the connection is torn down', async () => {
  let closed = 0
  const server = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
    req.socket.on('close', () => (closed += 1))
    res.end(zlib.gzipSync(Buffer.alloc(50_000_000, 'a'))) // ~50 KB on the wire, 50 MB decoded
  })
  try {
    await assert.rejects(fetchSite(server.port, '/', { maxBytes: 100_000 }), (error) => error.code === 'RESPONSE_TOO_LARGE' && error.failure === 'too_large')

    const partial = await fetchSite(server.port, '/', { maxBytes: 100_000, truncateAtMaxBytes: true })
    assert.equal(partial.truncated, true)
    assert.equal(partial.html.length, 100_000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(closed >= 1, 'socket must be closed after the limit is hit')
  } finally {
    await server.close()
  }
})

test('classifies timeouts, blocks, unavailable sites and unsupported content', async () => {
  const server = await listen((req, res) => {
    const url = req.url
    if (url === '/hang') return // never answers
    if (url === '/slow-body') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<p>start')
      return // headers sent, body never finishes
    }
    if (url === '/forbidden') { res.writeHead(403, { 'content-type': 'text/html' }); return res.end('<html>nope</html>') }
    if (url === '/ratelimit') { res.writeHead(429); return res.end('slow down') }
    if (url === '/cf-503') { res.writeHead(503, { 'content-type': 'text/html' }); return res.end('<title>Just a moment...</title><div id="cf-browser-verification"></div>') }
    if (url === '/cf-200') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>') }
    if (url === '/error') { res.writeHead(500); return res.end('boom') }
    if (url === '/missing') { res.writeHead(404); return res.end('gone') }
    if (url === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF') }
    if (url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}') }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><head><title>Acme Plumbing</title></head><body>Hi</body></html>')
  })
  const opts = { detectBotChallenge: true }
  const failureOf = async (pathName, extra = {}) => {
    try {
      await fetchSite(server.port, pathName, { ...opts, ...extra })
      return 'ok'
    } catch (error) {
      assert.ok(error instanceof WebsiteFetchError, `${pathName}: ${error}`)
      return `${error.failure}${error.statusCode ? `:${error.statusCode}` : ''}`
    }
  }
  try {
    assert.equal(await failureOf('/hang', { timeoutMs: 120 }), 'timeout')
    assert.equal(await failureOf('/slow-body', { timeoutMs: 120 }), 'timeout')
    assert.equal(await failureOf('/forbidden'), 'blocked:403')
    assert.equal(await failureOf('/ratelimit'), 'blocked:429')
    assert.equal(await failureOf('/cf-503'), 'blocked:503')
    assert.equal(await failureOf('/cf-200'), 'blocked:200')
    assert.equal(await failureOf('/error'), 'unavailable:500')
    assert.equal(await failureOf('/missing'), 'unavailable:404')
    assert.equal(await failureOf('/pdf'), 'unsupported')
    assert.equal(await failureOf('/json', { lenientContentType: true }), 'unsupported')
    assert.equal(await failureOf('/'), 'ok')
    // Challenge detection is opt-in so existing callers keep their behaviour.
    assert.equal(await failureOf('/cf-200', { detectBotChallenge: false }), 'ok')
  } finally {
    await server.close()
  }
})

test('connection failures are classified as unavailable, not as unsafe', async () => {
  const closed = await listen((_req, res) => res.end('x'))
  const port = closed.port
  await closed.close()

  const refused = await safeFetchWebsite(`http://site.test:${port}/`, { fetchImpl: policyFetch(port), resolveHostname: PUBLIC_RESOLVER }).catch((error) => error)
  assert.ok(refused instanceof WebsiteFetchError)
  assert.equal(refused.failure, 'unavailable')

  const unresolved = await safeFetchWebsite('https://no-such-host.invalid-tld-test/', { resolveHostname: async () => { throw new WebsiteFetchError('FETCH_FAILED', 'Website hostname could not be resolved') } }).catch((error) => error)
  assert.equal(unresolved.failure, 'unavailable')
})

test('recognises bot-challenge interstitials without flagging ordinary pages', () => {
  assert.equal(looksLikeBotChallenge('<title>Just a moment...</title>'), true)
  assert.equal(looksLikeBotChallenge('<title>Attention Required! | Cloudflare</title>'), true)
  assert.equal(looksLikeBotChallenge('<html><body><div id="cf-browser-verification">Checking your browser before accessing the site.</div></body></html>'), true)
  assert.equal(looksLikeBotChallenge('<html><head><title>Blocked</title></head></html>', new Headers({ 'cf-mitigated': 'challenge' })), true)
  assert.equal(looksLikeBotChallenge('<html><head><title>Acme Plumbing</title></head><body>Contact us. This form is protected by reCAPTCHA.</body></html>'), false)
  assert.equal(looksLikeBotChallenge(`<title>Just a moment</title>${'x'.repeat(70_000)}`), false, 'large pages are real content')
})

test('the shared default transport is the pinned fetch', async () => {
  assert.equal(typeof pinnedFetch, 'function')
  const source = fs.readFileSync(new URL('../lib/commercial-intelligence/safe-website-fetch.ts', import.meta.url), 'utf8')
  assert.match(source, /options\.fetchImpl \?\? pinnedFetch/)
})

test('bot-challenge detection catches interstitials but not ordinary Cloudflare-fronted pages', () => {
  // Interstitials seen on real small-business sites.
  assert.equal(looksLikeBotChallenge('<html><head><title>One moment, please...</title></head><body>Please wait while your request is being verified...</body></html>'), true)
  assert.equal(looksLikeBotChallenge('<html><head><title>Just a moment...</title></head></html>'), true)
  assert.equal(looksLikeBotChallenge('<form id="challenge-form" action="/?__cf_chl_f_tk=abc"></form>'), true)

  // Cloudflare injects this script into perfectly normal pages; it must never count as a challenge.
  const normal = `<html><head><title>Acme Plumbing — Calgary</title></head><body><p>Contact us</p>
    <script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.head.appendChild(a)})()</script>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`
  assert.equal(looksLikeBotChallenge(normal), false)
})

// ---------------------------------------------------------------------------------------------
// Name resolution is time-bounded and shared
// ---------------------------------------------------------------------------------------------

test('a name lookup that never answers fails within the deadline instead of hanging the request', async () => {
  const hung = () => new Promise(() => {})

  const started = performance.now()
  const error = await safeFetchWebsite('https://acmeplumbing.ca/', { resolveHostname: hung, timeoutMs: 80 }).catch((failure) => failure)
  assert.ok(error instanceof WebsiteFetchError)
  assert.equal(error.failure, 'timeout')
  assert.ok(performance.now() - started < 500, 'bounded by the request timeout')

  const lookup = createValidatingLookup({ resolve: hung, lookupTimeoutMs: 50 })
  const lookupError = await new Promise((done) => lookup('acmeplumbing.ca', {}, (failure) => done(failure)))
  assert.equal(lookupError.code, 'ETIMEDOUT')
})

test('one website visit resolves each hostname once, however many requests it makes', async () => {
  const { createEmailTransport } = await import('../lib/scraper/email-enrichment.ts')
  const lookups = []
  const transport = createEmailTransport('acmeplumbing.ca', {
    resolveHostname: async (hostname) => { lookups.push(hostname); return ['93.184.216.34'] },
    fetchImpl: async () => new Response('<p>ok</p>', { headers: { 'content-type': 'text/html' } }),
  })

  await Promise.all([
    transport.fetchPage('https://acmeplumbing.ca/'),
    transport.fetchPage('https://acmeplumbing.ca/contact'),
    transport.fetchPage('https://acmeplumbing.ca/contact-us'),
    transport.fetchPage('https://acmeplumbing.ca/about'),
    transport.fetchRobots('https://acmeplumbing.ca/'),
  ])
  assert.deepEqual(lookups, ['acmeplumbing.ca'])
})

test('the default (non-injected) transport shares one validated resolution across pre-check and connections', () => {
  const source = fs.readFileSync(new URL('../lib/scraper/email-enrichment.ts', import.meta.url), 'utf8')
  assert.match(source, /createPinnedFetch\(\{ resolve \}\)/, 'connections resolve through the shared memo')
  assert.match(source, /resolveHostname: \(hostname\) => resolve\(hostname, 0\)/, 'the pre-check uses the same memo')
})
