'use client'

import Link from 'next/link'

import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'

export default function TrialLimitModal({
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
    <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-6 sm:items-center sm:pb-0">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(11,20,38,0.99),rgba(7,13,26,1))] p-6 shadow-[0_32px_100px_rgba(2,8,23,0.7)] sm:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_70%)]" />

        <div className="relative space-y-4">
          {/* Badge */}
          <div className="inline-flex items-center rounded-full border border-amber-400/22 bg-amber-400/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">
            25 free leads reached
          </div>

          <h2 className="text-[1.55rem] font-semibold leading-[1.12] tracking-[-0.04em] text-white">
            You&apos;ve reached your 25 free verified leads.
          </h2>

          <div className="space-y-2 text-sm leading-7 text-slate-300">
            <p>
              Start serious prospecting with{' '}
              <span className="font-semibold text-white">120 verified leads per month</span>{' '}
              for only <span className="font-semibold text-white">$9.99</span>.
            </p>
            <p className="text-slate-400">
              Every lead includes a verified business with at least one real contact point — website, email, or phone number.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <StartCheckoutButton
              label="Start Prospecting — $9.99/mo"
              source="trial_limit_modal"
              plan="prospector"
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] px-6 text-sm font-semibold text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-[0_0_25px_rgba(34,211,238,0.55)] active:scale-[0.98]"
            />
            <button
              type="button"
              onClick={() => {
                onClose()
                onEmailLeads()
              }}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-6 text-sm font-semibold text-slate-200 transition hover:border-white/18 hover:bg-white/[0.07]"
            >
              Email Me My Leads
            </button>
            <Link
              href="/plans"
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl px-6 text-sm font-medium text-slate-500 transition hover:text-slate-300"
            >
              View Plans
            </Link>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full text-center text-xs text-slate-600 transition hover:text-slate-400"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
