import { ArrowRight, ChevronLeft } from 'lucide-react'
import type { PreparationMode } from './NaturalBriefing'

interface CampaignBriefProps {
  offering: string
  audience: string
  goal: string
  desiredActionLabel: string
  ctaDetail: string
  totalMatches: number
  selectedCapacity: number
  preparationMode: PreparationMode
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
  desiredActionLabel,
  ctaDetail,
  totalMatches,
  selectedCapacity,
  preparationMode,
  recommendation,
  onNext,
  onBack,
}: CampaignBriefProps) {
  const preparationLabel = {
    review: 'Prepare everything for review',
    assist: 'Help me write it',
    self: "I'll write it myself",
  }[preparationMode]

  const actionSummary = ctaDetail ? `${desiredActionLabel}: ${ctaDetail}` : desiredActionLabel || goal

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300/80">
          Today's Plan
        </p>
        <h2 className="text-3xl font-semibold leading-tight text-white">
          Ready to prepare outreach for today.
        </h2>
      </div>

      <div className="space-y-6">
        <SummaryRow label="You're selling" value={offering} />
        <SummaryRow label="You're reaching" value={audience} />
        <SummaryRow label="You want them to" value={actionSummary} />
        <SummaryRow label="Preparation" value={preparationLabel} />
        <SummaryRow label="Recommended businesses" value={`${selectedCapacity} of ${totalMatches.toLocaleString()}`} />

        {recommendation?.advice ? (
          <div className="rounded-lg border border-violet-300/16 bg-violet-400/8 px-4 py-3 text-sm leading-6 text-violet-100">
            {recommendation.advice}
          </div>
        ) : null}
      </div>

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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-white/8 pt-4 first:border-t-0 first:pt-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="text-lg leading-7 text-white">{value}</p>
    </div>
  )
}
