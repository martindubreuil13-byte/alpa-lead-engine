// Email enrichment V1: the original behaviour, kept as a reference and as a rollback path
// (EMAIL_INTELLIGENCE_VERSION=v1). The logic is the code that lived in app/api/scrape/route.ts
// and lib/scraper/run-scraper-shared.ts, with the network call made injectable so it can be
// benchmarked offline. Do not "improve" it: V2 is measured against this.

import * as cheerio from 'cheerio'

import {
  extractEmailCandidatesFromHtml,
  getWebsiteHost,
  hostsClearlyRelated,
  isBlockedWebsiteHost,
  pickBestEmailCandidate,
  sanitizeWebsite,
  type EmailValidationResult,
} from '../validation.ts'

const FETCH_TIMEOUT = 6000
const MAX_SECONDARY_PAGE_FETCHES = 3

export type HtmlPage = {
  html: string
  resolvedUrl: string
}

export type FetchHtml = (url: string) => Promise<HtmlPage | null>

export async function fetchHtmlV1(url: string, fetchImpl: typeof fetch = fetch) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) return null

    return {
      html: await res.text(),
      resolvedUrl: res.url || url,
    } satisfies HtmlPage
  } catch {
    return null
  }
}

export function buildSecondaryPageUrlsV1(base: string, homepage: HtmlPage | null) {
  const baseHost = getWebsiteHost(base)
  if (!baseHost) {
    return []
  }

  const candidates = new Map<string, number>()
  const anchorBase = homepage?.resolvedUrl || base
  const defaultPaths = [
    { path: '/contact', priority: 4 },
    { path: '/contact-us', priority: 4 },
    { path: '/about', priority: 3 },
    { path: '/about-us', priority: 3 },
    { path: '/team', priority: 2 },
  ]

  const addCandidate = (value: string, priority: number) => {
    try {
      const url = new URL(value, anchorBase)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return
      }

      const host = getWebsiteHost(url.toString())
      if (!host || isBlockedWebsiteHost(host) || !hostsClearlyRelated(baseHost, host)) {
        return
      }

      url.hash = ''
      url.search = ''

      const pathname = url.pathname.replace(/\/+$/, '') || '/'
      if (pathname === '/') {
        return
      }

      const normalizedUrl = `${url.origin}${pathname}`
      const previousPriority = candidates.get(normalizedUrl) || 0
      if (priority > previousPriority) {
        candidates.set(normalizedUrl, priority)
      }
    } catch {}
  }

  defaultPaths.forEach(({ path, priority }) => addCandidate(path, priority))

  if (homepage) {
    const $ = cheerio.load(homepage.html)

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href')
      if (!href) {
        return
      }

      const text = $(element).text().trim().toLowerCase()
      const hrefLower = href.toLowerCase()
      let priority = 0

      if (hrefLower.includes('contact') || text.includes('contact')) {
        priority = 4
      } else if (hrefLower.includes('about') || text.includes('about')) {
        priority = 3
      } else if (hrefLower.includes('team') || text.includes('team')) {
        priority = 2
      }

      if (priority > 0) {
        addCandidate(href, priority)
      }
    })
  }

  return [...candidates.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_SECONDARY_PAGE_FETCHES)
    .map(([url]) => url)
}

export async function enrichEmailV1(
  website: string | null,
  fetchHtml: FetchHtml = (url) => fetchHtmlV1(url)
): Promise<EmailValidationResult | null> {
  const base = sanitizeWebsite(website)
  if (!base) return null

  const originalHost = getWebsiteHost(base)
  if (!originalHost || isBlockedWebsiteHost(originalHost)) {
    return null
  }

  const candidates: EmailValidationResult[] = []
  const homepage = await fetchHtml(base)
  const pages: HtmlPage[] = []

  if (homepage) {
    const resolvedHost = getWebsiteHost(homepage.resolvedUrl)
    if (resolvedHost && !isBlockedWebsiteHost(resolvedHost) && hostsClearlyRelated(originalHost, resolvedHost)) {
      pages.push(homepage)
    }
  }

  const secondaryPageUrls = buildSecondaryPageUrlsV1(base, homepage)
  const secondaryPages = await Promise.all(secondaryPageUrls.map(async (url) => fetchHtml(url)))

  for (const page of secondaryPages) {
    if (page) {
      pages.push(page)
    }
  }

  for (const page of pages) {
    const resolvedHost = getWebsiteHost(page.resolvedUrl)
    if (!resolvedHost || isBlockedWebsiteHost(resolvedHost)) {
      continue
    }

    if (!hostsClearlyRelated(originalHost, resolvedHost)) {
      continue
    }

    candidates.push(
      ...extractEmailCandidatesFromHtml({
        html: page.html,
        pageUrl: page.resolvedUrl,
        websiteHost: resolvedHost,
      })
    )
  }

  return pickBestEmailCandidate(candidates)
}
