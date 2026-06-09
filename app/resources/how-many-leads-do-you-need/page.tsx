import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'How Many Leads Do You Need? | ALPA',
  },
  description:
    'Learn how many leads you actually need by connecting lead volume to conversion rate, deal value, and predictable pipeline planning.',
  alternates: {
    canonical: '/resources/how-many-leads-do-you-need',
  },
}

const commonMistakes = [
  'Focusing on volume instead of conversion.',
  'Ignoring how many leads turn into real conversations.',
  'Trying to grow pipeline without a repeatable system.',
]

const faqItems = [
  {
    question: 'How many leads do I need?',
    answer:
      'The number depends on how many leads turn into conversations, how many conversations turn into clients, and how much revenue you want to generate consistently.',
  },
  {
    question: 'What is a good conversion rate?',
    answer:
      'A good conversion rate depends on the market and offer, but the important part is knowing your own numbers well enough to forecast pipeline realistically.',
  },
  {
    question: 'How do I calculate leads?',
    answer:
      'Start with the number of clients you want, then work backward using conversion rates between leads, conversations, and closed deals.',
  },
  {
    question: 'Should I focus on volume or quality?',
    answer:
      'Quality usually matters more because better-fit leads produce stronger conversion and waste less time during outreach and sales.',
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

export default function HowManyLeadsDoYouNeedPage() {
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
            How Many Leads Do You Need?
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Most people think they need more leads.
            <br />
            What they actually need is the right number of leads.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            The number of leads you need depends on your conversion rate, deal value, and how
            consistently you can generate opportunities.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Without this clarity, most lead generation efforts become guesswork.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="Why most people get this wrong">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {commonMistakes.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
              <p>This is why more leads rarely solve the real problem.</p>
            </Section>

            <Section title="Simple calculation model">
              <p>If:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                <li className="text-sm leading-7 text-slate-300 sm:text-base">10 leads → 2 conversations</li>
                <li className="text-sm leading-7 text-slate-300 sm:text-base">2 conversations → 1 client</li>
              </ul>
              <p>Then you need around 10 leads per client.</p>
              <p>The goal is not more leads. It is predictable conversion.</p>
              <p>The goal is to understand how many leads reliably produce results.</p>
            </Section>

            <Section title="Example scenarios">
              <p>
                For many freelancers, 5 to 10 strong leads per week can be enough when the offer
                is clear and conversion is healthy.
              </p>
              <p>
                Agencies often need a larger flow, sometimes 20 to 50 leads per week, because the
                sales cycle is broader and more outreach volume is usually required.
              </p>
            </Section>

            <Section title="Why more leads is not always better">
              <p>
                More leads usually fail when targeting is weak and conversion is unclear.
              </p>
              <p>
                Weak leads create wasted time. The extra volume looks productive, but it usually
                produces more noise than revenue.
              </p>
            </Section>

            <Section title="A better way to think about volume">
              <p>
                A better approach is to work with fewer, better leads and keep the flow consistent
                instead of chasing random spikes in volume.
              </p>
              <p>
                The strongest pipeline usually comes from a system-based approach: define the
                target, generate leads, track conversion, and adjust the volume based on real results.
              </p>
              <p>This is what turns lead generation from random effort into predictable output.</p>
              <p>
                To make this consistent, you need a repeatable process →{' '}
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
                  Start with 25 free leads and start testing your real conversion numbers →
                </Link>
              </p>
              <p>
                Once you have leads, you still need to filter them →{' '}
                <Link href="/resources/how-to-qualify-leads" className="text-cyan-200 transition hover:text-white">
                  How to qualify leads
                </Link>
                .
              </p>
            </Section>

            <Section title="Quality vs quantity">
              <p>
                Quality improves efficiency because better-fit leads are easier to convert and less
                likely to waste outreach time.
              </p>
              <p>
                Quantity matters only when the underlying lead quality is strong enough to support
                predictable conversations and deals.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop guessing how many leads you need.
                <br />
                Start building a pipeline you can actually predict.
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

            <p className="text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              A strong lead generation strategy balances volume, quality, and conversion into a
              predictable system.
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
