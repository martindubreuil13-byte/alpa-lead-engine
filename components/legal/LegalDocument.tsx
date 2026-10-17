import type { Metadata } from 'next'
import Link from 'next/link'

import PublicHeader from '@/components/site/PublicHeader'
import { LEGAL_DRAFT, LEGAL_ENTITY, LEGAL_PAGES, LEGAL_UPDATED } from '@/lib/legal'

export function legalMetadata(title: string, description: string, path: string): Metadata {
  return {
    title: { absolute: `${title} | ALPA` },
    description,
    alternates: { canonical: path },
    robots: LEGAL_DRAFT ? { index: false, follow: false } : undefined,
  }
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-white/8 pt-8 sm:pt-10">
      <h2 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 text-base leading-7 text-slate-300">{children}</div>
    </section>
  )
}

export default function LegalDocument({
  activePath,
  title,
  intro,
  contents,
  children,
}: {
  activePath: string
  title: string
  intro: string
  contents: { id: string; title: string }[]
  children: React.ReactNode
}) {
  return (
    <main className="relative overflow-hidden bg-[#020617] text-white">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_34%)]" />

      <PublicHeader activePath={activePath} />

      <div className="relative px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-12 lg:px-10">
        <article className="mx-auto max-w-3xl space-y-8">
          <header>
            <h1 className="text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.05em] sm:text-5xl">{title}</h1>
            <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">{intro}</p>
            <p className="mt-3 text-sm text-slate-400">Last updated {LEGAL_UPDATED}</p>
          </header>

          {LEGAL_DRAFT ? (
            <div
              role="note"
              data-legal-draft
              className="rounded-2xl border border-amber-300/50 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100"
            >
              <strong className="font-semibold">Draft. Not in force.</strong> This page is being reworked and must not be relied on.
            </div>
          ) : null}

          <nav aria-label="On this page" className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">On this page</p>
            <ol className="mt-3 grid gap-x-8 gap-y-1.5 text-sm text-slate-300 sm:grid-cols-2">
              {contents.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="transition hover:text-white">{item.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          {children}

          <footer className="border-t border-white/8 pt-6 text-sm text-slate-400">
            <p className="mb-4 leading-6" data-legal-entity>
              ALPA is provided by {LEGAL_ENTITY.name}, registry code {LEGAL_ENTITY.registryCode}, registration number {LEGAL_ENTITY.registrationNumber},
              registered office {LEGAL_ENTITY.address}. Contact:{' '}
              <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} className="text-slate-200 underline underline-offset-2">{LEGAL_ENTITY.contactEmail}</a>.
            </p>
            <p className="flex flex-wrap gap-x-5 gap-y-2">
              {LEGAL_PAGES.map((page) => (
                <Link key={page.href} href={page.href} className={page.href === activePath ? 'text-white' : 'transition hover:text-white'}>
                  {page.label}
                </Link>
              ))}
              <Link href="/plans" className="transition hover:text-white">Plans</Link>
            </p>
          </footer>
        </article>
      </div>
    </main>
  )
}
