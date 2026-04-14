'use client'

const SESSION_STORAGE_KEY = 'alpa_session_id'

export function getSessionId() {
  if (typeof window === 'undefined') {
    return ''
  }

  const existingSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (existingSessionId) {
    return existingSessionId
  }

  const nextSessionId = crypto.randomUUID()
  window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId)
  return nextSessionId
}
