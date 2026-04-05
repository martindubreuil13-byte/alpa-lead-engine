import Link from 'next/link'

import { resources } from '@/lib/resources'

export default function ResourcesFooter() {
  return (
    <section className="relative px-4 pb-14 pt-2 sm:px-6 sm:pb-16 lg:px-10 lg:pb-20">
      <div className="mx-auto max-w-5xl border-t border-white/8 pt-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-300">Resources</h2>
        <ul className="mt-4 grid grid-cols-1 gap-2 text-sm text-slate-400 sm:grid-cols-2">
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
