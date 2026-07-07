import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

/**
 * Webhook called when Commercial Intelligence enrichment completes.
 * Revalidates the My Leads page to fetch fresh data.
 * Called by: lib/commercial-intelligence/queue-manager.ts completeEnrichment()
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))

    // Revalidate the My Leads page to show updated enrichment status
    revalidatePath('/dashboard/my-leads')

    // Also revalidate Leads page in case it's open
    revalidatePath('/dashboard/leads')

    console.log('[CI-Webhook] Page revalidated after enrichment completion')

    return NextResponse.json({
      ok: true,
      message: 'Pages revalidated',
    })
  } catch (err) {
    console.error('[CI-Webhook] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook failed' },
      { status: 500 }
    )
  }
}
