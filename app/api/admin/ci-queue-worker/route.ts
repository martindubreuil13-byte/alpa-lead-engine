import { processCommercialIntelligenceQueue } from '@/lib/commercial-intelligence/process-queue'
import { getQueueStats } from '@/lib/commercial-intelligence/queue-manager'
import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const maxDuration = 300 // 5 minutes for queue processing

/**
 * Worker endpoint to manually process Commercial Intelligence enrichment queue.
 *
 * The shared queue processor is also called by the scrape request after
 * discovery enqueues leads, so this route remains a manual/admin entry point.
 */
export async function POST(req: Request) {
  try {
    const profile = await getUserProfile()
    if (!profile || !isAdmin(profile)) {
      console.log('[CI-Worker] Unauthorized attempt')
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Admin access required',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await processCommercialIntelligenceQueue({
      limit: 10,
      source: 'admin-route',
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[CI-Worker] Unhandled exception', err)
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * GET /api/admin/ci-queue-worker - Check queue status
 */
export async function GET(req: Request) {
  try {
    const profile = await getUserProfile()
    if (!profile || !isAdmin(profile)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Admin access required',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const stats = await getQueueStats()

    return new Response(
      JSON.stringify({
        ok: true,
        stats,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
