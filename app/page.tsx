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

      {/* Grid — ghost trace on mobile; nearly invisible on desktop */}
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-[0.18] lg:opacity-[0.05]" />

      {/* Top gradient bloom */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[linear-gradient(180deg,rgba(37,99,235,0.11),rgba(2,6,23,0))]" />

      <PublicHeader />

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative px-4 pb-12 pt-7 sm:px-6 sm:pb-16 sm:pt-10 lg:px-10 lg:pb-32 lg:pt-24">

        {/* Desktop: floating ambient orb system — restrained, slow, cinematic */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
          <div className="hero-orb-float absolute -top-48 left-[16%] h-[700px] w-[800px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.08),transparent_65%)]" />
          <div className="hero-orb-alt absolute -right-28 top-[-10%] h-[540px] w-[600px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.05),transparent_65%)]" />
          <div className="hero-orb-slow absolute -bottom-32 left-[0%] h-[440px] w-[540px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.04),transparent_65%)]" />
        </div>

        <div className="mx-auto grid w-full max-w-7xl gap-9 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:items-center lg:gap-16">
          <div className="max-w-4xl">

            {/* Eyebrow — system indicator, no pill shape */}
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400/50" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                Contact-ready leads
              </span>
            </div>

            <h1 className="mt-6 max-w-5xl text-[2.4rem] font-semibold leading-[1.08] tracking-tight text-white sm:mt-8 sm:text-[4.5rem] sm:leading-[1.02] sm:tracking-[-0.04em] lg:mt-9 lg:max-w-none lg:text-[6.25rem] lg:leading-[0.92] lg:tracking-[-0.06em]">
              Business leads{' '}
              <br className="hidden lg:block" />
              in seconds.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-slate-400 sm:text-xl sm:leading-8 lg:mt-7 lg:max-w-[27rem] lg:text-[1.1rem] lg:leading-[1.75] lg:text-slate-500">
              Find contact-ready businesses with website, email, and phone numbers in seconds.
            </p>

            {/* Command bar CTA */}
            <div className="mt-8 flex max-w-xl flex-col items-start gap-3 lg:mt-11">
              <FreshStartCta className="group relative w-full overflow-hidden rounded-[13px] border border-white/[0.08] bg-[rgba(10,18,32,0.72)] px-4 py-3.5 text-left backdrop-blur-xl transition-all duration-300 hover:border-white/[0.14] hover:bg-[rgba(14,24,44,0.78)] active:scale-[0.99] sm:w-auto">
                {/* Passive shimmer sweep */}
                <span
                  aria-hidden="true"
                  className="command-bar-shimmer pointer-events-none absolute inset-0 rounded-[13px] bg-[linear-gradient(105deg,transparent_30%,rgba(255,255,255,0.022)_50%,transparent_70%)]"
                />
                <span className="relative flex items-center gap-3">
                  {/* System label */}
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="command-cursor-pulse h-1.5 w-1.5 rounded-full bg-blue-400/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">
                      Lead search
                    </span>
                  </span>
                  {/* Divider */}
                  <span className="h-3.5 w-px shrink-0 bg-white/[0.07]" aria-hidden="true" />
                  {/* Action text */}
                  <span className="text-sm font-medium tracking-[-0.01em] text-slate-300 transition-colors duration-200 group-hover:text-white">
                    Run a free lead search
                  </span>
                  {/* Arrow */}
                  <span
                    aria-hidden="true"
                    className="ml-0.5 shrink-0 text-slate-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-slate-400"
                  >
                    →
                  </span>
                </span>
              </FreshStartCta>
              <p className="text-xs text-slate-600">No credit card required</p>
            </div>
          </div>

          <div className="relative mx-auto hidden w-full max-w-[31rem] sm:block lg:max-w-none">
            {/* Ambient glow behind the preview — restrained */}
            <div className="pointer-events-none absolute -inset-8 hidden rounded-[48px] bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.09),transparent_68%)] blur-3xl lg:block" />
            <OperationalLeadPreview />
          </div>
        </div>
      </section>

      {/* ── MANIFESTO ────────────────────────────────────────────────────────── */}
      {/*
        Mobile: standard 2-line label + headline + supporting text.
        Desktop: full-width typographic manifesto. The h2 becomes the entire
        visual event. Supporting text answers from the opposite edge.
      */}
      <section className="relative px-4 py-14 sm:px-6 sm:py-16 lg:px-10 lg:py-44">

        {/* Desktop: directional glow from the left — makes it feel like a spotlight */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
          <div className="section-glow-drift absolute -left-[8%] top-[15%] h-[640px] w-[760px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(29,78,216,0.07),transparent_62%)] blur-3xl" />
        </div>

        <div className="cinematic-reveal mx-auto max-w-7xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
            The real problem
          </p>

          {/* Mobile heading */}
          <h2 className="mt-5 max-w-3xl text-[2rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl sm:leading-[1.02] sm:tracking-[-0.03em] lg:hidden">
            You did not become an entrepreneur to spend your time doing unpaid work.
          </h2>

          {/* Desktop heading — full width, manifesto scale */}
          <h2 className="mt-7 hidden text-[5.5rem] font-semibold leading-[0.91] tracking-[-0.065em] text-white lg:block">
            You did not become an entrepreneur to spend your time doing unpaid work.
          </h2>

          {/* Mobile supporting text */}
          <p className="mt-6 max-w-xl text-lg font-normal leading-8 tracking-normal text-slate-400 sm:text-xl sm:leading-9 lg:hidden">
            Hours spent searching manually across Google, LinkedIn, and directories are hours not spent building your business.
          </p>

          {/* Desktop supporting text — answered from the right, as a counterpoint */}
          <p className="hidden text-[1.05rem] leading-8 tracking-[-0.015em] text-slate-500 lg:ml-auto lg:mt-14 lg:block lg:max-w-[380px]">
            Hours spent searching manually across Google, LinkedIn, and directories are hours not spent building your business.
          </p>
        </div>
      </section>

      {/* ── OPERATIONAL SYSTEM ───────────────────────────────────────────────── */}
      {/*
        Mobile: label + headline above, preview below.
        Desktop: asymmetric split. Left column holds a cascading editorial reveal
        of the deliverables (Website → Done.). Right column is the live preview —
        wider, ungridded, suggesting the system is running right now.
      */}
      <section className="relative px-4 py-12 sm:px-6 sm:py-14 lg:px-10 lg:py-28">

        {/* Desktop: directional glow — drifts toward bottom-right, implying momentum */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
          <div className="directed-glow-flow absolute right-[-6%] top-[20%] h-[520px] w-[640px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(29,78,216,0.07),transparent_62%)] blur-3xl" />
        </div>

        <div className="mx-auto max-w-6xl lg:max-w-none lg:px-0">

          {/* Mobile: conventional header */}
          <div className="mb-7 sm:mb-10 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400/50" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                Contact-ready leads
              </span>
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-5xl sm:tracking-[-0.03em]">
              Website. Email. Phone. Export. Done.
            </h2>
          </div>

          {/* Desktop: asymmetric split */}
          <div className="cinematic-reveal hidden lg:flex lg:items-start lg:gap-16 lg:px-10">

            {/* Left: cascading opacity reveal — implied progress from Website → Done. */}
            <div className="w-[210px] shrink-0 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                Contact-ready leads
              </p>
              <div className="mt-10 space-y-px">
                <div className="text-[1.8rem] font-semibold leading-snug tracking-[-0.045em] text-white/[0.16]">Website.</div>
                <div className="text-[1.8rem] font-semibold leading-snug tracking-[-0.045em] text-white/[0.32]">Email.</div>
                <div className="text-[1.8rem] font-semibold leading-snug tracking-[-0.045em] text-white/[0.52]">Phone.</div>
                <div className="text-[1.8rem] font-semibold leading-snug tracking-[-0.045em] text-white/[0.76]">Export.</div>
                {/* Done. — system complete signal */}
                <div className="flex items-center gap-2.5 text-[1.8rem] font-semibold leading-snug tracking-[-0.045em] text-white">
                  Done.
                  <span className="lead-status-blink h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400/70" />
                </div>
              </div>
            </div>

            {/* Right: preview fills remaining space */}
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute -inset-6 rounded-[44px] bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.07),transparent_68%)] blur-2xl" />
              <OperationalLeadPreview variant="export" />
            </div>
          </div>

          {/* Mobile: full-width preview */}
          <div className="relative lg:hidden">
            <OperationalLeadPreview variant="export" />
          </div>
        </div>
      </section>

      {/* ── FLOW STEPS ───────────────────────────────────────────────────────── */}
      {/*
        Mobile: numbered circles with text, separated by a border.
        Desktop: giant faded ordinals anchor each step. No borders. Sparse.
        The whitespace IS the design.
      */}
      <section className="relative px-4 py-12 sm:px-6 sm:py-14 lg:px-10 lg:py-36">
        <div className="cinematic-reveal mx-auto max-w-6xl">
          <div className="flex flex-col gap-8 border-y border-white/[0.06] py-8 lg:flex-row lg:items-start lg:gap-0 lg:border-y-0 lg:py-0">
            {flowSteps.map((step, index) => (
              <div
                key={step.title}
                className="flex min-w-0 flex-1 items-center gap-5 lg:flex-col lg:items-start lg:px-16 lg:first:pl-0 lg:last:pr-0"
              >
                {/* Mobile: editorial numeral — no border, no box, just a faded ordinal */}
                <span className="w-7 shrink-0 text-left text-[1.3rem] font-bold leading-none tracking-tight text-white/20 lg:hidden">
                  {index + 1}
                </span>

                {/* Desktop: large faded ordinal — the number IS the atmosphere */}
                <div className="mb-6 hidden text-[7rem] font-bold leading-none tracking-[-0.08em] text-white/[0.07] lg:block">
                  {index + 1}
                </div>

                <div>
                  <div className="text-[1.05rem] font-semibold tracking-normal text-white lg:text-xl lg:tracking-[-0.04em]">
                    {step.title}
                  </div>
                  <div className="mt-1 text-sm text-slate-500 lg:mt-2">
                    {step.body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────────────────────── */}
      <section className="relative px-4 py-12 sm:px-6 sm:py-14 lg:px-10 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400/50" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">Simple pricing</span>
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl sm:tracking-[-0.03em] lg:text-[3.4rem] lg:tracking-[-0.045em]">
              25 free leads. No commitment.
            </h2>
          </div>

          <div className="cinematic-reveal mt-7 grid gap-4 lg:mt-14 lg:grid-cols-2 lg:gap-6">
            {/* Free card — subtle elevation via border tint, not neon */}
            <div className="rounded-[26px] border border-blue-400/[0.12] bg-[rgba(8,16,36,0.80)] p-6 shadow-[0_16px_48px_rgba(2,8,23,0.40),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:p-7 lg:rounded-[30px] lg:p-10">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400/50" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">25 free leads</span>
              </div>
              <p className="mt-4 text-base text-slate-300 lg:mt-5 lg:text-lg">
                Test the workflow before choosing a plan.
              </p>
              <div className="mt-6 lg:mt-8">
                <FreshStartCta className="group relative w-full overflow-hidden rounded-[11px] border border-white/[0.09] bg-[rgba(10,18,32,0.68)] px-4 py-3 text-left backdrop-blur-xl transition-all duration-300 hover:border-white/[0.15] hover:bg-[rgba(14,24,44,0.76)] active:scale-[0.99] sm:w-auto">
                  <span className="relative flex items-center gap-2.5">
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-400/60" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">Free trial</span>
                    </span>
                    <span className="h-3 w-px shrink-0 bg-white/[0.07]" aria-hidden="true" />
                    <span className="text-sm font-medium tracking-[-0.01em] text-slate-300 transition-colors duration-200 group-hover:text-white">
                      Start free
                    </span>
                    <span aria-hidden="true" className="ml-0.5 text-slate-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-slate-400">→</span>
                  </span>
                </FreshStartCta>
              </div>
            </div>

            {/* Paid card — recessed, less presence */}
            <div className="rounded-[26px] border border-white/[0.06] bg-white/[0.020] p-6 sm:p-7 lg:rounded-[30px] lg:p-9">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-600">
                Upgrade when it fits
              </div>
              <p className="mt-4 text-base text-slate-500 lg:mt-5 lg:text-lg">
                Plans start from $9.99/month.
              </p>
              <div className="mt-6 lg:mt-8">
                <Link
                  href="/plans"
                  className="group inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-all duration-200 hover:text-slate-300"
                >
                  View Plans
                  <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────────── */}
      <section className="relative px-4 pb-16 pt-12 sm:px-6 sm:pb-16 sm:pt-14 lg:px-10 lg:pb-40 lg:pt-36">

        {/* Desktop: breathing glow — shifted left to match editorial alignment */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
          <div className="cta-glow-breath absolute left-[38%] top-1/2 h-[640px] w-[960px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(29,78,216,0.14),transparent_58%)] blur-3xl" />
        </div>

        <div className="cinematic-reveal mx-auto max-w-5xl border-t border-white/8 pt-12 text-center sm:pt-14 lg:border-t-0 lg:pt-0 lg:text-left">
          <h2 className="mx-auto max-w-sm text-[2.1rem] font-semibold leading-[1.08] tracking-tight text-white sm:max-w-4xl sm:text-6xl sm:leading-[1.02] sm:tracking-[-0.04em] lg:mx-0 lg:max-w-none lg:text-[5.25rem] lg:leading-[0.94] lg:tracking-[-0.065em]">
            While you are still{' '}
            <br className="hidden lg:block" />
            thinking about this,
          </h2>
          <p className="mx-auto mt-6 max-w-xs text-base leading-7 text-slate-300 sm:max-w-2xl sm:text-lg lg:mx-0 lg:mt-9 lg:max-w-2xl lg:text-xl lg:text-slate-300">
            Your competitors are already talking to their next clients.
          </p>
          <p className="mx-auto mt-4 max-w-xs text-sm leading-6 text-slate-400 sm:max-w-2xl sm:text-base lg:mx-0 lg:mt-4 lg:text-slate-500">
            Best case: you leave with 25 free leads. Worst case: you lose less than a minute.
          </p>

          <div className="mx-auto mt-10 flex max-w-xl justify-center lg:mx-0 lg:mt-12 lg:justify-start">
            <FreshStartCta className="group relative w-full overflow-hidden rounded-[13px] border border-white/[0.08] bg-[rgba(10,18,32,0.72)] px-4 py-3.5 text-left backdrop-blur-xl transition-all duration-300 hover:border-white/[0.14] hover:bg-[rgba(14,24,44,0.78)] active:scale-[0.99] sm:w-auto">
              <span className="relative flex items-center gap-3">
                <span className="flex shrink-0 items-center gap-2">
                  <span className="command-cursor-pulse h-1.5 w-1.5 rounded-full bg-blue-400/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">Free trial</span>
                </span>
                <span className="h-3.5 w-px shrink-0 bg-white/[0.07]" aria-hidden="true" />
                <span className="text-sm font-medium tracking-[-0.01em] text-slate-300 transition-colors duration-200 group-hover:text-white">
                  Get 25 free leads
                </span>
                <span aria-hidden="true" className="ml-0.5 shrink-0 text-slate-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-slate-400">→</span>
              </span>
            </FreshStartCta>
          </div>
        </div>
      </section>

      <ResourcesFooter compact />
    </main>
  )
}
