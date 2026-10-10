// Offline V1 vs V2 email-extraction benchmark. Run with:
//   node --experimental-strip-types scripts/benchmark-email-intelligence.mjs
// Uses only the synthetic fixtures in tests/fixtures/email-sites.mjs. No network, no database.
// Everything it prints is MEASURED ON SYNTHETIC FIXTURES; it is not a real-world coverage claim.

import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

import { extractEmailCandidatesFromHtml } from '../lib/validation.ts'
import { enrichEmailV1, fetchHtmlV1 } from '../lib/scraper/email-enrichment-v1.ts'
import { createSafePageFetcher, enrichEmailV2 } from '../lib/scraper/email-enrichment.ts'
import { extractEmailCandidatesV2 } from '../lib/scraper/email-intelligence.ts'
import { createFixtureFetch, PUBLIC_RESOLVER, SITES } from '../tests/fixtures/email-sites.mjs'

const SIMULATED_LATENCY_MS = 25

function grade(best, acceptable) {
  if (!best) return 'none'
  const correct = acceptable.includes(best.value)
  if (best.emailConfidence === 'low') return correct ? 'low_correct' : 'low_wrong'
  return correct ? 'relevant_correct' : 'relevant_wrong'
}

async function runV1(site) {
  const requests = []
  const fixtureFetch = createFixtureFetch(site, { requests, latency: SIMULATED_LATENCY_MS })
  const started = performance.now()
  const best = await enrichEmailV1(site.website, (url) => fetchHtmlV1(url, fixtureFetch))
  return { best, ms: performance.now() - started, requests: requests.length }
}

async function runV2(site) {
  const requests = []
  const fixtureFetch = createFixtureFetch(site, { requests, latency: SIMULATED_LATENCY_MS })
  const host = new URL(site.website).hostname
  const fetchPage = createSafePageFetcher(host, { fetchImpl: fixtureFetch, resolveHostname: PUBLIC_RESOLVER })
  const started = performance.now()
  const outcome = await enrichEmailV2(site.website, { fetchPage })
  return { best: outcome.best, outcome, ms: performance.now() - started, requests: requests.length }
}

function allPages(site) {
  const pages = Object.entries(site.pages).map(([path, html]) => ({ url: new URL(path, site.website).href, html }))
  for (const [url, html] of Object.entries(site.externalPages || {})) pages.push({ url, html })
  return pages
}

function extractorAccuracy(extract) {
  let truePositives = 0
  let falsePositives = 0
  let falseNegatives = 0
  for (const site of SITES) {
    const found = new Set()
    for (const { url, html } of allPages(site)) {
      const host = new URL(url).hostname.replace(/^www\./, '')
      extract({ html, pageUrl: url, websiteHost: host }).forEach((candidate) => found.add(candidate.value))
    }
    for (const email of found) site.acceptable.includes(email) ? (truePositives += 1) : (falsePositives += 1)
    for (const email of site.acceptable) if (!found.has(email)) falseNegatives += 1
  }
  const extracted = truePositives + falsePositives
  return {
    extracted,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: extracted ? truePositives / extracted : 1,
    recall: truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : 1,
    falsePositiveRate: extracted ? falsePositives / extracted : 0,
  }
}

function extractionCost(extract) {
  const pages = SITES.filter((site) => !site.knownV2Miss).flatMap(allPages)
  const rounds = 40
  const started = performance.now()
  for (let round = 0; round < rounds; round += 1) {
    for (const { url, html } of pages) {
      extract({ html, pageUrl: url, websiteHost: new URL(url).hostname.replace(/^www\./, '') })
    }
  }
  return { pages: pages.length, msPerPage: (performance.now() - started) / (rounds * pages.length) }
}

export async function runBenchmark() {
  const rows = []
  for (const site of SITES) {
    const v1 = await runV1(site)
    const v2 = await runV2(site)
    rows.push({
      id: site.id,
      acceptable: site.acceptable,
      knownV2Miss: Boolean(site.knownV2Miss),
      v1,
      v2,
      v1Grade: grade(v1.best, site.acceptable),
      v2Grade: grade(v2.best, site.acceptable),
    })
  }

  const count = (key, grades) => rows.filter((row) => grades.includes(row[key])).length
  const distribution = (key) => ({
    high: rows.filter((row) => row[key].best?.emailConfidence === 'high').length,
    medium: rows.filter((row) => row[key].best?.emailConfidence === 'medium').length,
    low: rows.filter((row) => row[key].best?.emailConfidence === 'low').length,
    none: rows.filter((row) => !row[key].best).length,
  })

  const withTruth = SITES.filter((site) => site.acceptable.length > 0).length
  const v1Correct = count('v1Grade', ['relevant_correct'])
  const v2Correct = count('v2Grade', ['relevant_correct'])

  return {
    businesses: SITES.length,
    businessesWithAPublishedEmail: withTruth,
    rows,
    v1: {
      foundAny: rows.filter((row) => row.v1.best).length,
      relevantCorrect: v1Correct,
      relevantWrong: count('v1Grade', ['relevant_wrong']),
      lowReturned: count('v1Grade', ['low_correct', 'low_wrong']),
      lowWrong: count('v1Grade', ['low_wrong']),
      coverage: v1Correct / SITES.length,
      distribution: distribution('v1'),
      pagesRequested: rows.reduce((sum, row) => sum + row.v1.requests, 0),
      wallMs: rows.reduce((sum, row) => sum + row.v1.ms, 0),
      extractor: extractorAccuracy(extractEmailCandidatesFromHtml),
      extractionCost: extractionCost(extractEmailCandidatesFromHtml),
    },
    v2: {
      foundAny: rows.filter((row) => row.v2.best).length,
      relevantCorrect: v2Correct,
      relevantWrong: count('v2Grade', ['relevant_wrong']),
      lowReturned: count('v2Grade', ['low_correct', 'low_wrong']),
      lowWrong: count('v2Grade', ['low_wrong']),
      coverage: v2Correct / SITES.length,
      distribution: distribution('v2'),
      pagesRequested: rows.reduce((sum, row) => sum + row.v2.requests, 0),
      wallMs: rows.reduce((sum, row) => sum + row.v2.ms, 0),
      rounds: rows.reduce((sum, row) => sum + (row.v2.outcome.rounds || 0), 0),
      extractor: extractorAccuracy(extractEmailCandidatesV2),
      extractionCost: extractionCost(extractEmailCandidatesV2),
    },
    recovered: rows.filter((row) => row.v2Grade === 'relevant_correct' && row.v1Grade !== 'relevant_correct').map((row) => row.id),
    regressed: rows.filter((row) => row.v1Grade === 'relevant_correct' && row.v2Grade !== 'relevant_correct').map((row) => row.id),
    confidenceChanges: rows
      .filter((row) => row.v1.best && row.v2.best && row.v1.best.value === row.v2.best.value && row.v1.best.emailConfidence !== row.v2.best.emailConfidence)
      .map((row) => `${row.id}: ${row.v1.best.emailConfidence} -> ${row.v2.best.emailConfidence}`),
  }
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`
}

async function main() {
  const result = await runBenchmark()
  const { v1, v2 } = result
  const line = (label, a, b) => console.log(`${label.padEnd(46)}${String(a).padStart(10)}${String(b).padStart(10)}`)

  console.log(`\nEMAIL INTELLIGENCE BENCHMARK (synthetic fixtures; ${result.businesses} businesses, ${result.businessesWithAPublishedEmail} publish a real email)\n`)
  line('', 'V1', 'V2')
  line('Returned any address', v1.foundAny, v2.foundAny)
  line('Relevant + correct (high/medium)', v1.relevantCorrect, v2.relevantCorrect)
  line('Relevant but WRONG (false positive)', v1.relevantWrong, v2.relevantWrong)
  line('Low-confidence returned (not coverage)', v1.lowReturned, v2.lowReturned)
  line('  of which wrong/unrelated', v1.lowWrong, v2.lowWrong)
  line('Email coverage (relevant+correct / all)', pct(v1.coverage), pct(v2.coverage))
  line('Confidence: high', v1.distribution.high, v2.distribution.high)
  line('Confidence: medium', v1.distribution.medium, v2.distribution.medium)
  line('Confidence: low', v1.distribution.low, v2.distribution.low)
  line('No address returned', v1.distribution.none, v2.distribution.none)
  console.log('\nCandidate extraction (every page, all addresses extracted):')
  line('Extracted addresses', v1.extractor.extracted, v2.extractor.extracted)
  line('Precision', pct(v1.extractor.precision), pct(v2.extractor.precision))
  line('Recall', pct(v1.extractor.recall), pct(v2.extractor.recall))
  line('False-positive rate', pct(v1.extractor.falsePositiveRate), pct(v2.extractor.falsePositiveRate))
  console.log('\nProcessing (simulated 25 ms per page; extraction timed on this machine):')
  line('Pages requested (all sites)', v1.pagesRequested, v2.pagesRequested)
  line('Wall-clock, all sites (ms)', Math.round(v1.wallMs), Math.round(v2.wallMs))
  line('Extraction CPU per page (ms)', v1.extractionCost.msPerPage.toFixed(3), v2.extractionCost.msPerPage.toFixed(3))

  console.log('\nRecovered by V2:', result.recovered.join(', ') || 'none')
  console.log('Regressed in V2:', result.regressed.join(', ') || 'none')
  console.log('Confidence changes on the same address:', result.confidenceChanges.join('; ') || 'none')
  console.log('\nPer-site (V1 grade | V2 grade | V2 pages):')
  for (const row of result.rows) {
    console.log(`  ${row.id.padEnd(34)} ${row.v1Grade.padEnd(17)} ${row.v2Grade.padEnd(17)} ${row.v2.requests}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main()
