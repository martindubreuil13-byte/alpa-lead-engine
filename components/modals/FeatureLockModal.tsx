'use client'

import Link from 'next/link'
import { Lock, X } from 'lucide-react'

export default function FeatureLockModal({
  isOpen,
  onClose,
  title,
  description,
  benefit,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  description: string
  benefit: string
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#0b1220] p-8 shadow-[0_30px_80px_rgba(2,8,23,0.62)]">
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100">
            <Lock className="h-3.5 w-3.5" />
            Locked Feature
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:text-white"
            aria-label="Close feature lock modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">{title}</h2>
        <p className="mt-4 text-base leading-7 text-slate-300">{description}</p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
            Why it matters
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">{benefit}</p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/plans"
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.24)]"
          >
            Unlock full access
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 text-base font-semibold text-slate-200"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}
