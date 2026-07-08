import { ArrowRight } from 'lucide-react'

interface RepositoryResultsProps {
  totalMatches: number
  matchesWithCI: number
  matchesWithoutCI: number
  onNext: () => void
  onAdjust?: () => void
  onDiscover?: () => void
}

const RECOMMENDED_CAPACITY = 20

export function RepositoryResults({
  totalMatches,
  matchesWithCI,
  matchesWithoutCI,
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
        <div className="space-y-3 text-center py-8">
          <p className="text-lg text-white">
            I didn't find any matching businesses in your library.
          </p>
          <p className="text-sm text-slate-400">
            Try discovering new businesses or refining your search criteria.
          </p>
        </div>

        {onDiscover && (
          <button
            type="button"
            onClick={onDiscover}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
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
        <div className="space-y-3 text-center py-8">
          <p className="text-lg text-white">
            I found {totalMatches} business{totalMatches !== 1 ? 'es' : ''} in your library.
          </p>
          <p className="text-sm text-slate-400">
            I recommend discovering more before starting outreach.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {matchesWithCI} with commercial intelligence data ({percentWithCI}%)
          </p>
        </div>

        {onDiscover && (
          <button
            type="button"
            onClick={onDiscover}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
          >
            Discover More Businesses
            <ArrowRight className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onNext}
          className="w-full px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          Continue with {totalMatches}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Recommendation */}
      <div className="space-y-4 text-center py-8">
        <p className="text-sm text-slate-400">
          I searched your library.
        </p>
        <p className="text-lg font-semibold text-white">
          Found {totalMatches} matching businesses.
        </p>
        <div className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-6">
          <p className="text-base text-white">
            I've selected the <span className="font-semibold text-violet-200">strongest {recommendedCapacity}</span> for today's outreach.
          </p>
          <p className="text-xs text-slate-400 mt-3">
            {matchesWithCI} with commercial intelligence data ({percentWithCI}%)
          </p>
        </div>
      </div>

      {/* Primary Action: Use Recommendation */}
      <button
        type="button"
        onClick={onNext}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
      >
        Use these {recommendedCapacity}
        <ArrowRight className="h-4 w-4" />
      </button>

      {/* Secondary Action: Adjust */}
      {onAdjust && (
        <button
          type="button"
          onClick={onAdjust}
          className="w-full px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-300"
        >
          Adjust selection
        </button>
      )}
    </div>
  )
}
