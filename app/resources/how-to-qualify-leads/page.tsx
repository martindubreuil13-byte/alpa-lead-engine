import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'How to Qualify Leads | ALPA',
  },
  description:
    'Learn how to qualify leads more effectively, avoid poor-fit prospects, and build a workflow that prioritizes better opportunities.',
  alternates: {
    canonical: '/resources/how-to-qualify-leads',
  },
}

const qualificationMistakes = [
  'Chasing every lead instead of narrowing to the ones most likely to convert.',
  'Qualifying too late, after time has already been spent on outreach and follow-up.',
  'Focusing on quantity instead of fit.',
  'Relying on guesswork instead of clear qualification signals.',
]

const qualificationFramework = [
  {
    title: 'Relevance',
    description: 'The lead fits the kind of client, business, or niche you actually want to serve.',
  },
  {
    title: 'Intent',
    description: 'There is a realistic reason to believe the lead may need your offer soon.',
  },
  {
    title: 'Access',
    description: 'You have a usable path to reach the business and start a real conversation.',
  },
]

const faqItems = [
  {
    question: 'What is lead qualification?',
    answer:
      'Lead qualification is the process of deciding whether a prospect is a realistic fit before spending more time on outreach or sales activity.',
  },
  {
    question: 'How do you qualify a lead?',
    answer:
      'Start by checking fit, likely need, and contactability. If those signals are weak, the lead usually needs less attention or should be dropped.',
  },
  {
    question: 'When should I qualify a lead?',
    answer:
      'As early as possible. The sooner you qualify, the less time you waste on poor-fit prospects.',
  },
  {
    question: 'What makes a lead high quality?',
    answer:
      'A high-quality lead matches your offer, has a plausible reason to buy, and includes contact details you can use right away.',
  },
  {
    question: 'How do I avoid bad leads?',
    answer:
      'Avoid broad targeting, define your ideal prospect clearly, and use a system that helps you screen for fit before outreach begins.',
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

export default function HowToQualifyLeadsPage() {
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
            How to Qualify Leads
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Most leads don&apos;t fail because they&apos;re bad.
            <br />
            They fail because they were never qualified properly.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Lead qualification is the process of evaluating whether a potential client is a good
            fit before investing time in outreach or sales.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            In most cases, the difference between a closed deal and wasted effort is decided
            before the first conversation even starts.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="Why lead qualification matters">
              <p>
                Time is limited, especially when prospecting competes with delivery, outreach, and
                sales conversations.
              </p>
              <p>
                Poor leads absorb effort without creating much return. Better leads increase
                conversion because they start closer to your actual offer.
              </p>
              <p>
                In practice, fewer better-fit leads usually outperform a larger list of weak
                prospects because less energy is wasted on the wrong opportunities.
              </p>
            </Section>

            <Section title="Common mistakes">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {qualificationMistakes.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="A simple qualification framework">
              <p>A strong lead should have three things:</p>
              <ul className="space-y-4">
                {qualificationFramework.map((item) => (
                  <li key={item.title}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{item.description}</p>
                  </li>
                ))}
              </ul>
              <p>
                A qualified lead reduces the work needed to close. An unqualified lead increases it.
              </p>
            </Section>

            <Section title="Fast vs slow qualification">
              <p>
                The slow method usually looks like this: search, review, guess, qualify. Too much
                time is spent deciding whether the lead should have been considered in the first place.
              </p>
              <p>
                The better method is simpler: define, generate qualified leads, contact. That
                pushes qualification earlier, where it saves more time.
              </p>
            </Section>

            <Section title="A better lead-first approach">
              <p>
                ALPA fits a lead-first workflow. You define your target, generate better-fit leads,
                and reduce the time spent filtering weak prospects by hand.
              </p>
              <p>
                That means more effort goes into outreach and conversations, and less effort goes
                into sorting through leads that were never likely to convert.
              </p>
              <p className="pt-2">
                <Link
                  href="/dashboard/scraper"
                  className="text-sm font-medium text-cyan-200 transition hover:text-white"
                >
                  Start with 25 free leads and work with better-qualified prospects →
                </Link>
              </p>
            </Section>

            <Section title="What makes a high-quality lead?">
              <p>
                Fit matters first. A high-quality lead matches the kind of client your offer is
                built for.
              </p>
              <p>
                Timing matters too. Even a relevant company becomes a weaker lead if there is no
                realistic reason for them to act soon.
              </p>
              <p>
                Contactability matters because a lead is only useful if you can actually reach the
                business and act on it quickly.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop wasting time on the wrong leads.
                <br />
                Start working with better-qualified prospects.
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
