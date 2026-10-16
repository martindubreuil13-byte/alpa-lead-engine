import Link from 'next/link'

import { LEGAL_PAGES } from '@/lib/legal'

export default function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500 ${className}`}>
      {LEGAL_PAGES.map((page) => (
        <Link key={page.href} href={page.href} className="transition hover:text-white">
          {page.label}
        </Link>
      ))}
    </nav>
  )
}
