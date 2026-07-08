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
    <div className="space-y-12 max-w-3xl">
      {/* Why These Businesses */}
      <div className="space-y-6">
        <p className="text-sm text-slate-400">Commercial recommendation</p>

        <h2 className="text-2xl font-semibold text-white leading-tight">
          I recommend these {recommendedCapacity} businesses because:
        </h2>

        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5 bg-violet-400" />
            <div>
              <p className="text-base text-white font-medium">Highest commercial fit</p>
              <p className="text-sm text-slate-400 mt-0.5">
                Strong match to your offering and audience profile
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5 bg-violet-400" />
            <div>
              <p className="text-base text-white font-medium">Complete commercial intelligence</p>
              <p className="text-sm text-slate-400 mt-0.5">
                Website data, company signals, and buying indicators available
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5 bg-violet-400" />
            <div>
              <p className="text-base text-white font-medium">Active and receptive</p>
              <p className="text-sm text-slate-400 mt-0.5">
                Showing growth signals and updated business information
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-2 h-2 rounded-full mt-1.5 bg-violet-400" />
            <div>
              <p className="text-base text-white font-medium">Not recently contacted</p>
              <p className="text-sm text-slate-400 mt-0.5">
                Fresh opportunity for meaningful conversations
              </p>
            </div>
          </div>
        </div>

        {recommendation && recommendation.advice && (
          <div className="border-t border-slate-700 pt-6">
            <p className="text-sm text-slate-300">
              <span className="font-medium text-white">Industry insight:</span> {' '}
              {recommendation.advice}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        {onAdjust && (
          <button
            type="button"
            onClick={onAdjust}
            className="px-6 py-3 rounded-lg border border-slate-600 text-slate-300 font-medium text-sm transition hover:bg-slate-900"
          >
            Adjust
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          className="px-6 py-3 rounded-lg bg-violet-500 text-white font-medium text-sm transition hover:bg-violet-600"
        >
          Prepare my outreach
        </button>
      </div>
    </div>
  )
}
