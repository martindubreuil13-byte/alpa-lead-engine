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

  if (totalMatches === 0) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="space-y-3 py-8">
          <h2 className="text-2xl font-semibold leading-tight text-white">
            I do not have enough businesses to recommend yet.
          </h2>
          <p className="text-base leading-7 text-slate-300">
            I recommend finding more businesses before preparing outreach, so the messages are aimed at real commercial fit.
          </p>
        </div>

        {onDiscover && (
          <button
            type="button"
            onClick={onDiscover}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            Find more businesses
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  if (!hasEnoughMatches) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="space-y-4 py-8">
          <h2 className="text-2xl font-semibold leading-tight text-white">
            I only found {totalMatches} strong candidate{totalMatches === 1 ? '' : 's'}.
          </h2>
          <p className="text-base leading-7 text-slate-300">
            I recommend finding more businesses before preparing outreach. A larger pool gives ALPA better options without lowering message quality.
          </p>
        </div>

        {onDiscover && (
          <button
            type="button"
            onClick={onDiscover}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            Find more businesses
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
      <div className="space-y-6">
        <p className="text-sm text-slate-400">Commercial recommendation</p>

        <h2 className="text-2xl font-semibold text-white leading-tight">
          I recommend starting with {recommendedCapacity} businesses today.
        </h2>

        <p className="text-base leading-7 text-slate-300">
          That is enough to create meaningful conversations without sacrificing personalization quality.
        </p>

        <p className="text-sm leading-6 text-slate-400">
          I reviewed {totalMatches.toLocaleString()} businesses and found {matchesWithCI.toLocaleString()} with enough commercial intelligence to support a useful first message.
        </p>

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
