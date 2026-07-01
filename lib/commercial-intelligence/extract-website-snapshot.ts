import crypto from 'crypto'
import { load } from 'cheerio'
import type { WebsiteSnapshot, ExtractionResult } from './types'

const FETCH_TIMEOUT = 8000
const MAX_BODY_LENGTH = 2000

export async function extractWebsiteSnapshot(
  website: string | null | undefined
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
    const normalizedUrl = normalizeUrl(website)
    const html = await fetchWebsiteHtml(normalizedUrl)

    if (!html) {
      return {
        ok: false,
        error: { code: 'FETCH_FAILED', message: `Failed to fetch website: ${normalizedUrl}` },
        duration_ms: Date.now() - startTime,
        cost: 0,
      }
    }

    const snapshot = parseWebsiteSnapshot(html, normalizedUrl)
    const htmlHash = crypto.createHash('sha256').update(html).digest('hex')

    return {
      ok: true,
      data: {
        ...snapshot,
        html_hash: htmlHash,
        extracted_at: new Date().toISOString(),
      },
      duration_ms: Date.now() - startTime,
      cost: 0, // No external API cost
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'EXTRACTION_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      duration_ms: Date.now() - startTime,
      cost: 0,
    }
  }
}

function normalizeUrl(url: string): string {
  const trimmed = String(url).trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

async function fetchWebsiteHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    clearTimeout(timeout)

    if (!response.ok) return null

    return await response.text()
  } catch {
    return null
  }
}

function parseWebsiteSnapshot(html: string, baseUrl: string): Omit<WebsiteSnapshot, 'html_hash' | 'extracted_at'> {
  try {
    const $ = load(html)

    const title = $('title').text() || $('meta[property="og:title"]').attr('content') || null

    const metaDescription =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      null

    const h1 = $('h1').first().text() || null

    const bodyText = $('body').text().trim().slice(0, MAX_BODY_LENGTH)
    const bodyExcerpt = bodyText.length > 0 ? bodyText : null

    // Find navigation links
    const contactUrl = findUrl($, baseUrl, [
      'contact',
      'contact-us',
      'get-in-touch',
      'reach-out',
    ])
    const aboutUrl = findUrl($, baseUrl, ['about', 'about-us', 'team'])
    const servicesUrl = findUrl($, baseUrl, ['services', 'solutions', 'products', 'features'])

    // Extract visible email and phone
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
    const emails = html.match(emailRegex) || []
    const visibleEmail = filterGenericEmails(emails)[0] || null

    const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g
    const phones = html.match(phoneRegex) || []
    const visiblePhone = phones[0] || null

    // Extract social links
    const socialLinks = extractSocialLinks($)

    // Detect page language
    const pageLanguage = $('html').attr('lang') || 'en'

    // Extract favicon
    const faviconUrl = extractFaviconUrl($, baseUrl)

    return {
      title,
      meta_description: metaDescription,
      h1,
      body_excerpt: bodyExcerpt,
      contact_url: contactUrl,
      about_url: aboutUrl,
      services_url: servicesUrl,
      visible_email: visibleEmail,
      visible_phone: visiblePhone,
      social_links: socialLinks,
      page_language: pageLanguage,
      ...(faviconUrl ? { favicon_url: faviconUrl } : {}),
    }
  } catch {
    return {
      title: null,
      meta_description: null,
      h1: null,
      body_excerpt: null,
      contact_url: null,
      about_url: null,
      services_url: null,
      visible_email: null,
      visible_phone: null,
      social_links: {},
      page_language: 'en',
    }
  }
}

function findUrl($: any, baseUrl: string, keywords: string[]): string | null {
  const urlObj = new URL(baseUrl)
  const domain = urlObj.hostname

  const links = $('a[href]')
    .map((_: number, el: any) => $(el).attr('href'))
    .get()
    .filter(Boolean) as string[]

  for (const link of links) {
    const normalized = normalizeNavLink(link)
    if (keywords.some((kw) => normalized.includes(kw))) {
      try {
        const absoluteUrl = new URL(link, baseUrl)
        if (absoluteUrl.hostname === domain) {
          return absoluteUrl.toString()
        }
      } catch {
        // Invalid URL, skip
      }
    }
  }

  return null
}

function normalizeNavLink(link: string): string {
  return link
    .toLowerCase()
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/[^a-z0-9-]/g, '-')
}

function filterGenericEmails(emails: string[]): string[] {
  const genericPatterns = [
    'noreply',
    'no-reply',
    'donotreply',
    'do-not-reply',
    'admin',
    'info',
    'support',
    'hello',
    'hi',
    'contact',
    'sales',
    'marketing',
  ]

  return emails.filter(
    (email) => !genericPatterns.some((pattern) => email.toLowerCase().includes(pattern))
  )
}

function extractSocialLinks($: any): Record<string, string> {
  const links: Record<string, string> = {}

  const socialPatterns = {
    linkedin: /linkedin\.com/i,
    twitter: /twitter\.com|x\.com/i,
    facebook: /facebook\.com/i,
    instagram: /instagram\.com/i,
    github: /github\.com/i,
  }

  $('a[href]').each((_: number, el: any) => {
    const href = $(el).attr('href') || ''

    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      if (pattern.test(href)) {
        links[platform] = href
      }
    }
  })

  return links
}

function extractFaviconUrl($: any, baseUrl: string): string | null {
  try {
    const faviconLink =
      $('link[rel="icon"]').attr('href') ||
      $('link[rel="shortcut icon"]').attr('href') ||
      '/favicon.ico'

    if (!faviconLink) return null

    const url = new URL(faviconLink, baseUrl)
    return url.toString()
  } catch {
    return null
  }
}
