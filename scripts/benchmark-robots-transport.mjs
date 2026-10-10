// Deterministic robots.txt / transport benchmark on local servers behind a latency-emulating proxy.
//
//   node --experimental-strip-types scripts/benchmark-robots-transport.mjs [rttMs=80]
//
// SIMULATED NETWORK. Every number printed here comes from emulated latency, not from real websites:
//   - each new connection costs `setup` (TCP + TLS, about 2.4 round trips, as measured on real hosts)
//   - every chunk is delayed one way by rtt/2, so a request/response costs one round trip
//   - DNS costs `dns` once per host per visit
//   - servers add a small think time per request
// It shows what the scheduling changes do, deterministically. It does not predict real-world seconds.

import net from 'node:net'
import http from 'node:http'
import { performance } from 'node:perf_hooks'

import { createPinnedFetch } from '../lib/commercial-intelligence/pinned-fetch.ts'
import { createRobotsCache } from '../lib/commercial-intelligence/robots.ts'
import { DEFAULT_WEBSITE_USER_AGENT } from '../lib/commercial-intelligence/user-agent.ts'
import { enrichEmailV1, fetchHtmlV1 } from '../lib/scraper/email-enrichment-v1.ts'
import { enrichEmailV2 } from '../lib/scraper/email-enrichment.ts'

const RTT = Number(process.argv[2] || 80)
const SETUP = Math.round(RTT * 2.4)
const DNS = 50
const THINK = { page: 30, robots: 15 }
const WORKERS = 4
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] : 0 }

// ---- a website behind a latency proxy ------------------------------------------------------------
function delayedPipe(from, to, delay) {
  from.on('data', (chunk) => setTimeout(() => to.writable && to.write(chunk), delay))
  from.on('end', () => setTimeout(() => to.end(), delay))
  from.on('error', () => to.destroy())
  to.on('error', () => from.destroy())
  // Let delayed bytes drain before tearing the other side down.
  to.on('close', () => setTimeout(() => from.destroy(), delay * 2 + 20))
}

async function startSite({ robots = 'User-agent: *\nDisallow: /private', robotsHangs = false, emailOnHomepage = true, redirectTo = null }) {
  const counters = { requests: 0, robotsRequests: 0, connections: 0 }
  const backend = http.createServer((req, res) => {
    counters.requests += 1
    if (req.url === '/robots.txt') {
      counters.robotsRequests += 1
      if (robotsHangs) return
      return setTimeout(() => {
        if (redirectTo) { res.writeHead(301, { location: `${redirectTo}/robots.txt` }); return res.end() }
        res.writeHead(200, { 'content-type': 'text/plain' }); res.end(robots)
      }, THINK.robots)
    }
    setTimeout(() => {
      if (redirectTo) { res.writeHead(301, { location: `${redirectTo}${req.url}` }); return res.end() }
      res.writeHead(200, { 'content-type': 'text/html' })
      const host = String(req.headers['x-site-host'] || req.headers.host || '').split(':')[0].replace(/^www\./, '')
      const mail = `<a href="mailto:owner@${host}">mail</a>`
      const privacyLink = '<a href="/privacy-policy">Privacy</a>'
      if (req.url === '/') return res.end(`<html><body>${emailOnHomepage ? mail : privacyLink}</body></html>`)
      if (req.url === '/privacy-policy') return res.end(`<html><body>${mail}</body></html>`)
      res.writeHead; res.end('<html><body>nothing</body></html>')
    }, THINK.page)
  })
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))
  const backendPort = backend.address().port
  const proxy = net.createServer((client) => {
    counters.connections += 1
    client.pause()
    setTimeout(() => {
      if (client.destroyed) return
      const upstream = net.connect(backendPort, '127.0.0.1')
      delayedPipe(client, upstream, RTT / 2)
      delayedPipe(upstream, client, RTT / 2)
      client.resume()
    }, SETUP)
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  return {
    counters, port: proxy.address().port,
    close: () => { backend.closeAllConnections?.(); backend.close(); proxy.close() },
  }
}

// ---- visits --------------------------------------------------------------------------------------------
const hostFor = (index) => `site${index}.acmeplumbing.ca`

function dnsCounter() {
  const state = { lookups: 0 }
  return {
    state,
    memo() {
      const cache = new Map()
      return (hostname) => {
        if (!cache.has(hostname)) cache.set(hostname, (async () => { state.lookups += 1; await sleep(DNS); return [{ address: '127.0.0.1', family: 4 }] })())
        return cache.get(hostname)
      }
    },
  }
}

function v2Visit(dns, { robotsCache, optimizations, robots = true }) {
  return (host, port) => {
    const resolve = dns.memo()
    const options = {
      fetchImpl: createPinnedFetch({ resolve: async (name) => resolve(name), isAddressAllowed: () => true }),
      resolveHostname: async (name) => (await resolve(name)).map(() => '93.184.216.34'),
      robotsCache, robotsTimeoutMs: 1200, robotsRetryDelayMs: 5, userAgent: DEFAULT_WEBSITE_USER_AGENT,
    }
    return enrichEmailV2(`http://${host}:${port}/`, {
      transportOptions: options, optimizations,
      ...(robots ? {} : { fetchRobots: async () => [] }),
    })
  }
}

function v1Visit(dns) {
  return async (host, port) => {
    const resolve = dns.memo()
    const rewritten = (url) => String(url).replace(new RegExp(`//(?:www\\.)?${host.replace(/\./g, '\\.')}:`), '//127.0.0.1:')
    const seenHosts = new Set()
    return enrichEmailV1(`http://${host}:${port}/`, async (url) => {
      const name = new URL(url).hostname
      if (!seenHosts.has(name)) { seenHosts.add(name); await resolve(name) }
      const page = await fetchHtmlV1(url, (input, init) => fetch(rewritten(input), { ...init, headers: { ...init?.headers, 'x-site-host': new URL(String(input)).hostname } }))
      return page ? { html: page.html, resolvedUrl: page.resolvedUrl.replace('127.0.0.1', name) } : null
    })
  }
}

async function runScenario(label, sites, visit, { workers = WORKERS, dns, sitesOf = (index) => sites[index % sites.length] } = {}) {
  const total = sites.reduce((sum, site) => sum + site.counters.connections, 0)
  const before = { requests: sites.reduce((n, s) => n + s.counters.requests, 0), robots: sites.reduce((n, s) => n + s.counters.robotsRequests, 0), connections: total }
  const startedLookups = dns.state.lookups
  const times = []
  let next = 0
  const startedAt = performance.now()
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < sites.visits) {
      const index = next++
      const { host, site } = sitesOf(index)
      const started = performance.now()
      const result = await visit(host, site.port)
      times.push({ ms: performance.now() - started, ok: Boolean(result?.best || result?.value) })
      if (process.env.BENCH_DEBUG && index === 0) console.log('   [debug first visit]', JSON.stringify({ robots: result?.robots, reason: result?.robotsReason, access: result?.accessFailure, pages: `${result?.pagesLoaded}/${result?.pagesRequested}`, fails: result?.failureCounts, warmed: result?.warmed, rebased: result?.rebased, ms: result?.durationMs, found: result?.best?.value ?? result?.value }))
    }
  }))
  const elapsed = performance.now() - startedAt
  const visits = times.length
  const after = { requests: sites.reduce((n, s) => n + s.counters.requests, 0), robots: sites.reduce((n, s) => n + s.counters.robotsRequests, 0), connections: sites.reduce((n, s) => n + s.counters.connections, 0) }
  return {
    label, visits, found: times.filter((t) => t.ok).length,
    median: median(times.map((t) => t.ms)), p90: p90(times.map((t) => t.ms)), elapsed,
    requests: (after.requests - before.requests) / visits, robots: after.robots - before.robots,
    connections: (after.connections - before.connections) / visits, dns: (dns.state.lookups - startedLookups) / visits,
  }
}

const row = (r, extra = '') => console.log(`  ${r.label.padEnd(34)} median ${String(Math.round(r.median)).padStart(5)}  p90 ${String(Math.round(r.p90)).padStart(5)}  end-to-end ${String(Math.round(r.elapsed)).padStart(6)} ms | req/site ${r.requests.toFixed(1)}  robots ${String(r.robots).padStart(2)}  conn/site ${r.connections.toFixed(1)}  dns/site ${r.dns.toFixed(1)} | found ${r.found}/${r.visits}${extra}`)

async function makeSites(count, config = {}) {
  const sites = await Promise.all(Array.from({ length: count }, (_, index) => startSite(typeof config === 'function' ? config(index) : config)))
  sites.visits = count
  return sites
}
const siteRefs = (sites) => (index) => ({ host: hostFor(index % sites.length), site: sites[index % sites.length] })

console.log(`SIMULATED NETWORK: rtt ${RTT} ms, new connection ${SETUP} ms (tcp+tls), dns ${DNS} ms, server think ${THINK.page} ms (robots ${THINK.robots} ms), ${WORKERS} workers`)

// 1. Cold: twelve different origins, half need a second round --------------------------------------------
{
  console.log('\n1. COLD ROBOTS LOOKUP, 12 different origins (half find the email only on the privacy page = 2 rounds)')
  const run = async (label, make) => {
    const sites = await makeSites(12, (index) => ({ emailOnHomepage: index % 2 === 0 }))
    const dns = dnsCounter()
    const result = await runScenario(label, sites, make(dns), { dns, sitesOf: siteRefs(sites) })
    sites.forEach((site) => site.close())
    return result
  }
  const v1 = await run('V1 (no robots, 2 rounds)', (dns) => v1Visit(dns))
  const norobots = await run('V2 without robots (reference)', (dns) => v2Visit(dns, { robotsCache: null, optimizations: {}, robots: false }))
  const v22 = await run('V2.2-equivalent (robots first)', (dns) => v2Visit(dns, { robotsCache: null, optimizations: { warm: false, rebase: false } }))
  const v23 = await run('V2.3 (pre-opened connections)', (dns) => v2Visit(dns, { robotsCache: null, optimizations: {} }))
  ;[v1, norobots, v22, v23].forEach((r) => row(r))
  console.log(`  -> V2.2-eq vs V1: ${((v22.median / v1.median - 1) * 100).toFixed(0)}% median, ${((v22.elapsed / v1.elapsed - 1) * 100).toFixed(0)}% end-to-end | V2.3 vs V1: ${((v23.median / v1.median - 1) * 100).toFixed(0)}% median, ${((v23.elapsed / v1.elapsed - 1) * 100).toFixed(0)}% end-to-end | V2.3 vs V2.2-eq: ${((v23.median / v22.median - 1) * 100).toFixed(0)}% median`)
}

// 2. Warm cache ---------------------------------------------------------------------------------------------------
{
  console.log('\n2. WARM CACHE: the same 12 origins visited again with robots.txt already cached')
  const sites = await makeSites(12, (index) => ({ emailOnHomepage: index % 2 === 0 }))
  const cache = createRobotsCache()
  const dns = dnsCounter()
  const cold = await runScenario('V2.3 cold (fills the cache)', sites, v2Visit(dns, { robotsCache: cache, optimizations: {} }), { dns, sitesOf: siteRefs(sites) })
  const warm = await runScenario('V2.3 warm (cache hits)', sites, v2Visit(dns, { robotsCache: cache, optimizations: {} }), { dns, sitesOf: siteRefs(sites) })
  ;[cold, warm].forEach((r) => row(r))
  const stats = cache.stats()
  console.log(`  -> cache: ${stats.hits} hits, ${stats.misses} misses, ${stats.joined} joined in flight, size ${stats.size}`)
  sites.forEach((site) => site.close())
}

// 3. Several businesses on one origin, visited at the same time ------------------------------------------
{
  console.log('\n3. MULTIPLE BUSINESSES ON ONE ORIGIN, 8 leads at once (4 workers)')
  const run = async (label, cache) => {
    const sites = await makeSites(1, {})
    sites.visits = 8
    const dns = dnsCounter()
    const result = await runScenario(label, sites, v2Visit(dns, { robotsCache: cache, optimizations: {} }), { dns, sitesOf: () => ({ host: hostFor(0), site: sites[0] }) })
    sites.forEach((site) => site.close())
    return result
  }
  const without = await run('V2.3, robots cache disabled', null)
  const cache = createRobotsCache()
  const withCache = await run('V2.3, shared robots cache', cache)
  ;[without, withCache].forEach((r) => row(r))
  console.log(`  -> robots.txt requests for 8 leads: ${without.robots} without the cache, ${withCache.robots} with it (${cache.stats().joined} joined an in-flight lookup, ${cache.stats().hits} hits)`)
}

// 4. Redirected websites --------------------------------------------------------------------------------------
{
  console.log('\n4. REDIRECTED WEBSITES: every legacy origin redirects (robots.txt and pages) to its canonical origin')
  const run = async (label, make) => {
    const canonical = await makeSites(8, {})
    const legacy = await Promise.all(canonical.map((site, index) => startSite({ redirectTo: `http://www.${hostFor(index)}:${site.port}` })))
    legacy.visits = 8
    const dns = dnsCounter()
    const result = await runScenario(label, legacy, make(dns), { dns, sitesOf: (index) => ({ host: hostFor(index), site: legacy[index] }) })
    const legacyRequests = legacy.reduce((n, s) => n + s.counters.requests, 0)
    ;[...canonical, ...legacy].forEach((site) => site.close())
    return { ...result, legacyRequests }
  }
  // (V1 is not shown here: its plain fetch cannot reach the emulated canonical hostnames.)
  const v22 = await run('V2.2-equivalent (robots first)', (dns) => v2Visit(dns, { robotsCache: null, optimizations: { warm: false, rebase: false } }))
  const v23 = await run('V2.3 (pre-open + canonical origin)', (dns) => v2Visit(dns, { robotsCache: null, optimizations: {} }))
  ;[v22, v23].forEach((r) => row(r, ` | requests hitting the redirecting origin: ${(r.legacyRequests / r.visits).toFixed(1)}/site`))
}

// 5. robots.txt that never answers ------------------------------------------------------------------------------
{
  console.log('\n5. ROBOTS TIMEOUT: robots.txt never answers (timeout 1200 ms, a timeout is not retried); permission unknown, so no page is requested')
  const sites = await makeSites(4, { robotsHangs: true })
  const dns = dnsCounter()
  const result = await runScenario('V2.3', sites, v2Visit(dns, { robotsCache: null, optimizations: {} }), { dns, sitesOf: siteRefs(sites) })
  const pages = sites.reduce((n, s) => n + s.counters.requests - s.counters.robotsRequests, 0)
  row(result, ` | page requests: ${pages}`)
  sites.forEach((site) => site.close())
}
process.exit(0)
