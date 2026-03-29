'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { supabase } from '@/lib/supabase'
import { isIgnorableEmptyResultError } from '@/lib/supabase/errors'
import { getGuestLeads, getOrCreateGuestSessionId } from '@/lib/guest-session'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    loadViewerMode()

    const syncGuestState = () => {
      getOrCreateGuestSessionId()
    }

    syncGuestState()
    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestState)

    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestState)
    }
  }, [])

  const navItems = isAuthenticated
      ? [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/dashboard/leads', label: 'Leads Inbox' },
        { href: '/dashboard/kanban', label: 'Pipeline' },
        { href: '/dashboard/scraper', label: 'Prospector' },
        { href: '/dashboard/library', label: 'Lead Library' },
        { href: '/dashboard/templates', label: 'Templates' },
        { href: '/dashboard/billing', label: 'Plan & Billing' },
        { href: '/dashboard/settings', label: 'Settings' },
      ]
    : [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/dashboard/leads', label: 'Leads Inbox' },
        { href: '/dashboard/kanban', label: 'Pipeline' },
        { href: '/dashboard/scraper', label: 'Prospector' },
        { href: '/dashboard/billing', label: 'Plan & Billing' },
      ]

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === href
    return pathname.startsWith(href)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  async function loadViewerMode() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      setIsAuthenticated(false)
      return
    }

    setIsAuthenticated(true)
  }

  return (
    <div className="flex min-h-screen bg-[#0b1220] text-white">
      <aside className="flex w-64 flex-col border-r border-white/5 bg-[#0f172a] p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-400 text-lg font-bold text-black shadow-lg shadow-cyan-500/20">
            A
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">ALPA</div>
            <div className="text-xs text-slate-500">Autonomous Lead Engine</div>
          </div>
        </div>

        <nav className="mt-12 space-y-2">
          {navItems.map((item) => {
            const active = isActive(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-all ${
                  active
                    ? 'border border-white/10 bg-white/10 text-white shadow-inner'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{item.label}</span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              </Link>
            )
          })}

          <div className="my-4 border-t border-white/10" />

          {isAuthenticated ? (
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm text-red-400 transition hover:bg-white/5 hover:text-red-300"
            >
              <span>Logout</span>
            </button>
          ) : (
            <Link
              href="/login"
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm text-cyan-300 transition hover:bg-white/5 hover:text-white"
            >
              <span>Unlock full access</span>
            </Link>
          )}
        </nav>

        <div className="mt-auto space-y-4 pt-8">
          <div className="text-xs text-slate-500">ALPA • Intelligence System</div>
          <div className="text-xs text-slate-600">Build v1.1</div>
        </div>
      </aside>

      <main className="flex-1 p-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  )
}
