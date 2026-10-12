import type { Metadata } from 'next'
import Link from 'next/link'
import FreshStartCta from '@/components/landing/FreshStartCta'
import FreeTrialCommandFlow from '@/components/landing/FreeTrialCommandFlow'
import PublicHeader from '@/components/site/PublicHeader'
import ResourcesFooter from '@/components/site/ResourcesFooter'
import LandingPageTracker from '@/components/tracking/LandingPageTracker'

const pageTitle = 'Lead Generation Tool for Freelancers & Agencies | ALPA'
const pageDescription =
  'Find businesses, available contact details, and useful context with ALPA. Start discovering your first 25 businesses free.'

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

const heading = 'text-3xl font-semibold leading-[1.12] tracking-tight sm:text-4xl lg:text-5xl'
const section = 'relative mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:px-10 lg:py-24'
const cta = 'inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-[#d9bd82] px-6 py-3 text-sm font-semibold text-[#101a2c] transition-colors hover:bg-[#ead4a8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9bd82] sm:w-auto'
const features = [
  { title: 'WHO THEY ARE', body: 'Business name, location, industry, and an overview.' },
  { title: 'WHAT THEY DO', body: 'Services, products, customers, and useful information from their website.' },
  { title: 'HOW TO REACH THEM', body: 'Available email, phone, and website.' },
]
const steps = [
  { title: 'Tell us who you’re looking for.', body: 'Choose a business type and location. For example: dentists in Montreal.' },
  { title: 'Let ALPA do the research.', body: 'Find businesses, available contact details, and research from their websites.' },
  { title: 'Start the conversation.', body: 'Review your results, explore business profiles, and export your list.' },
]
const audiences = [
  { title: 'Freelancers', body: 'Find businesses that could use your skills, and understand them before you reach out.' },
  { title: 'Agencies', body: 'Build a prospect list for your services, with context to make your outreach relevant.' },
  { title: 'Consultants', body: 'Research potential clients in your niche and prepare for a more informed conversation.' },
  { title: 'Business developers', body: 'Explore new markets and bring business details and contact information into your pipeline.' },
]

export default function HomePage() {
  return (
    <main className="overflow-hidden bg-[#081222] text-[#f5f1e8]">
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
              'ALPA helps freelancers, consultants, coaches, agencies, and professional service providers find businesses and available contact details with website, email, and phone enrichment.',
            featureList: [
              'Discovers businesses',
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


      <PublicHeader trialCta />
      <section className={`${section} grid gap-12 pt-12 lg:grid-cols-2 lg:items-center lg:gap-16`}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#d9bd82]">ALPA by MINDRA</p>
          <h1 className="mt-6 text-[2.6rem] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-6xl lg:text-[4.5rem]">You need customers.<br /><span className="text-[#d9bd82]">We find them for you.</span></h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">Tell ALPA what kind of businesses you’re looking for. We’ll find them, tell you who they are, what they do, and how to reach them.</p>
          <p className="mt-5 text-base font-medium leading-7">You focus on turning conversations into customers.</p>
          <div className="mt-8"><FreshStartCta className={cta}>Find 25 businesses free →</FreshStartCta></div>
          <p className="mt-4 text-sm leading-6 text-slate-400">No account. No credit card. Just start.</p>
        </div>
        <figure className="min-w-0 rounded-2xl border border-[#d9bd82]/25 bg-[#101e32] p-5 shadow-2xl sm:p-7">
          <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 pb-4 text-xs text-slate-400"><span className="font-semibold tracking-[0.15em] text-[#d9bd82]">DISCOVERY</span><span>Illustrative preview</span></figcaption>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-slate-400">Business type</p><p className="mt-1">Dentists</p></div><div className="rounded-lg border border-white/10 p-3"><p className="text-xs text-slate-400">Location</p><p className="mt-1">Montreal</p></div></div>
          <div className="mt-5 rounded-xl bg-[#f5f1e8] p-5 text-[#101a2c] sm:p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#72613f]">Example business profile</p>
            <h2 className="mt-3 text-xl font-semibold">Example Dental Clinic</h2>
            <p className="mt-1 text-sm text-slate-600">Montreal, Quebec · Dentistry</p>
            <dl className="mt-5 space-y-4 text-sm">
              <div><dt className="text-xs font-semibold text-[#72613f]">01 — WHO THEY ARE</dt><dd className="mt-1 leading-6">A local dental practice serving Montreal.</dd></div>
              <div><dt className="text-xs font-semibold text-[#72613f]">02 — WHAT THEY DO</dt><dd className="mt-1 leading-6">General dentistry and preventive care.</dd></div>
              <div><dt className="text-xs font-semibold text-[#72613f]">03 — HOW TO REACH THEM</dt><dd className="mt-1 leading-6">Available email, phone, and website.</dd></div>
            </dl>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-400">Sample content. Details vary by business.</p>
        </figure>
      </section>

      <section className="bg-[#f5f1e8] text-[#101a2c]">
        <div className={section}>
          <h2 className={heading}>Finding businesses is easy.<br /><span className="text-[#72613f]">Finding the right information isn’t.</span></h2>
          <div className="mt-7 max-w-2xl space-y-4 text-base leading-8 text-slate-600"><p>You can spend an afternoon searching Google, opening websites, hunting for contact details, and trying to understand what each business actually does.</p><p>Or you can let ALPA handle the research.</p></div>
          <div className="mt-9 grid gap-5 md:grid-cols-2">
            <div className="border-t border-[#101a2c]/15 pt-5"><h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">The old way</h3><p className="mt-3 text-sm leading-8 text-slate-600">Search Google → Open websites → Find contacts → Read about each business → Copy into a spreadsheet → Repeat</p></div>
            <div className="border-t border-[#a1854e] pt-5"><h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#72613f]">The ALPA way</h3><p className="mt-3 text-sm font-medium leading-8">Choose business type + location → Discover → Review businesses, contacts, and context</p></div>
          </div>
          <p className="mt-9 text-lg font-medium">One search. Businesses, contacts, and context in one place.</p>
        </div>
      </section>

      <section className={section}>
        <h2 className={heading}>More than a name and an email.</h2>
        <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300">Every business ALPA discovers can give you information to help you decide whether to approach it.</p>
        <div className="mt-10 grid gap-8 md:grid-cols-3">{features.map((feature, index) => <div key={feature.title} className="border-t border-[#d9bd82]/30 pt-6"><p className="text-sm text-[#d9bd82]">0{index + 1}</p><h3 className="mt-4 text-xs font-semibold tracking-[0.16em]">{feature.title}</h3><p className="mt-3 text-base leading-7 text-slate-300">{feature.body}</p></div>)}</div>
        <p className="mt-10 max-w-2xl text-base leading-8 text-slate-300">No digging through websites. No copying information into spreadsheets. Just businesses you can research and contact.</p>
        <div className="mt-7"><FreshStartCta className={cta}>See what ALPA can find →</FreshStartCta></div>
      </section>

      <section className="border-y border-white/10 bg-[#101e32]">
        <div className={section}>
          <h2 className={heading}>Three steps. That’s it.</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">{steps.map((step, index) => <li key={step.title}><span className="text-4xl font-light text-[#d9bd82]">0{index + 1}</span><h3 className="mt-4 text-lg font-semibold">{step.title}</h3><p className="mt-3 text-base leading-7 text-slate-300">{step.body}</p></li>)}</ol>
          <div className="mt-9"><FreshStartCta className={cta}>Try it free →</FreshStartCta><p className="mt-4 text-sm text-slate-400">Your first 25 businesses are on us.</p></div>
        </div>
      </section>

      <section className={section}>
        <h2 className={heading}>Your next customer is out there.<br /><span className="text-[#d9bd82]">Finding them shouldn’t be your full-time job.</span></h2>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">{audiences.map((audience) => <div key={audience.title} className="border-t border-white/15 pt-5"><h3 className="text-lg font-semibold">{audience.title}</h3><p className="mt-3 text-sm leading-7 text-slate-300">{audience.body}</p></div>)}</div>
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
                <FreshStartCta className="btn-primary-gold group w-full sm:w-auto">
                  Start free
                  <span aria-hidden="true" className="ml-2 transition-transform duration-200 group-hover:translate-x-0.5">→</span>
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

      <section className="bg-[#f5f1e8] text-[#101a2c]">
        <div className={`${section} text-center`}>
          <h2 className={`${heading} mx-auto max-w-4xl`}>You could be talking to your next customer.<br /><span className="text-[#72613f]">Instead, you’re still looking for them.</span></h2>
          <p className="mt-7 text-base leading-7 text-slate-600">Let ALPA handle the search and research.</p>
          <p className="mt-3 text-lg font-medium">Find your first 25 businesses free.</p>
          <div className="mt-8"><FreshStartCta className={cta}>Start discovering →</FreshStartCta></div>
          <p className="mt-4 text-sm leading-6 text-slate-600">No account required to begin. No credit card. No commitment.</p>
        </div>
      </section>
      <ResourcesFooter compact />
      <FreeTrialCommandFlow />
    </main>
  )
}
