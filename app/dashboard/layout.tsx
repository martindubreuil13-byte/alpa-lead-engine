'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/dashboard/leads', label: 'Leads Inbox' },
    { href: '/dashboard/kanban', label: 'Pipeline' },
    { href: '/dashboard/scraper', label: 'Prospector' },
    { href: '/dashboard/library', label: 'Lead Library' },
    { href: '/dashboard/templates', label: 'Templates' },
    { href: '/dashboard/settings', label: 'Settings' },
  ]

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === href
    return pathname.startsWith(href)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen flex bg-[#0b1220] text-white">
      {/* SIDEBAR */}
      <aside className="w-64 bg-[#0f172a] border-r border-white/5 p-6 flex flex-col">

        {/* BRAND */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-400 flex items-center justify-center font-bold text-black text-lg shadow-lg shadow-cyan-500/20">
            A
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">
              ALPA
            </div>
            <div className="text-xs text-slate-500">
              Autonomous Lead Engine
            </div>
          </div>
        </div>

        {/* NAVIGATION */}
   <nav className="mt-12 space-y-2">
  {navItems.map((item) => {
    const active = isActive(item.href)

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`group flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-all ${
          active
            ? 'bg-white/10 text-white border border-white/10 shadow-inner'
            : 'text-slate-400 hover:text-white hover:bg-white/5'
        }`}
      >
        <span>{item.label}</span>

        {active && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        )}
      </Link>
    )
  })}

  {/* DIVIDER */}
  <div className="my-4 border-t border-white/10" />

  {/* LOGOUT */}
  <button
    onClick={handleLogout}
    className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm text-red-400 hover:text-red-300 hover:bg-white/5 transition"
  >
    <span>Logout</span>
  </button>
</nav>


        {/* FOOTER */}
        <div className="mt-auto pt-8 space-y-4">
          <div className="text-xs text-slate-500">
            ALPA • Intelligence System
          </div>
          <div className="text-xs text-slate-600">
            Build v1.1
          </div>

        


        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-10">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}