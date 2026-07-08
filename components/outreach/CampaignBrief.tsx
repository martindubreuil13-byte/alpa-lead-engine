import { ArrowRight, ChevronLeft } from 'lucide-react'

interface CampaignBriefProps {
  offering: string
  audience: string
  goal: string
  totalMatches: number
  selectedCapacity: number
  automationLevel: 'manual' | 'personalize' | 'generate'
  recommendation: {
    advice: string
    priorityField: string | null
    priorityValue: string | null
    confidence: number
  } | null
  onNext: () => void
  onBack: () => void
}

export function CampaignBrief({
  offering,
  audience,
  goal,
  totalMatches,
  selectedCapacity,
  automationLevel,
  recommendation,
  onNext,
  onBack,
}: CampaignBriefProps) {
  return (
    <div className="space-y-8">
      {/* Title */}
      <div>
        <h3 className="text-lg font-medium text-white">Today's Plan</h3>
      </div>

      {/* What We're Doing */}
      <div className="space-y-6">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
              Offering
            </p>
            <p className="text-base text-white">{offering}</p>
          </div>

          <div className="border-t border-white/5" />

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
              Reaching
            </p>
            <p className="text-base text-white">{audience}</p>
          </div>

          <div className="border-t border-white/5" />

          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
              Businesses Selected
            </p>
            <p className="text-2xl font-bold text-violet-300">{selectedCapacity}</p>
          </div>
        </div>

        <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-6 space-y-4">
          <p className="text-base text-white">
            We'll prepare personalized outreach for these{' '}
            <span className="font-semibold text-violet-200">{selectedCapacity}</span> businesses.
          </p>

          <div className="space-y-2">
            <p className="text-sm text-slate-300">
              <span className="font-medium">Estimated time:</span> Less than 2 minutes
            </p>
            <p className="text-sm text-slate-400">
              Messages personalized based on available business data.
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Adjust
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Prepare My Outreach
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
