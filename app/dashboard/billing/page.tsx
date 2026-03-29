import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { isFree, isStarter } from '@/lib/auth/access'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const user = await getUserProfile()
  if (!user) {
    redirect('/login')
  }

  const userIsFree = isFree(user) || !user
  const userIsStarter = isStarter(user)

  const leadsUsed = userIsStarter ? 120 : 12
  const leadsLimit = userIsStarter ? 500 : 25
  const usagePercent = Math.min(100, Math.round((leadsUsed / leadsLimit) * 100))

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
          Plan &amp; Billing
        </h1>
        <p className="text-base text-slate-400">Manage your plan and track your usage</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <section className="glass rounded-3xl p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Current Plan
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
            {userIsStarter ? 'Starter Plan' : 'Free Plan'}
          </h2>
          <p className="mt-3 max-w-xl text-base leading-7 text-slate-300">
            {userIsStarter
              ? 'Up to 500 verified leads per month'
              : 'Access to 25 verified leads'}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
              {user.email}
            </span>
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-cyan-100">
              {userIsStarter ? 'Starter access' : 'Free access'}
            </span>
          </div>
        </section>

        <section className="glass rounded-3xl p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Usage
          </div>
          <div className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
            Leads used: {leadsUsed} / {leadsLimit}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Placeholder usage until real tracking is wired in the next phase.
          </p>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <div className="mt-3 text-sm text-slate-500">{usagePercent}% of current allowance used</div>
        </section>
      </div>

      <section className="glass rounded-3xl p-8">
        {userIsFree ? (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                Upgrade
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
                Ready to unlock more?
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                Upgrade to Starter to generate more leads and start outreach.
              </p>
            </div>

            <Link
              href="/plans"
              className="inline-flex min-h-[54px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-6 text-base font-semibold text-slate-950 shadow-[0_22px_60px_rgba(34,211,238,0.28)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_70px_rgba(34,211,238,0.34)]"
            >
              Upgrade to Starter
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Active Plan
            </div>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white">
              Your plan is active
            </h2>
            <p className="max-w-2xl text-base leading-7 text-slate-300">
              Starter is active on your workspace. Billing controls and future plan actions will land here in the next phase.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
