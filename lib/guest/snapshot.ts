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
  return { used, attempts, saved, remaining, exhausted: remaining === 0 || attempts >= FREE_SEARCHES }
}

/** The result-count choices offered for the businesses still available: 10 and 25, or what is left. */
export function countOptions(remaining: number): string[] {
  const options: number[] = []
  if (remaining >= 10) options.push(10)
  if (remaining >= 25) options.push(25)
  else if (remaining > 0 && remaining !== 10) options.push(remaining)
  return (options.length ? options : [Math.max(1, remaining)]).map(String)
}
