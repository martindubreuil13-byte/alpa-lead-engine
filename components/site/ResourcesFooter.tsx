import Link from 'next/link'

import { resources } from '@/lib/resources'

export default function ResourcesFooter() {
  return (
    <section className="relative px-4 pb-14 pt-4 sm:px-6 sm:pb-16 lg:px-10 lg:pb-20">
      <div className="mx-auto max-w-6xl border-t border-white/8 pt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
              <Link href="/resources" className="transition hover:text-cyan-100">
                Resources
              </Link>
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Guides to help you build a better lead generation system.
            </p>
          </div>
          <Link href="/resources" className="text-sm text-slate-400 transition hover:text-white">
            View all →
          </Link>
        </div>
        <ul className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 text-sm text-slate-400 sm:grid-cols-2">
          {resources.map((resource) => (
            <li key={resource.href}>
              <Link href={resource.href} className="transition hover:text-white">
                {resource.title} →
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
