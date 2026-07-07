import { NextResponse } from 'next/server'
import { processCommercialIntelligenceQueue } from '@/lib/commercial-intelligence/process-queue'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

export async function POST() {
  const startedAt = Date.now()

  try {
    const profile = await getUserProfile()
    if (!profile) {
      console.log('[CI-BATCH] Unauthorized: no authenticated user')
      return NextResponse.json(
        { ok: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    console.log(`[CI-BATCH] Processing batch for user: ${profile.id}`)

    // Process one batch of items
    const result = await processCommercialIntelligenceQueue({
      limit: 10,
      source: 'worker-batch',
    })

    const elapsedMs = Date.now() - startedAt
    console.log(
      `[CI-BATCH] Complete: processed=${result.processed} succeeded=${result.succeeded} retrying=${result.retrying} failed=${result.failed} elapsed_ms=${elapsedMs}`
    )

    return NextResponse.json({
      ok: result.ok,
      processed: result.processed,
      succeeded: result.succeeded,
      retrying: result.retrying,
      failed: result.failed,
      recovered: result.recovered,
      stats: result.stats,
      elapsedMs,
      message: result.message,
    })
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    console.error('[CI-BATCH] Error:', err)
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        elapsedMs,
      },
      { status: 500 }
    )
  }
}
