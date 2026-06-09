import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import PublicHeader from '@/components/site/PublicHeader'
import { resources } from '@/lib/resources'

const pageTitle = 'Lead Generation Resources | ALPA'
const pageDescription =
  'Explore ALPA lead generation resources covering prospecting, qualification, outreach, tools, and building a more consistent pipeline.'

export const metadata: Metadata = {
  title: {
    absolute: pageTitle,
  },
  description: pageDescription,
  alternates: {
    canonical: '/resources',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: 'https://alpa.mindrasolutions.com/resources',
    type: 'website',
  },
  twitter: {
    title: pageTitle,
    description: pageDescription,
  },
}

const ctaBaseClass =
  'inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl px-6 text-base font-semibold tracking-[-0.01em] transition-all duration-200 sm:min-h-[58px] sm:px-7'
const primaryCtaClass = 'btn-primary-gold w-full sm:w-auto'
const secondaryCtaClass = `${ctaBaseClass} border border-white/35 bg-transparent text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-white/50 hover:bg-white/[0.05]`

export default function ResourcesPage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[40rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_84%_16%,rgba(45,212,191,0.1),transparent_24%)]" />

      <PublicHeader activePath="/resources" />

      <section className="relative px-4 pb-12 pt-8 sm:px-6 sm:pb-14 sm:pt-12 lg:px-10 lg:pb-16 lg:pt-14">
        <div className="mx-auto max-w-5xl">
          <h1 className="max-w-4xl text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-[3.8rem] lg:text-[4.8rem]">
            Lead Generation Resources
          </h1>

          <p className="mt-6 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Explore practical guides on finding leads, qualifying them, improving outreach, and
            building a more consistent prospecting system.
          </p>
        </div>
      </section>

      <section className="relative px-4 pb-12 sm:px-6 sm:pb-14 lg:px-10 lg:pb-16">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {resources.map((resource) => (
              <Link
                key={resource.href}
                href={resource.href}
                className="group rounded-[28px] border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/15 hover:bg-white/[0.05]"
              >
                <h2 className="text-lg font-semibold tracking-[-0.02em] text-white transition group-hover:text-cyan-100">
                  {resource.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-400">{resource.description}</p>
                <div className="mt-4 text-sm font-medium text-cyan-200 transition group-hover:text-white">
                  Read resource →
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-16 pt-4 sm:px-6 sm:pb-20 sm:pt-6 lg:px-10 lg:pb-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Start with 25 free leads and put the system into practice.
          </h2>

          <div className="mt-8 flex flex-col gap-3">
            <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
            <Link href="/plans" className={secondaryCtaClass}>
              View Plans
            </Link>
          </div>

          <div className="mt-3 text-center text-xs text-slate-500">
            No signup required • Start in seconds
          </div>
        </div>
      </section>
    </main>
  )
}
