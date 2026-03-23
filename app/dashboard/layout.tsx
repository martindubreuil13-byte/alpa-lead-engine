'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type SidebarTemplate = {
  id: string
  name: string
}

type SidebarSettings = {
  signature: string | null
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [template, setTemplate] = useState<SidebarTemplate | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => {
    fetchSidebarStatus()
  }, [])

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

  async function fetchSidebarStatus() {
    setStatusLoading(true)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      setTemplate(null)
      setSignature(null)
      setStatusLoading(false)
      return
    }

    const [{ data: templateData, error: templateError }, { data: settingsData, error: settingsError }] =
      await Promise.all([
        supabase
          .from('templates')
          .select('id, name')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('sender_settings')
          .select('signature')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle(),
      ])

    if (templateError) {
      console.error('Error fetching template:', templateError)
    }

    if (settingsError) {
      console.error('Error fetching signature:', settingsError)
    }

    setTemplate(templateData as SidebarTemplate | null)
    setSignature((settingsData as SidebarSettings | null)?.signature || null)
    setStatusLoading(false)
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Outreach Setup
            </div>

            {statusLoading ? (
              <div className="mt-3 text-sm text-slate-400">
                Loading template and signature...
              </div>
            ) : (
              <div className="mt-3 space-y-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-slate-400">Template</span>
                  <span className="max-w-[9rem] truncate text-right text-white">
                    {template?.name || 'Not set'}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <span className="text-slate-400">Signature</span>
                  <span className={`text-right ${signature ? 'text-emerald-300' : 'text-slate-500'}`}>
                    {signature ? 'Saved' : 'Missing'}
                  </span>
                </div>
              </div>
            )}
          </div>

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
