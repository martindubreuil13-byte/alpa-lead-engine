import Link from 'next/link'

import { STARTER_LOCK_MESSAGE } from '@/lib/usage/usage'

export default function FeatureLockNotice({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="glass rounded-3xl p-8">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
        {STARTER_LOCK_MESSAGE}
      </div>
      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">{title}</h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">{description}</p>
      <div className="mt-6">
        <Link
          href="/plans"
          className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-sky-300/30 bg-[linear-gradient(to_right,#3B82F6,#06B6D4)] px-6 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:brightness-110"
        >
          Upgrade
        </Link>
      </div>
    </div>
  )
}
