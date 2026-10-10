// Stand-ins for the three modules that reach the network, used by the end-to-end test through a module
// loader. They replace ONLY the network edge:
//   - searchSerperMaps / searchGooglePlaces: return the canned listings, mapped exactly as serper.ts maps
//     a place (same category helper, same fields). Google adds nothing.
//   - enrichEmailWithInspection / enrichEmail: feed the website fixtures to the REAL enrichEmailV2 (the real
//     page planner, extractor, classifier and inspection mapping), with no sockets and no robots.txt fetch.

import { enrichEmailV2 } from '../../../lib/scraper/email-enrichment.ts'
import { inspectionFromOutcome } from '../../../lib/scraper/email-inspection.ts'
import { serperPlaceCategory } from '../../../lib/sources/category.ts'
import { RAW_PLACES, SITES } from './world.mjs'

export async function searchSerperMaps({ query, city, maxResults, send }) {
  send?.(`🔎 Serper query: ${query}`)
  const leads = []
  const seen = new Set()
  for (const place of RAW_PLACES) {
    if (leads.length >= maxResults) break
    const company = String(place.title || '').trim()
    if (!company) continue
    const key = `${company.toLowerCase()}::${place.website || ''}::${place.phoneNumber || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    leads.push({
      company_name: company,
      phone: place.phoneNumber || null,
      website: place.website || null,
      email: null,
      industry: serperPlaceCategory(place),
      city,
      source: 'serper_maps',
      source_url: place.website || null,
    })
  }
  send?.(`📦 Serper final leads: ${leads.length}`)
  return leads
}

export async function searchGooglePlaces() {
  return []
}

const hostOf = (website) => new URL(website).hostname.replace(/^www\./, '')

export async function enrichEmailWithInspection(website) {
  const site = SITES[hostOf(website)]
  const outcome = await enrichEmailV2(website, {
    fetchRobots: async () => site?.robots ?? [],
    fetchPage: async (url) => {
      const entry = site?.pages[new URL(url).pathname] ?? site?.pages['*']
      if (!entry) return { ok: false, failure: 'not_found' }
      if (entry.failure) return { ok: false, failure: entry.failure }
      return { ok: true, page: { html: entry.html, resolvedUrl: entry.resolvedUrl ?? url } }
    },
  })
  return { record: outcome.best, inspection: inspectionFromOutcome(outcome) }
}

export async function enrichEmail(website) {
  return (await enrichEmailWithInspection(website)).record
}
