import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'ALPA vs Apollo | ALPA',
  },
  description:
    'Compare ALPA and Apollo by workflow, complexity, and fit to choose the prospecting approach that matches how you want to work.',
  alternates: {
    canonical: '/resources/alpa-vs-apollo',
  },
}

const faqItems = [
  {
    question: 'What is the difference between ALPA and Apollo?',
    answer:
      'Apollo is built around a large B2B database with filtering and outbound capabilities, while ALPA focuses on reducing steps between defining a target and starting outreach.',
  },
  {
    question: 'Is Apollo better for large B2B teams?',
    answer:
      'Apollo can be a better fit for larger B2B teams when deep filtering, large datasets, and structured outbound workflows are a priority.',
  },
  {
    question: 'Is ALPA better for simpler prospecting workflows?',
    answer:
      'ALPA can be a better fit when the priority is moving quickly from targeting to outreach with less manual filtering and a more streamlined workflow.',
  },
  {
    question: 'Which tool is faster to use?',
    answer:
      'A streamlined workflow is often faster when the goal is execution, while a database-driven workflow can take more time because it offers more control and filtering depth.',
  },
  {
    question: 'How should I choose between them?',
    answer:
      'Choose based on workflow fit. If you want more control and depth, a database-driven approach may fit better. If you want fewer steps and faster execution, a simpler workflow may be a better match.',
  },
]

const apolloFit = [
  'You need deep filtering and large datasets.',
  'You manage complex outbound campaigns.',
  'You are working in a structured B2B sales environment.',
]

const alpaFit = [
  'You want to move quickly from targeting to outreach.',
  'You want to reduce manual filtering.',
  'You need a simpler, repeatable prospecting workflow.',
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

export default function AlpaVsApolloPage() {
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
            ALPA vs Apollo
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Both tools help with lead generation.
            <br />
            But they are built for different ways of working.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            The real question is not which tool is better. It is which workflow fits how you want
            to prospect.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Apollo is designed as a large B2B database with advanced filtering and outbound
            capabilities.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            ALPA focuses on speed, simplicity, and reducing the manual work between defining a
            target and starting outreach.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Both approaches can work. The difference is how much time and complexity you are
            willing to manage.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Most teams don&apos;t fail because of the tool itself, but because the workflow does not
            match how they operate.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="Core workflow difference">
              <p>The main difference is workflow.</p>
              <p className="font-semibold tracking-[-0.02em] text-white">Apollo:</p>
              <p>Search → filter → refine → export → outreach</p>
              <p className="font-semibold tracking-[-0.02em] text-white">ALPA:</p>
              <p>Define → generate → contact</p>
              <p>Apollo gives more control and depth. ALPA reduces steps and speeds up execution.</p>
              <p>
                This difference becomes more important as lead generation needs to happen
                consistently.
              </p>
              <p>
                To make this consistent, you need a repeatable system →{' '}
                <Link
                  href="/resources/lead-generation-system"
                  className="text-cyan-200 transition hover:text-white"
                >
                  Build a lead generation system
                </Link>
                .
              </p>
            </Section>

            <Section title="When Apollo is a better fit">
              <p>Apollo is often a better fit when:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {apolloFit.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="When ALPA is a better fit">
              <p>ALPA is often a better fit when:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {alpaFit.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
              <p>The focus is not on adding more features, but on reducing unnecessary steps.</p>
              <p>
                Even with the right workflow, lead quality still matters →{' '}
                <Link
                  href="/resources/how-to-qualify-leads"
                  className="text-cyan-200 transition hover:text-white"
                >
                  How to qualify leads
                </Link>
                .
              </p>
            </Section>

            <Section title="Complexity vs speed">
              <p>Both tools solve lead generation in different ways.</p>
              <p>The tradeoff is between control and execution speed.</p>
              <p>
                If your priority is control and depth, a database-driven approach may fit better.
              </p>
              <p>
                If your priority is speed, simplicity, and execution, a streamlined workflow can be
                more effective.
              </p>
              <p className="pt-2">
                <Link
                  href="/dashboard/scraper"
                  className="text-sm font-medium text-cyan-200 transition hover:text-white"
                >
                  Start with 25 free leads and experience the difference in workflow →
                </Link>
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <p className="mb-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                The faster you move from targeting to outreach, the faster you can build pipeline.
              </p>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop spending time filtering large datasets.
                <br />
                Start working with leads you can act on without delay.
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
            </section>

            <p className="text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              The right tool is the one that fits your workflow and helps you move from leads to
              conversations consistently.
            </p>

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
