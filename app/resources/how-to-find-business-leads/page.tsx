import type { Metadata } from 'next'
import Link from 'next/link'

import BackLink from '@/components/resources/BackLink'
import FreshStartCta from '@/components/landing/FreshStartCta'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'How to Find Business Leads | ALPA',
  },
  description:
    'Learn practical ways to find business leads consistently, why manual lead generation takes so much time, and how to speed up the process.',
  alternates: {
    canonical: '/resources/how-to-find-business-leads',
  },
}

const leadMethods = [
  {
    title: 'Job platforms',
    description:
      'Job platforms surface active demand quickly. They can work well, but competition is high and many opportunities are already crowded.',
  },
  {
    title: 'Outreach',
    description:
      'Direct outreach gives you more control over who you contact. The challenge is building a strong list before the outreach even begins.',
  },
  {
    title: 'Referrals',
    description:
      'Referrals often bring high-trust opportunities. They are useful, but they rarely create a predictable system for finding leads every week.',
  },
  {
    title: 'Manual research',
    description:
      'Manual research means searching through directories, websites, and maps to build your own list. It works, but it is slow and repetitive.',
  },
  {
    title: 'Tools',
    description:
      'Lead generation tools help you move faster by reducing the time spent searching, filtering, and organizing contact data.',
  },
]

const inefficiencies = [
  'The work is repetitive and hard to scale when you need leads every week.',
  'Low-quality or incomplete data creates wasted follow-up and weak reply rates.',
  'The overall process is slow, which means less time is left for outreach and closing.',
]

const faqItems = [
  {
    question: 'What is a business lead?',
    answer:
      'A business lead is a company or person that could realistically need your service and may be worth contacting.',
  },
  {
    question: 'How do you find leads quickly?',
    answer:
      'The fastest way is to define your target clearly, narrow by location or market, and use a structured process or tool to generate relevant contacts.',
  },
  {
    question: 'What is the best method for finding leads?',
    answer:
      'The best method is usually the one you can repeat consistently. For many teams, that means combining clear targeting with a faster lead generation workflow.',
  },
  {
    question: 'Do I need tools to find leads?',
    answer:
      'No, but tools can save a significant amount of time. Manual research works, though it often takes too much time to sustain consistently.',
  },
  {
    question: 'What makes a lead valuable?',
    answer:
      'A valuable lead matches your target market and includes usable contact details so you can act on it quickly.',
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

export default function HowToFindBusinessLeadsPage() {
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
            How to Find Business Leads
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Finding business leads isn&apos;t the hardest part.
            <br />
            Finding the right leads consistently is.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Finding business leads is the process of identifying companies or individuals that are
            likely to need your product or service.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="How people find leads in practice">
              <ul className="space-y-4">
                {leadMethods.map((item) => (
                  <li key={item.title}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{item.description}</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="The time reality of manual lead generation">
              <p>
                For many freelancers, agencies, and small business owners, lead generation can
                consume a large share of the week before any outreach starts.
              </p>
              <p>
                In practice, it often takes up 20 to 40 percent of working time once searching,
                filtering, and validating contacts are included.
              </p>
              <p>
                That creates a real tradeoff: more time spent finding leads usually means less time
                spent following up, closing deals, and serving paying clients.
              </p>
            </Section>

            <Section title="Why this is inefficient">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {inefficiencies.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Old vs new lead generation">
              <p>
                The old model is slow: search, filter, verify, then contact. Every step depends on
                more manual work before you can send the first message.
              </p>
              <p>
                The newer model is simpler: define, generate, then contact. That reduces the time
                spent preparing and increases the time spent actually reaching prospects.
              </p>
            </Section>

            <Section title="A better way to find business leads">
              <p>
                ALPA is built around a simpler workflow. You define your target, select the
                location you care about, and generate leads quickly.
              </p>
              <p>
                That means less manual searching and a faster path to a list you can actually use
                for outreach.
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
