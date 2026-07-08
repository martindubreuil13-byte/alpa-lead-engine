interface EmptyStateOutreachProps {
  onPrepareOutreach: () => void
}

export function EmptyStateOutreach({ onPrepareOutreach }: EmptyStateOutreachProps) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-12 text-center">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-violet-600/5">
            <svg className="h-10 w-10 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-4">
          <h1 className="text-5xl font-bold text-white leading-tight">
            Prepare Today's Outreach
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed max-w-xl mx-auto">
            Every day brings new business opportunities. Let's identify the right prospects to contact today and prepare your outreach.
          </p>
        </div>

        {/* Value Propositions */}
        <div className="grid gap-6 md:grid-cols-3 py-8">
          <div className="space-y-2">
            <div className="text-2xl">🎯</div>
            <p className="text-sm font-medium text-white">Define Your Goal</p>
            <p className="text-xs text-slate-500">What are you offering and who benefits most?</p>
          </div>
          <div className="space-y-2">
            <div className="text-2xl">📊</div>
            <p className="text-sm font-medium text-white">Find Your Audience</p>
            <p className="text-xs text-slate-500">ALPA finds matching businesses from your library.</p>
          </div>
          <div className="space-y-2">
            <div className="text-2xl">✉️</div>
            <p className="text-sm font-medium text-white">Prepare & Send</p>
            <p className="text-xs text-slate-500">Review, approve, and send your outreach.</p>
          </div>
        </div>

        {/* CTA */}
        <div className="pt-8">
          <button
            onClick={onPrepareOutreach}
            className="inline-flex items-center justify-center px-8 py-4 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 text-white font-semibold shadow-lg hover:shadow-xl hover:from-violet-600 hover:to-violet-700 transition transform hover:scale-105"
          >
            <span>Prepare Today's Outreach</span>
            <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>

        {/* Secondary Message */}
        <p className="text-xs text-slate-500 pt-8">
          Takes about 5 minutes from briefing to campaign confirmation.
        </p>
      </div>
    </div>
  )
}
