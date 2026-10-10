// Controlled real-world comparison: V1 vs V2.2-equivalent vs V2.3 on the same sites, same minutes.
//
//   node --experimental-strip-types scripts/compare-robots-real.mjs <sites.json> <workdir> [every-nth=2]
//
// Arms rotate through every ordering so no arm always goes first. Robots.txt is honoured: a site whose
// policy does not let ALPA read its homepage is skipped by ALL arms. One visit per arm per site, spaced
// out, existing sites only. No ALPA search, no paid API, no database.

import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { isAllowedByPolicy } from '../lib/commercial-intelligence/robots.ts'
import { getWebsiteUserAgent } from '../lib/commercial-intelligence/user-agent.ts'
import { enrichEmailV1, fetchHtmlV1 } from '../lib/scraper/email-enrichment-v1.ts'
import { createRobotsFetcher, enrichEmailV2 } from '../lib/scraper/email-enrichment.ts'
import { getWebsiteHost, sanitizeWebsite } from '../lib/validation.ts'

const [sitesPath, workdir, nth = '2'] = process.argv.slice(2)
const sites = JSON.parse(fs.readFileSync(sitesPath, 'utf8')).map(([website], index) => ({ n: index + 1, website })).filter((_, index) => index % Number(nth) === 0)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] : 0 }
const userAgent = getWebsiteUserAgent()

const ARMS = {
  v1: async (site, policy) => {
    let pages = 0
    const started = performance.now()
    const best = await enrichEmailV1(site.website, async (url) => {
      if (!isAllowedByPolicy(policy, userAgent, url)) return null
      pages += 1
      return fetchHtmlV1(url)
    })
    return { ms: performance.now() - started, requests: pages, connections: pages, best: best?.value ?? null, confidence: best?.emailConfidence ?? null }
  },
  v22: async (site) => {
    const started = performance.now()
    const outcome = await enrichEmailV2(site.website, { transportOptions: { robotsCache: null }, optimizations: { warm: false, rebase: false } })
    return summarize(outcome, started)
  },
  v23: async (site) => {
    const started = performance.now()
    const outcome = await enrichEmailV2(site.website, { transportOptions: { robotsCache: null } })
    return summarize(outcome, started)
  },
}
function summarize(outcome, started) {
  return {
    ms: performance.now() - started, requests: outcome.pagesRequested + (outcome.robots === 'skipped' ? 0 : 1),
    connections: outcome.pagesRequested + (outcome.robots === 'skipped' ? 0 : 1),
    best: outcome.best?.value ?? null, confidence: outcome.best?.emailConfidence ?? null, access: outcome.accessFailure,
    rebased: outcome.rebased, warmed: outcome.warmed, rounds: outcome.rounds, robots: outcome.robots,
  }
}

const orders = [['v1', 'v22', 'v23'], ['v22', 'v23', 'v1'], ['v23', 'v1', 'v22'], ['v1', 'v23', 'v22'], ['v22', 'v1', 'v23'], ['v23', 'v22', 'v1']]
const rows = []
for (const [index, site] of sites.entries()) {
  const base = sanitizeWebsite(site.website)
  const host = getWebsiteHost(base)
  const policy = await createRobotsFetcher(host, { cache: null })(base) // eligibility check, outside every arm's timing
  if (!isAllowedByPolicy(policy, userAgent, base)) { process.stderr.write(`[${index + 1}/${sites.length}] ${host}: skipped (robots ${policy.kind})\n`); await sleep(400); continue }
  await sleep(800)

  const row = { n: site.n, order: orders[index % orders.length].join('>') }
  for (const arm of orders[index % orders.length]) {
    row[arm] = await ARMS[arm](site, policy)
    await sleep(1500)
  }
  rows.push(row)
  process.stderr.write(`[${index + 1}/${sites.length}] ${host}: v1 ${Math.round(row.v1.ms)}  v2.2 ${Math.round(row.v22.ms)}  v2.3 ${Math.round(row.v23.ms)} ms\n`)
  await sleep(400)
}
fs.writeFileSync(path.join(workdir, 'robots-compare.json'), JSON.stringify(rows, null, 1))

const stat = (arm, pick) => rows.map((row) => pick(row[arm]))
const line = (label, arm) => console.log(`  ${label.padEnd(26)} median ${String(Math.round(median(stat(arm, (r) => r.ms)))).padStart(5)}  p90 ${String(Math.round(p90(stat(arm, (r) => r.ms)))).padStart(5)}  mean ${String(Math.round(stat(arm, (r) => r.ms).reduce((a, b) => a + b, 0) / rows.length)).padStart(5)}  total ${String(Math.round(stat(arm, (r) => r.ms).reduce((a, b) => a + b, 0) / 1000)).padStart(3)}s | requests/site ${(stat(arm, (r) => r.requests).reduce((a, b) => a + b, 0) / rows.length).toFixed(2)}  email found ${rows.filter((row) => row[arm].best).length}/${rows.length}`)
console.log(`\nREAL-WORLD COMPARISON: ${rows.length} sites, one visit per arm per site, order rotated (robots.txt honoured)`)
line('V1', 'v1'); line('V2.2-equivalent', 'v22'); line('V2.3', 'v23')
const m = (arm) => median(stat(arm, (r) => r.ms))
console.log(`  V2.2-eq vs V1: ${((m('v22') / m('v1') - 1) * 100).toFixed(0)}% median | V2.3 vs V1: ${((m('v23') / m('v1') - 1) * 100).toFixed(0)}% median | V2.3 vs V2.2-eq: ${((m('v23') / m('v22') - 1) * 100).toFixed(0)}% median`)
const tot = (arm) => stat(arm, (r) => r.ms).reduce((a, b) => a + b, 0)
console.log(`  totals: V2.2-eq vs V1 ${((tot('v22') / tot('v1') - 1) * 100).toFixed(0)}% | V2.3 vs V1 ${((tot('v23') / tot('v1') - 1) * 100).toFixed(0)}%`)
console.log(`  V2.3 faster than V2.2-eq on ${rows.filter((r) => r.v23.ms < r.v22.ms).length}/${rows.length} sites; V2.3 at most 20% slower than V1 on ${rows.filter((r) => r.v23.ms <= r.v1.ms * 1.2).length}/${rows.length} sites`)
for (const first of ['v1', 'v22', 'v23']) {
  const subset = rows.filter((r) => r.order.startsWith(first))
  console.log(`  arm ${first} went first on ${subset.length} sites: medians v1 ${Math.round(median(subset.map((r) => r.v1.ms)))} / v2.2 ${Math.round(median(subset.map((r) => r.v22.ms)))} / v2.3 ${Math.round(median(subset.map((r) => r.v23.ms)))}`)
}
const same = rows.filter((r) => r.v22.best === r.v23.best && r.v22.confidence === r.v23.confidence).length
console.log(`  EMAIL RESULT PARITY V2.2-eq vs V2.3: identical on ${same}/${rows.length}${rows.filter((r) => r.v22.best !== r.v23.best).map((r) => ` (#${r.n}: ${r.v22.best ? 'found' : 'none'} vs ${r.v23.best ? 'found' : 'none'})`).join('')}`)
const warm = rows.map((r) => r.v23.warmed)
console.log(`  V2.3 connections opened ahead: ${warm.reduce((a, w) => a + w.opened, 0)}, used: ${warm.reduce((a, w) => a + w.used, 0)}; rebased to a canonical origin on ${rows.filter((r) => r.v23.rebased).length}/${rows.length} sites; second round needed on ${rows.filter((r) => r.v23.rounds === 2).length}`)
