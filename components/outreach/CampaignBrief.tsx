import { ArrowRight, ChevronLeft } from 'lucide-react'

interface CampaignBriefProps {
  offering: string
  audience: string
  goal: string
  totalMatches: number
  selectedCapacity: number
  automationLevel: 'manual' | 'personalize' | 'generate'
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
  onNext,
  onBack,
}: CampaignBriefProps) {
  return (
    <div className="space-y-8">
      {/* Title */}
      <div>
        <h3 className="text-lg font-semibold text-white">Today's Outreach</h3>
      </div>

      {/* What You're Doing */}
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
            Audience
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

      {/* Confidence Message */}
      <div className="rounded-2xl border border-violet-400/20 bg-violet-500/5 p-6 space-y-3">
        <p className="text-base text-white font-medium">
          {selectedCapacity} personalized messages will now be prepared.
        </p>
        <p className="text-sm text-slate-300">
          I'll personalize each message based on available commercial data.
        </p>
        <p className="text-xs text-slate-400">
          Estimated preparation time: under 2 minutes
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Adjust
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Prepare Outreach
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
