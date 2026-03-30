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
          className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_50px_rgba(14,165,233,0.24)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(14,165,233,0.3)]"
        >
          Upgrade
        </Link>
      </div>
    </div>
  )
}
