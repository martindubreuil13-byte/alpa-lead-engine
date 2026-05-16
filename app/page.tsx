import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import OperationalLeadPreview from '@/components/landing/OperationalLeadPreview'
import PublicHeader from '@/components/site/PublicHeader'
import ResourcesFooter from '@/components/site/ResourcesFooter'
import LandingPageTracker from '@/components/tracking/LandingPageTracker'

const pageTitle = 'Lead Generation Tool for Freelancers & Agencies | ALPA'
const pageDescription =
  'Business leads in seconds. Try ALPA instantly with 25 free leads before deciding if it is right for your prospecting workflow.'

export const metadata: Metadata = {
  title: {
    absolute: pageTitle,
  },
  description: pageDescription,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: 'https://alpa.mindrasolutions.com',
    type: 'website',
  },
  twitter: {
    title: pageTitle,
    description: pageDescription,
  },
}

const frictionPoints = ['25 free leads', 'No credit card', 'Export included']

const flowSteps = [
  {
    title: 'Choose your niche',
    body: 'Who you want to reach',
  },
  {
    title: 'Select your market',
    body: 'Where you want to look',
  },
  {
    title: 'Get leads',
    body: 'Export or start outreach',
  },
]

const primaryCtaClass =
  'inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_42%,#22D3EE_100%)] px-6 text-base font-semibold tracking-[-0.01em] text-white shadow-[0_0_18px_rgba(34,211,238,0.34),0_14px_38px_rgba(29,78,216,0.42)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(34,211,238,0.58),0_18px_48px_rgba(29,78,216,0.58)] active:scale-[0.98] sm:min-h-[58px] sm:w-auto sm:px-8'
const pricingLinkClass =
  'inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/14 bg-white/[0.04] px-5 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.07]'

export default function HomePage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <LandingPageTracker />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'ALPA',
            alternateName: 'ALPA by MINDRA',
            applicationCategory: 'BusinessApplication',
            applicationSubCategory: 'Lead Generation Software',
            operatingSystem: 'Web',
            url: 'https://alpa.mindrasolutions.com',
            description:
              'ALPA helps freelancers, consultants, coaches, agencies, and professional service providers find verified business leads with website, email, and phone enrichment.',
            featureList: [
              'Generates verified business leads',
              'Finds company websites',
              'Finds business emails',
              'Finds phone numbers when available',
              'Exports leads to CSV',
              'Supports fast prospecting for freelancers and agencies',
            ],
            offers: [
              {
                '@type': 'Offer',
                name: 'Free Trial',
                price: '0',
                priceCurrency: 'USD',
                description: '25 free leads',
              },
              {
                '@type': 'Offer',
                name: 'Starter',
                price: '29.99',
                priceCurrency: 'USD',
                description: '500 leads per month',
              },
            ],
            creator: {
              '@type': 'Organization',
              name: 'MINDRA Solutions',
              legalName: 'MINDRA (AI) Solutions OÜ Ltd',
              url: 'https://mindrasolutions.com',
            },
          }),
        }}
      />

      <div className="landing-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[linear-gradient(180deg,rgba(37,99,235,0.18),rgba(2,6,23,0))]" />

      <PublicHeader />

      <section className="relative px-4 pb-12 pt-7 sm:px-6 sm:pb-16 sm:pt-10 lg:px-10 lg:pb-20 lg:pt-12">
        <div className="mx-auto grid w-full max-w-7xl gap-9 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:items-center lg:gap-14">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-100">
              Contact-ready leads
            </div>

            <h1 className="mt-5 max-w-5xl text-[2.75rem] font-semibold leading-[0.96] tracking-[-0.06em] text-white sm:mt-7 sm:text-[4.5rem] lg:text-[5.8rem]">
              Business leads in seconds. Literally.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-xl sm:leading-8">
              Start with 25 free leads and see how fast prospecting should feel.
            </p>

            <div className="mt-7 flex max-w-xl flex-col items-start gap-4 sm:mt-8">
              <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>

              <ul className="flex max-w-full flex-wrap gap-2 text-sm text-slate-300">
                {frictionPoints.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative mx-auto hidden w-full max-w-[31rem] sm:block lg:max-w-none">
            <OperationalLeadPreview />
          </div>
        </div>
      </section>

      <section className="relative px-4 py-8 sm:px-6 sm:py-12 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-7 border-y border-white/8 py-8 sm:py-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
              The real problem
            </p>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl sm:leading-[1.02]">
              You did not become an entrepreneur to spend evenings doing unpaid prospecting work.
            </h2>
          </div>

          <p className="text-xl font-medium leading-8 tracking-[-0.02em] text-slate-300 sm:text-2xl sm:leading-9">
            So why are you still hunting for leads manually when ALPA can collapse that work into
            seconds?
          </p>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
                Contact-ready leads
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">
                Website. Email. Phone. Export. Done.
              </h2>
            </div>
          </div>

          <div className="mx-auto max-w-4xl">
            <OperationalLeadPreview variant="export" />
          </div>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-7 border-y border-white/8 py-7 lg:flex-row lg:items-center lg:justify-between">
            {flowSteps.map((step, index) => (
              <div key={step.title} className="flex min-w-0 flex-1 items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/18 bg-cyan-400/[0.08] text-sm font-semibold text-cyan-100">
                  {index + 1}
                </div>
                <div>
                  <div className="text-xl font-semibold tracking-[-0.03em] text-white">{step.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{step.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
              Simple pricing
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">
              25 free leads. No commitment.
            </h2>
          </div>

          <div className="mt-7 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[30px] border border-cyan-300/18 bg-[linear-gradient(180deg,rgba(34,211,238,0.1),rgba(8,17,32,0.96))] p-6 shadow-[0_24px_80px_rgba(34,211,238,0.12)] backdrop-blur-xl sm:p-7">
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
                25 free leads
              </div>
              <p className="mt-3 text-base text-slate-300">Test the workflow before choosing a plan.</p>
              <div className="mt-6">
                <FreshStartCta className={primaryCtaClass}>Start Free</FreshStartCta>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 shadow-[0_24px_80px_rgba(2,8,23,0.32)] backdrop-blur-xl sm:p-7">
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-300">
                Upgrade when it fits
              </div>
              <p className="mt-3 text-base text-slate-300">Plans start from $9.99/month.</p>
              <div className="mt-6">
                <Link href="/plans" className={pricingLinkClass}>
                  View Plans
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-14 lg:px-10 lg:pb-20">
        <div className="mx-auto max-w-5xl border-t border-white/8 pt-10 text-center sm:pt-14">
          <h2 className="mx-auto max-w-4xl text-4xl font-semibold leading-[1.02] tracking-[-0.055em] text-white sm:text-6xl">
            Why are you still thinking about this?
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Your competitors are already talking to your next clients.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Best case: you leave with 25 free leads. Worst case: you lose less than a minute.
          </p>

          <div className="mx-auto mt-8 flex max-w-xl justify-center">
            <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
          </div>
        </div>
      </section>

      <ResourcesFooter compact />
    </main>
  )
}
