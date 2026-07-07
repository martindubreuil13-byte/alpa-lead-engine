import { NextResponse } from 'next/server'
import { processCommercialIntelligenceQueue } from '@/lib/commercial-intelligence/process-queue'

export const runtime = 'nodejs'

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  const headerSecret = req.headers.get('x-cron-secret')

  return authHeader === `Bearer ${secret}` || headerSecret === secret
}

export async function GET(request: Request) {
  const startedAt = Date.now()

  try {
    if (!isAuthorized(request)) {
      console.error('[CI-CRON] Unauthorized: invalid token')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('[CI-CRON] Processing queue...')

    const result = await processCommercialIntelligenceQueue({
      limit: 20,
      source: 'vercel-cron',
    })

    const elapsedMs = Date.now() - startedAt
    console.log(
      `[CI-CRON] Complete: processed=${result.processed} succeeded=${result.succeeded} retrying=${result.retrying} failed=${result.failed} recovered=${result.recovered} elapsed_ms=${elapsedMs}`
    )

    return NextResponse.json({
      ok: result.ok,
      message: result.message,
      processed: result.processed,
      succeeded: result.succeeded,
      retrying: result.retrying,
      failed: result.failed,
      recovered: result.recovered,
      stats: result.stats,
      elapsedMs,
    })
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    console.error('[CI-CRON] Error:', err)
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
