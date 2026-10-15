import type { ReactNode } from 'react'

import { AlpaLogo } from '@/components/brand/AlpaLogo'

// The card the login page uses, for the other account screens (password reset) so they look the same.
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#050816] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_26%),linear-gradient(180deg,_#030712_0%,_#08111f_45%,_#0b1220_100%)]" />
      <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-[420px]">
          <div className="overflow-hidden rounded-[28px] border border-white/[0.12] bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(8,15,30,0.92))] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.68)] backdrop-blur-2xl sm:p-8">
            <div className="mx-auto mb-8 flex w-fit items-center">
              <AlpaLogo className="h-8 w-auto object-contain" priority />
            </div>
            <div className="space-y-2 text-center">
              <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-white sm:text-[2rem]">{title}</h1>
              {subtitle ? <p className="text-sm leading-6 text-slate-400 sm:text-[15px]">{subtitle}</p> : null}
            </div>
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </div>
    </main>
  )
}

/** Shared control styling: 16px text (no zoom on phones) and targets of at least 48px. */
export const inputClass =
  'h-14 w-full rounded-2xl border border-white/[0.10] bg-white/[0.06] px-4 text-base text-white placeholder:text-slate-500 transition-all duration-200 focus:border-cyan-300/45 focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-60'
export const linkButtonClass = 'inline-flex min-h-12 items-center justify-center px-3 text-sm font-medium text-cyan-200 transition hover:text-white'
