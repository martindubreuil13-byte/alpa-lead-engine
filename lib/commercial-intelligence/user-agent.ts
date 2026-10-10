// The User-Agent ALPA sends when it reads a business's public website.
//
// Policy: say who we are. The default names the product and points at the public product site.
// It deliberately does not start with "Mozilla/5.0" (that would claim browser compatibility) and
// never borrows another crawler's name. The value can be changed with ALPA_FETCH_USER_AGENT, but
// only to something that still identifies a product; anything else is ignored and the default is
// used, so a typo or an impersonation attempt in configuration cannot weaken the policy.
//
// The variable is read on every call at runtime (never at build time) and is server-only.

export const USER_AGENT_ENV = 'ALPA_FETCH_USER_AGENT'
export const DEFAULT_WEBSITE_USER_AGENT = 'ALPA-Business-Intelligence/1.0 (+https://alpa.mindrasolutions.com)'

// Other crawlers and browsers: claiming to be one of these is impersonation.
const IMPERSONATION =
  /googlebot|google-inspectiontool|adsbot|bingbot|msnbot|slurp|duckduckbot|baiduspider|yandex|applebot|facebookexternalhit|facebot|twitterbot|linkedinbot|pinterestbot|semrushbot|ahrefsbot|mj12bot|petalbot|curl\/|wget\/|python-requests|\bchrome\/|\bchromium\/|\bsafari\/|\bfirefox\/|\bedg\/|\bopr\/|\bmsie\b|\btrident\/|applewebkit|\bgecko\//i

export type UserAgentResolution = {
  userAgent: string
  source: 'default' | 'configured'
  /** Why a configured value was ignored. Never contains the value itself. */
  ignored?: 'too_short' | 'too_long' | 'not_ascii' | 'no_product_token' | 'no_url' | 'impersonation'
}

export function resolveWebsiteUserAgent(configured: string | null | undefined): UserAgentResolution {
  const fallback = (ignored?: UserAgentResolution['ignored']): UserAgentResolution => ({
    userAgent: DEFAULT_WEBSITE_USER_AGENT,
    source: 'default',
    ...(ignored ? { ignored } : {}),
  })

  const value = String(configured ?? '').trim()
  if (!value) return fallback()

  if (value.length < 12) return fallback('too_short')
  if (value.length > 200) return fallback('too_long')
  if (!/^[\x20-\x7e]+$/.test(value)) return fallback('not_ascii') // also rejects CR/LF header injection
  if (!/(^|[\s(;])[A-Za-z][A-Za-z0-9._-]*\/[0-9][A-Za-z0-9._-]*/.test(value)) return fallback('no_product_token')
  if (!/\+?https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) return fallback('no_url')
  if (IMPERSONATION.test(value)) return fallback('impersonation')

  return { userAgent: value, source: 'configured' }
}

let warned = false

/** The User-Agent to send now. A rejected configuration is reported once per process, without its value. */
export function getWebsiteUserAgent(): string {
  const resolution = resolveWebsiteUserAgent(process.env[USER_AGENT_ENV])
  if (resolution.ignored && !warned) {
    warned = true
    console.warn(`[WEBSITE-FETCH] ${USER_AGENT_ENV} ignored (${resolution.ignored}); using the default ALPA user agent`)
  }
  return resolution.userAgent
}
