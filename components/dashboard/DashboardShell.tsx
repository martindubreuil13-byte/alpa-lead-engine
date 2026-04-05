'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LifeBuoy, Lock, Mail } from 'lucide-react'

import FeatureLockModal from '@/components/modals/FeatureLockModal'
import { canAccessFeature, isAdmin, isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { supabase } from '@/lib/supabase'
import { getOrCreateGuestSessionId } from '@/lib/guest-session'
import { isGuestTrialModeForced } from '@/lib/session/guest-trial-mode'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'

type ViewerMode = 'resolving' | 'guest_trial' | 'authenticated_free' | 'authenticated_paid'

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [forcedGuestTrial, setForcedGuestTrial] = useState(() => isGuestTrialModeForced())
  const [lockedFeature, setLockedFeature] = useState<{
    title: string
    description: string
    benefit: string
  } | null>(null)
  const [supportOpen, setSupportOpen] = useState(false)
  const { profile, loading: profileLoading } = useClientUserProfile()

  const viewerMode: ViewerMode = forcedGuestTrial
    ? 'guest_trial'
    : profileLoading
      ? 'resolving'
      : profile && (isAdmin(profile) || isPaid(profile))
        ? 'authenticated_paid'
        : profile
          ? 'authenticated_free'
          : 'guest_trial'

  useEffect(() => {
    setForcedGuestTrial(isGuestTrialModeForced())

    const syncGuestState = () => {
      getOrCreateGuestSessionId()
    }

    syncGuestState()
    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestState)

    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestState)
    }
  }, [])

  useEffect(() => {
    console.log('NAV LOCK STATE UPDATED', {
      viewerMode,
      forcedGuestTrial,
      plan: profile?.plan ?? null,
      profileLoading,
    })
  }, [forcedGuestTrial, profile?.plan, profileLoading, viewerMode])

  const navItems: Array<{
    href: string
    label: string
    feature?: string
    lockedOnFree?: boolean
    description?: string
    benefit?: string
  }> = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/dashboard/leads', label: 'Leads Inbox' },
    {
      href: '/dashboard/kanban',
      label: 'Pipeline',
      feature: 'pipeline',
      description: 'Track every lead through outreach stages, follow-ups, and outcomes.',
      benefit: 'Pipeline turns lead generation into a repeatable sales system instead of a list that goes stale.',
    },
    { href: '/dashboard/scraper', label: 'Prospector' },
    {
      href: '/dashboard/library',
      label: 'Lead Library',
      lockedOnFree: true,
      description: 'Search and revisit your full lead history from one organized workspace.',
      benefit: 'A lead library keeps great prospects reusable long after the first scrape ends.',
    },
    {
      href: '/dashboard/templates',
      label: 'Templates',
      feature: 'templates',
      description: 'Save proven outreach messages so your follow-up stays fast and consistent.',
      benefit: 'Templates shorten response time and help your team scale without rewriting from scratch.',
    },
    { href: '/dashboard/billing', label: 'Plan & Billing' },
    {
      href: '/dashboard/settings',
      label: 'Settings',
      lockedOnFree: true,
      description: 'Configure sender identity, workspace defaults, and the advanced controls behind your system.',
      benefit: 'Settings make ALPA feel like your prospecting machine, not a generic dashboard.',
    },
  ]

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === href
    return pathname.startsWith(href)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  function isLocked(item: (typeof navItems)[number]) {
    if (viewerMode === 'resolving') {
      return Boolean(item.feature || item.lockedOnFree)
    }

    if (item.feature) {
      if (viewerMode === 'guest_trial') return true
      return !canAccessFeature(item.feature, profile)
    }

    if (item.lockedOnFree) {
      return viewerMode !== 'authenticated_paid'
    }

    return false
  }

  function getItemHref(item: (typeof navItems)[number]) {
    if (item.label === 'Plan & Billing' && viewerMode !== 'authenticated_free' && viewerMode !== 'authenticated_paid') {
      return '/plans'
    }

    return item.href
  }

  return (
    <div className="flex min-h-screen bg-[#0b1220] text-white">
      <aside className="hidden w-64 flex-col border-r border-white/5 bg-[#0f172a] p-6 md:flex">
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
            const itemHref = getItemHref(item)
            const active = isActive(itemHref)
            const locked = isLocked(item)

            if (locked) {
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() =>
                    setLockedFeature({
                      title: item.label,
                      description: item.description || 'This feature unlocks more control inside ALPA.',
                      benefit: item.benefit || 'Upgrade to unlock the full product workflow.',
                    })
                  }
                  className="group flex w-full items-center justify-between rounded-xl border border-white/6 px-4 py-3 text-sm text-slate-400 transition hover:border-white/12 hover:bg-white/[0.03] hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <span>{item.label}</span>
                  </div>
                  <Lock className="h-4 w-4 text-amber-200" />
                </button>
              )
            }

            return (
              <Link
                key={item.href}
                href={itemHref}
                className={`group flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-all ${
                  active
                    ? 'border border-white/10 bg-white/10 text-white shadow-inner'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{item.label}</span>
                {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
              </Link>
            )
          })}

          <button
            type="button"
            onClick={() => setSupportOpen(true)}
            className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <span className="flex items-center gap-2">
              <LifeBuoy className="h-4 w-4 text-cyan-300" />
              <span>Support</span>
            </span>
          </button>

          <div className="my-4 border-t border-white/10" />

          {viewerMode === 'authenticated_free' || viewerMode === 'authenticated_paid' ? (
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm text-red-400 transition hover:bg-white/5 hover:text-red-300"
            >
              <span>Logout</span>
            </button>
          ) : (
            <Link
              href="/plans"
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

      <main className="flex flex-1 flex-col p-4 sm:p-6 md:p-10">
        <div className="mx-auto w-full max-w-7xl flex-1">{children}</div>
        <footer className="mx-auto mt-10 w-full max-w-5xl border-t border-white/6 pt-6 text-center text-xs leading-6 text-slate-500">
          Need help or have a question? Reach us at{' '}
          <a
            href="mailto:info@mindrasolutions.com"
            className="font-medium text-sky-300 transition hover:underline"
          >
            info@mindrasolutions.com
          </a>{' '}
          — we typically reply within 24 hours.
        </footer>
      </main>

      <FeatureLockModal
        isOpen={Boolean(lockedFeature)}
        onClose={() => setLockedFeature(null)}
        title={lockedFeature?.title || 'Locked feature'}
        description={lockedFeature?.description || ''}
        benefit={lockedFeature?.benefit || ''}
        showUpgradeCta={viewerMode !== 'authenticated_paid'}
      />

      {supportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-lg rounded-3xl p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/12 text-cyan-200">
                    <LifeBuoy className="h-5 w-5" />
                  </div>
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
                    Need help?
                  </h2>
                </div>
                <p className="max-w-md text-sm leading-7 text-slate-300">
                  If you have any issue with your account, billing, or leads, reach us directly at{' '}
                  <a
                    href="mailto:info@mindrasolutions.com"
                    className="font-medium text-sky-300 transition hover:underline"
                  >
                    info@mindrasolutions.com
                  </a>
                  . We usually respond within 24 hours.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSupportOpen(false)}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href="mailto:info@mindrasolutions.com"
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border border-sky-300/20 bg-sky-300/10 px-5 text-sm font-medium text-sky-100 transition hover:bg-sky-300/15"
              >
                <Mail className="h-4 w-4" />
                Email Support
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
