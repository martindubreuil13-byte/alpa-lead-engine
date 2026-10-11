import { timingSafeEqual } from 'node:crypto'

/** Bearer-token check for the scheduled worker. Constant-time; an unset secret never authorizes anything. */
export function isCommercialIntelligenceCronAuthorized(request: Request, secret = process.env.CRON_SECRET) {
  if (!secret) return false
  const supplied = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
