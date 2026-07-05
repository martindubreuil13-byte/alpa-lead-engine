'use client'

import { Sparkles, X } from 'lucide-react'

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (secs === 0) return `${minutes}m`
  return `${minutes}m ${secs}s`
}

export default function PartialCompletionModal({
  isOpen,
  count,
  onClose,
  onViewLeads,
  elapsedSeconds = 0,
}: {
  isOpen: boolean
  count: number
  onClose: () => void
  onViewLeads: () => void
  elapsedSeconds?: number
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#0b1220] p-8 shadow-[0_30px_80px_rgba(2,8,23,0.62)]">
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
            <Sparkles className="h-3.5 w-3.5" />
            Search Complete
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:text-white"
            aria-label="Close partial completion modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">
          ✓ {count} verified {count === 1 ? 'business' : 'businesses'} found
        </h2>

        <p className="mt-3 text-base text-slate-300">
          Completed in {formatTime(elapsedSeconds)}.
        </p>

        <div className="mt-5 space-y-2 text-base leading-7 text-slate-300">
          <p>Business Profiles are now being built automatically.</p>
          <p>ALPA is reading each company's website and preparing a reusable Business Profile.</p>
          <p>You can start working immediately. Profiles will appear automatically inside My Leads as they finish.</p>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={onViewLeads}
            className="btn-primary-gold w-full justify-center"
          >
            View My Leads
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/12 bg-white/[0.03] px-6 text-base font-medium tracking-[-0.01em] text-slate-100 transition-all duration-200 hover:bg-white/[0.08]"
          >
            Start Another Search
          </button>
        </div>
      </div>
    </div>
  )
}
