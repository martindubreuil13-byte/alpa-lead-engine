import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'Best Lead Generation Tools | ALPA',
  },
  description:
    'Compare the best lead generation tools by category, understand when to use each one, and choose a workflow that fits how you prospect.',
  alternates: {
    canonical: '/resources/best-lead-generation-tools',
  },
}

const categoryItems = [
  {
    title: 'Databases',
    examples: 'Apollo, ZoomInfo',
    description:
      'Databases provide large sets of company and contact records for prospecting.',
    strengths: 'Broad coverage and structured filtering.',
    limitations: 'Can become noisy if targeting is weak or the data is outdated.',
  },
  {
    title: 'Scraping tools',
    examples: 'Phantombuster',
    description:
      'Scraping tools pull lead data from public sources and workflows you define.',
    strengths: 'Flexible and useful for custom lead collection.',
    limitations: 'Usually require more setup and more manual filtering afterward.',
  },
  {
    title: 'Outreach tools',
    examples: 'Lemlist, Hunter',
    description:
      'Outreach tools help with sending, sequencing, and managing contact activity.',
    strengths: 'Good for follow-up consistency and campaign management.',
    limitations: 'They depend on already having a strong lead list.',
  },
  {
    title: 'All-in-one tools',
    examples: 'Mixed stacks and integrated platforms',
    description:
      'All-in-one tools try to combine sourcing, list building, and outreach in one place.',
    strengths: 'Can reduce switching between different tools.',
    limitations: 'Can also become heavy if the workflow is more complex than you need.',
  },
]

const exampleTools = [
  {
    name: 'Apollo',
    summary:
      'Used for large B2B datasets and outbound workflows.',
  },
  {
    name: 'ZoomInfo',
    summary:
      'Used for enterprise-scale data and deeper company insights.',
  },
  {
    name: 'Hunter',
    summary:
      'Used for email discovery and lightweight lead research.',
  },
  {
    name: 'Lemlist',
    summary:
      'Used for outreach execution and follow-up sequencing.',
  },
  {
    name: 'Phantombuster',
    summary:
      'Used for custom scraping and automation workflows.',
  },
]

const faqItems = [
  {
    question: 'What is the best lead generation tool?',
    answer:
      'The best lead generation tool depends on how you prospect. The right fit is usually the one that reduces manual work without adding unnecessary complexity.',
  },
  {
    question: 'Do I need multiple tools?',
    answer:
      'Not always. Many teams add too many tools before they have a clear workflow, which often creates more friction instead of less.',
  },
  {
    question: 'Are free tools enough?',
    answer:
      'Free tools can help early on, but they usually require more manual effort and become harder to sustain once lead generation needs to happen consistently.',
  },
  {
    question: 'How do I choose the right tool?',
    answer:
      'Start with the kind of leads you need, how often you need them, and how much manual work you want to avoid. Then choose the category that best supports that workflow.',
  },
  {
    question: 'What should I avoid?',
    answer:
      'Avoid choosing tools only by feature list. If the workflow becomes harder to maintain, the tool is probably solving the wrong problem.',
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

export default function BestLeadGenerationToolsPage() {
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
            Best Lead Generation Tools
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Most people don&apos;t need more lead generation tools.
            <br />
            They need the right type of tool for how they actually prospect.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Lead generation tools are platforms that help you find, organize, and contact
            potential clients more efficiently.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Most teams don&apos;t fail because they lack tools. They fail because the tools
            don&apos;t match their workflow.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            This is not a list of the &ldquo;best&rdquo; tools in general. It is a breakdown of
            different types of tools and where they fit.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            The goal is to help you choose the right category based on how you actually generate leads.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="How to choose tools">
              <p>Before choosing a tool, define:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                <li className="text-sm leading-7 text-slate-300 sm:text-base">Who you want to reach</li>
                <li className="text-sm leading-7 text-slate-300 sm:text-base">How often you need leads</li>
                <li className="text-sm leading-7 text-slate-300 sm:text-base">
                  How much manual work you want to avoid
                </li>
              </ul>
              <p>Without this clarity, most tools add complexity instead of reducing it.</p>
              <p>This is where most tool stacks become inefficient.</p>
            </Section>

            <Section title="Categories of tools">
              <ul className="space-y-5">
                {categoryItems.map((item) => (
                  <li key={item.title}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">
                      {item.title} <span className="font-normal text-slate-400">({item.examples})</span>
                    </h3>
                    <p className="mt-3 text-sm font-semibold tracking-[-0.02em] text-white">Description:</p>
                    <p className="mt-1 text-sm leading-7 text-slate-300 sm:text-base">{item.description}</p>
                    <p className="mt-3 text-sm font-semibold tracking-[-0.02em] text-white">Pros:</p>
                    <ul className="list-outside list-disc space-y-2 pl-5 marker:text-slate-500">
                      {item.strengths.split('. ').filter(Boolean).map((point) => (
                        <li key={point} className="text-sm leading-7 text-slate-300 sm:text-base">
                          {point.replace(/\.$/, '')}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm font-semibold tracking-[-0.02em] text-white">Cons:</p>
                    <ul className="list-outside list-disc space-y-2 pl-5 marker:text-slate-500">
                      {item.limitations.split('. ').filter(Boolean).map((point) => (
                        <li key={point} className="text-sm leading-7 text-slate-300 sm:text-base">
                          {point.replace(/\.$/, '')}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p>
                Different tools solve different parts of the workflow. The problem starts when one
                tool is expected to do everything.
              </p>
            </Section>

            <Section title="Example tools">
              <p className="font-semibold tracking-[-0.02em] text-white">
                Examples of commonly used tools
              </p>
              <ul className="space-y-4">
                {exampleTools.map((tool) => (
                  <li key={tool.name}>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{tool.name}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{tool.summary}</p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="When to use each type">
              <p>
                In the early stage, manual research plus simple tools can be enough while you are
                testing the market and refining the offer.
              </p>
              <p>
                As prospecting becomes more regular, structured tools help reduce manual effort and
                improve consistency.
              </p>
              <p>
                At higher volume, the real need is not just more tools. It is a clearer system for
                targeting, generation, qualification, and outreach.
              </p>
              <p>Without a system, tools tend to create more noise than results.</p>
              <p>
                To make tools effective, they need to fit into a repeatable process →{' '}
                <Link href="/resources/lead-generation-system" className="text-cyan-200 transition hover:text-white">
                  Build a lead generation system
                </Link>
                .
              </p>
            </Section>

            <Section title="Where ALPA fits">
              <p>
                ALPA focuses on fast lead generation, reduced manual filtering, and a simpler
                workflow from searching to outreach.
              </p>
              <p>
                It is designed for users who want to move from searching to outreach faster.
              </p>
              <p>The focus is not on adding features, but on reducing unnecessary steps.</p>
              <p>
                Even with the right tool, lead quality still matters →{' '}
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
                  Start with 25 free leads and see how much faster prospecting can be →
                </Link>
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <p className="mb-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Most tools optimize features. Very few optimize speed and execution.
              </p>
              <p className="mb-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                The best tool is not the one with the most features. It is the one that helps you
                act faster and more consistently.
              </p>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop switching between tools.
                <br />
                Start using a system you can rely on every week.
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
              A good lead generation tool reduces time, improves consistency, and supports a
              workflow you can repeat.
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
