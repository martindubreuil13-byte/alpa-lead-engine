import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 1_000_000
const DEFAULT_MAX_REDIRECTS = 3

export type WebsiteFetchResult = {
  html: string
  url: string
  statusCode: number
  responseTimeMs: number
}

export type WebsiteFetchOptions = {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  fetchImpl?: typeof fetch
  resolveHostname?: (hostname: string) => Promise<string[]>
}

export class WebsiteFetchError extends Error {
  readonly code:
    | 'INVALID_URL'
    | 'UNSAFE_URL'
    | 'FETCH_FAILED'
    | 'TOO_MANY_REDIRECTS'
    | 'INVALID_CONTENT_TYPE'
    | 'RESPONSE_TOO_LARGE'

  constructor(
    code:
      | 'INVALID_URL'
      | 'UNSAFE_URL'
      | 'FETCH_FAILED'
      | 'TOO_MANY_REDIRECTS'
      | 'INVALID_CONTENT_TYPE'
      | 'RESPONSE_TOO_LARGE',
    message: string
  ) {
    super(message)
    this.name = 'WebsiteFetchError'
    this.code = code
  }
}

export async function safeFetchWebsite(
  input: string,
  options: WebsiteFetchOptions = {}
): Promise<WebsiteFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const resolveHostname = options.resolveHostname ?? resolvePublicAddresses
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const startedAt = Date.now()

  let currentUrl = normalizeWebsiteUrl(input)

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const parsedUrl = await assertPublicHttpUrl(currentUrl, resolveHostname)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(parsedUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ALPAResearch/1.0; +https://alpa.mindrasolutions.com)',
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
        currentUrl = new URL(location, parsedUrl).toString()
        continue
      }

      if (!response.ok) {
        throw new WebsiteFetchError('FETCH_FAILED', `Website returned HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() || ''
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new WebsiteFetchError('INVALID_CONTENT_TYPE', 'Website did not return HTML')
      }

      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > maxBytes) {
        throw new WebsiteFetchError('RESPONSE_TOO_LARGE', 'Website response exceeded the size limit')
      }

      const html = await readBoundedText(response, maxBytes)
      return {
        html,
        url: parsedUrl.toString(),
        statusCode: response.status,
        responseTimeMs: Date.now() - startedAt,
      }
    } catch (error) {
      if (error instanceof WebsiteFetchError) throw error
      const message = error instanceof Error ? error.message : 'Unknown website fetch error'
      throw new WebsiteFetchError('FETCH_FAILED', message)
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

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(candidate).toString()
  } catch {
    throw new WebsiteFetchError('INVALID_URL', 'Website URL is invalid')
  }
}

async function assertPublicHttpUrl(
  input: string,
  resolveHostname: (hostname: string) => Promise<string[]>
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

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new WebsiteFetchError('UNSAFE_URL', 'Local or internal website URLs are not allowed')
  }

  const addresses = isIP(hostname) ? [hostname] : await resolveHostname(hostname)
  if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
    throw new WebsiteFetchError('UNSAFE_URL', 'Website resolves to a non-public network address')
  }

  return url
}

async function resolvePublicAddresses(hostname: string) {
  try {
    const results = await lookup(hostname, { all: true, verbatim: true })
    return results.map((result) => result.address)
  } catch {
    throw new WebsiteFetchError('FETCH_FAILED', 'Website hostname could not be resolved')
  }
}

export function isNonPublicAddress(address: string) {
  const normalized = address.toLowerCase().split('%')[0]

  if (normalized.startsWith('::ffff:')) {
    return isNonPublicAddress(normalized.slice('::ffff:'.length))
  }

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224
    )
  }

  if (isIP(normalized) === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    )
  }

  return true
}

async function readBoundedText(response: Response, maxBytes: number) {
  if (!response.body) return ''

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
      throw new WebsiteFetchError('RESPONSE_TOO_LARGE', 'Website response exceeded the size limit')
    }
    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}

function isRedirect(status: number) {
  return [301, 302, 303, 307, 308].includes(status)
}
