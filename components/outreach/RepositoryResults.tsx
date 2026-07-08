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
      {/* Advisor Recommendation */}
      <div className="space-y-6">
        <p className="text-sm text-slate-400">Here's what I found:</p>

        <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-8 space-y-4">
          <p className="text-lg leading-relaxed text-white">
            I found more than{' '}
            <span className="font-semibold text-violet-200">
              {totalMatches.toLocaleString()}
            </span>{' '}
            businesses that could be relevant to your outreach.
          </p>

          <p className="text-base leading-relaxed text-white">
            For today, I recommend starting with{' '}
            <span className="font-semibold text-violet-200">{recommendedCapacity}</span> carefully
            selected companies.
          </p>

          <p className="text-sm text-slate-300">
            Quality outreach consistently outperforms mass outreach. This size gives you meaningful
            conversations while maintaining personalization.
          </p>

          {recommendation && recommendation.advice && (
            <div className="border-t border-violet-400/10 pt-4">
              <p className="text-sm text-slate-300">
                {recommendation.advice}
              </p>
            </div>
          )}

          <p className="text-xs text-slate-400 pt-2">
            {percentWithCI}% have commercial intelligence data for better personalization
          </p>
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
