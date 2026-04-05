import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'How to Build a Lead Generation System | ALPA',
  },
  description:
    'Learn how to build a lead generation system that creates a more consistent pipeline through better targeting, qualification, and outreach.',
  alternates: {
    canonical: '/resources/lead-generation-system',
  },
}

const failurePoints = [
  'Reliance on one channel',
  'No repeatable workflow',
  'Inconsistent effort',
  'Lack of targeting clarity',
]

const systemBreakpoints = [
  'Poor targeting.',
  'Inconsistent execution.',
  'Too much manual work.',
  'Overcomplicated tools.',
]

const systemParts = [
  {
    title: '1. Targeting',
    description: 'define who you want to reach',
  },
  {
    title: '2. Lead generation',
    description: 'create a steady flow of leads',
  },
  {
    title: '3. Qualification',
    description: 'focus on the best opportunities',
  },
  {
    title: '4. Outreach',
    description: 'turn leads into conversations',
  },
]

const faqItems = [
  {
    question: 'What is a lead generation system?',
    answer:
      'A lead generation system is a repeatable process for finding, filtering, and contacting prospects without rebuilding the workflow each time.',
  },
  {
    question: 'How do I build a lead generation system?',
    answer:
      'Start by defining the target, then create a repeatable process for generating leads, qualifying them, and moving into outreach every week.',
  },
  {
    question: 'What are the key parts of a system?',
    answer:
      'The core parts are targeting, lead generation, qualification, and outreach. Each one supports the next.',
  },
  {
    question: 'Why is consistency important?',
    answer:
      'Consistency matters because lead generation improves when outreach and list building happen repeatedly, not only when work slows down.',
  },
  {
    question: 'How do I make lead generation predictable?',
    answer:
      'Make the process simpler, reduce manual work, and use a system you can repeat every week with the same basic steps.',
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

export default function LeadGenerationSystemPage() {
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
            How to Build a Lead Generation System
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Most people don&apos;t struggle to get leads once.
            <br />
            They struggle to get leads consistently.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            That&apos;s not a lead problem. It&apos;s a system problem.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            A lead generation system is a repeatable process that continuously produces potential
            clients without starting from scratch each time.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            A system removes randomness from lead generation and replaces it with consistency.
            Without a system, results stay unpredictable.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="Why most lead generation fails">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {failurePoints.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="The difference between tactics and systems">
              <p>
                Tactics are isolated actions. They can create short-term results, but they do not
                automatically create a steady pipeline.
              </p>
              <p>
                Systems are repeatable processes. They connect targeting, lead generation,
                qualification, and outreach so the work can continue week after week.
              </p>
              <p>
                Tactics can create results. Systems make those results predictable.
              </p>
              <p>Systems are what turn those results into something you can rely on.</p>
            </Section>

            <Section title="The 4-part system">
              <ul className="space-y-4">
                {systemParts.map((item) => (
                  <li key={item.title} className="text-sm leading-7 text-slate-300 sm:text-base">
                    <span className="font-semibold tracking-[-0.02em] text-white">{item.title}</span>
                    {' — '}
                    {item.description}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Where most systems break">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {systemBreakpoints.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="A simpler model">
              <p>
                The old model is repetitive: search, filter, contact, repeat. Too much effort goes
                into rebuilding the same workflow each time new leads are needed.
              </p>
              <p>A cleaner model is define, generate, qualify, contact.</p>
              <p>That makes the process easier to repeat and easier to scale.</p>
              <p>
                ALPA supports that approach with faster generation, better targeting, and less
                manual effort between defining the market and starting outreach.
              </p>
              <p className="pt-2">
                <Link
                  href="/dashboard/scraper"
                  className="text-sm font-medium text-cyan-200 transition hover:text-white"
                >
                  Start with 25 free leads and build a repeatable system →
                </Link>
              </p>
            </Section>

            <Section title="Why consistency matters more than volume">
              <p>
                Fewer better leads often outperform larger weak lists because the work stays
                focused on businesses that actually fit the offer.
              </p>
              <p>
                Consistent effort matters just as much. Small weekly actions build more pipeline
                than occasional bursts followed by long gaps.
              </p>
              <p>
                Over time, that consistency compounds. Each round of targeting, qualification, and
                outreach creates a stronger base for the next.
              </p>
              <p>Consistency is what turns lead generation into a predictable pipeline.</p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop relying on random lead generation.
                <br />
                Start building a system you can rely on every week.
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
