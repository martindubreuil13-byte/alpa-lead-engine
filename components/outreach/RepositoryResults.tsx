import { ArrowRight } from 'lucide-react'

interface RepositoryResultsProps {
  totalMatches: number
  matchesWithCI: number
  matchesWithoutCI: number
  recommendation: {
    advice: string
    priorityField: string | null
    priorityValue: string | null
    confidence: number
  } | null
  onNext: () => void
  onAdjust?: () => void
  onDiscover?: () => void
}

const RECOMMENDED_CAPACITY = 20

export function RepositoryResults({
  totalMatches,
  matchesWithCI,
  matchesWithoutCI,
  recommendation,
  onNext,
  onAdjust,
  onDiscover,
}: RepositoryResultsProps) {
  const hasEnoughMatches = totalMatches >= 5
  const recommendedCapacity = Math.min(RECOMMENDED_CAPACITY, totalMatches)
  const percentWithCI = totalMatches > 0 ? Math.round((matchesWithCI / totalMatches) * 100) : 0

  if (totalMatches === 0) {
    return (
      <div className="space-y-6">
        <div className="space-y-3 text-center py-12">
          <p className="text-base text-white">
            I didn't find any matching businesses in your library.
          </p>
          <p className="text-sm text-slate-400">
            Try discovering new businesses or refining your search.
          </p>
        </div>

        {onDiscover && (
          <button
            type="button"
            onClick={onDiscover}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
          >
            Discover Businesses
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  if (!hasEnoughMatches) {
    return (
      <div className="space-y-6">
        <div className="space-y-4 py-8">
          <p className="text-base text-white">
            I found {totalMatches} business{totalMatches !== 1 ? 'es' : ''} in your library.
          </p>
          <p className="text-sm text-slate-400">
            I recommend discovering more before starting outreach to have better quality options.
          </p>
        </div>

        {onDiscover && (
          <button
            type="button"
            onClick={onDiscover}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
          >
            Discover More Businesses
            <ArrowRight className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onNext}
          className="w-full px-4 py-3 rounded-lg border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          Continue with {totalMatches}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Commercial Insight with Evidence */}
      <div className="space-y-6">
        <p className="text-sm text-slate-400">Commercial Insight</p>

        <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-8 space-y-6">
          <div className="space-y-4">
            <p className="text-base text-slate-300">
              I reviewed{' '}
              <span className="font-semibold text-violet-200">{totalMatches.toLocaleString()}</span>{' '}
              businesses in your library.
            </p>

            <p className="text-base text-slate-300">
              After applying your commercial strategy, I identified the{' '}
              <span className="font-semibold text-violet-200">{recommendedCapacity}</span> strongest
              candidates to begin today's outreach.
            </p>
          </div>

          {recommendation && recommendation.advice && (
            <div className="border-t border-violet-400/10 pt-4">
              <p className="text-sm leading-relaxed text-white">
                {recommendation.advice}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-slate-400">
              {percentWithCI}% have commercial intelligence data for personalization
            </p>
            <p className="text-xs font-medium text-violet-300">
              High confidence
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={onNext}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Use my recommendation
          <ArrowRight className="h-4 w-4" />
        </button>

        {onAdjust && (
          <button
            type="button"
            onClick={onAdjust}
            className="w-full px-4 py-3 rounded-lg border border-white/10 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-300"
          >
            Adjust
          </button>
        )}
      </div>
    </div>
  )
}
