import type { Metadata } from 'next'
import Link from 'next/link'

import PlanCard, { type PlanCardProps } from '@/components/plans/PlanCard'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: 'Plans | ALPA',
}

const plans: PlanCardProps[] = [
  {
    name: 'Test the Engine',
    price: 'Free',
    description: 'See how quickly ALPA surfaces people worth contacting before you commit to more.',
    features: [
      '25 verified leads',
      'CSV export',
      'Fast business discovery',
      'No outreach tools',
      'No pipeline access',
    ],
    ctaLabel: 'Start Free',
    href: '/dashboard',
  },
  {
    name: 'Starter Pipeline',
    price: '$49',
    priceSuffix: '/ month',
    priceNote: 'Up to 500 verified leads per month',
    description:
      'Move from finding the right people to starting real conversations without adding complexity.',
    features: [
      '500 verified leads / month',
      'CSV export',
      '1 email template',
      'Basic outreach sending',
      'Lead history',
      'Simple upgrade path as ALPA evolves',
    ],
    ctaLabel: 'Start Building',
    href: '/login?mode=signup',
    featured: true,
  },
  {
    name: 'Outbound Engine',
    price: 'Coming Soon',
    description:
      'For teams ready to reach more of the right people with higher volume and more flexibility.',
    features: [
      '1,000+ verified leads',
      'Unlimited templates',
      'Multi-campaign outreach',
      'Pipeline tracking',
      'Follow-up tools',
    ],
    ctaLabel: 'Coming Soon',
    disabled: true,
  },
  {
    name: 'Autonomous Growth',
    price: 'Coming Soon',
    description:
      "ALPA's future layer for smarter prospecting, AI-assisted outreach, and more scalable growth.",
    features: [
      'ICP-based prospecting',
      'Automated lead discovery',
      'AI-assisted outreach',
      'Smarter targeting logic',
      'Built for scalable prospecting',
    ],
    ctaLabel: 'Coming Soon',
    disabled: true,
  },
]

export default function PlansPage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_86%_16%,rgba(45,212,191,0.12),transparent_24%)]" />
      <div className="pointer-events-none absolute left-[-7rem] top-[12rem] h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-8rem] top-[30rem] h-80 w-80 rounded-full bg-teal-400/10 blur-3xl" />

      <PublicHeader activePath="/plans" />

      <section className="relative px-4 pb-10 pt-10 sm:px-6 lg:px-10 lg:pb-14 lg:pt-14">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <h1 className="max-w-5xl text-[3rem] font-semibold leading-[1] tracking-[-0.06em] text-white sm:text-[4.4rem] lg:text-[5.4rem]">
              Unlock Your Pipeline
            </h1>

            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300 sm:text-xl">
              Find people you can actually reach. Start conversations that turn into clients.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
              No setup. No complexity. Just real opportunities.
            </p>
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-14 sm:px-6 lg:px-10 lg:pb-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
            {plans.map((plan) => (
              <PlanCard key={plan.name} {...plan} />
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-20 pt-10 sm:px-6 lg:px-10 lg:pb-24">
        <div className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden px-2 py-10 sm:px-4 sm:py-14">
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/10 blur-3xl sm:h-[24rem] sm:w-[24rem]" />
            <div className="relative mx-auto flex max-w-3xl flex-col items-center">
              <p className="text-center text-[2rem] font-semibold leading-[1.05] tracking-[-0.05em] text-slate-100 sm:text-[2.8rem]">
                Your next clients are already within reach.
              </p>
              <p className="mt-5 max-w-2xl text-center text-sm leading-7 text-slate-300/72 sm:text-base">
                Start free with 25 verified leads, or unlock more when you&apos;re ready to move faster.
              </p>
              <div className="mt-8 flex w-full max-w-[34rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-[58px] flex-1 items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-7 text-base font-semibold text-slate-950 shadow-[0_22px_60px_rgba(34,211,238,0.28)] transition duration-200 hover:scale-[1.02] hover:shadow-[0_30px_84px_rgba(34,211,238,0.38)]"
                >
                  Start Free
                </Link>
                <Link
                  href="/login?mode=signup"
                  className="inline-flex min-h-[58px] flex-1 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.03] px-7 text-base font-semibold text-slate-200 transition duration-200 hover:scale-[1.01] hover:border-white/20 hover:bg-white/[0.06]"
                >
                  Start Building
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
