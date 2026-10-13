import { GUEST_MAX_AGE } from './security.ts'
import type { GuestErrorCode } from './search-errors.ts'

type TrialRow = { created_at?: string | null; attempts?: number | null; used?: number | null; active_until?: string | null } | null

// reserve_guest_trial answers 0 for every refusal. The reason matters to the visitor (wait, results already saved, or a
// shared network), so it is read from the trial row afterwards; this changes no allowance and needs no database change.
export function classifyReserveRefusal(row: TrialRow, now = Date.now()): GuestErrorCode {
  if (!row) return 'GUEST_UNAVAILABLE'
  const created = Date.parse(String(row.created_at || ''))
  if (Number.isFinite(created) && created < now - GUEST_MAX_AGE * 1000) return 'GUEST_EXPIRED'
  const activeUntil = Date.parse(String(row.active_until || ''))
  if (Number.isFinite(activeUntil) && activeUntil > now) return 'GUEST_RUNNING'
  if (Number(row.attempts) >= 3) return 'GUEST_SEARCHES_USED'
  if (Number(row.used) >= 25) return 'GUEST_ALLOWANCE_USED'
  return 'GUEST_RATE_LIMITED'
}
