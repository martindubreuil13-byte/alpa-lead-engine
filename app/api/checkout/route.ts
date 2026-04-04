import { NextResponse } from 'next/server'

import { createStarterCheckoutSession } from '@/lib/stripe'

type CheckoutRequestBody = {
  email?: string | null
  source?: string | null
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as CheckoutRequestBody | null
    const origin = new URL(req.url).origin

    const session = await createStarterCheckoutSession({
      origin,
      email: body?.email || null,
      source: body?.source || null,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start checkout'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
