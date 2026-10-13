// What a visitor is told when a search cannot run. The server names the reason with a code; anything unexpected (a proxy
// timeout page, a dropped connection) gets a plain message instead of a parser error or raw HTML.

export type GuestErrorCode =
  | 'GUEST_RUNNING'
  | 'GUEST_SEARCHES_USED'
  | 'GUEST_ALLOWANCE_USED'
  | 'GUEST_RATE_LIMITED'
  | 'GUEST_EXPIRED'
  | 'GUEST_UNAVAILABLE'
  | 'GUEST_ORIGIN'
  | 'GUEST_INVALID'

export type SearchFailureKind =
  | 'running'
  | 'limit'
  | 'rate'
  | 'expired'
  | 'unavailable'
  | 'invalid'
  | 'offline'
  | 'network'
  | 'timeout'
  | 'server'
  | 'unknown'

export type SearchFailure = {
  kind: SearchFailureKind
  message: string
  /** Trying the same search again can work (nothing was used, or the cause is temporary). */
  retryable: boolean
  /** The visitor's saved results are available to open. */
  resultsAvailable: boolean
}

export const GUEST_MESSAGES: Record<GuestErrorCode, string> = {
  GUEST_RUNNING: 'A search is still finishing. Your businesses will appear in a moment.',
  GUEST_SEARCHES_USED: 'You have used the free searches. Your businesses are saved and ready to view.',
  GUEST_ALLOWANCE_USED: 'You have used all 25 free businesses. Your businesses are saved and ready to view.',
  GUEST_RATE_LIMITED: 'Many free searches have come from your network today. Please try again tomorrow, or from another connection.',
  GUEST_EXPIRED: 'This free trial has expired. Start a new search to begin again.',
  GUEST_UNAVAILABLE: 'The free search is temporarily unavailable. Nothing was used. Please try again shortly.',
  GUEST_ORIGIN: 'This page could not start a search. Please reload ALPA and try again.',
  GUEST_INVALID: 'Enter a business type and a location to search.',
}

const KIND_BY_CODE: Record<GuestErrorCode, SearchFailureKind> = {
  GUEST_RUNNING: 'running',
  GUEST_SEARCHES_USED: 'limit',
  GUEST_ALLOWANCE_USED: 'limit',
  GUEST_RATE_LIMITED: 'rate',
  GUEST_EXPIRED: 'expired',
  GUEST_UNAVAILABLE: 'unavailable',
  GUEST_ORIGIN: 'unavailable',
  GUEST_INVALID: 'invalid',
}

export function isGuestErrorCode(value: unknown): value is GuestErrorCode {
  return typeof value === 'string' && value in GUEST_MESSAGES
}

/** Reads an error body that is JSON, one server-sent-event line, or anything else (HTML, plain text) without throwing. */
export function parseErrorBody(text: string): { message?: string; code?: string } | null {
  const trimmed = String(text || '').trim()
  if (!trimmed || trimmed.startsWith('<')) return null
  const candidate = trimmed.split('\n').map((line) => line.trim()).find((line) => line.startsWith('data:'))?.slice(5).trim() ?? trimmed
  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object') {
      return {
        message: typeof parsed.message === 'string' ? parsed.message : typeof parsed.error === 'string' ? parsed.error : undefined,
        code: typeof parsed.code === 'string' ? parsed.code : undefined,
      }
    }
  } catch {
    // not JSON
  }
  return null
}

export function describeSearchFailure(input: {
  status?: number
  code?: string | null
  /** The request could not be made or was cut off (fetch rejected). */
  networkError?: boolean
  stalled?: boolean
  offline?: boolean
}): SearchFailure {
  if (isGuestErrorCode(input.code)) {
    const kind = KIND_BY_CODE[input.code]
    return {
      kind,
      message: GUEST_MESSAGES[input.code],
      retryable: kind === 'unavailable' || kind === 'expired' || kind === 'invalid',
      resultsAvailable: kind === 'limit' || kind === 'running',
    }
  }
  if (input.offline) {
    return { kind: 'offline', message: 'You appear to be offline. Reconnect and try again. Nothing was used.', retryable: true, resultsAvailable: false }
  }
  if (input.stalled) {
    return { kind: 'timeout', message: 'The connection stopped responding. Please try again.', retryable: true, resultsAvailable: false }
  }
  if (input.networkError) {
    return { kind: 'network', message: 'The connection was interrupted before the search could finish. Please try again.', retryable: true, resultsAvailable: false }
  }
  const status = input.status ?? 0
  if (status === 504 || status === 408) {
    return { kind: 'timeout', message: 'The search took too long to respond. Please try again.', retryable: true, resultsAvailable: false }
  }
  if (status === 429) {
    return { kind: 'rate', message: GUEST_MESSAGES.GUEST_RATE_LIMITED, retryable: false, resultsAvailable: false }
  }
  if (status >= 500) {
    return { kind: 'server', message: 'The free search is temporarily unavailable. Please try again shortly.', retryable: true, resultsAvailable: false }
  }
  return { kind: 'unknown', message: 'The search could not be completed. Please try again.', retryable: true, resultsAvailable: false }
}

/** Browsers embedded in social apps keep storage and cookies separate from the phone's browser. */
export function detectInAppBrowser(userAgent: string): string | null {
  const ua = String(userAgent || '')
  if (/Instagram/i.test(ua)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook'
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'tiktok'
  if (/LinkedInApp/i.test(ua)) return 'linkedin'
  if (/Snapchat/i.test(ua)) return 'snapchat'
  if (/Line\//i.test(ua)) return 'line'
  if (/Twitter|TwitterAndroid/i.test(ua)) return 'twitter'
  if (/Pinterest/i.test(ua)) return 'pinterest'
  return null
}
