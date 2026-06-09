'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'alpa_scraper_onboarding_seen'

export default function FirstRunOverlay() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (window.localStorage.getItem(STORAGE_KEY) === '1') {
      return
    }

    setVisible(true)
  }, [])

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1')
    }

    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0b1220] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.68)]">
        <div className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
          Welcome
        </div>

        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">Welcome to ALPA</h2>

        <div className="mt-5 space-y-3 text-base leading-7 text-slate-300">
          <p>1. Enter business type</p>
          <p>2. Choose a location</p>
          <p>3. Run your search</p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="btn-secondary mt-8 min-h-[52px] w-full rounded-2xl px-5 text-base font-semibold"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
