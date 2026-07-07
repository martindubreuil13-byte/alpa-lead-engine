import { NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

interface CIStats {
  total_leads: number
  completed: number
  pending: number
  processing: number
  failed: number
  last_completed_at: string | null
}

export async function GET() {
  try {
    const profile = await getUserProfile()
    if (!profile) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const supabase = await createServerClient()
    const { data: statsResult, error } = await supabase.rpc('get_ci_statistics', {
      p_user_id: profile.id,
    })

    if (error) {
      console.error('[CI-STATS] RPC error:', error)
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch statistics' },
        { status: 500 }
      )
    }

    if (!statsResult || statsResult.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No statistics available' },
        { status: 404 }
      )
    }

    const stats = statsResult[0]
    const response: CIStats = {
      total_leads: stats.total_leads || 0,
      completed: stats.completed || 0,
      pending: (stats.pending || 0) + (stats.not_started || 0),
      processing: stats.processing || 0,
      failed: stats.failed || 0,
      last_completed_at: stats.last_completed_at || null,
    }

    return NextResponse.json({ ok: true, data: response })
  } catch (err) {
    console.error('[CI-STATS] Error:', err)
    return NextResponse.json(
      { ok: false, error: 'Server error' },
      { status: 500 }
    )
  }
}
