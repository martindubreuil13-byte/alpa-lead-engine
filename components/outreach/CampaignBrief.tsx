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
  const automationLabel = {
    manual: "I'll prepare everything myself",
    personalize: 'AI helps me personalize',
    generate: 'AI prepares everything for review',
  }[automationLevel]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">Campaign Brief</h2>
        <p className="mt-2 text-sm text-slate-400">
          Review everything before we start preparing your outreach.
        </p>
      </div>

      {/* Brief Summary Card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">
            Offering
          </div>
          <div className="text-base font-medium text-white">{offering}</div>
        </div>

        <div className="border-t border-white/5" />

        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">
            Audience
          </div>
          <div className="text-base font-medium text-white">{audience}</div>
        </div>

        <div className="border-t border-white/5" />

        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">
            Campaign Goal
          </div>
          <div className="text-base font-medium text-white">{goal}</div>
        </div>

        <div className="border-t border-white/5" />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">
              Available
            </div>
            <div className="text-2xl font-bold text-white">{totalMatches}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">
              You're selecting
            </div>
            <div className="text-2xl font-bold text-violet-300">{selectedCapacity}</div>
          </div>
        </div>

        <div className="border-t border-white/5" />

        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">
            Preparation Mode
          </div>
          <div className="text-base font-medium text-white">{automationLabel}</div>
        </div>
      </div>

      {/* Confirmation Message */}
      <div className="p-4 rounded-lg border border-violet-400/20 bg-violet-500/10">
        <p className="text-sm text-violet-200">
          ✓ Everything is set. When you start, ALPA will prepare personalized outreach to {selectedCapacity} business{selectedCapacity !== 1 ? 'es' : ''} based on your briefing.
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Go back to refine
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-violet-400/30 bg-violet-500/20 text-sm font-medium text-violet-200 transition hover:bg-violet-500/30 hover:border-violet-400/50"
        >
          Start Preparing Outreach
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
