import Link from 'next/link'

import { cn } from '@/lib/utils'

type PublicHeaderProps = {
  activePath?: string
}

const navItems = [
  { href: '/plans', label: 'Plans' },
]

export default function PublicHeader({ activePath }: PublicHeaderProps) {
  return (
    <header className="relative z-10 px-4 pt-5 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 backdrop-blur-xl sm:px-5">
        <Link href="/" className="text-sm font-semibold tracking-[0.18em] text-white sm:text-[15px]">
          ALPA by MINDRA
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const active = activePath === item.href

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-[42px] items-center justify-center rounded-full px-4 text-sm font-medium transition',
                  active
                    ? 'border border-cyan-300/25 bg-cyan-300/10 text-cyan-100'
                    : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
                )}
              >
                {item.label}
              </Link>
            )
          })}

          <Link
            href="/login"
            className="inline-flex min-h-[42px] items-center justify-center rounded-full px-4 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
          >
            Log in
          </Link>
          <Link
            href="/login?mode=signup"
            className="inline-flex min-h-[42px] items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-300/15"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  )
}
