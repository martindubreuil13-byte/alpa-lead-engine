'use client'

const LOGS = [
  'Reading business websites',
  'Finding usable contact details',
  'Filtering weak signals',
  'Preparing export-ready leads',
]

export default function LiveLogPanel() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70 p-5 shadow-[0_20px_70px_rgba(2,8,23,0.55)] backdrop-blur-2xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_45%)]" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
              WHAT YOUR LEADS LOOK LIKE
            </div>
            <div className="mt-2 text-lg font-semibold tracking-[-0.02em] text-white">
              Example search: marketing agencies in Miami
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
            <span className="h-2 w-2 rounded-full bg-cyan-300" />
            Sample
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {LOGS.map((log, index) => (
            <div
              key={log}
              className="landing-log-row flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3 text-sm text-slate-300"
              style={{ animationDelay: `${index * 0.5}s` }}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-cyan-300 to-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.7)]" />
              <span>{log}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
