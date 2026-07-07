import { createServerClient } from '@/lib/supabase/server'

interface CIStats {
  total_leads: number
  not_started: number
  pending: number
  processing: number
  completed: number
  failed: number
  skipped: number
  completion_percentage: number
  avg_processing_seconds: number | null
  last_completed_at: string | null
  actively_processing: boolean
}

export default async function CommercialIntelligenceStatus() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    const { data: statsResult, error } = await supabase.rpc('get_ci_statistics', {
      p_user_id: user.id,
    })

    if (error) {
      console.error('[CI-Status] RPC error:', error)
      return null
    }

    if (!statsResult || statsResult.length === 0) {
      console.error('[CI-Status] RPC returned no rows')
      return null
    }

    const stats: CIStats = statsResult[0]

    if (stats.total_leads === 0) return null

    const waiting = stats.pending + stats.not_started
    const allAnalyzed = stats.completed === stats.total_leads

    return (
      <div className="mb-8 rounded-lg border border-white/10 bg-gradient-to-r from-emerald-500/5 via-blue-500/5 to-purple-500/5 p-6 backdrop-blur-sm">
        <div className="space-y-4">
          {/* HEADER */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Commercial Intelligence</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {allAnalyzed
                  ? '✓ All businesses analyzed'
                  : '⚡ ALPA is analyzing your businesses in the background'}
              </p>
            </div>
          </div>

          {/* KEY METRICS */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            {/* READY */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <div>
                <p className="text-xl font-bold text-emerald-400">{stats.completed}</p>
                <p className="text-xs text-emerald-300">Ready to use</p>
              </div>
            </div>

            {/* WAITING */}
            {waiting > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div>
                  <p className="text-xl font-bold text-blue-400">{waiting}</p>
                  <p className="text-xs text-blue-300">Waiting</p>
                </div>
              </div>
            )}

            {/* FAILED */}
            {stats.failed > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
                <div>
                  <p className="text-xl font-bold text-rose-400">{stats.failed}</p>
                  <p className="text-xs text-rose-300">Failed</p>
                </div>
              </div>
            )}
          </div>

          {/* PROGRESS INDICATOR */}
          <div className="flex items-center gap-3 pt-2">
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-700"
                style={{ width: `${stats.completion_percentage}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 font-medium">{stats.completion_percentage}%</p>
          </div>

          {/* LAST ACTIVITY */}
          {stats.last_completed_at && (
            <p className="text-xs text-slate-500 pt-2 border-t border-white/5">
              Last completed: {new Date(stats.last_completed_at).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
    )
  } catch (err) {
    console.error('[CI-Status] error:', err)
    return null
  }
}
