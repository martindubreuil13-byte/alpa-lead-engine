import type { GuestSnapshot } from './recovery.ts'

/** The visitor's saved trial as the server holds it. Null when it cannot be read; never throws. */
export async function fetchGuestSnapshot(timeoutMs = 8_000): Promise<GuestSnapshot | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('/api/guest/session', { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as GuestSnapshot
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const FREE_BUSINESSES = 25
export const FREE_SEARCHES = 3

/** What the visitor can still do, from the server's record. */
export function describeAllowance(snapshot: Pick<GuestSnapshot, 'used' | 'attempts' | 'leads'> | null) {
  const used = Math.max(0, Number(snapshot?.used ?? 0))
  const attempts = Math.max(0, Number(snapshot?.attempts ?? 0))
  const saved = Array.isArray(snapshot?.leads) ? snapshot!.leads!.length : 0
  const remaining = Math.max(0, FREE_BUSINESSES - used)
  const exhausted = remaining === 0 || attempts >= FREE_SEARCHES
  // `discovered` is what was actually delivered (the server reconciles `used` to the delivered count), never what was requested.
  const discovered = used || saved
  return { used, attempts, saved, discovered, remaining, exhausted, lastBusiness: !exhausted && remaining === 1 }
}

/** The one-line status for a returning visitor who still has free businesses, from the server's record. */
export function remainingNotice(allowance: { discovered: number; remaining: number }): string {
  const { discovered, remaining } = allowance
  const found = `${discovered} ${discovered === 1 ? 'business' : 'businesses'}`
  return `You've discovered ${found}. You have ${remaining} free ${remaining === 1 ? 'business' : 'businesses'} remaining.`
}

/** The search button's label: the last free business is named as such. */
export function searchButtonLabel(allowance: { lastBusiness: boolean }): string {
  return allowance.lastBusiness ? 'Find my last business →' : 'Find businesses'
}

/** The result-count choices offered for the businesses still available: 10 and 25, or what is left (never a minimum of 10). */
export function countOptions(remaining: number): string[] {
  const options: number[] = []
  if (remaining >= 10) options.push(10)
  if (remaining >= 25) options.push(25)
  else if (remaining > 0 && remaining !== 10) options.push(remaining)
  return (options.length ? options : [Math.max(1, remaining)]).map(String)
}
