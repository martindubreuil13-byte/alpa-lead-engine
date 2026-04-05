import type { Metadata } from 'next'
import Link from 'next/link'

import BackLink from '@/components/resources/BackLink'
import FreshStartCta from '@/components/landing/FreshStartCta'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'Lead Generation for Agencies | ALPA',
  },
  description:
    'Learn how lead generation for agencies works, why consistent client acquisition is difficult, and how to find verified business leads faster.',
  alternates: {
    canonical: '/resources/lead-generation-for-agencies',
  },
}

const leadSources = [
  {
    title: 'Referrals',
    description:
      'Many agencies grow through referrals because trust is already established. The problem is that referrals are difficult to predict and rarely create steady pipeline coverage.',
  },
  {
    title: 'Outbound outreach',
    description:
      'Outbound gives agencies more control over who they target. It works best when the agency already has a clear niche and a strong list of businesses to contact.',
  },
  {
    title: 'Partnerships and networks',
    description:
      'Partnerships can open warm introductions and repeat opportunities. They are valuable, but they still depend on other people sending the next lead.',
  },
  {
    title: 'Lead generation tools',
    description:
      'Lead generation tools help agencies find businesses and contact details faster. That makes prospecting more repeatable and less dependent on one channel.',
  },
]

const clientChallenges = [
  'Referral-heavy growth creates uneven demand from month to month.',
  'Manual research slows down outreach and takes time away from delivery.',
  'Low-quality leads create wasted follow-up and poor-fit conversations.',
]

const faqItems = [
  {
    question: 'What is ALPA?',
    answer:
      'ALPA is a lead generation platform that helps you find verified business contacts quickly.',
  },
  {
    question: 'How does ALPA find leads?',
    answer:
      'ALPA scans and aggregates business data, then filters and verifies usable contact details.',
  },
  {
    question: 'Who is ALPA best for?',
    answer:
      'ALPA is best for freelancers, agencies, and small teams that need a more consistent flow of business leads.',
  },
  {
    question: 'Do I need to create an account?',
    answer: 'No, you can start with 25 free leads without signing up.',
  },
  {
    question: 'What makes a lead valuable?',
    answer:
      'A valuable lead matches your target market and includes usable contact details so your outreach can start quickly.',
  },
]

const ctaBaseClass =
  'inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl px-6 text-base font-semibold tracking-[-0.01em] transition-all duration-200 sm:min-h-[58px] sm:px-7'
const primaryCtaClass = `${ctaBaseClass} border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]`
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

export default function LeadGenerationForAgenciesPage() {
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
            Lead Generation for Agencies
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Most agencies don&apos;t struggle to deliver results.
            <br />
            They struggle to maintain a consistent flow of new clients.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Lead generation for agencies is the process of finding and connecting with businesses
            that are likely to need your services before they actively start searching.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="How agencies get leads">
              <ul className="space-y-4">
                {leadSources.map((item) => (
                  <li key={item.title}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{item.description}</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Why it&apos;s difficult">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {clientChallenges.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="A better way to find business leads">
              <p>
                Manual prospecting is slow because agencies have to define targets, search through
                businesses, and decide whether the contact details are worth using.
              </p>
              <p>
                Lead generation tools are faster because they reduce the manual research needed
                before outreach begins.
              </p>
              <p>
                ALPA gives agencies a simpler way to find business leads with verified contact
                details, so less time goes into searching and more time goes into building a healthy pipeline.
              </p>
              <p>
                For agencies selling to other businesses, this guide to{' '}
                <Link href="/resources/b2b-lead-generation" className="text-cyan-200 transition hover:text-white">
                  B2B lead generation
                </Link>{' '}
                helps sharpen who should enter the pipeline.
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
                  Start with 25 free leads and see how quickly you can build a pipeline →
                </Link>
              </p>
            </Section>

            <Section title="What is a verified lead?">
              <p>
                A verified lead is a business contact with confirmed company information and usable
                details, such as an email address, website, or another clear way to get in touch.
              </p>
              <p>
                Better lead quality means agencies spend less time cleaning bad data and more time
                starting real conversations with relevant prospects.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop searching for leads. Start building a pipeline.
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
