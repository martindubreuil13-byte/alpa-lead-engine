// Real-website validation of Email Intelligence V1 vs V2.
//
//   node --experimental-strip-types scripts/validate-email-intelligence-real-sites.mjs \
//        <sites.json> <workdir> [phase...]
//
// Phases (default: capture analyze timing ua):
//   capture  - one polite GET per URL either strategy asks for; responses are stored in <workdir>
//              only (never in a database). robots.txt is honoured.
//   analyze  - runs V1 and V2 on the SAME captured responses (no network): coverage, quality,
//              extraction-only cost, access statistics.
//   timing   - separate controlled live run of each strategy's real fetch path, alternating order.
//   ua       - homepage-only comparison of the current user agent against an identifying one.
//
// Safeguards: GET only, no forms, no logins, no browser, no proxies, no CAPTCHA handling,
// sequential businesses (at most 4 parallel page requests to one site, which is V2's own design),
// 6 s timeouts, 1.5 MB cap, robots.txt honoured. No ALPA search, no paid API, no database access.

import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { extractEmailCandidatesFromHtml } from '../lib/validation.ts'
import { safeFetchWebsite, WebsiteFetchError, looksLikeBotChallenge } from '../lib/commercial-intelligence/safe-website-fetch.ts'
import { enrichEmailV1, fetchHtmlV1 } from '../lib/scraper/email-enrichment-v1.ts'
import { createEmailTransport, createRobotsFetcher, createSafePageFetcher, enrichEmailV2, MAX_PAGE_BYTES } from '../lib/scraper/email-enrichment.ts'
import { getWebsiteHost, hostsClearlyRelated, sanitizeWebsite } from '../lib/validation.ts'
import { extractEmailCandidatesV2, isRelevantEmail } from '../lib/scraper/email-intelligence.ts'
import { DEFAULT_WEBSITE_USER_AGENT } from '../lib/commercial-intelligence/user-agent.ts'

// The agent used to capture pages. Defaults to the configured ALPA agent; set CAPTURE_UA to compare.
const CAPTURE_UA = process.env.CAPTURE_UA || DEFAULT_WEBSITE_USER_AGENT

const [sitesPath, workdir, ...requestedPhases] = process.argv.slice(2)
if (!sitesPath || !workdir) {
  console.error('usage: validate-email-intelligence-real-sites.mjs <sites.json> <workdir> [phase...]')
  process.exit(2)
}
const phases = requestedPhases.length ? requestedPhases : ['capture', 'analyze', 'timing', 'ua']

const SITES = JSON.parse(fs.readFileSync(sitesPath, 'utf8')).map(([website, group, histEmail, histConfidence], index) => ({
  n: index + 1, website, group, histEmail: Boolean(histEmail), histConfidence,
}))

const htmlDir = path.join(workdir, 'html')
fs.mkdirSync(htmlDir, { recursive: true })
const cachePath = path.join(workdir, 'capture.json')
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : { robots: {}, pages: {} }
const saveCache = () => fs.writeFileSync(cachePath, JSON.stringify(cache))

const TIMEOUT_MS = 6000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : 0)
const percentile = (values, p) => (values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)] : 0)

// ---------------------------------------------------------------------------------------------
// robots.txt (minimal, conservative: the "*" group only; Disallow/Allow with * and $)
// ---------------------------------------------------------------------------------------------

function parseRobots(text) {
  const rules = []
  let applies = false
  let sawAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match) continue
    const field = match[1].toLowerCase()
    const value = match[2].trim()
    if (field === 'user-agent') {
      if (!sawAgent) applies = false
      sawAgent = true
      if (value === '*') applies = true
    } else if (applies && (field === 'disallow' || field === 'allow')) {
      sawAgent = false
      if (value) rules.push({ allow: field === 'allow', pattern: value })
    } else {
      sawAgent = false
    }
  }
  return rules
}

function robotsAllows(rules, pathname) {
  let best = null
  for (const rule of rules) {
    const source = rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')
    if (new RegExp(`^${source}`).test(pathname)) {
      if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
    }
  }
  return !best || best.allow
}

async function allowedByRobots(url) {
  const parsed = new URL(url)
  const key = `${parsed.protocol}//${parsed.host}`
  if (!(key in cache.robots)) {
    try {
      const result = await safeFetchWebsite(`${key}/robots.txt`, { timeoutMs: 5000, maxBytes: 200_000, truncateAtMaxBytes: true, lenientContentType: true, userAgent: CAPTURE_UA })
      cache.robots[key] = parseRobots(result.html)
    } catch {
      cache.robots[key] = [] // no readable robots.txt: nothing is disallowed
    }
    saveCache()
  }
  return robotsAllows(cache.robots[key], parsed.pathname + parsed.search)
}

// ---------------------------------------------------------------------------------------------
// Capture layer
// ---------------------------------------------------------------------------------------------

let htmlCounter = Object.keys(cache.pages).length
async function capture(url, userAgent = CAPTURE_UA) {
  const key = `${userAgent === CAPTURE_UA ? '' : 'ua2|'}${url}`
  if (cache.pages[key]) return cache.pages[key]

  const started = performance.now()
  let entry
  if (!(await allowedByRobots(url))) {
    entry = { robots: true, ms: 0 }
  } else {
    try {
      const result = await safeFetchWebsite(url, {
        timeoutMs: TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES, truncateAtMaxBytes: true, lenientContentType: true,
        detectBotChallenge: true, userAgent,
      })
      const file = `${String(++htmlCounter).padStart(4, '0')}.html`
      fs.writeFileSync(path.join(htmlDir, file), result.html)
      entry = {
        ok: true, finalUrl: result.url, status: result.statusCode, bytes: Buffer.byteLength(result.html),
        truncated: Boolean(result.truncated), file, ms: Math.round(performance.now() - started),
        challenge: false,
      }
    } catch (error) {
      entry = {
        ok: false, failure: error instanceof WebsiteFetchError ? error.failure : 'unavailable',
        status: error?.statusCode ?? null, code: error?.code ?? null, message: String(error?.message || '').slice(0, 120),
        ms: Math.round(performance.now() - started),
      }
    }
  }
  cache.pages[key] = entry
  saveCache()
  return entry
}

const readHtml = (entry) => fs.readFileSync(path.join(htmlDir, entry.file), 'utf8')
// Recomputed from the stored bytes with the current detector, so earlier captures stay valid.
const isChallenge = (entry) => Boolean(entry?.ok) && looksLikeBotChallenge(readHtml(entry))

// What V1 and V2 each see for a recorded response ------------------------------------------------

/** V1 (global fetch): a page for any 2xx, null otherwise; redirects were followed wherever they led. */
async function replayV1(url) {
  const entry = await capture(url)
  if (!entry.ok) return null
  return { html: readHtml(entry), resolvedUrl: entry.finalUrl }
}

/** V2: the same bytes, plus its typed failures and its same-site redirect rule. */
function replayV2For(siteHost) {
  return async (url) => {
    const entry = await capture(url)
    if (entry.robots) return { ok: false, failure: 'unavailable' }
    if (!entry.ok) return { ok: false, failure: entry.failure === 'unavailable' && [404, 410].includes(entry.status) ? 'not_found' : entry.failure }
    const host = getWebsiteHost(entry.finalUrl)
    if (!host || !hostsClearlyRelated(siteHost, host)) return { ok: false, failure: 'unavailable' }
    if (isChallenge(entry)) return { ok: false, failure: 'blocked' }
    return { ok: true, page: { html: readHtml(entry), resolvedUrl: entry.finalUrl, truncated: entry.truncated } }
  }
}

const mask = (email) => (email ? email.replace(/^(.{1,2})[^@]*@/, '$1***@') : null)

// ---------------------------------------------------------------------------------------------
// Phase: capture + analyze
// ---------------------------------------------------------------------------------------------

async function runCaptureAndAnalyze() {
  const rows = []
  for (const site of SITES) {
    const base = sanitizeWebsite(site.website)
    const siteHost = getWebsiteHost(base)
    const requestedV1 = []
    const requestedV2 = []

    // Warm the cache: V2 first (its pages), then V1 (its pages); each URL is fetched at most once.
    const v2Outcome = await enrichEmailV2(site.website, {
      fetchPage: async (url) => { requestedV2.push(url); return replayV2For(siteHost)(url) },
    })
    const v1Best = await enrichEmailV1(site.website, async (url) => { requestedV1.push(url); return replayV1(url) })

    // Re-run both purely from the recorded responses to time extraction/planning without network.
    const timeReplay = async (fn) => {
      const times = []
      for (let rep = 0; rep < 7; rep += 1) {
        const started = performance.now()
        await fn()
        times.push(performance.now() - started)
      }
      return median(times)
    }
    const v1ComputeMs = await timeReplay(() => enrichEmailV1(site.website, replayV1))
    const v2ComputeMs = await timeReplay(() => enrichEmailV2(site.website, { fetchPage: replayV2For(siteHost) }))

    // Every address a human could see on the fetched pages, for false-negative review.
    const pageEntries = [...new Set([...requestedV1, ...requestedV2])].map((url) => cache.pages[url]).filter((entry) => entry?.ok)
    const rawAddresses = new Set()
    const signals = { cfemail: false, jsonldEmail: false, mailto: false, obfuscated: false }
    for (const entry of pageEntries) {
      const html = readHtml(entry)
      for (const match of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi)) rawAddresses.add(match[0].toLowerCase())
      if (/data-cfemail|cdn-cgi\/l\/email-protection/i.test(html)) signals.cfemail = true
      if (/application\/ld\+json[^>]*>[^<]*"email"/i.test(html)) signals.jsonldEmail = true
      if (/href=["']\s*mailto:/i.test(html)) signals.mailto = true
      if (/\[\s*at\s*\]|\(\s*at\s*\)/i.test(html)) signals.obfuscated = true
    }

    // Every candidate each extractor yields from those pages (for the relevance audit).
    const v1Candidates = []
    const v2Candidates = []
    for (const entry of pageEntries) {
      const html = readHtml(entry)
      const host = getWebsiteHost(entry.finalUrl)
      if (!host || !hostsClearlyRelated(siteHost, host)) continue
      const input = { html, pageUrl: entry.finalUrl, websiteHost: host }
      extractEmailCandidatesFromHtml(input).forEach((candidate) => v1Candidates.push({ value: candidate.value, confidence: candidate.emailConfidence, page: new URL(entry.finalUrl).pathname }))
      extractEmailCandidatesV2(input).forEach((candidate) => v2Candidates.push({ value: candidate.value, confidence: candidate.emailConfidence, evidence: candidate.evidence, relevance: candidate.relevance, page: new URL(entry.finalUrl).pathname }))
    }

    const home = cache.pages[base]
    rows.push({
      ...site,
      home: home ? { ok: Boolean(home.ok), failure: home.failure ?? null, status: home.status ?? null, robots: Boolean(home.robots), challenge: isChallenge(home), truncated: Boolean(home.truncated), bytes: home.bytes ?? null } : null,
      v1: { best: v1Best ? { value: v1Best.value, confidence: v1Best.emailConfidence, page: new URL(v1Best.emailSource).pathname } : null, pagesRequested: requestedV1.length, computeMs: v1ComputeMs },
      v2: {
        best: v2Outcome.best ? { value: v2Outcome.best.value, confidence: v2Outcome.best.emailConfidence, evidence: v2Outcome.best.evidence, relevance: v2Outcome.best.relevance, page: new URL(v2Outcome.best.emailSource).pathname } : null,
        pagesRequested: v2Outcome.pagesRequested, pagesLoaded: v2Outcome.pagesLoaded, rounds: v2Outcome.rounds, accessFailure: v2Outcome.accessFailure,
        partialAccess: v2Outcome.partialAccess, truncated: v2Outcome.truncated, coverageClass: v2Outcome.coverageClass, computeMs: v2ComputeMs,
      },
      v1Candidates, v2Candidates, rawAddresses: [...rawAddresses], signals,
      pageSummary: [...new Set([...requestedV1, ...requestedV2])].map((url) => {
        const entry = cache.pages[url]
        return { path: new URL(url).pathname || '/', ok: Boolean(entry?.ok), status: entry?.status ?? null, failure: entry?.failure ?? (entry?.robots ? 'robots' : null), bytes: entry?.bytes ?? null, truncated: Boolean(entry?.truncated), challenge: isChallenge(entry), ms: entry?.ms ?? null }
      }),
    })
    process.stderr.write(`[${site.n}/${SITES.length}] ${new URL(base).hostname} V1=${v1Best?.emailConfidence ?? '-'} V2=${v2Outcome.best?.emailConfidence ?? '-'} pages ${requestedV1.length}/${requestedV2.length}\n`)
    await sleep(250)
  }
  fs.writeFileSync(path.join(workdir, 'analysis.json'), JSON.stringify(rows, null, 1))
  return rows
}

// ---------------------------------------------------------------------------------------------
// Phase: controlled live timing (each strategy's real production fetch path)
// ---------------------------------------------------------------------------------------------

async function runTiming() {
  const results = []
  for (const [index, site] of SITES.entries()) {
    const host = getWebsiteHost(sanitizeWebsite(site.website))
    const base = sanitizeWebsite(site.website)
    const row = { n: site.n }
    const robotsOk = await allowedByRobots(base)

    const runV1 = async () => {
      let pageRequests = 0
      let networkMs = 0
      const started = performance.now()
      const best = await enrichEmailV1(site.website, async (url) => {
        pageRequests += 1
        if (!(await allowedByRobots(url))) return null
        const t = performance.now()
        const page = await fetchHtmlV1(url) // the original unmodified V1 transport (global fetch)
        networkMs += performance.now() - t
        return page
      })
      return { ms: performance.now() - started, pageRequests, best: best?.value ?? null, confidence: best?.emailConfidence ?? null }
    }
    const runV2 = async () => {
      // The production path: one shared transport, robots.txt fetched inside the timed section.
      let pageRequests = 0
      let robotsMs = 0
      const transport = createEmailTransport(host)
      const started = performance.now()
      const outcome = await enrichEmailV2(site.website, {
        fetchRobots: async (website) => {
          const t = performance.now()
          const rules = await transport.fetchRobots(website)
          robotsMs = performance.now() - t
          return rules
        },
        fetchPage: async (url) => {
          pageRequests += 1
          return transport.fetchPage(url)
        },
      })
      return { ms: performance.now() - started, robotsMs, pageRequests, best: outcome.best?.value ?? null, confidence: outcome.best?.emailConfidence ?? null, rounds: outcome.rounds, access: outcome.accessFailure }
    }

    if (!robotsOk) { results.push({ ...row, skipped: 'robots' }); continue }
    const order = index % 2 === 0 ? ['v1', 'v2'] : ['v2', 'v1']
    for (const which of order) {
      row[which] = await (which === 'v1' ? runV1() : runV2())
      await sleep(1500)
    }
    row.order = order.join('>')
    results.push(row)
    process.stderr.write(`[timing ${site.n}/${SITES.length}] V1 ${Math.round(row.v1.ms)}ms/${row.v1.pageRequests}p  V2 ${Math.round(row.v2.ms)}ms/${row.v2.pageRequests}p\n`)
    await sleep(300)
  }
  fs.writeFileSync(path.join(workdir, 'timing.json'), JSON.stringify(results, null, 1))
  return results
}

// ---------------------------------------------------------------------------------------------
// Phase: user-agent accessibility comparison (homepage only)
// ---------------------------------------------------------------------------------------------

async function runUserAgent() {
  const honest = 'Mozilla/5.0 (compatible; ALPAResearch/1.0; +https://alpa.mindrasolutions.com)'
  const rows = []
  for (const site of SITES) {
    const base = sanitizeWebsite(site.website)
    const current = await capture(base)
    const alternative = await capture(base, honest)
    rows.push({ n: site.n, current: current.ok ? 'ok' : current.robots ? 'robots' : current.failure + (current.status ? `:${current.status}` : ''), identifying: alternative.ok ? 'ok' : alternative.robots ? 'robots' : alternative.failure + (alternative.status ? `:${alternative.status}` : '') })
    await sleep(400)
  }
  fs.writeFileSync(path.join(workdir, 'useragent.json'), JSON.stringify(rows, null, 1))
  return rows
}

// ---------------------------------------------------------------------------------------------
// Phase: transport parity (pinned transport vs Node's built-in fetch, homepage only)
// ---------------------------------------------------------------------------------------------

async function runParity() {
  const rows = []
  for (const site of SITES) {
    const base = sanitizeWebsite(site.website)
    const pinned = await capture(base)
    let plain
    if (pinned.robots) {
      rows.push({ n: site.n, skipped: 'robots' })
      continue
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const response = await fetch(base, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal })
      const text = await response.text()
      clearTimeout(timer)
      plain = { status: response.status, ok: response.ok, finalUrl: response.url, bytes: Buffer.byteLength(text) }
    } catch (error) {
      plain = { error: error?.name === 'AbortError' ? 'timeout' : String(error?.cause?.code || error?.message || error).slice(0, 60) }
    }
    rows.push({
      n: site.n,
      pinned: pinned.ok ? { ok: true, status: pinned.status, finalUrl: pinned.finalUrl, bytes: pinned.bytes } : { ok: false, failure: pinned.failure, status: pinned.status, message: pinned.message },
      plain,
    })
    await sleep(300)
  }
  fs.writeFileSync(path.join(workdir, 'parity.json'), JSON.stringify(rows, null, 1))
  return rows
}

if (phases.includes('parity')) await runParity()
if (phases.includes('capture') || phases.includes('analyze')) await runCaptureAndAnalyze()
if (phases.includes('timing')) await runTiming()
if (phases.includes('ua')) await runUserAgent()
console.error('done')
