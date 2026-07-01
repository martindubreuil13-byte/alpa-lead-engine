import { load } from 'cheerio'
import type { BusinessSignals, ExtractionResult } from './types'

const FETCH_TIMEOUT = 8000

interface PageAnalysisResult {
  html: string
  statusCode: number
  responseTimeMs: number
}

export async function generateBusinessSignals(
  website: string | null | undefined
): Promise<ExtractionResult<BusinessSignals>> {
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

    // Check HTTPS
    const hasHttps = normalizedUrl.startsWith('https://')

    // Fetch homepage
    const homepage = await fetchPage(normalizedUrl)
    if (!homepage) {
      return {
        ok: false,
        error: { code: 'FETCH_FAILED', message: `Failed to fetch website: ${normalizedUrl}` },
        duration_ms: Date.now() - startTime,
        cost: 0,
      }
    }

    // Analyze homepage
    const homeSignals = analyzePageContent(homepage.html, normalizedUrl)

    // Fetch key pages in parallel
    const urlsToCheck = [
      { url: findPageUrl(homepage.html, normalizedUrl, ['contact']), key: 'contact' },
      { url: findPageUrl(homepage.html, normalizedUrl, ['about']), key: 'about' },
      { url: findPageUrl(homepage.html, normalizedUrl, ['services', 'solutions', 'products']), key: 'services' },
    ]

    const pageChecks = await Promise.all(
      urlsToCheck.map(async ({ url, key }) => {
        if (!url) return { key, exists: false, signals: {} }
        const page = await fetchPage(url)
        return {
          key,
          exists: page !== null,
          signals: page ? analyzePageContent(page.html, normalizedUrl) : {},
        }
      })
    )

    const signals: BusinessSignals = {
      has_https: hasHttps,
      has_contact_page: pageChecks.find((p) => p.key === 'contact')?.exists || false,
      has_about_page: pageChecks.find((p) => p.key === 'about')?.exists || false,
      has_services_page: pageChecks.find((p) => p.key === 'services')?.exists || false,
      has_pricing: homeSignals.hasPricing,
      has_testimonials: homeSignals.hasTestimonials,
      has_blog: homeSignals.hasBlog,
      has_faq: homeSignals.hasFaq,
      has_booking_link: homeSignals.hasBookingLink,
      has_social_links: homeSignals.hasSocialLinks,
      has_visible_email: homeSignals.hasVisibleEmail,
      has_visible_phone: homeSignals.hasVisiblePhone,
      detected_cms: homeSignals.detectedCms,
      detected_ecommerce_platform: homeSignals.detectedEcommerce,
      response_time_ms: homepage.responseTimeMs,
      detected_at: new Date().toISOString(),
    }

    return {
      ok: true,
      data: signals,
      duration_ms: Date.now() - startTime,
      cost: 0, // No external API cost
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'ANALYSIS_ERROR',
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

async function fetchPage(url: string): Promise<PageAnalysisResult | null> {
  try {
    const startTime = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    clearTimeout(timeout)

    if (!response.ok) return null

    const html = await response.text()
    const responseTimeMs = Date.now() - startTime

    return {
      html,
      statusCode: response.status,
      responseTimeMs,
    }
  } catch {
    return null
  }
}

function analyzePageContent(
  html: string,
  baseUrl: string
): {
  hasPricing: boolean
  hasTestimonials: boolean
  hasBlog: boolean
  hasFaq: boolean
  hasBookingLink: boolean
  hasSocialLinks: boolean
  hasVisibleEmail: boolean
  hasVisiblePhone: boolean
  detectedCms: string | undefined
  detectedEcommerce: string | undefined
} {
  try {
    const $ = load(html)
    const lowerHtml = html.toLowerCase()

    // Pricing indicators
    const hasPricing = !!(
      $('[class*="pricing"]').length > 0 ||
      $('[id*="pricing"]').length > 0 ||
      lowerHtml.includes('$') ||
      lowerHtml.includes('pricing') ||
      lowerHtml.includes('plan') ||
      lowerHtml.includes('cost')
    )

    // Testimonials
    const hasTestimonials = !!(
      $('[class*="testimonial"]').length > 0 ||
      $('[class*="review"]').length > 0 ||
      $('[class*="quote"]').length > 0 ||
      lowerHtml.includes('testimonial') ||
      lowerHtml.includes('case study')
    )

    // Blog
    const hasBlog = !!(
      $('[class*="blog"]').length > 0 ||
      $('a[href*="/blog"]').length > 0 ||
      $('a[href*="/news"]').length > 0 ||
      lowerHtml.includes('latest posts') ||
      lowerHtml.includes('article')
    )

    // FAQ
    const hasFaq = !!(
      $('[class*="faq"]').length > 0 ||
      $('[id*="faq"]').length > 0 ||
      lowerHtml.includes('frequently asked')
    )

    // Booking link (Calendly, Acuity, etc.)
    const hasBookingLink = !!(
      lowerHtml.includes('calendly') ||
      lowerHtml.includes('acuity') ||
      lowerHtml.includes('booking') ||
      $('a[href*="calendly"]').length > 0 ||
      $('a[href*="acuity"]').length > 0
    )

    // Social links
    const hasSocialLinks = !!(
      $('a[href*="linkedin"]').length > 0 ||
      $('a[href*="twitter"]').length > 0 ||
      $('a[href*="facebook"]').length > 0 ||
      $('a[href*="instagram"]').length > 0 ||
      $('a[href*="github"]').length > 0
    )

    // Email & phone
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    const hasVisibleEmail = emailRegex.test(html)

    const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/
    const hasVisiblePhone = phoneRegex.test(html)

    // CMS detection
    let detectedCms: string | undefined
    if (lowerHtml.includes('wordpress')) detectedCms = 'WordPress'
    else if (lowerHtml.includes('webflow')) detectedCms = 'Webflow'
    else if (lowerHtml.includes('squarespace')) detectedCms = 'Squarespace'
    else if (lowerHtml.includes('wix')) detectedCms = 'Wix'
    else if (lowerHtml.includes('shopify')) detectedCms = 'Shopify'
    else if (lowerHtml.includes('next.js')) detectedCms = 'Next.js'
    else if (lowerHtml.includes('gatsby')) detectedCms = 'Gatsby'

    // E-commerce platform detection
    let detectedEcommerce: string | undefined
    if (lowerHtml.includes('shopify')) detectedEcommerce = 'Shopify'
    else if (lowerHtml.includes('woocommerce')) detectedEcommerce = 'WooCommerce'
    else if (lowerHtml.includes('magento')) detectedEcommerce = 'Magento'
    else if ($('[class*="cart"]').length > 0 || $('[id*="cart"]').length > 0) {
      detectedEcommerce = 'E-commerce (Unknown)'
    }

    return {
      hasPricing,
      hasTestimonials,
      hasBlog,
      hasFaq,
      hasBookingLink,
      hasSocialLinks,
      hasVisibleEmail,
      hasVisiblePhone,
      detectedCms,
      detectedEcommerce,
    }
  } catch {
    return {
      hasPricing: false,
      hasTestimonials: false,
      hasBlog: false,
      hasFaq: false,
      hasBookingLink: false,
      hasSocialLinks: false,
      hasVisibleEmail: false,
      hasVisiblePhone: false,
      detectedCms: undefined,
      detectedEcommerce: undefined,
    }
  }
}

function findPageUrl(html: string, baseUrl: string, keywords: string[]): string | null {
  try {
    const $ = load(html)
    const urlObj = new URL(baseUrl)
    const domain = urlObj.hostname

    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .filter(Boolean) as string[]

    for (const link of links) {
      const normalized = link.toLowerCase().replace(/^\//, '')
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
  } catch {
    return null
  }
}
