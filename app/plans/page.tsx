import type { Metadata } from 'next'
import Link from 'next/link'

import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import LegalLinks from '@/components/legal/LegalLinks'
import FreeTrialPlanLink from '@/components/plans/FreeTrialPlanLink'
import BackToLeadsButton from '@/components/plans/BackToLeadsButton'
import PlanCard, { type PlanCardProps } from '@/components/plans/PlanCard'
import PublicHeader from '@/components/site/PublicHeader'
import PlansPageTracker from '@/components/tracking/PlansPageTracker'

const pageTitle = 'Pricing & Plans for Lead Generation | ALPA'
const pageDescription =
  'ALPA plans start free — get 25 verified leads instantly. ALPA Starter: 100 businesses/month for $9.99. ALPA Pro: 500 businesses/month for $24.99. Free: 25 businesses, lifetime. Find real business contacts with website, email, and phone.'

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
  { name: 'ALPA Free', price: 'Free', description: 'Try ALPA with 25 businesses, lifetime.',
    features: ['25 businesses · lifetime allowance', 'CSV export', 'Website & business details', 'At least 1 contact point'],
    ctaLabel: 'Start Free', href: '/dashboard/scraper' },
  { name: 'ALPA Starter', price: '$9.99', priceSuffix: '/ month', description: 'For regular prospecting.',
    features: ['100 businesses / month', 'CSV export', 'Save & export business lists'],
    ctaLabel: 'Choose Starter', checkoutSource: 'plans_starter', checkoutPlan: 'starter', highlight: true },
  { name: 'ALPA Pro', price: '$24.99', priceSuffix: '/ month', description: 'For higher-volume prospecting.',
    features: ['500 businesses / month', 'Everything in Starter', 'Business history'],
    ctaLabel: 'Choose Pro', checkoutSource: 'plans_pro', checkoutPlan: 'pro', badge: 'Most Popular', featured: true },
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
          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3 xl:items-stretch">
            {plans.map((plan) => (
              <PlanCard key={plan.name} {...plan} />
            ))}
          </div>
          {/* Trust line */}
          <p className="mt-8 text-center text-xs leading-5 text-slate-500">
            Paid plans are billed monthly in advance and renew until cancelled. Cancel anytime; paid access continues to the end of the period you have paid for.
            Free includes 25 businesses, lifetime. Monthly allowances reset on the usage date shown in your account; unused businesses do not roll over.
            Prices are in US dollars. See the{' '}
            <Link href="/terms" className="underline underline-offset-2 hover:text-white">Terms</Link>,{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-white">Privacy Policy</Link> and{' '}
            <Link href="/refund-policy" className="underline underline-offset-2 hover:text-white">Refund &amp; Cancellation Policy</Link>.
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
                  className="btn-primary-gold w-full flex-1"
                >
                  Start Free
                </FreeTrialPlanLink>
                <StartCheckoutButton
                  label="Start Prospecting"
                  source="plans_footer"
                  plan="starter"
                  wrapperClassName="flex-1"
                  className="btn-primary-gold w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="relative px-4 pb-10 sm:px-6 lg:px-10">
        <LegalLinks className="mx-auto max-w-6xl border-t border-white/8 pt-6" />
      </div>
    </main>
  )
}
