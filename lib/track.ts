'use client'

const ATTRIBUTION_KEY = 'alpa_attribution'
const FIRST_VISIT_KEY = 'alpa_first_visit_tracked'
const CURRENT_SEARCH_KEY = 'alpa_current_search_id'
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

function getDeviceType() {
  if (typeof window === 'undefined') return null
  const ua = window.navigator.userAgent
  if (/ipad|tablet/i.test(ua)) return 'tablet'
  if (/mobile|iphone|ipod|android/i.test(ua)) return 'mobile'
  return 'desktop'
}

function getBrowser() {
  if (typeof window === 'undefined') return null
  const ua = window.navigator.userAgent
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari'
  if (/Firefox\//.test(ua)) return 'Firefox'
  return 'Other'
}

function getOperatingSystem() {
  if (typeof window === 'undefined') return null
  const ua = window.navigator.userAgent
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Other'
}

function readJsonObject(key: string) {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function getAttribution() {
  if (typeof window === 'undefined') return {}

  const searchParams = new URLSearchParams(window.location.search)
  const incoming = UTM_KEYS.reduce<Record<string, string>>((acc, key) => {
    const value = searchParams.get(key)?.trim()
    if (value) acc[key] = value
    return acc
  }, {})
  const existing = readJsonObject(ATTRIBUTION_KEY)
  const firstLandingPage =
    typeof existing.first_landing_page === 'string' && existing.first_landing_page
      ? existing.first_landing_page
      : `${window.location.pathname}${window.location.search}`

  const attribution = {
    ...existing,
    ...incoming,
    referrer:
      typeof existing.referrer === 'string' && existing.referrer
        ? existing.referrer
        : document.referrer || null,
    first_landing_page: firstLandingPage,
    device_type: getDeviceType(),
    browser: getBrowser(),
    operating_system: getOperatingSystem(),
  }

  try {
    window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution))
  } catch {}

  return attribution
}

export function createAnalyticsSearchId() {
  if (typeof window === 'undefined') return null
  const searchId = window.crypto.randomUUID()
  window.localStorage.setItem(CURRENT_SEARCH_KEY, searchId)
  return searchId
}

export function getCurrentAnalyticsSearchId() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(CURRENT_SEARCH_KEY)
  } catch {
    return null
  }
}

export function clearCurrentAnalyticsSearchId(searchId?: string | null) {
  if (typeof window === 'undefined') return
  try {
    const current = window.localStorage.getItem(CURRENT_SEARCH_KEY)
    if (!searchId || current === searchId) {
      window.localStorage.removeItem(CURRENT_SEARCH_KEY)
    }
  } catch {}
}

export function shouldTrackFirstVisit() {
  if (typeof window === 'undefined') return false
  try {
    if (window.localStorage.getItem(FIRST_VISIT_KEY) === '1') return false
    window.localStorage.setItem(FIRST_VISIT_KEY, '1')
    return true
  } catch {
    return false
  }
}

export async function trackEvent(event: string, data: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const session_id =
      window.localStorage.getItem('session_id') || window.crypto.randomUUID()
    window.localStorage.setItem('session_id', session_id)
    const explicitSearchId = typeof data.search_id === 'string' ? data.search_id : null
    const search_id = explicitSearchId || getCurrentAnalyticsSearchId()

    const response = await fetch('/api/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event,
        session_id,
        search_id,
        source_page: `${window.location.pathname}${window.location.search}`,
        ...getAttribution(),
        ...data,
      }),
    })

    if (!response.ok) {
      console.error('Track failed:', new Error(`Track API responded with ${response.status}`))
      return null
    }

    return response.json().catch(() => null)
  } catch (err) {
    console.error('Track failed:', err)
    return null
  }
}
