import {
  GUEST_CAPTURE_EMAIL_STORAGE_KEY,
  GUEST_LEADS_STORAGE_KEY,
  GUEST_LEADS_UPDATED_EVENT,
  GUEST_SESSION_STORAGE_KEY,
} from '@/lib/trial'
import { clearStoredScrapeResult } from '@/lib/session/scrape-result'

const USAGE_STORAGE_PREFIX = 'alpa_usage'

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function resetGuestSession(options?: { regenerateSessionId?: boolean }) {
  if (!canUseStorage()) return null

  console.log('SESSION RESET TRIGGERED')

  window.localStorage.removeItem(GUEST_LEADS_STORAGE_KEY)
  window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY)
  window.localStorage.removeItem(GUEST_CAPTURE_EMAIL_STORAGE_KEY)
  clearStoredScrapeResult()

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index)
    if (key && key.startsWith(USAGE_STORAGE_PREFIX)) {
      window.localStorage.removeItem(key)
    }
  }

  let nextSessionId: string | null = null

  if (options?.regenerateSessionId) {
    nextSessionId = crypto.randomUUID()
    window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, nextSessionId)
  }

  window.dispatchEvent(new Event(GUEST_LEADS_UPDATED_EVENT))
  return nextSessionId
}
