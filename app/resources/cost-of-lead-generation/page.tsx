import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'Cost of Lead Generation | ALPA',
  },
  description:
    'Understand the real cost of lead generation by comparing tool cost, time cost, and the hidden cost of manual prospecting.',
  alternates: {
    canonical: '/resources/cost-of-lead-generation',
  },
}

const hiddenCosts = [
  'Manual research takes hours that could be spent on outreach, sales, or delivery.',
  'The same effort has to be repeated every week when there is no repeatable system.',
  'Opportunity cost grows when lead generation delays follow-up, proposals, and closing work.',
]

const faqItems = [
  {
    question: 'How much should lead generation cost?',
    answer:
      'It depends on the value of your time, your sales process, and how much manual work is required. The right question is usually whether the cost improves speed and lead quality.',
  },
  {
    question: 'Are lead generation tools worth it?',
    answer:
      'They are usually worth it when they reduce manual work, improve lead quality, and free up time for outreach or closing.',
  },
  {
    question: 'Is manual lead generation cheaper?',
    answer:
      'Not always. Manual methods often look cheaper because the cost is hidden inside your time instead of shown as a monthly bill.',
  },
  {
    question: 'How do I calculate lead generation cost?',
    answer:
      'Start with time spent per day or week, multiply it by your hourly value, then add any direct costs such as tools or services.',
  },
  {
    question: 'What is the real cost of finding leads?',
    answer:
      'The real cost includes direct spend and the revenue lost when too much time goes into searching, filtering, and validating leads manually.',
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

export default function CostOfLeadGenerationPage() {
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

          <h1 className="mt-6 text-[2.25rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:mt-8 sm:text-[3.5rem] lg:text-[4.4rem]">
            Cost of Lead Generation
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Lead generation doesn&apos;t just cost money.
            <br />
            It costs time.
            <br />
            <br />
            And time is usually the more expensive part.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            The cost of lead generation includes both direct expenses (tools, data, services) and
            indirect costs (time spent searching, filtering, and validating leads).
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="The hidden cost of manual lead generation">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {hiddenCosts.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Time vs money">
              <p>
                If you spend one to two hours per day searching for leads, that time has a real
                cost whether you track it or not.
              </p>
              <p>
                The question is not only what a tool costs. The real question is what your time is
                worth and what that same time could produce in outreach, sales, or client work.
              </p>
              <p>
                Most people try to save money on tools while spending far more in time.
              </p>
            </Section>

            <Section title="A simple cost example">
              <p>
                Imagine you spend one hour per day searching for leads, five days per week. That
                becomes around 20 hours per month.
              </p>
              <p>
                If your time is worth $25 per hour, that is about $500 per month in hidden cost.
                If your time is worth $100 per hour, that becomes $2,000 per month.
              </p>
              <p>
                That calculation does not even include the cost of weak leads, delayed follow-up,
                or missed sales opportunities.
              </p>
            </Section>

            <Section title="Why cheap methods are often more expensive">
              <p>
                Free methods often take the most time because every lead still has to be found,
                checked, and filtered manually.
              </p>
              <p>
                Low-quality leads make the cost worse because time is spent on outreach that was
                unlikely to work in the first place.
              </p>
              <p>
                Inconsistency also reduces the pipeline. When lead generation feels slow, it
                usually gets pushed aside for more urgent work.
              </p>
            </Section>

            <Section title="A better way to think about cost">
              <p>
                A better way to think about cost is to pay for speed, pay for quality, and reduce
                manual work where it creates the biggest drag.
              </p>
              <p>
                ALPA supports that shift. It helps generate leads faster, reduces wasted time on
                filtering, and frees up more hours for outreach and closing.
              </p>
              <p>
                If you are comparing options, look at both{' '}
                <Link href="/resources/lead-generation-tools" className="text-cyan-200 transition hover:text-white">
                  lead generation tools
                </Link>{' '}
                and the repeatable workflow behind them →{' '}
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
                  Start with 25 free leads and see how much time you can save →
                </Link>
              </p>
            </Section>

            <Section title="What is your time actually worth?">
              <p>
                Your hourly rate is one way to measure the value of time, but it is not the only one.
              </p>
              <p>
                Opportunity cost matters too. An hour spent searching for leads is an hour not spent
                selling, following up, delivering client work, or improving retention.
              </p>
              <p>
                That means the real value of time often sits closer to revenue potential than to a
                basic hourly estimate.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop spending hours searching for leads.
                <br />
                Start using that time to close clients.
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

            <Section title="Frequently Asked Questions">
              <div className="space-y-6">
                {faqItems.map((item) => (
                  <div key={item.question}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">
                      {item.question}
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </main>
  )
}
