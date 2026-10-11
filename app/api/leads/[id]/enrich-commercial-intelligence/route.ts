import { NextResponse } from 'next/server'

// Retired in B2 Phase 0. Customers no longer start, claim or drive Business Intelligence research.
// Research is started by the server only, behind the CI_RESEARCH_ENABLED switch. This answer never
// reads or writes the queue, never calls an AI model and never authenticates the caller.
export const runtime = 'nodejs'

const retired = () =>
  NextResponse.json({ ok: false, error: 'RETIRED', message: 'Customer-triggered research has been retired.' }, { status: 410 })

export const POST = retired
export const GET = retired
