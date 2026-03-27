import * as cheerio from 'cheerio'

export type EmailConfidence = 'high' | 'medium' | 'low'

export type EmailValidationResult = {
  value: string
  emailSource: string
  emailConfidence: EmailConfidence
  isGenericEmail: boolean
  domainMatch: boolean
}

type ExtractEmailCandidateInput = {
  html: string
  pageUrl: string
  websiteHost: string
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const GENERIC_LOCAL_PARTS = new Set([
  'info',
  'contact',
  'hello',
  'admin',
  'support',
  'sales',
  'office',
])
const NO_REPLY_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
])
const BLOCKED_WEBSITE_HOSTS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'yelp.com',
  'yellowpages.com',
  'yellowpages.ca',
  'brownbook.net',
  'hotfrog.com',
  'foursquare.com',
  'mapquest.com',
  'tripadvisor.com',
]

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, '')
}

function normalizeLocalPart(email: string): string {
  return normalizeEmail(email).split('@')[0]?.split('+')[0] || ''
}

function getEmailDomain(email: string): string {
  return normalizeEmail(email).split('@')[1] || ''
}

function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email)

  if (!value || value.length < 6) {
    return false
  }

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
    return false
  }

  if (value.includes('..')) {
    return false
  }

  return true
}

function isGenericEmail(email: string): boolean {
  return GENERIC_LOCAL_PARTS.has(normalizeLocalPart(email))
}

function isNoReplyEmail(email: string): boolean {
  return NO_REPLY_LOCAL_PARTS.has(normalizeLocalPart(email))
}

function getPagePriority(pageUrl: string): number {
  try {
    const pathname = new URL(pageUrl).pathname.toLowerCase()

    if (pathname.includes('/contact')) return 3
    if (pathname.includes('/about')) return 2
    if (pathname === '/' || pathname === '') return 1
  } catch {}

  return 0
}

function getConfidenceRank(confidence: EmailConfidence): number {
  if (confidence === 'high') return 3
  if (confidence === 'medium') return 2
  return 1
}

export function sanitizeWebsite(url: string | null): string | null {
  if (!url) return null

  const trimmed = url.trim()
  if (!trimmed) return null

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function getWebsiteHost(url: string | null): string | null {
  const value = sanitizeWebsite(url)
  if (!value) return null

  try {
    return normalizeHost(new URL(value).hostname)
  } catch {
    return null
  }
}

export function isBlockedWebsiteHost(host: string | null): boolean {
  if (!host) return true

  return BLOCKED_WEBSITE_HOSTS.some(
    (blockedHost) => host === blockedHost || host.endsWith(`.${blockedHost}`)
  )
}

export function hostsClearlyRelated(left: string | null, right: string | null): boolean {
  if (!left || !right) return false

  return (
    left === right ||
    left.endsWith(`.${right}`) ||
    right.endsWith(`.${left}`)
  )
}

export function domainsClearlyMatch(websiteHost: string, emailDomain: string): boolean {
  return hostsClearlyRelated(normalizeHost(websiteHost), normalizeHost(emailDomain))
}

function decodeMailtoValue(href: string): string | null {
  const raw = href.replace(/^mailto:/i, '').split('?')[0] || ''

  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function normalizeExtractedEmail(value: string): string | null {
  const normalized = normalizeEmail(
    value
      .replace(/^mailto:/i, '')
      .replace(/[),;:.]+$/g, '')
      .replace(/^[("'`<\[]+/, '')
      .trim()
  )

  if (!isValidEmail(normalized)) {
    return null
  }

  if (isNoReplyEmail(normalized)) {
    return null
  }

  return normalized
}

function buildEmailValidationResult(
  email: string,
  pageUrl: string,
  websiteHost: string
): EmailValidationResult | null {
  const normalized = normalizeExtractedEmail(email)
  if (!normalized) {
    return null
  }

  const emailDomain = getEmailDomain(normalized)
  const domainMatch = domainsClearlyMatch(websiteHost, emailDomain)
  const generic = isGenericEmail(normalized)

  return {
    value: normalized,
    emailSource: pageUrl,
    emailConfidence: domainMatch ? (generic ? 'medium' : 'high') : 'low',
    isGenericEmail: generic,
    domainMatch,
  }
}

export function extractEmailCandidatesFromHtml({
  html,
  pageUrl,
  websiteHost,
}: ExtractEmailCandidateInput): EmailValidationResult[] {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg, iframe').remove()

  const candidates = new Map<string, EmailValidationResult>()

  $('a[href^="mailto:"]').each((_, element) => {
    const href = $(element).attr('href')
    if (!href) return

    const decoded = decodeMailtoValue(href)
    if (!decoded) return

    const candidate = buildEmailValidationResult(decoded, pageUrl, websiteHost)
    if (!candidate) return

    candidates.set(candidate.value, candidate)
  })

  const textContent = $('body').text()
  const matches = textContent.match(EMAIL_REGEX) || []

  for (const match of matches) {
    const candidate = buildEmailValidationResult(match, pageUrl, websiteHost)
    if (!candidate) continue

    const previous = candidates.get(candidate.value)
    if (!previous || getPagePriority(candidate.emailSource) > getPagePriority(previous.emailSource)) {
      candidates.set(candidate.value, candidate)
    }
  }

  return Array.from(candidates.values())
}

export function pickBestEmailCandidate(
  candidates: EmailValidationResult[]
): EmailValidationResult | null {
  if (candidates.length === 0) {
    return null
  }

  return [...candidates].sort((left, right) => {
    const confidenceDelta =
      getConfidenceRank(right.emailConfidence) - getConfidenceRank(left.emailConfidence)
    if (confidenceDelta !== 0) return confidenceDelta

    const domainMatchDelta = Number(right.domainMatch) - Number(left.domainMatch)
    if (domainMatchDelta !== 0) return domainMatchDelta

    const genericDelta = Number(left.isGenericEmail) - Number(right.isGenericEmail)
    if (genericDelta !== 0) return genericDelta

    const sourceDelta = getPagePriority(right.emailSource) - getPagePriority(left.emailSource)
    if (sourceDelta !== 0) return sourceDelta

    return left.value.localeCompare(right.value)
  })[0]
}

export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null

  const trimmed = phone.trim()
  if (!trimmed) return null

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) {
    return null
  }

  return trimmed.replace(/\s+/g, ' ')
}
