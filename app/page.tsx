import type { Metadata } from 'next'
import Link from 'next/link'

import FloatingLeadShowcase from '@/components/landing/FloatingLeadShowcase'
import FreshStartCta from '@/components/landing/FreshStartCta'
import LiveLogPanel from '@/components/landing/LiveLogPanel'
import PublicHeader from '@/components/site/PublicHeader'
import ResourcesFooter from '@/components/site/ResourcesFooter'

export const metadata: Metadata = {
  title: {
    absolute: 'Lead Generation & Prospecting Platform | ALPA',
  },
  description:
    'Find and access verified business leads faster with ALPA. A modern prospecting platform designed for freelancers, agencies, and sales teams.',
  alternates: {
    canonical: '/',
  },
}

const howItWorks = [
  'Search your target market',
  'Get verified contacts',
  'Start reaching out',
]
const heroSteps = ['Define your target', 'Select your location', 'Get verified leads in seconds']
const ctaBaseClass =
  'inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl px-6 text-base font-semibold tracking-[-0.01em] transition-all duration-200 sm:min-h-[58px] sm:px-7'
const primaryCtaClass = `${ctaBaseClass} border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]`
const secondaryCtaClass = `${ctaBaseClass} border border-white/35 bg-transparent text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-white/50 hover:bg-white/[0.05]`

export default function HomePage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'ALPA',
            applicationCategory: 'BusinessApplication',
            description: 'Lead generation and prospecting platform for finding verified business contacts.',
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

      <section className="relative px-4 pb-12 pt-6 sm:px-6 sm:pb-16 sm:pt-10 lg:px-10 lg:pb-20 lg:pt-12">
        <div className="mx-auto grid w-full max-w-7xl gap-10 sm:gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(380px,0.98fr)] lg:items-center lg:gap-14">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-300">
              Premium lead engine
            </div>

            <h1 className="mt-6 max-w-5xl text-[2.35rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:mt-8 sm:text-[4rem] lg:text-[5.6rem]">
              Find Verified Business Leads in Minutes
            </h1>

            <p className="mt-6 max-w-3xl text-base leading-7 text-slate-300 sm:mt-8 sm:text-xl sm:leading-8">
              A modern lead generation platform designed to help freelancers, agencies, and sales teams discover and contact the right businesses faster.
            </p>

            <div className="mt-8 flex w-full max-w-3xl flex-col items-start gap-4 sm:mt-10">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
                <Link href="/plans" className={secondaryCtaClass}>
                  View Plans
                </Link>
              </div>

              <ul className="flex w-full max-w-3xl flex-col items-start gap-2 text-left text-sm text-slate-400 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
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

              <p className="text-left text-sm text-slate-400">
                No signup required • No credit card required
              </p>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[34rem]">
            <div className="landing-orbit absolute left-[8%] top-[4%] h-24 w-24 rounded-full border border-cyan-400/20 bg-cyan-400/5 blur-[2px]" />
            <div className="landing-orbit absolute bottom-[16%] right-[6%] h-20 w-20 rounded-full border border-teal-300/20 bg-teal-300/5 blur-[2px]" />

            <div className="relative rounded-[34px] border border-white/10 bg-white/[0.03] p-4 shadow-[0_30px_120px_rgba(2,8,23,0.7)] backdrop-blur-2xl sm:p-5">
              <div className="absolute inset-0 rounded-[34px] bg-[linear-gradient(180deg,rgba(34,211,238,0.08),transparent_20%,transparent_78%,rgba(45,212,191,0.08))]" />
              <div className="relative min-h-[36rem] overflow-hidden rounded-[28px] border border-white/8 bg-[#06101f] p-4 sm:min-h-[40rem] sm:p-5">
                <div className="max-w-[21rem] sm:max-w-[22rem]">
                  <LiveLogPanel />
                </div>
                <FloatingLeadShowcase />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-12 sm:px-6 sm:py-14 lg:px-10 lg:py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            What is ALPA?
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-300 sm:text-lg">
            ALPA is a lead generation and prospecting platform designed to help freelancers and
            agencies find verified business leads and contact details in minutes.
          </p>
          <p className="mt-4 text-base leading-8 text-slate-400 sm:text-lg">
            Instead of spending hours searching and validating data manually, ALPA helps you move
            faster from research to outreach.
          </p>
        </div>
      </section>

      <section className="relative px-4 py-12 sm:px-6 sm:py-14 lg:px-10 lg:py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            How it works
          </h2>
          <ul className="mt-8 space-y-5">
            {howItWorks.map((item, index) => (
              <li key={item} className="flex items-start gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-sm font-semibold text-cyan-100">
                  {index + 1}
                </span>
                <span className="pt-1 text-base leading-7 text-slate-300 sm:text-lg">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-8 lg:px-10 lg:pb-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Start with 25 free leads and see how quickly your next opportunities appear.
          </h2>

          <div className="mt-8 flex flex-col gap-3">
            <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
            <Link href="/plans" className={secondaryCtaClass}>
              View Plans
            </Link>
          </div>

          <div className="mt-3 text-center text-xs text-slate-500">
            No signup required • Get leads in seconds
          </div>

          <p className="mt-8 text-center text-base leading-7 text-slate-400 sm:text-lg">
            Stop wasting hours searching for leads.
            <br />
            Use that time to reach out, close, and get paid.
          </p>
        </div>
      </section>

      <ResourcesFooter />
    </main>
  )
}
