'use client'

import { useId, useState } from 'react'
import { Plug } from 'lucide-react'

// A quiet, honest entry point. Nothing here connects to anything: every item is labelled as upcoming.
const UPCOMING = [
  ['CRM systems', 'Send saved businesses to the CRM you already use'],
  ['AI agents', 'Let your own agents work from ALPA’s business intelligence'],
  ['Outreach platforms', 'Hand qualified businesses to your outreach tools'],
  ['Automation tools', 'Trigger your workflows when new businesses are saved'],
] as const

export default function ConnectTools() {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-2 rounded-full border border-white/12 px-3.5 py-1.5 text-xs text-white/75 transition hover:border-[#d8c28a]/60 hover:text-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a]"
      >
        <Plug aria-hidden="true" className="h-3.5 w-3.5" />
        <span>Connect your tools</span>
        <span aria-hidden="true" className="text-white/35">—</span>
        <span className="text-[#d8c28a]/90">Coming soon</span>
      </button>
      {open ? (
        <div id={panelId} role="region" aria-label="Connect your tools" className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/12 bg-[#0b1a33] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <p className="text-sm text-white/85">ALPA is being built to connect with the tools you already work in.</p>
          <ul className="mt-3 divide-y divide-white/10 border-y border-white/10">
            {UPCOMING.map(([name, detail]) => (
              <li key={name} className="flex items-start justify-between gap-3 py-2.5">
                <span>
                  <span className="block text-sm text-white">{name}</span>
                  <span className="block text-xs text-white/55">{detail}</span>
                </span>
                <span className="mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.16em] text-[#d8c28a]/80">Coming soon</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-white/50">None of these are available yet. Your businesses stay in ALPA, and you can export them as CSV today.</p>
        </div>
      ) : null}
    </div>
  )
}
