import type { Metadata } from 'next'
import Link from 'next/link'

import BackLink from '@/components/resources/BackLink'
import FreshStartCta from '@/components/landing/FreshStartCta'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'B2B Lead Generation | ALPA',
  },
  description:
    'Learn how B2B lead generation works, why targeting matters more than volume, and how to build a stronger business pipeline faster.',
  alternates: {
    canonical: '/resources/b2b-lead-generation',
  },
}

const leadMethods = [
  {
    title: 'Referrals',
    description:
      'Referrals can produce strong B2B opportunities because trust already exists. The downside is that they are hard to predict and difficult to scale into a steady pipeline.',
  },
  {
    title: 'Inbound marketing',
    description:
      'Inbound content can attract businesses already looking for help. It can work well, but it often takes time before it produces a reliable flow of leads.',
  },
  {
    title: 'Outreach',
    description:
      'Outbound outreach gives you more control over who enters the pipeline. It works best when targeting is clear and the lead list is relevant.',
  },
  {
    title: 'Networking',
    description:
      'Networking can open useful conversations with buyers, partners, and referrals. It is valuable, but it usually does not create enough volume on its own.',
  },
  {
    title: 'Tools',
    description:
      'Lead generation tools help reduce the manual work required to find companies and contact details. That makes prospecting more repeatable and easier to maintain.',
  },
]

const b2bChallenges = [
  'It is often difficult to identify who the real decision-maker is inside a company.',
  'Pipeline quality becomes inconsistent when new leads depend on referrals or occasional warm introductions.',
  'Manual research is slow because every company still needs to be checked before outreach begins.',
]

const faqItems = [
  {
    question: 'What is B2B lead generation?',
    answer:
      'B2B lead generation is the process of finding businesses that are likely to need your offer and creating a path to contact them.',
  },
  {
    question: 'How is B2B different from general lead generation?',
    answer:
      'B2B lead generation usually involves fewer but higher-value opportunities, longer buying cycles, and more than one person involved in the decision.',
  },
  {
    question: 'How do you find decision-makers?',
    answer:
      'The clearest approach is to start with the right company profile, then identify contact paths linked to the buying decision.',
  },
  {
    question: 'What is a good B2B lead?',
    answer:
      'A good B2B lead matches your target market, has a realistic reason to buy, and includes contact details you can act on quickly.',
  },
  {
    question: 'How can I generate leads consistently?',
    answer:
      'Consistency usually comes from a repeatable workflow: define the target, generate relevant leads, and keep outreach active every week.',
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

export default function B2BLeadGenerationPage() {
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
            B2B Lead Generation
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            B2B lead generation isn&apos;t about getting more leads.
            <br />
            It&apos;s about consistently reaching the right companies.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            B2B lead generation is the process of identifying and connecting with businesses that
            are likely to need your product or service.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            In B2B, a small number of well-targeted leads often produces more revenue than a large
            list of poor-fit prospects.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="What makes B2B lead generation different">
              <p>
                B2B lead generation usually involves fewer opportunities, but each one can be worth
                far more than a broad consumer lead.
              </p>
              <p>
                Decision cycles are also longer, which means timing matters more and rushed targeting
                usually creates weak results.
              </p>
              <p>
                On top of that, there are often multiple stakeholders involved, so the first contact
                is not always the final decision-maker.
              </p>
            </Section>

            <Section title="Common B2B lead generation methods">
              <ul className="space-y-4">
                {leadMethods.map((item) => (
                  <li key={item.title}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{item.description}</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Why B2B lead generation is difficult">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {b2bChallenges.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Precision vs volume">
              <p>
                More leads do not automatically create better results. If the companies are a poor
                fit, the extra volume only adds more wasted effort.
              </p>
              <p>
                Better targeting usually improves conversion because the message is more relevant
                and the lead is closer to your real market.
              </p>
              <p>
                In B2B, quality matters more than quantity because each conversation can represent
                a larger deal and a longer buying process.
              </p>
            </Section>

            <Section title="A better way to build a B2B pipeline">
              <p>
                The old model is slow: search, research, guess, then contact. Too much time goes
                into deciding which companies are worth pursuing.
              </p>
              <p>
                The newer model is simpler: define target, generate leads, then contact. That
                creates a cleaner path from targeting to outreach.
              </p>
              <p>
                ALPA fits that workflow. You define the niche, select the company type or location,
                and generate leads quickly instead of building every list by hand.
              </p>
              <p className="pt-2">
                <Link
                  href="/dashboard/scraper"
                  className="text-sm font-medium text-cyan-200 transition hover:text-white"
                >
                  Start with 25 free leads and build a targeted B2B pipeline in minutes →
                </Link>
              </p>
            </Section>

            <Section title="What makes a strong B2B lead?">
              <p>
                Relevance comes first. A strong lead matches the kind of business you actually want
                to work with.
              </p>
              <p>
                Timing also matters. Even a good-fit company becomes a weak lead if there is no
                likely reason for them to buy right now.
              </p>
              <p>
                Usable contact information matters just as much, because a lead is only valuable if
                your team can act on it quickly.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop chasing random companies.
                <br />
                Start building a targeted B2B pipeline.
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
