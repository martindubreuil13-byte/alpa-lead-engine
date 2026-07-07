'use client'

import { useEffect, useState } from 'react'

interface CIStatsData {
  total_leads: number
  completed: number
  pending: number
  processing: number
  failed: number
  last_completed_at: string | null
}

export default function CommercialIntelligenceStatus() {
  const [stats, setStats] = useState<CIStatsData | null>(null)

  // Fetch initial stats and listen for updates
  useEffect(() => {
    const fetchInitialStats = async () => {
      try {
        const response = await fetch('/api/leads/ci-stats')
        if (response.ok) {
          const data = await response.json()
          if (data.ok && data.data) {
            setStats(data.data)
          }
        }
      } catch (err) {
        console.error('[CI-Status] Error fetching stats:', err)
      }
    }

    // Fetch on mount
    fetchInitialStats()

    // Listen for real-time stats updates from worker
    const handleStatsUpdate = (event: Event) => {
      const customEvent = event as CustomEvent
      if (customEvent.detail) {
        setStats(customEvent.detail)
      }
    }

    window.addEventListener('ci-stats-updated', handleStatsUpdate)
    return () => window.removeEventListener('ci-stats-updated', handleStatsUpdate)
  }, [])

  if (!stats || stats.total_leads === 0) return null

  const waiting = stats.pending
  const allComplete = stats.completed === stats.total_leads && stats.pending === 0
  const completionPercentage = stats.total_leads > 0
    ? Math.round((stats.completed / stats.total_leads) * 100)
    : 0

  const statusMessage = allComplete
    ? '✓ Commercial Intelligence is up to date'
    : '⚡ Researching your businesses…'

  return (
    <div className="mb-8 rounded-lg border border-white/10 bg-gradient-to-r from-emerald-500/5 via-blue-500/5 to-purple-500/5 p-6 backdrop-blur-sm">
      <div className="space-y-4">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Business Profiles</h3>
            <p className="text-xs text-slate-400 mt-0.5">{statusMessage}</p>
          </div>
        </div>

        {/* KEY METRICS - Only show what matters */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          {/* READY */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div>
              <p className="text-xl font-bold text-emerald-400">{stats.completed}</p>
              <p className="text-xs text-emerald-300">Ready</p>
            </div>
          </div>

          {/* WAITING - Only show if > 0 */}
          {waiting > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div>
                <p className="text-xl font-bold text-blue-400">{waiting}</p>
                <p className="text-xs text-blue-300">Waiting</p>
              </div>
            </div>
          )}

          {/* FAILED - Only show if > 0 */}
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
              className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-500"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 font-medium">{completionPercentage}%</p>
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
}
