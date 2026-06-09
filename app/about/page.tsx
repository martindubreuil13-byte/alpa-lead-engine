import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import PublicHeader from '@/components/site/PublicHeader'

const pageTitle = 'About ALPA by MINDRA | ALPA'
const pageDescription =
  'Learn what ALPA is, why MINDRA Solutions built it, and how it helps freelancers and agencies make lead generation more consistent with less wasted time.'

export const metadata: Metadata = {
  title: {
    absolute: pageTitle,
  },
  description: pageDescription,
  alternates: {
    canonical: '/about',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: 'https://alpa.mindrasolutions.com/about',
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

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-white/8 pt-10 sm:pt-12">
      <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">{title}</h2>
      <div className="mt-5 space-y-4 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
        {children}
      </div>
    </section>
  )
}

export default function AboutPage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[40rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_84%_16%,rgba(45,212,191,0.1),transparent_24%)]" />

      <PublicHeader activePath="/about" />

      <section className="relative px-4 pb-12 pt-8 sm:px-6 sm:pb-14 sm:pt-12 lg:px-10 lg:pb-16 lg:pt-14">
        <div className="mx-auto max-w-5xl">
          <h1 className="max-w-4xl text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-[3.8rem] lg:text-[4.8rem]">
            About ALPA
          </h1>

          <p className="mt-6 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            ALPA is built to solve a simple but expensive problem.
          </p>
        </div>
      </section>

      <section className="relative px-4 pb-12 sm:px-6 sm:pb-14 lg:px-10 lg:pb-16">
        <div className="mx-auto max-w-5xl space-y-10 sm:space-y-12">
          <Section title="What is ALPA">
            <p>
              Most businesses do not struggle to find leads once. They struggle to find them
              consistently without wasting time.
            </p>
            <p>
              The traditional approach to lead generation is slow, repetitive, and difficult to
              maintain. It depends on manual searching, scattered tools, and inconsistent effort.
            </p>
            <p>
              ALPA was created to simplify that process.
            </p>
          </Section>

          <Section title="What problem it solves">
            <p>
              Instead of rebuilding lead lists from scratch, you define your target, generate leads
              faster, and move directly into outreach.
            </p>
            <p>
              The goal is not just to find more leads. It is to build a process that works every
              week.
            </p>
          </Section>

          <Section title="ALPA and MINDRA">
            <p>
              ALPA is part of MINDRA.
            </p>
            <p>
              MINDRA focuses on building systems that combine clarity, structure, and execution to
              help businesses operate more efficiently.
            </p>
            <p>
              ALPA applies that same approach to lead generation: less noise, fewer steps, and a
              clearer path from targeting to action.
            </p>
          </Section>
        </div>
      </section>

      <section className="relative px-4 pb-16 pt-4 sm:px-6 sm:pb-20 sm:pt-6 lg:px-10 lg:pb-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Start with 25 free leads and see the workflow in practice.
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
