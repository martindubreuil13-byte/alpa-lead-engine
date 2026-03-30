const GUEST_TRIAL_MODE_STORAGE_KEY = 'alpa_guest_trial_mode'

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function isGuestTrialModeForced() {
  if (!canUseSessionStorage()) return false
  return window.sessionStorage.getItem(GUEST_TRIAL_MODE_STORAGE_KEY) === '1'
}

export function enableGuestTrialMode() {
  if (!canUseSessionStorage()) return
  window.sessionStorage.setItem(GUEST_TRIAL_MODE_STORAGE_KEY, '1')
}

export function clearGuestTrialMode() {
  if (!canUseSessionStorage()) return
  window.sessionStorage.removeItem(GUEST_TRIAL_MODE_STORAGE_KEY)
}
