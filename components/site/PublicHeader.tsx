'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

type PublicHeaderProps = {
  activePath?: string
}

const navItems = [
  { href: '/resources', label: 'Resources' },
  { href: '/plans', label: 'Plans' },
  { href: '/about', label: 'About' },
]

const mobileItems = [...navItems, { href: '/login', label: 'Log in' }]

export default function PublicHeader({ activePath }: PublicHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isMenuOpen])

  return (
    <>
      <header className="relative z-20 px-4 pt-5 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="text-sm font-semibold tracking-[0.24em] text-white sm:text-[15px]">
            ALPA
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
            {navItems.map((item) => {
              const active = activePath === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'text-sm font-medium tracking-tight transition',
                    active ? 'text-white' : 'text-slate-300 hover:text-white'
                  )}
                >
                  {item.label}
                </Link>
              )
            })}

            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/15 px-5 text-sm font-medium tracking-tight text-white transition hover:border-white/30 hover:bg-white/[0.04]"
            >
              Log in
            </Link>
          </nav>

          <button
            type="button"
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-2xl text-white transition hover:text-slate-200 md:hidden"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? '×' : '☰'}
          </button>
        </div>
      </header>

      <div
        className={cn(
          'fixed inset-0 z-30 bg-[#020617] transition-opacity duration-200 md:hidden',
          isMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <div className="flex min-h-screen flex-col px-6 pb-8 pt-6">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="text-sm font-semibold tracking-[0.24em] text-white"
              onClick={() => setIsMenuOpen(false)}
            >
              ALPA
            </Link>

            <button
              type="button"
              aria-label="Close menu"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-3xl text-white transition hover:text-slate-200"
              onClick={() => setIsMenuOpen(false)}
            >
              ×
            </button>
          </div>

          <nav className="mt-12 flex flex-1 flex-col" aria-label="Mobile">
            {mobileItems.map((item) => {
              const active = activePath === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'border-b border-white/8 py-5 text-2xl font-medium tracking-tight transition',
                    active ? 'text-white' : 'text-slate-300 hover:text-white'
                  )}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </>
  )
}
