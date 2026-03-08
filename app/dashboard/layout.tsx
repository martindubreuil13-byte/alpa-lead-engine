'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/dashboard/leads', label: 'Leads' },
    { href: '/dashboard/kanban', label: 'Pipeline' },
    { href: '/dashboard/scraper', label: 'Prospector' },
    { href: '/dashboard/templates', label: 'Templates' },
    { href: '/dashboard/settings', label: 'Settings' },
  ]

  return (
    <div className="min-h-screen flex bg-[#0b1220] text-white">
      <aside className="w-64 bg-[#0f172a] border-r border-white/5 p-6 flex flex-col">
        
        {/* BRAND BLOCK */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-400 flex items-center justify-center font-bold text-black text-lg shadow-lg shadow-cyan-500/20">
            A
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">
              ALPA
            </div>
            <div className="text-xs text-slate-500">
              Autonomous Lead Prospecting Agent
            </div>
          </div>
        </div>

        {/* NAVIGATION */}
        <nav className="mt-12 space-y-2">
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href))

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-xl px-4 py-3 text-sm transition ${
                  active
                    ? 'bg-white/10 text-white border border-white/10 shadow-inner'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* FOOTER */}
        <div className="mt-auto pt-6 space-y-2">
          <div className="text-xs text-slate-500">
            ALPA • Intelligence Engine
          </div>
          <div className="text-xs text-slate-600">
            Build v1.0
          </div>
        </div>

      </aside>

      <main className="flex-1 p-10">
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  )
}