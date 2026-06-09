import type { Metadata } from 'next'
import Link from 'next/link'

import BackLink from '@/components/resources/BackLink'
import FreshStartCta from '@/components/landing/FreshStartCta'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'Find Local Business Leads | ALPA',
  },
  description:
    'Learn how to find local business leads in a specific city or region, why manual local lead generation is slow, and how to speed it up.',
  alternates: {
    canonical: '/resources/find-local-business-leads',
  },
}

const leadMethods = [
  {
    title: 'Google Maps',
    description:
      'Google Maps is one of the most common starting points for local lead generation. It shows businesses by location, but it still leaves a lot of manual checking to do.',
  },
  {
    title: 'Business directories',
    description:
      'Directories can help surface local companies quickly. The downside is that listings are often outdated, broad, or missing useful contact details.',
  },
  {
    title: 'Manual searches',
    description:
      'Manual searches give you control over niche and location. They also slow the process down because every result still needs review.',
  },
  {
    title: 'Referrals',
    description:
      'Referrals can uncover strong local opportunities, especially in service-based markets. They are valuable, but they are difficult to scale consistently.',
  },
  {
    title: 'Tools',
    description:
      'Lead generation tools help you narrow by market and location faster. That reduces the time spent hunting through raw search results.',
  },
]

const inefficiencies = [
  'Manual filtering becomes repetitive when every business has to be checked one by one.',
  'Contact data is often incomplete, unclear, or spread across different pages.',
  'The process is slow, which delays outreach and weakens consistency.',
]

const faqItems = [
  {
    question: 'What are local business leads?',
    answer:
      'Local business leads are companies within a specific city, region, or service area that may realistically need your service.',
  },
  {
    question: 'How do you find leads in a specific city?',
    answer:
      'The clearest way is to combine a target market with a target location, then build a list of businesses that match both filters.',
  },
  {
    question: 'Is Google Maps enough for finding leads?',
    answer:
      'Google Maps is useful, but it usually requires too much manual filtering if you need a repeatable lead generation process.',
  },
  {
    question: 'How can I target businesses by location?',
    answer:
      'You can target by city, region, or service area, then narrow further by niche so your outreach is more relevant.',
  },
  {
    question: 'What makes a good local lead?',
    answer:
      'A good local lead matches your niche, falls inside your target area, and includes usable contact details so you can act on it quickly.',
  },
]

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

export default function FindLocalBusinessLeadsPage() {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqItems.map((item) => ({
              '@type': 'Question',
              name: item.question,
              acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer,
              },
            })),
          }),
        }}
      />

      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_34%),radial-gradient(circle_at_86%_16%,rgba(45,212,191,0.08),transparent_24%)]" />

      <PublicHeader />

      <div className="relative px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10 lg:px-10 lg:pb-24 lg:pt-12">
        <div className="mx-auto max-w-3xl">
          <BackLink />

          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-300">
            Resource Guide
          </div>

          <h1 className="mt-6 text-[2.25rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:mt-8 sm:text-[3.5rem] lg:text-[4.4rem]">
            Find Local Business Leads
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Finding local business leads isn&apos;t difficult.
            <br />
            Finding the right businesses in the right location quickly is.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Finding local business leads is the process of identifying companies within a
            specific city, region, or area that are likely to need your services.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="How people find local leads in practice">
              <ul className="space-y-4">
                {leadMethods.map((item) => (
                  <li key={item.title}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{item.description}</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="The local search problem">
              <p>
                Local searches often return too many businesses that are technically nearby but not
                actually relevant to your offer.
              </p>
              <p>
                Most search tools also do a poor job of filtering by real buying intent, so you
                still have to judge whether each company is worth contacting.
              </p>
              <p>
                That means time gets lost checking websites, categories, and contact pages one by
                one before outreach can even begin.
              </p>
              <p>
                If you want the broader workflow behind this, start with{' '}
                <Link href="/resources/how-to-find-business-leads" className="text-cyan-200 transition hover:text-white">
                  how to find business leads
                </Link>
                .
              </p>
            </Section>

            <Section title="Why local lead generation is inefficient">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {inefficiencies.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="A better way to find local business leads">
              <p>
                The old model is slow: search, scroll, filter, then verify. Every result needs
                more manual work before it becomes usable.
              </p>
              <p>
                The newer model is simpler: define location, generate leads, then contact. That
                reduces the time spent sorting through irrelevant businesses.
              </p>
              <p>
                ALPA fits that workflow. You choose the target, select the location, and generate
                leads quickly instead of checking businesses one by one.
              </p>
              <p>
                To make this consistent, you need a repeatable system →{' '}
                <Link href="/resources/lead-generation-system" className="text-cyan-200 transition hover:text-white">
                  Build a lead generation system
                </Link>
                .
              </p>
              <p className="pt-2">
                <Link
                  href="/dashboard/scraper"
                  className="text-sm font-medium text-cyan-200 transition hover:text-white"
                >
                  Start with 25 free leads and find businesses in your target location →
                </Link>
              </p>
            </Section>

            <Section title="How location targeting changes lead generation">
              <p>
                Location targeting helps you work from a smaller and more relevant pool of businesses.
              </p>
              <p>
                Combining niche plus location makes outreach more specific, whether you are targeting
                restaurants in one city or contractors in one region.
              </p>
              <p>
                That usually leads to faster prospecting, clearer messaging, and a more focused
                pipeline.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop searching for local businesses one by one.
                <br />
                Start building a pipeline in your target location.
              </h2>

              <div className="mt-6 flex flex-col gap-3">
                <FreshStartCta className={primaryCtaClass}>Get 25 Free Leads</FreshStartCta>
                <Link href="/plans" className={secondaryCtaClass}>
                  View Plans
                </Link>
              </div>

              <div className="mt-3 text-center text-xs text-slate-500">
                No signup required • Start in seconds
              </div>
            </section>

            <section className="border-t border-white/8 pt-10 sm:pt-12">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Frequently Asked Questions
              </h2>

              <div className="mt-6 space-y-6">
                {faqItems.map((item) => (
                  <div key={item.question}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">
                      {item.question}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{item.answer}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
