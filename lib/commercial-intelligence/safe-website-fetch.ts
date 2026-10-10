import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { isNonPublicAddress } from './ip-safety.ts'
import { pinnedFetch, stripBrackets, withDeadline } from './pinned-fetch.ts'
import { getWebsiteUserAgent } from './user-agent.ts'

export { isNonPublicAddress }

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 1_000_000
const DEFAULT_MAX_REDIRECTS = 3

export type WebsiteFetchResult = {
  html: string
  url: string
  statusCode: number
  responseTimeMs: number
  /** True when the page exceeded the byte limit and only its first `maxBytes` were read. */
  truncated?: boolean
}

export type WebsiteFetchOptions = {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  fetchImpl?: typeof fetch
  resolveHostname?: (hostname: string) => Promise<string[]>
  userAgent?: string
  /** Accept responses with no content type or any text/* type, not only HTML. */
  lenientContentType?: boolean
  /** Return the first `maxBytes` of an oversized page instead of rejecting it. */
  truncateAtMaxBytes?: boolean
  /** Called with every redirect target before it is followed. Return false to stop. */
  isRedirectAllowed?: (target: URL) => boolean
  /** Treat bot-challenge pages ("Just a moment...", access-denied walls) as blocked, not as content. */
  detectBotChallenge?: boolean
}

/** Why a website could not be read. Additive: error codes are unchanged. */
export type WebsiteFailure = 'unavailable' | 'blocked' | 'timeout' | 'too_large' | 'unsupported' | 'unsafe'

export type WebsiteFetchErrorCode =
  | 'INVALID_URL'
  | 'UNSAFE_URL'
  | 'FETCH_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'INVALID_CONTENT_TYPE'
  | 'RESPONSE_TOO_LARGE'

const DEFAULT_FAILURE: Record<WebsiteFetchErrorCode, WebsiteFailure> = {
  INVALID_URL: 'unsafe',
  UNSAFE_URL: 'unsafe',
  FETCH_FAILED: 'unavailable',
  TOO_MANY_REDIRECTS: 'unavailable',
  INVALID_CONTENT_TYPE: 'unsupported',
  RESPONSE_TOO_LARGE: 'too_large',
}

export class WebsiteFetchError extends Error {
  readonly code: WebsiteFetchErrorCode
  readonly failure: WebsiteFailure
  readonly statusCode: number | null
  /** True when the refusal was an anti-bot interstitial rather than a plain HTTP error. */
  readonly challenge: boolean

  constructor(
    code: WebsiteFetchErrorCode,
    message: string,
    extra: { failure?: WebsiteFailure; statusCode?: number; challenge?: boolean } = {}
  ) {
    super(message)
    this.name = 'WebsiteFetchError'
    this.code = code
    this.failure = extra.failure ?? DEFAULT_FAILURE[code]
    this.statusCode = extra.statusCode ?? null
    this.challenge = extra.challenge ?? false
  }
}

const CHALLENGE_TITLE =
  /<title[^>]*>\s*(?:just a moment|one moment,? please|attention required|access denied|verifying you are human|are you a robot|checking your browser|security check|please wait|one more step|ddos protection|you have been blocked|request blocked)/i
// Markers that only appear on interstitials. The generic "/cdn-cgi/challenge-platform" script is
// deliberately NOT here: Cloudflare injects it into ordinary pages as well.
const CHALLENGE_BODY =
  /cf-browser-verification|cf_chl_opt|__cf_chl_|id=["']challenge-form|challenge-error-text|_incapsula_resource|px-captcha|captcha-delivery\.com|sucuri\.net\/privacy|enable javascript and cookies to continue|why have i been blocked|checking if the site connection is secure/i

/** Conservative: only short interstitial pages are treated as challenges, never ordinary sites. */
export function looksLikeBotChallenge(html: string, headers?: Headers): boolean {
  if (headers?.get('cf-mitigated')?.toLowerCase() === 'challenge') return true
  if (html.length > 60_000) return false
  return CHALLENGE_TITLE.test(html) || CHALLENGE_BODY.test(html)
}

function classifyThrown(error: unknown, timedOut: boolean): WebsiteFetchError {
  if (error instanceof WebsiteFetchError) return error
  const name = (error as { name?: string })?.name
  const code = (error as { code?: string })?.code
  const message = error instanceof Error ? error.message : 'Unknown website fetch error'

  if (timedOut || name === 'AbortError') {
    return new WebsiteFetchError('FETCH_FAILED', 'Website request timed out', { failure: 'timeout' })
  }
  if (code === 'ERR_UNSAFE_ADDRESS') {
    return new WebsiteFetchError('UNSAFE_URL', 'Website resolves to a non-public network address')
  }
  return new WebsiteFetchError('FETCH_FAILED', message, { failure: 'unavailable' })
}

export async function safeFetchWebsite(
  input: string,
  options: WebsiteFetchOptions = {}
): Promise<WebsiteFetchResult> {
  const fetchImpl = options.fetchImpl ?? pinnedFetch
  const resolveHostname = options.resolveHostname ?? resolvePublicAddresses
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const startedAt = Date.now()

  let currentUrl = normalizeWebsiteUrl(input)

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const parsedUrl = await assertPublicHttpUrl(currentUrl, resolveHostname, timeoutMs)
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetchImpl(parsedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': options.userAgent ?? getWebsiteUserAgent(),
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        if (!location) {
          throw new WebsiteFetchError('FETCH_FAILED', 'Redirect response is missing a location')
        }
        if (redirectCount >= maxRedirects) {
          throw new WebsiteFetchError('TOO_MANY_REDIRECTS', 'Website exceeded the redirect limit')
        }
        const target = new URL(location, parsedUrl)
        // Unsafe targets (private address, bad scheme, credentials) are security failures and are
        // reported as such before the softer "left the business website" rule is considered.
        await assertPublicHttpUrl(target.toString(), resolveHostname, timeoutMs)
        if (options.isRedirectAllowed && !options.isRedirectAllowed(target)) {
          // The site moved elsewhere; that is an availability result, not a security event.
          throw new WebsiteFetchError('UNSAFE_URL', 'Redirect left the business website', { failure: 'unavailable' })
        }
        currentUrl = target.toString()
        continue
      }

      if (!response.ok) {
        const blockedStatus = [401, 403, 407, 429].includes(response.status)
        let challenged = false
        if (options.detectBotChallenge) {
          const snippet = await readBoundedText(response, 16_384, true).then((read) => read.text).catch(() => '')
          challenged = looksLikeBotChallenge(snippet, response.headers)
        } else {
          await response.body?.cancel().catch(() => undefined)
        }
        throw new WebsiteFetchError('FETCH_FAILED', `Website returned HTTP ${response.status}`, {
          failure: blockedStatus || challenged ? 'blocked' : 'unavailable',
          statusCode: response.status,
          challenge: challenged,
        })
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() || ''
      const htmlType =
        contentType.includes('text/html') || contentType.includes('application/xhtml+xml')
      const lenientType =
        options.lenientContentType && (!contentType || contentType.startsWith('text/'))
      if (!htmlType && !lenientType) {
        throw new WebsiteFetchError('INVALID_CONTENT_TYPE', 'Website did not return HTML')
      }

      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > maxBytes && !options.truncateAtMaxBytes) {
        throw new WebsiteFetchError('RESPONSE_TOO_LARGE', 'Website response exceeded the size limit')
      }

      const { text: html, truncated } = await readBoundedText(response, maxBytes, options.truncateAtMaxBytes)
      if (options.detectBotChallenge && looksLikeBotChallenge(html, response.headers)) {
        throw new WebsiteFetchError('FETCH_FAILED', 'Website returned a bot-challenge page', {
          failure: 'blocked',
          statusCode: response.status,
          challenge: true,
        })
      }
      return {
        html,
        url: parsedUrl.toString(),
        statusCode: response.status,
        responseTimeMs: Date.now() - startedAt,
        truncated,
      }
    } catch (error) {
      throw classifyThrown(error, timedOut)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new WebsiteFetchError('TOO_MANY_REDIRECTS', 'Website exceeded the redirect limit')
}

export function normalizeWebsiteUrl(input: string) {
  const trimmed = String(input || '').trim()
  if (!trimmed) {
    throw new WebsiteFetchError('INVALID_URL', 'Website URL is empty')
  }

  // "ftp://x", "file:///x", "javascript:x" must be rejected, not wrapped into an https URL.
  // (A bare "host:8080" is a port, not a scheme, and is still accepted.)
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i)?.[1]
  if (scheme && !/^https?$/i.test(scheme)) {
    throw new WebsiteFetchError('UNSAFE_URL', 'Only public HTTP(S) website URLs are allowed')
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(candidate).toString()
  } catch {
    throw new WebsiteFetchError('INVALID_URL', 'Website URL is invalid')
  }
}

async function assertPublicHttpUrl(
  input: string,
  resolveHostname: (hostname: string) => Promise<string[]>,
  lookupTimeoutMs: number
) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new WebsiteFetchError('INVALID_URL', 'Website URL is invalid')
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new WebsiteFetchError('UNSAFE_URL', 'Only public HTTP(S) website URLs are allowed')
  }

  const hostname = stripBrackets(url.hostname.toLowerCase()).replace(/\.$/, '')
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    (!hostname.includes('.') && !isIP(hostname)) // single-label names resolve through search domains
  ) {
    throw new WebsiteFetchError('UNSAFE_URL', 'Local or internal website URLs are not allowed')
  }

  const addresses = isIP(hostname)
    ? [hostname]
    : await withDeadline(resolveHostname(hostname), lookupTimeoutMs, () =>
        new WebsiteFetchError('FETCH_FAILED', 'Website hostname lookup timed out', { failure: 'timeout' })
      )
  if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
    throw new WebsiteFetchError('UNSAFE_URL', 'Website resolves to a non-public network address')
  }

  return url
}

export async function resolvePublicAddresses(hostname: string) {
  try {
    const results = await lookup(hostname, { all: true, verbatim: true })
    return results.map((result) => result.address)
  } catch {
    throw new WebsiteFetchError('FETCH_FAILED', 'Website hostname could not be resolved')
  }
}

async function readBoundedText(response: Response, maxBytes: number, truncate = false): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    if (bytesRead > maxBytes) {
      await reader.cancel().catch(() => undefined)
      if (!truncate) {
        throw new WebsiteFetchError('RESPONSE_TOO_LARGE', 'Website response exceeded the size limit')
      }
      const keep = value.byteLength - (bytesRead - maxBytes)
      if (keep > 0) text += decoder.decode(value.subarray(0, keep), { stream: true })
      return { text: text + decoder.decode(), truncated: true }
    }
    text += decoder.decode(value, { stream: true })
  }

  return { text: text + decoder.decode(), truncated: false }
}

function isRedirect(status: number) {
  return [301, 302, 303, 307, 308].includes(status)
}
