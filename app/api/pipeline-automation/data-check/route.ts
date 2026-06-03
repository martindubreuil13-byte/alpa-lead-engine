import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const PAGE_SIZE = 1000

type DistributionRow = {
  key: string
  count: number
}

function addCount(map: Map<string, number>, value: string | null | undefined) {
  const key = String(value || '').trim() || 'null'
  map.set(key, (map.get(key) || 0) + 1)
}

function toRows(map: Map<string, number>): DistributionRow[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
}

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const statusCounts = new Map<string, number>()
    const stageCounts = new Map<string, number>()
    let total = 0
    let page = 0

    while (true) {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      const { data, error } = await supabase
        .from('leads')
        .select('status, pipeline_stage')
        .eq('user_id', userId)
        .range(from, to)

      if (error) {
        console.error('[pipeline-automation/data-check] fetch error:', error)
        return NextResponse.json({ error: 'DATA_CHECK_FAILED' }, { status: 500 })
      }

      const rows = data || []
      for (const row of rows) {
        addCount(statusCounts, row.status)
        addCount(stageCounts, row.pipeline_stage)
      }

      total += rows.length
      if (rows.length < PAGE_SIZE) break
      page += 1
    }

    return NextResponse.json({
      total,
      status: toRows(statusCounts),
      pipeline_stage: toRows(stageCounts),
    })
  } catch (error) {
    console.error('[pipeline-automation/data-check] GET error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
