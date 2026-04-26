import type { Metadata } from 'next'
import Link from 'next/link'

import FloatingLeadShowcase from '@/components/landing/FloatingLeadShowcase'
import FreshStartCta from '@/components/landing/FreshStartCta'
import LiveLogPanel from '@/components/landing/LiveLogPanel'
import PublicHeader from '@/components/site/PublicHeader'
import ResourcesFooter from '@/components/site/ResourcesFooter'
import LandingPageTracker from '@/components/tracking/LandingPageTracker'

export const metadata: Metadata = {
  title: {
    absolute: 'Lead Generation Tool for Freelancers & Agencies | ALPA',
  },
  description:
    'Find ready-to-contact business leads enriched with website, email, and phone. No signup, no credit card, and 25 free leads instantly.',
  alternates: {
    canonical: '/',
  },
}

const heroSteps = ['Define your target', 'Select your location', 'Get verified leads in seconds']

const valueCards = [
  {
    title: 'Business Website',
    body: 'See where the business lives online so you can qualify it quickly.',
  },
  {
    title: 'Email Included',
    body: 'Find usable contact emails without opening dozens of tabs.',
  },
  {
    title: 'Phone Number',
    body: 'Get another way to reach the business when email is not enough.',
  },
  {
    title: 'CSV Export',
    body: 'Download your lead list and move straight into outreach.',
  },
]

const steps = [
  {
    title: 'Enter your niche',
    body: 'Search for the type of businesses you want to reach — agencies, dentists, restaurants, roofers, consultants, and more.',
  },
  {
    title: 'Choose your location',
    body: 'Target a city, region, or market so your lead list matches where you want to sell.',
  },
  {
    title: 'Generate and export leads',
    body: 'Get verified business leads enriched with website, email, and phone, then download your CSV or send it to your inbox.',
  },
]

const comparisonRows = [
  {
    manual: 'Search Google manually',
    alpa: 'Search by niche and location',
  },
  {
    manual: 'Open dozens of websites',
    alpa: 'Generate leads in seconds',
  },
  {
    manual: 'Copy emails into spreadsheets',
    alpa: 'Export CSV instantly',
  },
  {
    manual: 'Guess who to contact',
    alpa: 'Website, email, and phone included',
  },
  {
    manual: 'Lose hours before outreach starts',
    alpa: 'Start reaching out faster',
  },
]

const useCases = [
  {
    title: 'Freelancers',
    body: 'Find local businesses that may need your service and start outreach today.',
    bestFit: true,
  },
  {
    title: 'Small Agencies',
    body: 'Build prospect lists for SEO, web design, social media, PPC, and local marketing campaigns.',
    bestFit: true,
  },
  {
    title: 'Coaches & Consultants',
    body: 'Find businesses in your target market and start conversations with better-fit prospects.',
    bestFit: false,
  },
  {
    title: 'Sales Teams',
    body: 'Source contact-ready businesses for outbound campaigns without slowing the team down.',
    bestFit: false,
  },
]

const starterBullets = [
  'Built for freelancers and small agencies',
  'Generate new prospect lists every month',
  'Export and use leads immediately',
  'Simple upgrade when you are ready',
]

const freeBullets = [
  'No signup required',
  'No credit card required',
  'Website, email, and phone included',
  'CSV export included',
]

const ctaBaseClass =
  'inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl px-6 text-base font-semibold tracking-[-0.01em] transition-all duration-200 sm:min-h-[58px] sm:px-7'
const primaryCtaClass = `${ctaBaseClass} border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]`
const secondaryCtaClass = `${ctaBaseClass} border border-white/35 bg-transparent text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-white/50 hover:bg-white/[0.05]`

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
            applicationCategory: 'BusinessApplication',
            description: 'Lead generation tool for freelancers, agencies, and small teams.',
            creator: {
              '@type': 'Organization',
              name: 'MINDRA',
            },
          }),
        }}
      />

      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_82%_18%,rgba(45,212,191,0.12),transparent_24%)]" />
      <div className="pointer-events-none absolute left-[-7rem] top-[10rem] h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6rem] top-[34rem] h-80 w-80 rounded-full bg-teal-400/10 blur-3xl" />

      <PublicHeader />

      <section className="relative px-4 pb-12 pt-6 sm:px-6 sm:pb-14 sm:pt-8 lg:px-10 lg:pb-16 lg:pt-10">
        <div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(380px,0.98fr)] lg:items-center lg:gap-14">
          <div className="order-1 max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-300">
              PREMIUM LEAD ENGINE
            </div>

            <h1 className="mt-5 max-w-5xl text-[2.45rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:mt-7 sm:text-[4rem] lg:text-[5.3rem]">
              Find Ready-to-Contact Business Leads in Seconds
            </h1>

            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300 sm:text-xl sm:leading-8">
              ALPA helps freelancers and small agencies generate verified business leads enriched
              with website, email, and phone — no signup, no credit card, 25 free leads instantly.
            </p>

            <p className="mt-4 max-w-2xl text-base font-medium text-cyan-100 sm:text-lg">
              Stop wasting hours searching. Start reaching out today.
            </p>

            <div className="mt-7 flex w-full max-w-3xl flex-col gap-4 sm:mt-9">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
                <Link href="/plans" className={secondaryCtaClass}>
                  View Plans
                </Link>
              </div>

              <p className="text-sm text-slate-300">
                No signup required · No credit card · Export instantly
              </p>

              <ul className="flex w-full flex-col gap-2 text-sm text-slate-400 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
                {heroSteps.map((step, index) => (
                  <li key={step} className="flex items-center gap-3">
                    <span>{step}</span>
                    {index < heroSteps.length - 1 ? (
                      <span className="text-slate-600" aria-hidden="true">
                        →
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>

              <p className="text-sm text-slate-400">
                Only real, verified contacts. No filler. No junk.
              </p>
            </div>
          </div>

          <div className="order-2 relative mx-auto w-full max-w-[34rem]">
            <div className="landing-orbit absolute left-[8%] top-[4%] h-24 w-24 rounded-full border border-cyan-400/20 bg-cyan-400/5 blur-[2px]" />
            <div className="landing-orbit absolute bottom-[16%] right-[6%] h-20 w-20 rounded-full border border-teal-300/20 bg-teal-300/5 blur-[2px]" />

            <div className="relative rounded-[34px] border border-white/10 bg-white/[0.03] p-4 shadow-[0_30px_120px_rgba(2,8,23,0.7)] backdrop-blur-2xl sm:p-5">
              <div className="absolute inset-0 rounded-[34px] bg-[linear-gradient(180deg,rgba(34,211,238,0.08),transparent_20%,transparent_78%,rgba(45,212,191,0.08))]" />
              <div className="relative min-h-[31rem] overflow-hidden rounded-[28px] border border-white/8 bg-[#06101f] p-4 sm:min-h-[38rem] sm:p-5">
                <div className="max-w-[21rem] sm:max-w-[22rem]">
                  <LiveLogPanel />
                </div>
                <FloatingLeadShowcase />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-12 lg:px-10 lg:py-14">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Everything you need to start outreach faster.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
              ALPA gives you the contact details that usually take hours to find manually.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {valueCards.map((card, index) => (
              <div
                key={card.title}
                className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(2,8,23,0.32)] backdrop-blur-xl"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-sm font-semibold text-cyan-100">
                  0{index + 1}
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-white">
                  {card.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-12 lg:px-10 lg:py-14">
        <div className="mx-auto max-w-6xl rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_80px_rgba(2,8,23,0.45)] backdrop-blur-xl sm:p-8 lg:p-10">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              How ALPA works
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
              From target market to contact-ready lead list in seconds.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className="rounded-[28px] border border-white/8 bg-[#081120]/90 p-5"
              >
                <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                  Step {index + 1}
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em] text-white">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-start gap-3">
            <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
            <p className="text-sm text-slate-400">
              No signup. No credit card. Your first list is free.
            </p>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-12 lg:px-10 lg:py-14">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Manual prospecting vs ALPA
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
              Your time should go into conversations, not spreadsheet hunting.
            </p>
          </div>

          <div className="mt-8 md:hidden">
            <div className="space-y-3">
              {comparisonRows.map((row) => (
                <div
                  key={row.manual}
                  className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] shadow-[0_18px_60px_rgba(2,8,23,0.3)] backdrop-blur-xl"
                >
                  <div className="border-b border-white/8 bg-[#08101d] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Manual
                    </div>
                    <div className="mt-1 text-sm leading-6 text-slate-300">{row.manual}</div>
                  </div>
                  <div className="bg-[linear-gradient(180deg,rgba(34,211,238,0.1),rgba(8,20,36,0.95))] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                      With ALPA
                    </div>
                    <div className="mt-1 text-sm font-medium leading-6 text-cyan-50">{row.alpa}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 hidden overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.03] shadow-[0_24px_80px_rgba(2,8,23,0.38)] backdrop-blur-xl md:block">
            <div className="grid gap-px bg-white/8 md:grid-cols-2">
              <div className="bg-[#08101d] px-5 py-4">
                <h3 className="text-lg font-semibold text-white">Manual Prospecting</h3>
              </div>
              <div className="bg-[linear-gradient(180deg,rgba(34,211,238,0.14),rgba(59,130,246,0.08))] px-5 py-4">
                <h3 className="text-lg font-semibold text-cyan-100">With ALPA</h3>
              </div>

              {comparisonRows.map((row) => (
                <div key={row.manual} className="contents">
                  <div className="bg-[#07101c] px-5 py-4 text-sm text-slate-300 sm:text-base">
                    {row.manual}
                  </div>
                  <div className="bg-[#071424] px-5 py-4 text-sm font-medium text-cyan-50 sm:text-base">
                    {row.alpa}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 flex flex-col items-start gap-3">
            <p className="text-base font-medium text-slate-300">Stop building lists manually.</p>
            <FreshStartCta className={primaryCtaClass}>Try ALPA Free</FreshStartCta>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-12 lg:px-10 lg:py-14">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Built for people who need leads now
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
              Whether you sell services, campaigns, advice, or growth — ALPA helps you build a
              prospect list faster.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {useCases.map((item) => (
              <div
                key={item.title}
                className={`rounded-[28px] border p-5 backdrop-blur-xl ${
                  item.bestFit
                    ? 'border-cyan-300/18 bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(15,23,42,0.92))] shadow-[0_20px_70px_rgba(34,211,238,0.12)]'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                  {item.bestFit ? (
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                      Best fit
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-4 py-10 sm:px-6 sm:py-12 lg:px-10 lg:py-14">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Start free. Upgrade when you need more.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
              Test ALPA without friction. If the first 25 leads help, unlock 300 leads/month for
              consistent prospecting.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="flex h-full rounded-[32px] border border-cyan-300/18 bg-[linear-gradient(180deg,rgba(34,211,238,0.1),rgba(8,17,32,0.96))] p-6 shadow-[0_24px_80px_rgba(34,211,238,0.14)] backdrop-blur-xl sm:p-7">
              <div className="flex w-full flex-col">
                <div className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
                Free Trial
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white">
                  25 leads
                </div>
                <div className="mt-2 text-sm text-cyan-100">Test ALPA instantly</div>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-300">
                  {freeBullets.map((item) => (
                    <li key={item} className="flex items-start gap-3 leading-6">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.55)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-7">
                  <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
                </div>
              </div>
            </div>

            <div className="flex h-full rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_80px_rgba(2,8,23,0.35)] backdrop-blur-xl sm:p-7">
              <div className="flex w-full flex-col">
                <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-300">
                  Starter
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white">
                  $29.99/month
                </div>
                <div className="mt-2 text-sm text-cyan-100">300 leads/month</div>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-300">
                  {starterBullets.map((item) => (
                    <li key={item} className="flex items-start gap-3 leading-6">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-300/90 shadow-[0_0_10px_rgba(34,211,238,0.45)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-7">
                  <Link href="/plans" className={secondaryCtaClass}>
                    Unlock 300 Leads
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-12 pt-10 sm:px-6 sm:pb-14 sm:pt-12 lg:px-10 lg:pb-16 lg:pt-14">
        <div className="mx-auto max-w-6xl rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(8,17,32,0.96))] px-6 py-8 text-center shadow-[0_26px_90px_rgba(2,8,23,0.46)] backdrop-blur-xl sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <h2 className="mx-auto max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl lg:text-[3.2rem]">
            Your next prospect list should not take hours to build.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
            Start with 25 free leads. No signup. No credit card. Export instantly.
          </p>

          <div className="mx-auto mt-8 flex w-full max-w-3xl flex-col gap-3 sm:flex-row">
            <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
            <Link href="/plans" className={secondaryCtaClass}>
              View Plans
            </Link>
          </div>

          <p className="mx-auto mt-5 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
            Stop wasting hours searching for leads. Use that time to reach out, close, and get
            paid.
          </p>
        </div>
      </section>

      <ResourcesFooter />
    </main>
  )
}
