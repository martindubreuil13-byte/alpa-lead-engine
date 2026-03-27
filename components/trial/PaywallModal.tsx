'use client'

import Link from 'next/link'

export default function PaywallModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#0b1220] p-8 shadow-[0_30px_80px_rgba(2,8,23,0.62)]">
        <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">
          Free Trial
        </div>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
          You’ve just generated 25 leads.
        </h2>
        <p className="mt-4 text-lg text-slate-300">
          Now imagine having this every day.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.92),rgba(37,99,235,0.95))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.24)]"
          >
            Unlock full access
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 text-base font-semibold text-slate-200"
          >
            Keep exploring
          </button>
        </div>
      </div>
    </div>
  )
}
