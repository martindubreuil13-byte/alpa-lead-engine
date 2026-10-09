import crypto from 'crypto'
import { load } from 'cheerio'

import { normalizeWebsiteUrl, safeFetchWebsite, type WebsiteFetchOptions } from './safe-website-fetch.ts'
import type { ExtractionResult, WebsiteSnapshot } from './types.ts'

const MAX_HOMEPAGE_TEXT = 4_000
const MAX_SUPPORTING_PAGE_TEXT = 3_000

type ResearchPageKind = NonNullable<WebsiteSnapshot['research_pages']>[number]['kind']
type ResearchPage = NonNullable<WebsiteSnapshot['research_pages']>[number]

type SnapshotOptions = {
  fetchOptions?: WebsiteFetchOptions
}

export async function extractWebsiteSnapshot(
  website: string | null | undefined,
  options: SnapshotOptions = {}
): Promise<ExtractionResult<WebsiteSnapshot>> {
  const startTime = Date.now()

  if (!website) {
    return {
      ok: false,
      error: { code: 'NO_WEBSITE', message: 'Website URL is required' },
      duration_ms: 0,
      cost: 0,
    }
  }

  try {
    const homepage = await safeFetchWebsite(normalizeWebsiteUrl(website), options.fetchOptions)
    const parsedHomepage = parseHomepage(homepage.html, homepage.url)
    const researchPages: ResearchPage[] = [
      {
        kind: 'homepage',
        url: homepage.url,
        text: extractReadableText(homepage.html, MAX_HOMEPAGE_TEXT),
      },
    ]

    const supportingPages: Array<{ kind: ResearchPageKind; url: string | null }> = [
      { kind: 'about', url: parsedHomepage.about_url },
      { kind: 'services', url: parsedHomepage.services_url },
      { kind: 'contact', url: parsedHomepage.contact_url },
    ]

    const fetchedSupportingPages = await Promise.all(
      supportingPages.map(async ({ kind, url }) => {
        if (!url) return null
        try {
          const page = await safeFetchWebsite(url, options.fetchOptions)
          return {
            kind,
            url: page.url,
            text: extractReadableText(page.html, MAX_SUPPORTING_PAGE_TEXT),
          } satisfies ResearchPage
        } catch {
          return null
        }
      })
    )

    researchPages.push(
      ...fetchedSupportingPages.filter((page): page is ResearchPage => Boolean(page?.text))
    )

    const usablePages = researchPages.filter((page) => Boolean(page.text))
    const htmlHash = crypto
      .createHash('sha256')
      .update(usablePages.map((page) => `${page.url}\n${page.text}`).join('\n\n'))
      .digest('hex')

    return {
      ok: true,
      data: {
        ...parsedHomepage,
        body_excerpt: researchPages[0]?.text.slice(0, 2_000) || null,
        research_pages: usablePages,
        source_urls: usablePages.map((page) => page.url),
        html_hash: htmlHash,
        extracted_at: new Date().toISOString(),
      },
      duration_ms: Date.now() - startTime,
      cost: 0,
    }
  } catch (err) {
    const error = err as { code?: string; message?: string }
    return {
      ok: false,
      error: {
        code: error.code || 'EXTRACTION_ERROR',
        message: error.message || 'Unable to retrieve website research',
      },
      duration_ms: Date.now() - startTime,
      cost: 0,
    }
  }
}

export function extractReadableText(html: string, maxLength: number) {
  const $ = load(html)
  $('script, style, noscript, svg, nav, header, footer, form, iframe, canvas').remove()
  const root = $('main').first().length
    ? $('main').first()
    : $('article').first().length
      ? $('article').first()
      : $('body')

  return root
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function parseHomepage(
  html: string,
  baseUrl: string
): Omit<WebsiteSnapshot, 'html_hash' | 'extracted_at' | 'research_pages' | 'source_urls'> {
  const $ = load(html)
  const title = cleanText($('title').text() || $('meta[property="og:title"]').attr('content'))
  const metaDescription = cleanText(
    $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content')
  )
  const h1 = cleanText($('h1').first().text())
  const contactUrl = findUrl($, baseUrl, ['contact', 'contact-us', 'get-in-touch', 'reach-out'])
  const aboutUrl = findUrl($, baseUrl, ['about', 'about-us', 'our-story', 'company', 'team'])
  const servicesUrl = findUrl($, baseUrl, [
    'services',
    'solutions',
    'products',
    'what-we-do',
    'features',
  ])
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
  const visibleEmail = (html.match(emailRegex) || []).find((email) => !isNoReplyEmail(email)) || null
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g
  const faviconUrl = extractFaviconUrl($, baseUrl)

  return {
    title,
    meta_description: metaDescription,
    h1,
    body_excerpt: null,
    contact_url: contactUrl,
    about_url: aboutUrl,
    services_url: servicesUrl,
    visible_email: visibleEmail,
    visible_phone: html.match(phoneRegex)?.[0] || null,
    social_links: extractSocialLinks($),
    page_language: $('html').attr('lang') || 'en',
    ...(faviconUrl ? { favicon_url: faviconUrl } : {}),
  }
}

function cleanText(value: string | undefined) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  return cleaned || null
}

function findUrl($: ReturnType<typeof load>, baseUrl: string, keywords: string[]) {
  const base = new URL(baseUrl)
  let match: string | null = null

  $('a[href]').each((_, element) => {
    if (match) return
    const href = $(element).attr('href') || ''
    const label = `${href} ${$(element).text()}`.toLowerCase()
    if (!keywords.some((keyword) => label.includes(keyword))) return

    try {
      const url = new URL(href, base)
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        url.hostname.toLowerCase() === base.hostname.toLowerCase()
      ) {
        url.hash = ''
        match = url.toString()
      }
    } catch {}
  })

  return match
}

function isNoReplyEmail(email: string) {
  return /(?:no-?reply|do-?not-?reply)/i.test(email)
}

function extractSocialLinks($: ReturnType<typeof load>) {
  const links: WebsiteSnapshot['social_links'] = {}
  const patterns = {
    linkedin: /linkedin\.com/i,
    twitter: /twitter\.com|x\.com/i,
    facebook: /facebook\.com/i,
    instagram: /instagram\.com/i,
    github: /github\.com/i,
  }

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') || ''
    for (const [platform, pattern] of Object.entries(patterns)) {
      if (pattern.test(href)) links[platform as keyof typeof links] = href
    }
  })

  return links
}

function extractFaviconUrl($: ReturnType<typeof load>, baseUrl: string) {
  try {
    const href =
      $('link[rel="icon"]').attr('href') ||
      $('link[rel="shortcut icon"]').attr('href') ||
      '/favicon.ico'
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}
