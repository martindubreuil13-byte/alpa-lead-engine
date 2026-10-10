import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'

import {
  DEFAULT_WEBSITE_USER_AGENT,
  resolveWebsiteUserAgent,
  USER_AGENT_ENV,
} from '../lib/commercial-intelligence/user-agent.ts'
import { createRobotsFetcher, enrichEmailV2, formatEmailIntelLog } from '../lib/scraper/email-enrichment.ts'
import {
  isAllowedByPolicy,
  isPathAllowed,
  isUrlAllowed,
  parseRobots,
  productToken,
  selectRobotsRules,
} from '../lib/commercial-intelligence/robots.ts'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

// ---------------------------------------------------------------------------------------------
// User-agent configuration
// ---------------------------------------------------------------------------------------------

test('the default user agent identifies ALPA, its public site, and nothing it is not', () => {
  assert.equal(DEFAULT_WEBSITE_USER_AGENT, 'ALPA-Business-Intelligence/1.0 (+https://alpa.mindrasolutions.com)')
  assert.ok(!/mozilla|chrome|safari|firefox|gecko|webkit/i.test(DEFAULT_WEBSITE_USER_AGENT), 'must not claim to be a browser')
  assert.ok(!/googlebot|bingbot|crawler/i.test(DEFAULT_WEBSITE_USER_AGENT), 'must not borrow another crawler identity')
  assert.ok(!/@/.test(DEFAULT_WEBSITE_USER_AGENT), 'no invented contact address')
  assert.deepEqual(resolveWebsiteUserAgent(DEFAULT_WEBSITE_USER_AGENT), { userAgent: DEFAULT_WEBSITE_USER_AGENT, source: 'configured' })
})

test('unset or empty configuration falls back to the default', () => {
  for (const value of [undefined, null, '', '   ', '\n']) {
    assert.deepEqual(resolveWebsiteUserAgent(value), { userAgent: DEFAULT_WEBSITE_USER_AGENT, source: 'default' })
  }
})

test('a valid identifying agent can be configured (surrounding whitespace is trimmed)', () => {
  const custom = 'ALPA-Business-Intelligence/1.1 (+https://alpa.mindrasolutions.com/about)'
  assert.deepEqual(resolveWebsiteUserAgent(`  ${custom}  `), { userAgent: custom, source: 'configured' })
  assert.equal(resolveWebsiteUserAgent('PartnerResearch/3.0 (+https://partner.example.org/bot)').source, 'configured')
})

test('invalid or impersonating configuration is ignored and reported without echoing the value', () => {
  const cases = [
    ['short', 'a/1', 'too_short'],
    ['x'.repeat(250), undefined, 'too_long'],
    ['Agent/1.0 (+https://ünïcode.example.org)', undefined, 'not_ascii'],
    ['Agent/1.0 (+https://example.org)\r\nX-Injected: 1', undefined, 'not_ascii'],
    ['just some words without a version', undefined, 'no_product_token'],
    ['Research/1.0 without any link at all', undefined, 'no_url'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', undefined, 'impersonation'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 (+https://x.org)', undefined, 'impersonation'],
    ['Bingbot/2.0 (+https://www.bing.com/bingbot.htm)', undefined, 'impersonation'],
    ['curl/8.4.0 (+https://example.org)', undefined, 'impersonation'],
  ]
  for (const [value, , reason] of cases) {
    const result = resolveWebsiteUserAgent(value)
    assert.equal(result.userAgent, DEFAULT_WEBSITE_USER_AGENT, value.slice(0, 30))
    assert.equal(result.source, 'default')
    assert.equal(result.ignored, reason, value.slice(0, 40))
    assert.ok(!JSON.stringify(result).includes(value.slice(0, 20)) || reason === 'too_short')
  }
})

test('the user-agent variable is server-only and read at runtime', () => {
  const source = read('lib/commercial-intelligence/user-agent.ts')
  assert.equal(USER_AGENT_ENV, 'ALPA_FETCH_USER_AGENT')
  assert.ok(!/NEXT_PUBLIC_/.test(source))
  assert.match(source, /process\.env\[USER_AGENT_ENV\]/)
  assert.ok(!/^const .*= process\.env/m.test(source), 'must not be captured at module load')
})

// ---------------------------------------------------------------------------------------------
// Runtime assumptions (Vercel runs Node.js on the serverless "nodejs" runtime)
// ---------------------------------------------------------------------------------------------

test('the Node APIs the secure transport depends on exist on this runtime', () => {
  const major = Number(process.versions.node.split('.')[0])
  assert.ok(major >= 20, `Node ${process.versions.node}: the transport needs >= 20`)
  assert.equal(typeof http.request, 'function')
  assert.equal(typeof Readable.toWeb, 'function')
  assert.equal(typeof zlib.createBrotliDecompress, 'function')
  assert.equal(typeof AbortSignal, 'function')
  assert.equal(typeof Response, 'function')
  assert.equal(typeof Headers, 'function')
})

/** Static import graph of the app, to prove who can reach the Node-only transport. */
function buildGraph() {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', '.git', 'tests', 'scripts', 'supabase'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(full)
    }
  }
  for (const dir of ['app', 'lib', 'components']) walk(path.join(ROOT, dir))
  for (const root of ['proxy.ts', 'middleware.ts']) if (fs.existsSync(path.join(ROOT, root))) files.push(path.join(ROOT, root))

  const resolve = (spec, from) => {
    const base = spec.startsWith('@/') ? path.join(ROOT, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null
    if (!base) return null
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    }
    return null
  }
  const imports = new Map()
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const targets = new Set()
    for (const match of source.matchAll(pattern)) {
      const target = resolve(match[1] || match[2], file)
      if (target) targets.add(target)
    }
    imports.set(file, targets)
  }
  return { files, imports }
}

function importersOf(graph, seeds) {
  const reached = new Set(seeds)
  let changed = true
  while (changed) {
    changed = false
    for (const [file, targets] of graph.imports) {
      if (!reached.has(file) && [...targets].some((target) => reached.has(target))) { reached.add(file); changed = true }
    }
  }
  return reached
}

test('only Node-runtime server code can reach the secure transport (no edge, no client, no proxy)', () => {
  const graph = buildGraph()
  const seeds = ['lib/commercial-intelligence/pinned-fetch.ts', 'lib/commercial-intelligence/safe-website-fetch.ts', 'lib/commercial-intelligence/user-agent.ts', 'lib/scraper/email-enrichment.ts']
    .map((relative) => path.join(ROOT, relative))
  const reach = [...importersOf(graph, seeds)]
  assert.ok(reach.length > seeds.length, 'the graph must actually find importers')

  for (const file of reach) {
    const relative = path.relative(ROOT, file)
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(!/^\s*['"]use client['"]/m.test(source.slice(0, 400)), `${relative} is a client component that reaches the transport`)
    assert.ok(!/export const runtime\s*=\s*['"](edge|experimental-edge)['"]/.test(source), `${relative} declares the edge runtime`)
    assert.ok(!/^(proxy|middleware)\.ts$/.test(relative), `${relative} must not reach the transport`)
  }

  const routes = reach.filter((file) => /\/route\.ts$/.test(file)).map((file) => path.relative(ROOT, file))
  assert.ok(routes.includes('app/api/scrape/route.ts'))
  for (const route of routes) assert.ok(!/runtime\s*=\s*['"]edge/.test(read(route)), route)
})

test('neither configuration variable is exposed to the browser', () => {
  for (const name of ['EMAIL_INTELLIGENCE_VERSION', 'ALPA_FETCH_USER_AGENT']) {
    assert.ok(!new RegExp(`NEXT_PUBLIC_${name}`).test(read('lib/scraper/email-enrichment.ts') + read('lib/commercial-intelligence/user-agent.ts')))
    const graph = buildGraph()
    for (const file of graph.files) {
      const source = fs.readFileSync(file, 'utf8')
      if (!source.includes(name)) continue
      assert.ok(!/^\s*['"]use client['"]/m.test(source.slice(0, 400)), `${path.relative(ROOT, file)} (client) references ${name}`)
    }
  }
  assert.match(read('next.config.js'), /reactStrictMode/)
  assert.ok(!/env\s*:/.test(read('next.config.js')), 'next.config must not inline env values into the bundle')
})

test('the configuration variables are documented in .env.example without values', () => {
  const example = read('.env.example')
  assert.match(example, /^#?\s*EMAIL_INTELLIGENCE_VERSION=$/m)
  assert.match(example, /^#?\s*ALPA_FETCH_USER_AGENT=$/m)
})

// ---------------------------------------------------------------------------------------------
// Rollback scope
// ---------------------------------------------------------------------------------------------

test('the V1 switch rolls back email discovery only: V1 keeps its own transport, research keeps the shared one', () => {
  const v1 = read('lib/scraper/email-enrichment-v1.ts')
  assert.ok(!/safe-website-fetch|pinned-fetch|user-agent/.test(v1), 'V1 uses its original fetch and user agent')
  assert.match(v1, /'User-Agent': 'Mozilla\/5\.0'/)
  for (const file of ['extract-website-snapshot.ts', 'generate-business-signals.ts']) {
    assert.match(read(`lib/commercial-intelligence/${file}`), /safe-website-fetch/, `${file} is not affected by EMAIL_INTELLIGENCE_VERSION`)
  }
  assert.ok(!/EMAIL_INTELLIGENCE_VERSION/.test(read('lib/commercial-intelligence/safe-website-fetch.ts')))
})

// ---------------------------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------------------------

const ok = (html, url = 'https://acmeplumbing.ca/') => ({ ok: true, page: { html, resolvedUrl: url } })
const fail = (failure, challenge = false) => ({ ok: false, failure, challenge })
const stub = (map, fallback = fail('not_found')) => async (url) => map[new URL(url).pathname.replace(/\/+$/, '') || '/'] ?? fallback

test('the per-website log line carries the signals needed to monitor coverage and access, and no personal data', async () => {
  const found = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: stub({ '/': ok('<a href="mailto:owner@acmeplumbing.ca">x</a>') }) })
  const blocked = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: stub({ '/': fail('blocked', true), '/contact': fail('blocked', true), '/contact-us': fail('blocked') }) })
  const timeout = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: stub({ '/': fail('timeout') }) })
  const none = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: stub({ '/': ok('<p>hi</p>') }) })
  const big = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: stub({ '/': { ok: true, page: { html: '<p>start</p>', resolvedUrl: 'https://acmeplumbing.ca/', truncated: true } } }) })

  const lines = {
    found: formatEmailIntelLog('https://acmeplumbing.ca', found),
    blocked: formatEmailIntelLog('https://acmeplumbing.ca', blocked),
    timeout: formatEmailIntelLog('https://acmeplumbing.ca', timeout),
    none: formatEmailIntelLog('https://acmeplumbing.ca', none),
    big: formatEmailIntelLog('https://acmeplumbing.ca', big),
  }

  assert.match(lines.found, /^\[EMAIL-INTEL\] host=acmeplumbing\.ca result=high pages=1\/4 rounds=1 ms=\d+/)
  assert.match(lines.blocked, /result=unreadable:blocked .*fail=blocked:3,not_found:1 challenge=2/)
  assert.match(lines.timeout, /result=unreadable:timeout/)
  assert.match(lines.none, /result=none/)
  assert.match(lines.big, /result=unreadable:too_large .*truncated/)

  for (const line of Object.values(lines)) {
    assert.ok(!line.includes('@'), `log line must not contain an email address: ${line}`)
    assert.ok(!/owner|ALPA-Business|Mozilla/.test(line))
    assert.ok(line.length < 200, 'keep it concise')
    assert.equal(line.split('\n').length, 1)
  }
})

// ---------------------------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------------------------

const ALPA = DEFAULT_WEBSITE_USER_AGENT
const rulesFor = (text, agent = ALPA) => selectRobotsRules(parseRobots(text), agent)

test('robots.txt: the ALPA group wins over *, otherwise * applies', () => {
  const text = `User-agent: *\nDisallow: /\n\nUser-agent: alpa-business-intelligence\nDisallow: /private\n`
  assert.equal(productToken(ALPA), 'alpa-business-intelligence')
  assert.equal(isUrlAllowed(rulesFor(text), 'https://x.com/contact'), true)
  assert.equal(isUrlAllowed(rulesFor(text), 'https://x.com/private/page'), false)
  assert.equal(isUrlAllowed(rulesFor(text, 'OtherBot/1.0 (+https://o.org)'), 'https://x.com/contact'), false)
  assert.equal(isUrlAllowed(rulesFor('User-agent: alpa\nDisallow: /contact'), 'https://x.com/contact'), false, 'a shorter named token such as "alpa" matches')
})

test('robots.txt: longest rule wins, Allow wins ties, wildcards and anchors work', () => {
  const rules = rulesFor('User-agent: *\nDisallow: /folder\nAllow: /folder/open\nDisallow: /*.pdf$\nDisallow: /search?q=*')
  assert.equal(isPathAllowed(rules, '/folder/secret'), false)
  assert.equal(isPathAllowed(rules, '/folder/open/page'), true)
  assert.equal(isPathAllowed(rules, '/doc.pdf'), false)
  assert.equal(isPathAllowed(rules, '/doc.pdf?x=1'), true)
  assert.equal(isPathAllowed(rules, '/search?q=plumber'), false)
  assert.equal(isPathAllowed(rules, '/contact'), true)
  assert.equal(isPathAllowed(rulesFor('User-agent: *\nAllow: /a\nDisallow: /a'), '/a'), true, 'a tie goes to Allow')
})

test('robots.txt: empty Disallow, comments, BOM, CRLF and unknown fields are harmless', () => {
  assert.equal(isPathAllowed(rulesFor('User-agent: *\nDisallow:\n'), '/anything'), true)
  assert.equal(isPathAllowed(rulesFor('﻿User-agent: *\r\nDisallow: /x # private\r\nCrawl-delay: 10\r\nSitemap: https://x.com/s.xml\r\n'), '/x/y'), false)
  assert.deepEqual(parseRobots(''), [])
  assert.deepEqual(parseRobots('garbage without colons'), [])
  assert.equal(isPathAllowed(rulesFor('User-agent: googlebot\nDisallow: /'), '/'), true, 'rules for other crawlers do not apply to us')
  assert.equal(isUrlAllowed([{ allow: false, pattern: '/' }], 'not a url'), false, 'a URL that cannot be read is not requested')
})

test('robots.txt: honoured by email discovery, which never requests a disallowed page', async () => {
  const requested = []
  const fetchPage = async (url) => {
    requested.push(new URL(url).pathname)
    return new URL(url).pathname === '/' ? ok('<a href="mailto:owner@acmeplumbing.ca">x</a>') : fail('not_found')
  }
  const fetchRobots = async () => rulesFor('User-agent: *\nDisallow: /contact\nDisallow: /about')
  const outcome = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage, fetchRobots })
  // "Disallow: /contact" is a prefix rule, so /contact-us is disallowed too.
  assert.deepEqual(requested, ['/'], 'disallowed pages were never requested')
  assert.equal(outcome.best.value, 'owner@acmeplumbing.ca')
  assert.equal(outcome.failureCounts.robots, 3)

  const partial = []
  await enrichEmailV2('https://acmeplumbing.ca', {
    fetchPage: async (url) => { partial.push(new URL(url).pathname); return fail('not_found') },
    fetchRobots: async () => rulesFor('User-agent: *\nDisallow: /about'),
  })
  assert.deepEqual(partial.sort(), ['/', '/contact', '/contact-us'], 'only the disallowed page is skipped')
})

test('robots.txt: a site that disallows ALPA entirely is reported as such, with no page requests', async () => {
  const requested = []
  const outcome = await enrichEmailV2('https://acmeplumbing.ca', {
    fetchPage: async (url) => { requested.push(url); return ok('<p>x</p>') },
    fetchRobots: async () => rulesFor('User-agent: *\nDisallow: /'),
  })
  assert.equal(requested.length, 0)
  assert.equal(outcome.accessFailure, 'robots')
  assert.equal(outcome.coverageClass, 'unanalyzable')
  assert.equal(outcome.rounds, 0)
  assert.match(formatEmailIntelLog('https://acmeplumbing.ca', outcome), /result=unreadable:robots .*fail=robots:4/)
})

test('robots.txt: the real fetcher reads the file with the ALPA agent and turns the answer into a policy', async () => {
  const seen = []
  const serve = (status, body, type = 'text/plain') => async (url, init) => {
    seen.push({ url: String(url), userAgent: init.headers['User-Agent'] })
    return new Response(body, { status, headers: { 'content-type': type } })
  }
  const fetcher = (impl) => createRobotsFetcher('acmeplumbing.ca', { fetchImpl: impl, resolveHostname: async () => ['93.184.216.34'], retryDelayMs: 1 })

  const policy = await fetcher(serve(200, 'User-agent: *\nDisallow: /private'))('https://acmeplumbing.ca/')
  assert.equal(policy.kind, 'rules')
  assert.equal(isAllowedByPolicy(policy, ALPA, 'https://acmeplumbing.ca/private'), false)
  assert.equal(seen[0].url, 'https://acmeplumbing.ca/robots.txt')
  assert.equal(seen[0].userAgent, ALPA)

  // No file, or a client error: the site has no robots policy for us (RFC 9309).
  for (const status of [404, 410, 401, 403]) {
    assert.equal((await fetcher(serve(status, 'User-agent: *\nDisallow: /'))('https://acmeplumbing.ca/')).kind, 'allow_all', `status ${status}`)
  }
  // Server errors and rate limiting: permission cannot be determined, so nothing is requested.
  for (const status of [429, 500, 502, 503]) {
    const result = await fetcher(serve(status, 'User-agent: *\nAllow: /'))('https://acmeplumbing.ca/')
    assert.equal(result.kind, 'unknown', `status ${status}`)
    assert.equal(isAllowedByPolicy(result, ALPA, 'https://acmeplumbing.ca/'), false)
  }
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const slow = createRobotsFetcher('acmeplumbing.ca', { fetchImpl: hang, resolveHostname: async () => ['93.184.216.34'], timeoutMs: 40, retryDelayMs: 1 })
  assert.deepEqual(await slow('https://acmeplumbing.ca/'), { kind: 'unknown', reason: 'timeout' })
})

test('robots.txt: default enrichment with an injected page fetcher never touches the network for robots', async () => {
  let robotsCalls = 0
  const outcome = await enrichEmailV2('https://acmeplumbing.ca', { fetchPage: async () => ok('<p>hi</p>') })
  assert.equal(outcome.coverageClass, 'none')
  assert.equal(robotsCalls, 0)
})

test('robots handling can be switched off on the server and defaults to on', async () => {
  const { emailRobotsEnabled } = await import('../lib/scraper/email-enrichment.ts')
  for (const value of [undefined, null, '', 'on', 'true', '1', 'yes', 'ON', 'whatever']) assert.equal(emailRobotsEnabled(value), true, String(value))
  for (const value of ['off', 'OFF', ' false ', '0', 'no', 'disabled']) assert.equal(emailRobotsEnabled(value), false, String(value))
  assert.ok(!/NEXT_PUBLIC_EMAIL_INTELLIGENCE_ROBOTS/.test(read('lib/scraper/email-enrichment.ts')))
  assert.match(read('.env.example'), /EMAIL_INTELLIGENCE_ROBOTS=/)
})
