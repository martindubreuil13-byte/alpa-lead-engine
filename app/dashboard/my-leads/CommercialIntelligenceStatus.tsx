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

function getActivityMessage(lastCompletedAt: string | null): string {
  if (!lastCompletedAt) return ''

  const lastCompleted = new Date(lastCompletedAt)
  const now = new Date()
  const secondsAgo = Math.floor((now.getTime() - lastCompleted.getTime()) / 1000)

  if (secondsAgo < 5) return 'New business analyzed just now'
  if (secondsAgo < 60) return `Intelligence updated ${secondsAgo}s ago`
  const minutesAgo = Math.floor(secondsAgo / 60)
  if (minutesAgo < 60) return `Last profile analyzed ${minutesAgo}m ago`
  const hoursAgo = Math.floor(minutesAgo / 60)
  if (hoursAgo < 24) return `Recently analyzed: ${hoursAgo}h ago`
  return `Last analyzed: ${lastCompleted.toLocaleDateString()}`
}

export default function CommercialIntelligenceStatus() {
  const [stats, setStats] = useState<CIStatsData | null>(null)
  const [prevCompleted, setPrevCompleted] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)

  // Fetch initial stats and listen for updates
  useEffect(() => {
    const fetchInitialStats = async () => {
      try {
        const response = await fetch('/api/leads/ci-stats')
        if (response.ok) {
          const data = await response.json()
          if (data.ok && data.data) {
            setStats(data.data)
            setPrevCompleted(data.data.completed)
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
        // Trigger animation if count increased
        if (customEvent.detail.completed > (stats?.completed || 0)) {
          setIsAnimating(true)
          setTimeout(() => setIsAnimating(false), 600)
        }
        setStats(customEvent.detail)
        setPrevCompleted(customEvent.detail.completed)
      }
    }

    window.addEventListener('ci-stats-updated', handleStatsUpdate)
    return () => window.removeEventListener('ci-stats-updated', handleStatsUpdate)
  }, [stats?.completed])

  if (!stats || stats.total_leads === 0) return null

  const waiting = stats.pending
  const allComplete = stats.completed === stats.total_leads && stats.pending === 0
  const completionPercentage = stats.total_leads > 0
    ? Math.round((stats.completed / stats.total_leads) * 100)
    : 0
  const activityMessage = getActivityMessage(stats.last_completed_at)

  // Complete state: show premium completion message
  if (allComplete) {
    return (
      <div className="mb-8 rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-emerald-600/5 p-8 backdrop-blur-sm">
        <div className="space-y-4 text-center">
          <div>
            <p className="text-sm font-semibold text-emerald-300 mb-2">✓ Commercial Intelligence Complete</p>
            <p className="text-sm text-slate-400 leading-relaxed">
              Your entire lead database has been analyzed. All {stats.total_leads} {stats.total_leads === 1 ? 'business' : 'businesses'} are ready for outreach.
            </p>
          </div>
          {activityMessage && (
            <p className="text-xs text-slate-500">{activityMessage}</p>
          )}
        </div>
      </div>
    )
  }

  // In-progress state: focus on value and momentum
  return (
    <div className="mb-8 rounded-lg border border-white/10 bg-gradient-to-br from-slate-500/5 to-slate-600/5 p-8 backdrop-blur-sm">
      <div className="space-y-6">
        {/* HEADER - Minimal, value-focused */}
        <div>
          <h3 className="text-sm font-semibold text-white">Your Lead Database Is Getting Smarter</h3>
          <p className="text-xs text-slate-400 mt-1">Analyzing businesses to help you sell smarter</p>
        </div>

        {/* PRIMARY METRIC: Analyzed Count with Animation */}
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-emerald-300 tabular-nums transition-all duration-500"
            style={{ transform: isAnimating ? 'scale(1.1)' : 'scale(1)' }}>
            {stats.completed}
          </span>
          <span className="text-sm text-slate-400">
            {stats.completed === 1 ? 'business analyzed' : 'businesses analyzed'}
          </span>
        </div>

        {/* PROGRESS INDICATOR - Understated, secondary */}
        <div className="space-y-2">
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700 ease-out"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">{completionPercentage}% of {stats.total_leads}</span>
          </div>
        </div>

        {/* TO ANALYZE - Outcome focused, only if > 0 */}
        {waiting > 0 && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-xs text-slate-500 mb-1">Waiting to analyze</p>
            <p className="text-xl font-semibold text-slate-300">{waiting}</p>
          </div>
        )}

        {/* MOMENTUM - Active, rewarding */}
        {activityMessage && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-xs text-emerald-400 font-medium">
              ✨ {activityMessage}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
