import type { Metadata } from 'next'
import Link from 'next/link'

import FreshStartCta from '@/components/landing/FreshStartCta'
import BackLink from '@/components/resources/BackLink'
import PublicHeader from '@/components/site/PublicHeader'

export const metadata: Metadata = {
  title: {
    absolute: 'Lead Generation Tools | ALPA',
  },
  description:
    'Compare lead generation tools, understand what makes a tool useful in practice, and learn how to choose a simpler workflow for finding better leads.',
  alternates: {
    canonical: '/resources/lead-generation-tools',
  },
}

const toolTypes = [
  {
    title: 'Databases',
    description:
      'large datasets, often noisy',
  },
  {
    title: 'Scraping tools',
    description:
      'flexible, but require filtering',
  },
  {
    title: 'Outreach tools',
    description:
      'useful after targeting is clear',
  },
  {
    title: 'All-in-one platforms',
    description:
      'reduce switching, but can add complexity',
  },
]

const evaluationFramework = [
  'Define your target clearly.',
  'Generate usable leads quickly.',
  'Reduce manual work.',
  'Support consistent outreach.',
]

const commonMistakes = [
  'Choosing tools based on feature lists instead of the outcomes they improve.',
  'Overcomplicating the workflow with too many moving parts.',
  'Ignoring lead quality and focusing too much on volume.',
]

const faqItems = [
  {
    question: 'What are lead generation tools?',
    answer:
      'Lead generation tools are platforms that help you identify prospects, organize lead data, and create a faster path to outreach.',
  },
  {
    question: 'What is the best lead generation tool?',
    answer:
      'The best tool is the one that helps you reach relevant companies quickly without adding unnecessary complexity to your workflow.',
  },
  {
    question: 'Do I need multiple tools?',
    answer:
      'Not always. Many teams use too many tools when a simpler system would help them move from targeting to outreach faster.',
  },
  {
    question: 'What should I look for in a tool?',
    answer:
      'Look for relevance, usable data, speed, and a workflow that helps you stay consistent instead of creating more manual steps.',
  },
  {
    question: 'How do I choose the right tool?',
    answer:
      'Start with your actual prospecting process, then choose the tool that helps you define targets, generate leads, and begin outreach with less friction.',
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

export default function LeadGenerationToolsPage() {
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
            Lead Generation Tools
          </h1>

          <p className="mt-6 text-lg leading-8 text-slate-100 sm:text-2xl sm:leading-9">
            Most lead generation tools don&apos;t fail because they lack features.
            <br />
            They fail because they don&apos;t match how you actually prospect.
          </p>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Lead generation tools are platforms that help you find, organize, and contact
            potential clients more efficiently.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            In practice, most prospecting problems are not caused by missing tools, but by
            workflows that are too complex to sustain.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Choosing a lead generation tool is not about features. It&apos;s about finding
            something that fits the way you actually prospect.
          </p>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            This page focuses on how to evaluate tools and avoid adding unnecessary complexity to
            your workflow.
          </p>

          <div className="mt-10 space-y-10 sm:mt-12 sm:space-y-12">
            <Section title="Types of lead generation tools">
              <ul className="space-y-4">
                {toolTypes.map((item) => (
                  <li key={item.title} className="text-sm leading-7 text-slate-300 sm:text-base">
                    <span className="font-semibold tracking-[-0.02em] text-white">{item.title}</span>
                    {' — '}
                    {item.description}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="What to look for in a tool">
              <p>
                Relevance matters first. A tool should help you find businesses that actually fit
                the kind of work you want to sell.
              </p>
              <p>
                Data quality matters just as much. If the lead information is incomplete or weak,
                the rest of the workflow slows down immediately.
              </p>
              <p>
                Speed and usability matter too. A good tool should make the next action obvious
                instead of adding more friction between searching and outreach.
              </p>
            </Section>

            <Section title="Common mistakes when choosing tools">
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {commonMistakes.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="A simple evaluation framework">
              <p>A good tool should help you do four things well:</p>
              <ul className="list-outside list-disc space-y-3 pl-5 marker:text-slate-500">
                {evaluationFramework.map((item) => (
                  <li key={item} className="text-sm leading-7 text-slate-300 sm:text-base">
                    {item}
                  </li>
                ))}
              </ul>
              <p>
                If a tool makes those steps easier, it is probably useful. If it adds complexity
                without improving results, it is probably the wrong fit.
              </p>
            </Section>

            <Section title="A better way to prospect">
              <p>
                The old model often looks like this: tool, complexity, slow workflow. You spend
                more time managing software than actually moving leads into outreach.
              </p>
              <p>A better model is simpler: target, generate, contact.</p>
              <p>That keeps the focus on action instead of tool management.</p>
              <p>
                ALPA fits that workflow. You define who you want to reach, generate leads quickly,
                and move into outreach without stitching together a complicated stack.
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
                  Start with 25 free leads and test a simpler prospecting workflow →
                </Link>
              </p>
            </Section>

            <Section title="What actually makes a tool effective?">
              <p>
                Speed matters because lead generation competes with everything else in your work
                week. If it takes too long, it becomes inconsistent.
              </p>
              <p>
                Simplicity matters because most teams do not need more steps. They need fewer
                blockers between targeting and action.
              </p>
              <p>
                Relevance matters because even the fastest tool becomes inefficient if the leads do
                not match the businesses you want to contact.
              </p>
            </Section>

            <section className="border-t border-white/8 pt-12 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                Stop switching between tools.
                <br />
                Start running a simple lead generation system.
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
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{item.question}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-300 sm:text-base">{item.answer}</p>
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
