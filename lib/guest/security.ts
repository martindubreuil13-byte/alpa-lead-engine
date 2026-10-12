import { createHmac, timingSafeEqual } from 'node:crypto'

export const GUEST_COOKIE = 'alpa_guest_trial'
export const GUEST_MAX_AGE = 30 * 24 * 60 * 60
export function signGuestId(id: string, key: string) {
 return `${id}.${createHmac('sha256', key).update(`guest-session:${id}`).digest('hex')}`
}
export function readGuestId(token: string | undefined, key: string) {
 if (!token || !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) return null
 const [id] = token.split('.')
 const expected = signGuestId(id, key)
 return timingSafeEqual(Buffer.from(token), Buffer.from(expected)) ? id : null
}
export function guestRateBucket(address: string, key: string, date = new Date()) {
 return createHmac('sha256', key).update(`guest-rate:${date.toISOString().slice(0,10)}:${address}`).digest('hex')
}
export function validExportEmail(value: unknown): value is string {
 return typeof value === 'string' && value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
export function sameOrigin(req: Request) {
 return req.headers.get('origin') === new URL(req.url).origin
}
