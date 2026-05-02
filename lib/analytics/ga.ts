'use client'

type GtagParams = Record<string, string | number | boolean | undefined | null>

declare global {
  interface Window {
    gtag?: (command: 'event', eventName: string, params?: Record<string, unknown>) => void
  }
}

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const

const UTM_STORAGE_KEY = 'alpa_utm_params'

function readStoredUtms() {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.sessionStorage.getItem(UTM_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}

    return UTM_KEYS.reduce<Record<string, string>>((acc, key) => {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) {
        acc[key] = value.trim()
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

export function preserveUtmParams() {
  if (typeof window === 'undefined') return {}

  try {
    const searchParams = new URLSearchParams(window.location.search)
    const incomingUtms = UTM_KEYS.reduce<Record<string, string>>((acc, key) => {
      const value = searchParams.get(key)?.trim()
      if (value) acc[key] = value
      return acc
    }, {})

    if (Object.keys(incomingUtms).length === 0) {
      return readStoredUtms()
    }

    const nextUtms = {
      ...readStoredUtms(),
      ...incomingUtms,
    }

    window.sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(nextUtms))
    return nextUtms
  } catch {
    return {}
  }
}

function getExistingSessionId() {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage.getItem('session_id') || null
  } catch {
    return null
  }
}

function cleanParams(params: GtagParams = {}) {
  return Object.entries(params).reduce<Record<string, string | number | boolean>>((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') return acc
    acc[key] = value
    return acc
  }, {})
}

export function getSourcePage() {
  if (typeof window === 'undefined') return undefined
  return window.location.pathname || undefined
}

export function trackEvent(eventName: string, params: GtagParams = {}) {
  if (typeof window === 'undefined') return

  const utmParams = preserveUtmParams()
  const sessionId = getExistingSessionId()
  const eventParams = cleanParams({
    ...utmParams,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...params,
  })

  if (typeof window.gtag !== 'function') {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[ga]', eventName, eventParams)
    }
    return
  }

  try {
    window.gtag('event', eventName, eventParams)
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[ga] event failed', eventName, error)
    }
  }
}

