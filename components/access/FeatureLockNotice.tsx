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
          className="btn-primary-gold"
        >
          Upgrade
        </Link>
      </div>
    </div>
  )
}
