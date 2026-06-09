'use client'

import { useEffect, useState } from 'react'

import { trackEvent } from '@/lib/track'

const ONBOARDING_SEEN_KEY = 'alpa_prospector_onboarding_seen'

const EXAMPLE_TYPES = ['dentists', 'law firms', 'roofing companies', 'SEO agencies']
const EXAMPLE_LOCATIONS = ['Miami', 'London', 'Dallas']

const STEPS = [
  'Enter a business type',
  'Choose a location',
  'Select how many leads you want',
  'Watch ALPA build your lead list live',
]

export default function ProspectorOnboardingOverlay() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.sessionStorage.getItem(ONBOARDING_SEEN_KEY)) {
      setVisible(true)
      void trackEvent('onboarding_started', {
        metadata: { surface: 'prospector' },
      })
    }
  }, [])

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ONBOARDING_SEEN_KEY, '1')
    }
    void trackEvent('onboarding_completed', {
      metadata: { surface: 'prospector' },
    })
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-950/75 backdrop-blur-sm">
      <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-cyan-300/14 bg-[linear-gradient(180deg,rgba(11,20,38,0.97),rgba(7,13,26,0.98))] p-6 shadow-[0_32px_100px_rgba(2,8,23,0.7)] sm:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.07),transparent_70%)]" />

        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/60">
                Welcome to ALPA
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">
                Find verified businesses in seconds.
              </h2>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] p-2 text-slate-400 transition hover:border-white/20 hover:text-white"
              aria-label="Dismiss"
            >
              <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3">
                <path
                  d="M2 2l10 10M12 2L2 12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {STEPS.map((text, i) => (
              <div key={text} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/8 text-[11px] font-semibold text-cyan-200">
                  {i + 1}
                </span>
                <span className="text-sm text-slate-300">{text}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:gap-8">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Business types
              </div>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_TYPES.map((type) => (
                  <span
                    key={type}
                    className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-xs text-slate-400"
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Locations
              </div>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_LOCATIONS.map((loc) => (
                  <span
                    key={loc}
                    className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-xs text-slate-400"
                  >
                    {loc}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="btn-primary-gold mt-6 w-full"
          >
            Start Prospecting
          </button>
        </div>
      </div>
    </div>
  )
}
