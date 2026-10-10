// Controlled user-agent comparison on the existing validation sample.
//
//   node --experimental-strip-types scripts/compare-user-agents.mjs <sites.json> <workdir>
//
// One homepage GET per agent per site (alternating order, spaced out), robots.txt honoured,
// no forms, no logins, no browser, no proxies. Sites where the two agents disagree get ONE
// confirming request per agent and a full V2 enrichment per agent, so a transient timeout is not
// mistaken for an agent effect. Page bodies are kept in memory only; nothing is written to disk
// except the outcome table.

import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { safeFetchWebsite, WebsiteFetchError } from '../lib/commercial-intelligence/safe-website-fetch.ts'
import { DEFAULT_WEBSITE_USER_AGENT } from '../lib/commercial-intelligence/user-agent.ts'
import { createSafePageFetcher, enrichEmailV2, MAX_PAGE_BYTES } from '../lib/scraper/email-enrichment.ts'
import { extractEmailCandidatesV2, pickBestEmailCandidateV2 } from '../lib/scraper/email-intelligence.ts'
import { getWebsiteHost, sanitizeWebsite } from '../lib/validation.ts'

const [sitesPath, workdir] = process.argv.slice(2)
if (!sitesPath || !workdir) {
  console.error('usage: compare-user-agents.mjs <sites.json> <workdir>')
  process.exit(2)
}

const AGENTS = {
  current: 'Mozilla/5.0',
  alpa: process.env.COMPARE_CANDIDATE_UA || DEFAULT_WEBSITE_USER_AGENT,
}
const SITES = JSON.parse(fs.readFileSync(sitesPath, 'utf8')).map(([website, group], index) => ({ n: index + 1, website, group }))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const percentile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)] : 0 }

// robots.txt: the group naming this agent wins, otherwise "*" ---------------------------------------
const robotsCache = new Map()
function parseRobots(text) {
  const groups = []
  let current = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!match) continue
    const field = match[1].toLowerCase()
    const value = match[2].trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (current && (field === 'disallow' || field === 'allow') && value) current.rules.push({ allow: field === 'allow', pattern: value })
    }
  }
  return groups
}
function rulesFor(groups, userAgent) {
  const token = userAgent.toLowerCase().split(/[\/\s]/)[0]
  const named = groups.find((group) => group.agents.some((agent) => agent !== '*' && (token.includes(agent) || agent.includes(token))))
  return (named ?? groups.find((group) => group.agents.includes('*')))?.rules ?? []
}
function allowed(rules, pathname) {
  let best = null
  for (const rule of rules) {
    const source = rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')
    if (new RegExp(`^${source}`).test(pathname) && (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow))) best = rule
  }
  return !best || best.allow
}
async function robotsAllows(url, userAgent) {
  const parsed = new URL(url)
  const key = `${parsed.protocol}//${parsed.host}`
  if (!robotsCache.has(key)) {
    try {
      const result = await safeFetchWebsite(`${key}/robots.txt`, { timeoutMs: 5000, maxBytes: 200_000, truncateAtMaxBytes: true, lenientContentType: true, userAgent: AGENTS.alpa })
      robotsCache.set(key, parseRobots(result.html))
    } catch {
      robotsCache.set(key, [])
    }
  }
  return allowed(rulesFor(robotsCache.get(key), userAgent), parsed.pathname + parsed.search)
}

// One homepage request -------------------------------------------------------------------------------
async function homepage(url, userAgent) {
  if (!(await robotsAllows(url, userAgent))) return { outcome: 'robots', ms: 0 }
  const started = performance.now()
  try {
    const result = await safeFetchWebsite(url, { timeoutMs: 6000, maxBytes: MAX_PAGE_BYTES, truncateAtMaxBytes: true, lenientContentType: true, detectBotChallenge: true, userAgent })
    const host = getWebsiteHost(result.url)
    const best = pickBestEmailCandidateV2(extractEmailCandidatesV2({ html: result.html, pageUrl: result.url, websiteHost: host }))
    return { outcome: 'content', ms: Math.round(performance.now() - started), relevantEmail: Boolean(best && best.emailConfidence !== 'low') }
  } catch (error) {
    const ms = Math.round(performance.now() - started)
    if (!(error instanceof WebsiteFetchError)) return { outcome: 'error', ms }
    if (error.failure === 'timeout') return { outcome: 'timeout', ms }
    if (error.challenge) return { outcome: 'challenge', ms, status: error.statusCode }
    if (error.failure === 'blocked') return { outcome: `blocked:${error.statusCode}`, ms }
    return { outcome: `unavailable${error.statusCode ? ':' + error.statusCode : ''}`, ms }
  }
}

const rows = []
for (const [index, site] of SITES.entries()) {
  const base = sanitizeWebsite(site.website)
  const order = index % 2 === 0 ? ['current', 'alpa'] : ['alpa', 'current']
  const row = { n: site.n, group: site.group, order: order.join('>') }
  for (const which of order) { row[which] = await homepage(base, AGENTS[which]); await sleep(1500) }
  rows.push(row)
  process.stderr.write(`[${site.n}/${SITES.length}] current=${row.current.outcome} alpa=${row.alpa.outcome}\n`)
  await sleep(400)
}

// Disagreements: confirm once, then compare full V2 recovery ---------------------------------------
const differs = (row) => row.current.outcome !== row.alpa.outcome && !(row.current.outcome === 'robots' || row.alpa.outcome === 'robots')
for (const row of rows.filter(differs)) {
  const base = sanitizeWebsite(SITES[row.n - 1].website)
  const order = row.order.split('>')
  row.confirm = {}
  for (const which of order) { row.confirm[which] = await homepage(base, AGENTS[which]); await sleep(1500) }
  row.full = {}
  for (const which of order) {
    const host = getWebsiteHost(base)
    const fetchPage = createSafePageFetcher(host, { userAgent: AGENTS[which] })
    const started = performance.now()
    const outcome = await enrichEmailV2(base, { fetchPage })
    row.full[which] = {
      ms: Math.round(performance.now() - started), relevant: Boolean(outcome.best && outcome.best.emailConfidence !== 'low'),
      confidence: outcome.best?.emailConfidence ?? null, access: outcome.accessFailure, pages: `${outcome.pagesLoaded}/${outcome.pagesRequested}`, challenge: outcome.challengePages,
    }
    await sleep(1500)
  }
  process.stderr.write(`  confirm #${row.n}: current=${row.confirm.current.outcome} alpa=${row.confirm.alpa.outcome} | full current=${row.full.current.relevant} alpa=${row.full.alpa.relevant}\n`)
}

fs.writeFileSync(path.join(workdir, 'ua-compare.json'), JSON.stringify({ agents: AGENTS, rows }, null, 1))

// Summary ------------------------------------------------------------------------------------------------
const cross = {}
for (const row of rows) { const key = `${row.current.outcome.padEnd(16)} | ${row.alpa.outcome}`; cross[key] = (cross[key] || 0) + 1 }
console.log(`\nUSER-AGENT COMPARISON: ${rows.length} homepages, one request per agent (current = "${AGENTS.current}", candidate = "${AGENTS.alpa}")`)
console.log('outcome with current UA | outcome with candidate UA')
Object.entries(cross).sort((a, b) => b[1] - a[1]).forEach(([key, count]) => console.log(`  ${String(count).padStart(3)}  ${key}`))
const content = (which) => rows.filter((row) => row[which].outcome === 'content')
for (const which of ['current', 'alpa']) {
  const ok = content(which)
  console.log(`${which.padEnd(8)} content ${ok.length}/${rows.length}  403/406/blocked ${rows.filter((r) => /^(blocked|unavailable:40[36])/.test(r[which].outcome)).length}  challenge ${rows.filter((r) => r[which].outcome === 'challenge').length}  timeout ${rows.filter((r) => r[which].outcome === 'timeout').length}  duration on content: median ${median(ok.map((r) => r[which].ms))}ms p90 ${percentile(ok.map((r) => r[which].ms), 90)}ms  homepage-only relevant email ${ok.filter((r) => r[which].relevantEmail).length}`)
}
const both = rows.filter((r) => r.current.outcome === 'content' && r.alpa.outcome === 'content')
console.log(`sites readable with both: ${both.length}; median duration current ${median(both.map((r) => r.current.ms))}ms vs candidate ${median(both.map((r) => r.alpa.ms))}ms; homepage email result differs on ${both.filter((r) => r.current.relevantEmail !== r.alpa.relevantEmail).length}`)
console.log('disagreements (first request / confirmation / full-V2 relevant email current vs candidate):')
for (const row of rows.filter(differs)) {
  console.log(`  #${row.n} ${row.current.outcome}->${row.alpa.outcome} | confirm ${row.confirm.current.outcome}->${row.confirm.alpa.outcome} | full ${row.full.current.relevant ? 'email' : row.full.current.access || 'none'} -> ${row.full.alpa.relevant ? 'email' : row.full.alpa.access || 'none'}`)
}
