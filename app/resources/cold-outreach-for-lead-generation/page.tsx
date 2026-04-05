import type { Metadata } from 'next'
import Link from 'next/link'

import BackLink from '@/components/resources/BackLink'
import FreshStartCta from '@/components/landing/FreshStartCta'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'Cold Outreach for Lead Generation | ALPA',
  },
  description:
    'Learn why cold outreach fails, what makes it effective, and how stronger lead quality improves outreach results.',
  alternates: {
    canonical: '/resources/cold-outreach-for-lead-generation',
  },
}

const outreachFailures = [
  'Poor targeting puts the message in front of businesses that were never a strong fit to begin with.',
  'Generic messages make it harder for prospects to see why the outreach matters to them.',
  'Low-quality leads create wasted follow-up because the contact or company is weak from the start.',
  'Lack of consistency breaks momentum, which makes pipeline generation uneven and hard to measure.',
]

const outreachSuccessFactors = [
  'Relevance makes the outreach feel specific instead of random.',
  'Timing matters because even a good offer can miss if the business is not ready.',
  'Clarity helps the recipient understand quickly why the message is worth reading.',
  'Simple messaging works better than overexplaining when the target is already a strong fit.',
]

const workflowSteps = [
  'Define the companies you want to reach.',
  'Generate leads that match that profile.',
  'Contact them with clear messaging.',
  'Follow up consistently to create reply opportunities.',
]

const faqItems = [
  {
    question: 'What is cold outreach?',
    answer:
      'Cold outreach is the process of contacting businesses or people who have not interacted with you before in order to start a conversation.',
  },
  {
    question: 'Does cold outreach still work?',
    answer:
      'Yes, cold outreach still works when the lead is relevant and the message is clear. Weak targeting usually creates the impression that outreach does not work.',
  },
  {
    question: 'Why do most outreach messages fail?',
    answer:
      'Most outreach fails because the wrong companies are contacted or the message is too generic for the situation.',
  },
  {
    question: 'How many messages should I send?',
    answer:
      'The right number depends on your market, but consistency matters more than bursts. A smaller volume of better-fit leads often outperforms broad random outreach.',
  },
  {
    question: 'What makes a good outreach lead?',
    answer:
      'A good outreach lead matches your target, has a reachable contact, and is likely to care about the offer you are making.',
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

export default function ColdOutreachForLeadGenerationPage() {
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
            Cold Outreach for Lead Generation
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Cold outreach doesn&apos;t fail because people don&apos;t reply.
            <br />
            It fails because the wrong companies are being contacted.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Cold outreach is the process of contacting businesses or individuals who have not
            interacted with you before, with the goal of starting a conversation.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            In most cases, outreach performance is decided before the first message is ever sent.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="Why cold outreach often fails">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {outreachFailures.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="What makes outreach effective">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {outreachSuccessFactors.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Targeting vs messaging">
              <p>
                Most people spend too much time trying to write a better message before they have a
                better list of leads.
              </p>
              <p>
                In practice, targeting matters more because the right lead needs less persuasion and
                creates a more natural reason to reply.
              </p>
              <p>
                A strong lead makes a simple message work. A weak lead makes even a good message fail.
              </p>
              <p>
                That is why strong outreach usually starts with{' '}
                <Link href="/resources/how-to-qualify-leads" className="text-cyan-200 transition hover:text-white">
                  better lead qualification
                </Link>{' '}
                and a clearer understanding of{' '}
                <Link href="/resources/b2b-lead-generation" className="text-cyan-200 transition hover:text-white">
                  B2B lead generation
                </Link>
                .
              </p>
            </Section>

            <Section title="A simple outreach workflow">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {workflowSteps.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="A better way to run outreach">
              <p>
                ALPA helps reduce the time spent finding leads before outreach even begins.
              </p>
              <p>
                Better targeting improves outreach quality because your message is built around a
                stronger fit from the start.
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
                  Start with 25 free leads and start outreach with the right companies →
                </Link>
              </p>
            </Section>

            <Section title="What makes a good outreach lead?">
              <p>
                Relevance matters first. The business should be a realistic fit for the service you offer.
              </p>
              <p>
                Reachable contact information matters next, because weak contact paths slow down
                outreach before the first message is even sent.
              </p>
              <p>
                Timing matters too, since even a strong fit becomes a weak lead if the business has
                no likely reason to act.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop sending messages to the wrong companies.
                <br />
                Start reaching the right ones.
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
