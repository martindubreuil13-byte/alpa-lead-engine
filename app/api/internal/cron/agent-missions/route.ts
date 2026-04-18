import { NextResponse } from 'next/server'

import { executeMissionRun } from '@/lib/agent/mission-executor'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const MAX_MISSIONS_PER_TICK = Math.max(1, Number(process.env.AGENT_CRON_BATCH_SIZE || 10))
const CRON_CONCURRENCY = Math.max(1, Number(process.env.AGENT_CRON_CONCURRENCY || 2))

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  const headerSecret = req.headers.get('x-cron-secret')

  return authHeader === `Bearer ${secret}` || headerSecret === secret
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date().toISOString()

    const { data: dueMissions, error } = await admin
      .from('agent_missions')
      .select('id')
      .in('status', ['active', 'scheduled'])
      .not('next_run_at', 'is', null)
      .lte('next_run_at', now)
      .order('next_run_at', { ascending: true })
      .limit(MAX_MISSIONS_PER_TICK)

    if (error) {
      throw error
    }

    const missionIds = ((dueMissions ?? []) as Array<{ id: string }>).map((mission) => mission.id)
    let queueIndex = 0
    const results: Awaited<ReturnType<typeof executeMissionRun>>[] = []

    const workerCount = Math.min(CRON_CONCURRENCY, missionIds.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (queueIndex < missionIds.length) {
        const index = queueIndex
        queueIndex += 1
        const missionId = missionIds[index]
        if (!missionId) continue
        results.push(await executeMissionRun({ missionId, triggerType: 'scheduler' }))
      }
    })

    await Promise.all(workers)

    return NextResponse.json({
      success: true,
      checkedAt: now,
      dueMissionCount: missionIds.length,
      results,
    })
  } catch (error) {
    console.error('[cron/agent-missions] error:', error)
    return NextResponse.json({ error: 'CRON_FAILED' }, { status: 500 })
  }
}
