const INSIGHT_POINTS = [
  'Defines your ideal target automatically',
  'Filters irrelevant industries',
  'Shapes outreach messaging',
  'Prioritizes high-value leads',
]

export { INSIGHT_POINTS }

export default function AgentInsightPanel() {
  return (
    <aside className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.92),rgba(6,12,24,0.9))] p-5 shadow-[0_22px_50px_rgba(2,8,23,0.38),0_0_0_1px_rgba(59,130,246,0.08)] backdrop-blur-xl">
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
          Guide
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          How Agent Mode Works
        </h2>
        <p className="text-sm leading-6 text-slate-400">
          Turn a rough positioning statement into a sharper targeting brief for prospecting and outreach.
        </p>
      </div>

      <div className="mt-5 space-y-3">
        {INSIGHT_POINTS.map((point) => (
          <div
            key={point}
            className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3"
          >
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.55)]" />
            <span className="text-sm leading-6 text-slate-200">{point}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
