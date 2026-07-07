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

function getRecentActivityText(lastCompletedAt: string | null): string {
  if (!lastCompletedAt) return ''

  const lastCompleted = new Date(lastCompletedAt)
  const now = new Date()
  const secondsAgo = Math.floor((now.getTime() - lastCompleted.getTime()) / 1000)

  if (secondsAgo < 60) return 'Last profile completed moments ago'
  const minutesAgo = Math.floor(secondsAgo / 60)
  if (minutesAgo < 60) return `Last profile completed ${minutesAgo}m ago`
  const hoursAgo = Math.floor(minutesAgo / 60)
  if (hoursAgo < 24) return `Last profile completed ${hoursAgo}h ago`
  return `Recently completed: ${lastCompleted.toLocaleDateString()}`
}

export default function CommercialIntelligenceStatus() {
  const [stats, setStats] = useState<CIStatsData | null>(null)
  const [activityText, setActivityText] = useState('')

  // Fetch initial stats and listen for updates
  useEffect(() => {
    const fetchInitialStats = async () => {
      try {
        const response = await fetch('/api/leads/ci-stats')
        if (response.ok) {
          const data = await response.json()
          if (data.ok && data.data) {
            setStats(data.data)
            setActivityText(getRecentActivityText(data.data.last_completed_at))
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
        setActivityText(getRecentActivityText(customEvent.detail.last_completed_at))
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

  // Complete state: show premium completion message
  if (allComplete) {
    return (
      <div className="mb-8 rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-emerald-600/5 p-8 backdrop-blur-sm">
        <div className="space-y-3 text-center">
          <div>
            <p className="text-sm font-semibold text-emerald-300 mb-1">✓ Commercial Intelligence Complete</p>
            <p className="text-xs text-slate-400">
              All {stats.total_leads} discovered {stats.total_leads === 1 ? 'business' : 'businesses'} have been analyzed and are ready for outreach.
            </p>
          </div>
          {activityText && (
            <p className="text-xs text-slate-500">{activityText}</p>
          )}
        </div>
      </div>
    )
  }

  // In-progress state: show active research
  return (
    <div className="mb-8 rounded-lg border border-white/10 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-slate-500/5 p-6 backdrop-blur-sm">
      <div className="space-y-5">
        {/* HEADER */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Commercial Intelligence</h3>
          <p className="text-xs text-slate-400">🔬 Researching your businesses…</p>
        </div>

        {/* PROGRESS BAR - More prominent */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Progress</span>
            <span className="text-sm font-semibold text-white">{completionPercentage}%</span>
          </div>
          <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 transition-all duration-700 shadow-lg shadow-blue-500/20"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
        </div>

        {/* KEY METRICS */}
        <div className="grid grid-cols-2 gap-3">
          {/* COMPLETED */}
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
            <p className="text-xs text-emerald-300 mb-0.5">Ready</p>
            <p className="text-lg font-bold text-emerald-300">{stats.completed}</p>
          </div>

          {/* BUSINESSES TO ANALYZE - Only show if > 0 */}
          {waiting > 0 && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2.5">
              <p className="text-xs text-blue-300 mb-0.5">To Analyze</p>
              <p className="text-lg font-bold text-blue-300">{waiting}</p>
            </div>
          )}
        </div>

        {/* FAILURES - Only show if > 0 */}
        {stats.failed > 0 && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
            <p className="text-xs text-rose-300">Failed ({stats.failed})</p>
          </div>
        )}

        {/* ACTIVITY */}
        {activityText && (
          <p className="text-xs text-slate-500 border-t border-white/5 pt-3">
            {activityText}
          </p>
        )}
      </div>
    </div>
  )
}
