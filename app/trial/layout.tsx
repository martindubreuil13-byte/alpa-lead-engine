import type { Metadata } from 'next'
import { Instrument_Serif } from 'next/font/google'
import Link from 'next/link'

import { AlpaLogo } from '@/components/brand/AlpaLogo'

// The same display serif the application uses, so the free search reads as ALPA itself and not as a separate product.
const displaySerif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  title: 'Find 25 businesses free · ALPA',
  robots: { index: false, follow: false },
}

export default function TrialLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${displaySerif.variable} min-h-screen bg-transparent text-white`}>
      <header className="border-b border-white/6 bg-[#020617]/70 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[64px] w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <Link href="/" aria-label="ALPA home" className="inline-flex min-h-[44px] items-center">
            <AlpaLogo className="h-7 w-auto" priority />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1 text-sm text-white/70">
            <Link href="/plans" className="inline-flex min-h-[44px] items-center rounded px-3 transition hover:text-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d8c28a]">
              Plans
            </Link>
            <Link href="/login" className="inline-flex min-h-[44px] items-center rounded px-3 transition hover:text-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d8c28a]">
              Log in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pt-10 lg:px-10">{children}</main>
    </div>
  )
}
