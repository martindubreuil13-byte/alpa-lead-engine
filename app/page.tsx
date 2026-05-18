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

      {/* Grid — barely visible on desktop; atmosphere takes over */}
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-50 lg:opacity-[0.10]" />

      {/* Top gradient bloom */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[linear-gradient(180deg,rgba(37,99,235,0.18),rgba(2,6,23,0))]" />

      <PublicHeader />

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative px-4 pb-12 pt-7 sm:px-6 sm:pb-16 sm:pt-10 lg:px-10 lg:pb-32 lg:pt-20">

        {/* Desktop: floating ambient orb system */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
          <div className="hero-orb-float absolute -top-48 left-[16%] h-[700px] w-[800px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.16),transparent_65%)]" />
          <div className="hero-orb-alt absolute -right-28 top-[-10%] h-[540px] w-[600px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(14,165,233,0.10),transparent_65%)]" />
          <div className="hero-orb-slow absolute -bottom-32 left-[0%] h-[440px] w-[540px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.08),transparent_65%)]" />
        </div>

        <div className="mx-auto grid w-full max-w-7xl gap-9 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)] lg:items-center lg:gap-16">
          <div className="max-w-4xl">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-100 lg:border-white/[0.12] lg:bg-white/[0.05] lg:px-3.5 lg:py-1.5">
              Contact-ready leads
            </div>

            <h1 className="mt-5 max-w-5xl text-[2.75rem] font-semibold leading-[0.96] tracking-[-0.06em] text-white sm:mt-7 sm:text-[4.5rem] lg:mt-8 lg:max-w-none lg:text-[6.25rem] lg:leading-[0.91]">
              Business leads
              <br className="hidden lg:block" />
              in seconds.
              <br className="hidden lg:block" />
              Literally.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-xl sm:leading-8 lg:mt-7 lg:max-w-[26rem] lg:text-[1.15rem] lg:leading-8 lg:text-slate-400">
              Start with 25 free leads and see how fast prospecting should feel.
            </p>

            <div className="mt-7 flex max-w-xl flex-col items-start gap-4 sm:mt-8 lg:mt-10">
              <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>

              <ul className="flex max-w-full flex-wrap gap-2 text-sm text-slate-300">
                {frictionPoints.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 lg:border-white/[0.07] lg:bg-white/[0.025]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative mx-auto hidden w-full max-w-[31rem] sm:block lg:max-w-none">
            {/* Desktop: ambient glow behind the preview */}
            <div className="pointer-events-none absolute -inset-8 hidden rounded-[48px] bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.18),transparent_68%)] blur-3xl lg:block" />
            {/* Desktop: light sweep */}
            <div className="pointer-events-none absolute inset-0 hidden overflow-hidden rounded-[30px] lg:block">
              <div className="preview-sweep absolute inset-y-0 w-36 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)]" />
            </div>
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
          <div className="section-glow-drift absolute -left-[8%] top-[15%] h-[640px] w-[760px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(29,78,216,0.11),transparent_62%)] blur-3xl" />
        </div>

        <div className="cinematic-reveal mx-auto max-w-7xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-100/80 sm:text-sm sm:tracking-[0.24em] lg:text-[11px] lg:tracking-[0.34em] lg:text-cyan-100/60">
            The real problem
          </p>

          {/* Mobile heading */}
          <h2 className="mt-5 max-w-3xl text-[2rem] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-5xl sm:leading-[1.02] lg:hidden">
            You did not become an entrepreneur to spend your time doing unpaid work.
          </h2>

          {/* Desktop heading — full width, manifesto scale */}
          <h2 className="mt-7 hidden text-[5.5rem] font-semibold leading-[0.91] tracking-[-0.065em] text-white lg:block">
            You did not become an entrepreneur to spend your time doing unpaid work.
          </h2>

          {/* Mobile supporting text */}
          <p className="mt-7 text-xl font-medium leading-8 tracking-[-0.02em] text-slate-300 sm:text-2xl sm:leading-9 lg:hidden">
            So why are you still spending hours hunting for leads manually when ALPA can do it in seconds?
          </p>

          {/* Desktop supporting text — answered from the right, as a counterpoint */}
          <p className="hidden text-[1.1rem] leading-8 tracking-[-0.015em] text-slate-500 lg:ml-auto lg:mt-16 lg:block lg:max-w-[400px]">
            So why are you still spending hours hunting for leads manually when ALPA can do it in seconds?
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
      <section className="relative px-4 py-10 sm:px-6 sm:py-14 lg:px-10 lg:py-28">

        {/* Desktop: directional glow — drifts toward bottom-right, implying momentum */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
          <div className="directed-glow-flow absolute right-[-6%] top-[20%] h-[520px] w-[640px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(29,78,216,0.10),transparent_62%)] blur-3xl" />
        </div>

        <div className="mx-auto max-w-6xl lg:max-w-none lg:px-0">

          {/* Mobile: conventional header */}
          <div className="mb-7 sm:mb-10 lg:hidden">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
              Contact-ready leads
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">
              Website. Email. Phone. Export. Done.
            </h2>
          </div>

          {/* Desktop: asymmetric split */}
          <div className="cinematic-reveal hidden lg:flex lg:items-start lg:gap-16 lg:px-10">

            {/* Left: cascading opacity reveal — implied progress from Website → Done. */}
            <div className="w-[210px] shrink-0 pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-100/60">
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
                  <span className="lead-status-blink h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                </div>
              </div>
            </div>

            {/* Right: preview fills remaining space */}
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute -inset-6 rounded-[44px] bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.12),transparent_68%)] blur-2xl" />
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
      <section className="relative px-4 py-10 sm:px-6 sm:py-14 lg:px-10 lg:py-36">
        <div className="cinematic-reveal mx-auto max-w-6xl">
          <div className="flex flex-col gap-7 border-y border-white/[0.06] py-7 lg:flex-row lg:items-start lg:gap-0 lg:border-y-0 lg:py-0">
            {flowSteps.map((step, index) => (
              <div
                key={step.title}
                className="flex min-w-0 flex-1 items-center gap-4 lg:flex-col lg:items-start lg:px-16 lg:first:pl-0 lg:last:pr-0"
              >
                {/* Mobile: circle */}
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/18 bg-cyan-400/[0.08] text-sm font-semibold text-cyan-100 lg:hidden">
                  {index + 1}
                </div>

                {/* Desktop: large faded ordinal — the number IS the atmosphere */}
                <div className="mb-6 hidden text-[7rem] font-bold leading-none tracking-[-0.08em] text-white/[0.07] lg:block">
                  {index + 1}
                </div>

                <div>
                  <div className="text-xl font-semibold tracking-[-0.03em] text-white lg:text-xl lg:tracking-[-0.04em]">
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
      <section className="relative px-4 py-10 sm:px-6 sm:py-14 lg:px-10 lg:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
              Simple pricing
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-white sm:text-5xl lg:text-[3.4rem]">
              25 free leads. No commitment.
            </h2>
          </div>

          <div className="cinematic-reveal mt-7 grid gap-4 lg:mt-14 lg:grid-cols-2 lg:gap-8">
            {/* Free card — visually dominant: stronger glow, more presence */}
            <div className="rounded-[30px] border border-cyan-300/18 bg-[linear-gradient(180deg,rgba(34,211,238,0.1),rgba(8,17,32,0.96))] p-6 shadow-[0_24px_80px_rgba(34,211,238,0.12)] backdrop-blur-xl sm:p-7 lg:rounded-[36px] lg:border-cyan-300/22 lg:p-10 lg:shadow-[0_40px_120px_rgba(34,211,238,0.20),inset_0_1px_0_rgba(34,211,238,0.18)]">
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100">
                25 free leads
              </div>
              <p className="mt-3 text-base text-slate-300 lg:mt-4 lg:text-lg">
                Test the workflow before choosing a plan.
              </p>
              <div className="mt-6 lg:mt-9">
                <FreshStartCta className={primaryCtaClass}>Start Free</FreshStartCta>
              </div>
            </div>

            {/* Paid card — deliberately recessed: less glow, lower contrast */}
            <div className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 shadow-[0_24px_80px_rgba(2,8,23,0.32)] backdrop-blur-xl sm:p-7 lg:rounded-[36px] lg:border-white/[0.05] lg:bg-white/[0.018] lg:p-9">
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
                Upgrade when it fits
              </div>
              <p className="mt-3 text-base text-slate-400 lg:mt-4 lg:text-lg">
                Plans start from $9.99/month.
              </p>
              <div className="mt-6 lg:mt-9">
                <Link href="/plans" className={pricingLinkClass}>
                  View Plans
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────────── */}
      <section className="relative px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-14 lg:px-10 lg:pb-40 lg:pt-36">

        {/* Desktop: breathing glow — shifted left to match editorial alignment */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
          <div className="cta-glow-breath absolute left-[38%] top-1/2 h-[640px] w-[960px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(29,78,216,0.22),transparent_58%)] blur-3xl" />
        </div>

        <div className="cinematic-reveal mx-auto max-w-5xl border-t border-white/8 pt-10 text-center sm:pt-14 lg:border-t-0 lg:pt-0 lg:text-left">
          <h2 className="mx-auto max-w-4xl text-4xl font-semibold leading-[1.02] tracking-[-0.055em] text-white sm:text-6xl lg:mx-0 lg:max-w-none lg:text-[5.25rem] lg:leading-[0.94] lg:tracking-[-0.065em]">
            While you are still
            <br className="hidden lg:block" />
            thinking about this,
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg lg:mx-0 lg:mt-9 lg:max-w-2xl lg:text-xl lg:text-slate-300">
            Your competitors are already talking to their next clients.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base lg:mx-0 lg:mt-4 lg:text-slate-500">
            Best case: you leave with 25 free leads. Worst case: you lose less than a minute.
          </p>

          <div className="mx-auto mt-8 flex max-w-xl justify-center lg:mx-0 lg:mt-12 lg:justify-start">
            <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
          </div>
        </div>
      </section>

      <ResourcesFooter compact />
    </main>
  )
}
