import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'Manual vs Lead Generation Tools | ALPA',
  },
  description:
    'Compare manual lead generation and lead generation tools across time, cost, and consistency to choose a more efficient workflow.',
  alternates: {
    canonical: '/resources/manual-vs-lead-generation-tools',
  },
}

const manualPros = [
  'Low direct cost at the beginning.',
  'Complete control over where leads come from.',
  'Useful for testing a market in the earliest stage.',
]

const manualCons = [
  'Slow to repeat.',
  'Repetitive to maintain.',
  'Inconsistent when time gets tight.',
]

const toolPros = [
  'Faster list building.',
  'Easier to scale.',
  'More consistent when lead generation needs to happen every week.',
]

const toolCons = [
  'Monthly tool cost is visible immediately.',
  'Poor-fit tools can add complexity instead of removing it.',
  'They still need clear targeting to work well.',
]

const faqItems = [
  {
    question: 'Is manual lead generation better?',
    answer:
      'Manual lead generation can work at the beginning, but it usually becomes too slow and inconsistent once you need steady pipeline volume.',
  },
  {
    question: 'Are tools worth it?',
    answer:
      'Tools are usually worth it when they reduce manual work, improve lead quality, and give you more time for outreach or closing.',
  },
  {
    question: 'When should I use tools?',
    answer:
      'Use tools when manual searching starts taking too much of your week or when you need a process you can repeat consistently.',
  },
  {
    question: 'What is the difference in cost?',
    answer:
      'Manual lead generation often looks cheaper because the cost is hidden in time, while tools show more of the cost upfront in a subscription.',
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

export default function ManualVsLeadGenerationToolsPage() {
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
            Manual vs Lead Generation Tools
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Manual lead generation looks cheaper.
            <br />
            Until you measure the time it actually costs.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Manual lead generation means searching, filtering, and validating prospects by hand.
            Tool-based lead generation uses software to speed up those same steps and make the
            workflow easier to repeat.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Manual work saves money upfront, but often costs more over time.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Most lead generation decisions fail at this exact point: optimizing for visible cost
            instead of total cost.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            The real question is not whether tools are better than manual work. It is when manual
            work stops being efficient and starts costing you more than it saves.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            This page compares both approaches so you can decide what actually makes sense for your situation.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="Manual lead generation">
              <p>Manual lead generation works, especially when starting from scratch.</p>
              <p className="font-semibold tracking-[-0.02em] text-white">Pros:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {manualPros.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="font-semibold tracking-[-0.02em] text-white">Cons:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {manualCons.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Tool-based lead generation">
              <p>Tools change the equation by reducing repeated manual effort.</p>
              <p className="font-semibold tracking-[-0.02em] text-white">Pros:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {toolPros.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="font-semibold tracking-[-0.02em] text-white">Cons:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {toolCons.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Time comparison">
              <p>
                Manual lead generation is slow because every search, filter, and quality check has
                to be repeated by hand.
              </p>
              <p>
                Tool-based lead generation is faster because the work starts from clearer inputs
                and moves toward usable leads with less repetition.
              </p>
              <p>
                In practice, manual work is usually slow, repetitive, and inconsistent. Tools are
                usually faster, more scalable, and easier to repeat week after week.
              </p>
              <p>
                Speed is not just convenience. It directly impacts how much pipeline you can build.
              </p>
            </Section>

            <Section title="Cost comparison">
              <p>
                Manual lead generation often appears cheaper because the direct spend is lower at
                the beginning.
              </p>
              <p>
                But once time is included, the cost changes. One hour per day of manual searching
                can turn into 20 or more hours each month, which makes the hidden cost larger than
                many tool subscriptions.
              </p>
              <p>
                This is where manual lead generation quietly becomes more expensive than tools.
              </p>
              <p>
                For a deeper breakdown of time vs cost →{' '}
                <Link href="/resources/cost-of-lead-generation" className="text-cyan-200 transition hover:text-white">
                  Cost of lead generation
                </Link>
                .
              </p>
            </Section>

            <Section title="Consistency comparison">
              <p>
                Manual lead generation usually depends on spare time, which makes pipeline quality
                rise and fall with workload.
              </p>
              <p>
                Tools support a more regular workflow. That makes it easier to keep lead generation
                active even when delivery or sales work gets busy.
              </p>
            </Section>

            <Section title="Clear verdict">
              <p>
                Manual lead generation works, but it does not scale well. It is useful when testing
                a market or starting from zero, but it becomes inefficient when you need steady output.
              </p>
              <p>
                Tools improve efficiency, consistency, and repeatability.
              </p>
              <p>
                The real advantage is not just working faster, but building a process that
                continues to work over time.
              </p>
              <p>
                To make that consistent, you need a repeatable system →{' '}
                <Link href="/resources/lead-generation-system" className="text-cyan-200 transition hover:text-white">
                  Build a lead generation system
                </Link>
                .
              </p>
              <p>
                Once leads are generated, they still need to be filtered →{' '}
                <Link href="/resources/how-to-qualify-leads" className="text-cyan-200 transition hover:text-white">
                  How to qualify leads
                </Link>
                .
              </p>
              <p className="pt-2">
                <Link
                  href="/dashboard/scraper"
                  className="text-sm font-medium text-cyan-200 transition hover:text-white"
                >
                  Start with 25 free leads and see the difference in speed and consistency →
                </Link>
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop relying on manual searching.
                <br />
                Start using a faster system you can rely on every week.
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
