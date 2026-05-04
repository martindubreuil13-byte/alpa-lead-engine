const TIME_ZONE_STORAGE_KEY = 'alpa_user_time_zone'
const DEFAULT_TIME_ZONE = 'UTC'

export function getBrowserTimeZone() {
  if (typeof window === 'undefined') {
    return DEFAULT_TIME_ZONE
  }

  try {
    const stored = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY)
    if (stored) return stored

    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, detected)
    return detected
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
  }
}
