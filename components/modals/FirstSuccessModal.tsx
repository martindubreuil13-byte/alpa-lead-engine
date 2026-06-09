'use client'

import { Sparkles, X } from 'lucide-react'

export default function FirstSuccessModal({
  isOpen,
  onClose,
  onEmailLeads,
}: {
  isOpen: boolean
  onClose: () => void
  onEmailLeads: () => void
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#0b1220] p-8 shadow-[0_30px_80px_rgba(2,8,23,0.62)]">
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100">
            <Sparkles className="h-3.5 w-3.5" />
            First Success
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:text-white"
            aria-label="Close first success modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">
          Nice. ALPA found verified businesses in seconds.
        </h2>

        <p className="mt-5 text-base leading-7 text-slate-300">
          You can continue prospecting, or save your leads before leaving.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="btn-primary-gold"
          >
            Continue Prospecting
          </button>
          <button
            type="button"
            onClick={onEmailLeads}
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 text-base font-semibold text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08]"
          >
            Email Me My Leads
          </button>
        </div>
      </div>
    </div>
  )
}
