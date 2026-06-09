'use client'

import { Eye, RotateCcw, Sparkles, X } from 'lucide-react'

export default function PartialCompletionModal({
  isOpen,
  count,
  onClose,
  onViewLeads,
}: {
  isOpen: boolean
  count: number
  onClose: () => void
  onViewLeads: () => void
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
          We found {count} {count === 1 ? 'lead' : 'leads'} for you
        </h2>

        <div className="mt-5 space-y-3 text-base leading-7 text-slate-300">
          <p>
            These businesses are ready to contact right now. You can refine your search or
            start working with them immediately.
          </p>
        </div>

        <div className="mt-8 mx-auto grid w-full max-w-lg grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onViewLeads}
            className="btn-primary-gold w-full gap-2"
          >
            <Eye className="h-4 w-4" />
            View my leads
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.03] px-6 text-base font-medium tracking-[-0.01em] text-slate-100 transition-all duration-200 hover:bg-white/[0.08]"
          >
            <RotateCcw className="h-4 w-4" />
            Refine search
          </button>
        </div>
      </div>
    </div>
  )
}
