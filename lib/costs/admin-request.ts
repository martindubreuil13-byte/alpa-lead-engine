import { NextResponse } from 'next/server'

import { isValidTimeZone } from '@/lib/costs/report'

const NO_STORE = { 'Cache-Control': 'no-store' }
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

/** A write must come from this site, as JSON. A form on another site can send neither. */
export function isSameSiteJson(request: Request) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  try { return new URL(origin).host === (request.headers.get('x-forwarded-host') ?? request.headers.get('host')) } catch { return false }
}

export const timeZoneOf = (value: unknown) => (typeof value === 'string' && isValidTimeZone(value) ? value : 'UTC')
