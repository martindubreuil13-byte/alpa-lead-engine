'use client'

export default function AskKaiaCta() {
  const openKaia = () => {
    window.dispatchEvent(new CustomEvent('elevenlabs-convai:open'))
  }

  return (
    <div className="mt-6 w-full max-w-xl rounded-2xl border border-cyan-300/14 bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(2,8,23,0.28)] backdrop-blur-xl sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.01em] text-white">
            Questions? Ask Kaia.
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Your AI guide to ALPA can explain pricing, features, workflows, and how to generate
            ready-to-contact business leads in seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={openKaia}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-50 transition hover:border-cyan-200/35 hover:bg-cyan-300/15"
        >
          Ask Kaia
        </button>
      </div>
    </div>
  )
}
