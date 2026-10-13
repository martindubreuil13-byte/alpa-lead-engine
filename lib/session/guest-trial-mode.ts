import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/guest/safe-storage'

const GUEST_TRIAL_MODE_STORAGE_KEY = 'alpa_guest_trial_mode'

export function isGuestTrialModeForced() {
  return safeGetItem('session', GUEST_TRIAL_MODE_STORAGE_KEY) === '1'
}

export function enableGuestTrialMode() {
  safeSetItem('session', GUEST_TRIAL_MODE_STORAGE_KEY, '1')
}

export function clearGuestTrialMode() {
  safeRemoveItem('session', GUEST_TRIAL_MODE_STORAGE_KEY)
}
