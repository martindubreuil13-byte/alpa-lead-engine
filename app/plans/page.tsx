import type { Metadata } from 'next'

import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import FreeTrialPlanLink from '@/components/plans/FreeTrialPlanLink'
import BackToLeadsButton from '@/components/plans/BackToLeadsButton'
import PlanCard, { type PlanCardProps } from '@/components/plans/PlanCard'
import PublicHeader from '@/components/site/PublicHeader'
import PlansPageTracker from '@/components/tracking/PlansPageTracker'

const pageTitle = 'Pricing & Plans for Lead Generation | ALPA'
const pageDescription =
  'ALPA plans start free — get 25 verified leads instantly. Prospector: 120 leads/month for $9.99. Starter: 500 leads/month with outreach tools for $29.99. Find real business contacts with website, email, and phone.'

export const metadata: Metadata = {
  title: {
    absolute: pageTitle,
  },
  description: pageDescription,
  alternates: {
    canonical: '/plans',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: 'https://alpa.mindrasolutions.com/plans',
    type: 'website',
  },
  twitter: {
    title: pageTitle,
    description: pageDescription,
  },
}

const plans: PlanCardProps[] = [
  {
    name: 'Free',
    price: 'Free',
    description: 'Test ALPA and see how quickly it surfaces businesses worth contacting.',
    features: [
      '25 verified leads',
      'CSV export',
      'Website & business details',
      'Instant lead discovery',
    ],
    ctaLabel: 'Start Free',
    href: '/dashboard/scraper',
  },
  {
    name: 'Prospector',
    price: '$9.99',
    priceSuffix: '/ month',
    pricePerLead: '$0.08 per verified lead',
    description: 'Find verified businesses ready to contact in seconds.',
    features: [
      '120 verified leads / month',
      'CSV export',
      'Website & business details',
      'Ready-to-contact businesses',
      'Built for freelancers, founders & agencies',
    ],
    ctaLabel: 'Start Prospecting',
    checkoutSource: 'plans_prospector',
    checkoutPlan: 'prospector',
    highlight: true,
  },
  {
    name: 'Starter',
    price: '$29.99',
    priceSuffix: '/ month',
    pricePerLead: '$0.06 per verified lead',
    description: 'Move from lead discovery to real outreach workflows.',
    features: [
      '500 verified leads / month',
      'CSV export',
      'Pipeline access',
      '1 outreach template',
      'Basic outreach workflow',
      'Lead history',
    ],
    ctaLabel: 'Start Building',
    checkoutSource: 'plans_featured',
    badge: 'Most Popular',
    featured: true,
  },
  {
    name: 'Pro',
    price: '$49.99',
    priceSuffix: '/ month',
    pricePerLead: '$0.05 per verified lead',
    description: 'Built for operators scaling outbound prospecting.',
    features: [
      '1,000+ verified leads',
      'Multi-template outreach',
      'Advanced workflows',
      'Larger-scale prospecting',
      'More automation tools',
    ],
    ctaLabel: 'Coming Soon',
    badge: 'Coming Soon',
    disabled: true,
  },
]

export default function PlansPage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <PlansPageTracker />
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_86%_16%,rgba(45,212,191,0.12),transparent_24%)]" />
      <div className="pointer-events-none absolute left-[-7rem] top-[12rem] h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-8rem] top-[30rem] h-80 w-80 rounded-full bg-teal-400/10 blur-3xl" />

      <PublicHeader activePath="/plans" />

      {/* Hero */}
      <section className="relative px-4 pb-10 pt-10 sm:px-6 lg:px-10 lg:pb-14 lg:pt-14">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <BackToLeadsButton />
          </div>
          <div className="max-w-3xl">
            <h1 className="text-[2.8rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-[4rem] lg:text-[5rem]">
              Verified business leads.<br className="hidden sm:block" /> Ready when you are.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              Every lead includes a verified business with at least one real contact point — website, email, or phone number.
            </p>
          </div>
        </div>
      </section>

      {/* Plan cards */}
      <section className="relative px-4 pb-16 sm:px-6 lg:px-10 lg:pb-22">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
            {plans.map((plan) => (
              <PlanCard key={plan.name} {...plan} />
            ))}
          </div>

          {/* Trust line */}
          <p className="mt-8 text-center text-xs text-slate-600">
            No contracts. Cancel anytime. Billed monthly.
          </p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative px-4 pb-20 pt-6 sm:px-6 lg:px-10 lg:pb-24">
        <div className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden px-2 py-12 sm:px-4 sm:py-16">
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[18rem] w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/10 blur-3xl sm:h-[24rem] sm:w-[24rem]" />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center">
              <p className="text-center text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.04em] text-slate-100 sm:text-[2.5rem]">
                While you&apos;re still deciding, someone else is already contacting your next client.
              </p>
              <p className="mt-4 max-w-xl text-center text-sm leading-7 text-slate-400 sm:text-base">
                Start free with 25 verified leads or begin prospecting today for $9.99/month.
              </p>
              <div className="mt-8 flex w-full max-w-[32rem] flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
                <FreeTrialPlanLink
                  href="/dashboard/scraper"
                  ctaLocation="plans_page"
                  className="inline-flex min-h-[54px] w-full flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-7 text-sm font-semibold text-white transition-all duration-200 hover:border-white/16 hover:bg-white/[0.10]"
                >
                  Start Free
                </FreeTrialPlanLink>
                <StartCheckoutButton
                  label="Start Prospecting"
                  source="plans_footer"
                  plan="prospector"
                  wrapperClassName="flex-1"
                  className="inline-flex min-h-[54px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] px-7 text-sm font-semibold text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
