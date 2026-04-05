import type { Metadata } from 'next'
import { Suspense } from 'react'

import PostCheckoutAccountForm from '@/components/auth/PostCheckoutAccountForm'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

function LoadingState() {
  return (
    <div className="w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white/[0.12] bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(8,15,30,0.92))] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.68)] backdrop-blur-2xl sm:p-8">
      <div className="mx-auto mb-8 flex w-fit items-center rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-200">
        ALPA
      </div>
      <div className="space-y-3 text-center">
        <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-white sm:text-[2.2rem]">
          Your access is unlocked. Create your account to access your workspace.
        </h1>
      </div>
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-300">
        Verifying your checkout...
      </div>
    </div>
  )
}

export default function PostCheckoutPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050816] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_26%),linear-gradient(180deg,_#030712_0%,_#08111f_45%,_#0b1220_100%)]" />
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[6px]" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <Suspense fallback={<LoadingState />}>
          <PostCheckoutAccountForm />
        </Suspense>
      </div>
    </main>
  )
}
