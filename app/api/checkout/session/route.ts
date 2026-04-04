import { NextResponse } from 'next/server'

import { getCheckoutEmail, getCheckoutSession, isCheckoutUnlocked } from '@/lib/stripe'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('session_id') || ''
    const session = await getCheckoutSession(sessionId)

    return NextResponse.json({
      verified: isCheckoutUnlocked(session),
      email: getCheckoutEmail(session),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify checkout'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
