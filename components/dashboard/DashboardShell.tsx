'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpenText,
  Columns3,
  CreditCard,
  FileText,
  Home,
  Inbox,
  LifeBuoy,
  Lock,
  LogOut,
  Mail,
  Menu,
  Rocket,
  ServerCog,
  Settings,
  Sparkles,
  Users,
  X,
  Zap,
} from 'lucide-react'

import { AlpaLogo } from '@/components/brand/AlpaLogo'
import HomeBackButton from '@/components/dashboard/HomeBackButton'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import { canAccessFeature, isAdmin, isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getOrCreateGuestSessionId } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'
import { isGuestTrialModeForced } from '@/lib/session/guest-trial-mode'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'

type ViewerMode = 'resolving' | 'guest_trial' | 'authenticated_free' | 'authenticated_paid'

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  feature?: string
  lockedOnFree?: boolean
  description?: string
  benefit?: string
  adminOnly?: boolean
  badge?: string
  accent?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/dashboard/leads', label: 'Leads Inbox', icon: Inbox },
  {
    href: '/dashboard/kanban',
    label: 'Pipeline',
    icon: Columns3,
    feature: 'pipeline',
    description: 'Track every lead through outreach stages, follow-ups, and outcomes.',
    benefit: 'Pipeline turns lead generation into a repeatable sales system instead of a list that goes stale.',
  },
  { href: '/dashboard/scraper', label: 'Discover', icon: Rocket },
  {
    href: '/dashboard/library',
    label: 'Lead Library',
    icon: BookOpenText,
    lockedOnFree: true,
    description: 'Search and revisit your full lead history from one organized workspace.',
    benefit: 'A lead library keeps great prospects reusable long after the first scrape ends.',
  },
  {
    href: '/dashboard/templates',
    label: 'Templates',
    icon: FileText,
    feature: 'templates',
    description: 'Save proven outreach messages so your follow-up stays fast and consistent.',
    benefit: 'Templates shorten response time and help your team scale without rewriting from scratch.',
  },
  {
    href: '/dashboard/outreach',
    label: 'Outreach Queue',
    icon: Zap,
    adminOnly: true,
    description: 'Review and approve personalized drafts before they go out.',
    benefit: 'The Outreach Queue keeps you in control of every message with one-click approve or reject.',
  },
  { href: '/dashboard/billing', label: 'Plan & Billing', icon: CreditCard },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    lockedOnFree: true,
    description: 'Configure sender identity, workspace defaults, and the advanced controls behind your system.',
    benefit: 'Settings make ALPA feel like your prospecting machine, not a generic dashboard.',
  },
  {
    href: '/agent',
    label: 'Agent',
    icon: Sparkles,
    adminOnly: true,
    badge: 'Beta',
    accent: true,
    description: 'Autonomous lead engine that finds and prepares outreach on your behalf.',
    benefit: 'Agent runs 24/7 to fill your pipeline without manual prospecting.',
  },
]

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin/activity', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/lead-capture', label: 'Lead Capture', icon: Mail },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/system', label: 'System', icon: ServerCog },
]

const ADMIN_ACTIVE_NAV_STYLE = {
  backgroundColor: '#ffffff',
  color: '#0B1020',
  fontWeight: 600,
} as const

const ADMIN_ACTIVE_ICON_STYLE = {
  color: '#0B1020',
  fill: '#0B1020',
  stroke: '#0B1020',
} as const

const HOME_BACK_ROUTES = new Set([
  '/dashboard/kanban',
  '/dashboard/leads',
  '/dashboard/library',
  '/dashboard/outreach',
  '/dashboard/scraper',
  '/agent/setup',
  '/agent/dashboard',
])

export default function DashboardShell({
  children,
  adminEmail = null,
}: {
  children: ReactNode
  adminEmail?: string | null
}) {
  const pathname = usePathname()
  const [forcedGuestTrial, setForcedGuestTrial] = useState(() => isGuestTrialModeForced())
  const [lockedFeature, setLockedFeature] = useState<{
    title: string
    description: string
    benefit: string
  } | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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
    if (!mobileMenuOpen && !supportOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
        setSupportOpen(false)
      }
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleEscape)
    }
  }, [mobileMenuOpen, supportOpen])

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin(profile)),
    [profile]
  )
  const normalizedAdminEmail = String(adminEmail || '').trim().toLowerCase()
  const isAdminEmail = Boolean(
    profile?.email && normalizedAdminEmail && profile.email.toLowerCase() === normalizedAdminEmail
  )
  const canOpenAdmin = isAdmin(profile) || isAdminEmail

  const activeItem = useMemo(() => {
    return (
      [...visibleNavItems, ...(canOpenAdmin ? ADMIN_NAV_ITEMS : [])].find((item) => {
        const href = getItemHref(item, viewerMode)
        return isActivePath(pathname, href)
      }) ?? null
    )
  }, [canOpenAdmin, pathname, viewerMode, visibleNavItems])

  const showHomeBackButton =
    HOME_BACK_ROUTES.has(pathname) || pathname.startsWith('/agent/dashboard')
  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  function isLocked(item: NavItem) {
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

  function openLockedItem(item: NavItem) {
    setMobileMenuOpen(false)
    setLockedFeature({
      title: item.label,
      description: item.description || 'This feature unlocks more control inside ALPA.',
      benefit: item.benefit || 'Upgrade to unlock the full product workflow.',
    })
  }

  return (
    <div className="min-h-screen bg-transparent text-white">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 overflow-y-auto border-r border-white/6 bg-[#060c18]/90 px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-12 backdrop-blur-xl lg:flex lg:flex-col">
          <Link href="/" className="flex items-center gap-4">
            <div className="min-w-0">
              <AlpaLogo className="h-8 w-auto object-contain" priority />
            </div>
          </Link>

          <div className="mt-12 rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
              Workspace
            </div>
            <div className="mt-3 text-sm text-slate-200">
              {viewerMode === 'authenticated_paid'
                ? 'Paid access active across pipeline, templates, and outreach.'
                : viewerMode === 'authenticated_free'
                  ? 'Free access active. Upgrade when you are ready to unlock paid workflow tools.'
                  : 'Trial mode active. Explore the dashboard and upgrade when you want full execution tools.'}
            </div>
          </div>

          <nav className="mt-8 space-y-2">
            {visibleNavItems.map((item) => {
              const href = getItemHref(item, viewerMode)
              const active = isActivePath(pathname, href)
              const locked = isLocked(item)
              const Icon = item.icon

              if (locked) {
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => openLockedItem(item)}
                    className="flex min-h-[52px] w-full items-center justify-between rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-3 text-left text-sm text-slate-300 transition hover:border-white/12 hover:bg-white/[0.05] hover:text-white"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/[0.04] text-slate-300">
                        <Icon className="h-4 w-4" />
                      </span>
                      <NavItemLabel item={item} />
                    </span>
                    <Lock className="h-4 w-4 text-amber-200" />
                  </button>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={href}
                  className={`flex min-h-[52px] items-center justify-between rounded-2xl px-4 py-3 text-sm transition ${
                    active
                      ? 'border border-blue-400/20 bg-blue-500/10 text-white shadow-[0_0_0_1px_rgba(59,130,246,0.12)]'
                      : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                        active ? 'bg-blue-500/12 text-blue-100' : 'bg-white/[0.04] text-slate-300'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <NavItemLabel item={item} />
                  </span>
                  {active ? <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.55)]" /> : null}
                </Link>
              )
            })}
          </nav>

          {canOpenAdmin ? (
            <nav className="mt-8 border-t border-white/6 pt-6">
              <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                Admin
              </div>
              <div className="mt-3 space-y-2">
                {ADMIN_NAV_ITEMS.map((item) => {
                  const active = isActivePath(pathname, item.href)
                  const Icon = item.icon

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-admin-nav-item={item.label}
                      data-active={active ? 'true' : 'false'}
                      style={active ? ADMIN_ACTIVE_NAV_STYLE : undefined}
                      className={`flex min-h-[48px] items-center justify-between rounded-2xl px-4 py-3 text-sm transition ${
                        active
                          ? '!bg-white !font-semibold !text-[#0B1020] shadow-[0_0_24px_rgba(59,130,246,0.16)]'
                          : 'bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white hover:shadow-[0_0_18px_rgba(59,130,246,0.12)]'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          style={active ? ADMIN_ACTIVE_ICON_STYLE : undefined}
                          className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                            active ? '!text-[#0B1020]' : 'bg-white/[0.04] text-slate-400'
                          }`}
                        >
                          <Icon
                            className={`h-4 w-4 ${active ? '!fill-[#0B1020] !stroke-[#0B1020] !text-[#0B1020]' : ''}`}
                            style={active ? ADMIN_ACTIVE_ICON_STYLE : undefined}
                          />
                        </span>
                        <span
                          style={active ? { color: '#0B1020', fontWeight: 600 } : undefined}
                          className={active ? '!font-semibold !text-[#0B1020]' : 'font-medium'}
                        >
                          {item.label}
                        </span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            </nav>
          ) : null}

          <div className="mt-auto space-y-3 pt-8">
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className="flex min-h-[48px] w-full items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-slate-200 transition hover:bg-white/[0.06]"
            >
              <span className="flex items-center gap-3">
                <LifeBuoy className="h-4 w-4 text-blue-200" />
                <span>Support</span>
              </span>
            </button>

            {viewerMode === 'authenticated_free' || viewerMode === 'authenticated_paid' ? (
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-[48px] w-full items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-rose-200 transition hover:bg-white/[0.06]"
              >
                <span className="flex items-center gap-3">
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </span>
              </button>
            ) : (
              <Link
                href="/plans"
                className="btn-primary-gold w-full"
              >
                Unlock full access
              </Link>
            )}

            <div className="px-1 text-xs text-slate-500">
              Need help fast? Reach us at{' '}
              <a href="mailto:info@mindrasolutions.com" className="text-blue-200 hover:text-white">
                info@mindrasolutions.com
              </a>
              .
            </div>
          </div>
        </aside>

        <main className="flex min-h-screen min-w-0 flex-1 flex-col px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-8 sm:pt-6 lg:px-10 lg:pb-10 lg:pt-8">
          <div className="sticky top-0 z-20 -mx-4 mb-5 border-b border-white/6 bg-[#020617]/88 px-4 pb-4 pt-1 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href="/"
                  className="inline-flex items-center opacity-80 transition hover:opacity-100"
                >
                  <AlpaLogo className="h-6 w-auto object-contain" />
                </Link>
                <div className="truncate text-lg font-semibold text-white">
                  {activeItem?.label || 'Dashboard'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Open navigation"
                  aria-expanded={mobileMenuOpen}
                  onClick={() => setMobileMenuOpen(true)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 transition hover:bg-white/[0.08]"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4">
            {showHomeBackButton ? <HomeBackButton className="self-start" /> : null}
            {children}
          </div>

          <footer className="mx-auto mt-10 hidden w-full max-w-6xl border-t border-white/6 pt-6 text-center text-xs leading-6 text-slate-500 lg:block">
            Need help or have a question? Reach us at{' '}
            <a
              href="mailto:info@mindrasolutions.com"
              className="font-medium text-blue-200 transition hover:text-white hover:underline"
            >
              info@mindrasolutions.com
            </a>
            . We typically reply within 24 hours.
          </footer>
        </main>
      </div>

      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-950/82 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-[linear-gradient(180deg,#081120_0%,#030712_100%)] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 shadow-[0_25px_90px_rgba(2,8,23,0.6)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
                    Navigate
                  </div>
                <div className="text-lg font-semibold text-white">Workspace menu</div>
              </div>

              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileMenuOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="mt-6 flex-1 space-y-3 overflow-y-auto pb-4">
              {visibleNavItems.map((item) => {
                const locked = isLocked(item)
                const href = getItemHref(item, viewerMode)
                const active = !locked && isActivePath(pathname, href)
                const Icon = item.icon

                if (locked) {
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => openLockedItem(item)}
                      className="flex min-h-[60px] w-full items-center justify-between rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-3 text-left"
                    >
                      <span className="flex items-center gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04]">
                          <Icon className="h-5 w-5 text-slate-200" />
                        </span>
                        <span>
                          <span className="block text-sm font-medium text-white">
                            <NavItemLabel item={item} />
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">Upgrade to access</span>
                        </span>
                      </span>
                      <Lock className="h-4 w-4 text-amber-200" />
                    </button>
                  )
                }

                return (
                  <Link
                    key={item.href}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex min-h-[60px] items-center justify-between rounded-3xl px-4 py-3 transition ${
                      active
                        ? 'border border-blue-400/20 bg-blue-500/10 text-white'
                        : 'border border-white/8 bg-white/[0.03] text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04]">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="text-sm font-medium">
                        <NavItemLabel item={item} />
                      </span>
                    </span>
                    {active ? <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.55)]" /> : null}
                  </Link>
                )
              })}

              {canOpenAdmin ? (
                <div className="mt-6 border-t border-white/6 pt-5">
                  <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Admin
                  </div>
                  <div className="mt-3 space-y-3">
                    {ADMIN_NAV_ITEMS.map((item) => {
                      const active = isActivePath(pathname, item.href)
                      const Icon = item.icon

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          data-admin-nav-item={item.label}
                          data-active={active ? 'true' : 'false'}
                          style={active ? ADMIN_ACTIVE_NAV_STYLE : undefined}
                          className={`flex min-h-[56px] items-center justify-between rounded-3xl px-4 py-3 transition ${
                            active
                              ? '!bg-white !font-semibold !text-[#0B1020] shadow-[0_0_24px_rgba(59,130,246,0.16)]'
                              : 'border border-white/8 bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white hover:shadow-[0_0_18px_rgba(59,130,246,0.12)]'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span
                              style={active ? ADMIN_ACTIVE_ICON_STYLE : undefined}
                              className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                                active ? '!text-[#0B1020]' : 'bg-white/[0.04] text-slate-400'
                              }`}
                            >
                              <Icon
                                className={`h-5 w-5 ${active ? '!fill-[#0B1020] !stroke-[#0B1020] !text-[#0B1020]' : ''}`}
                                style={active ? ADMIN_ACTIVE_ICON_STYLE : undefined}
                              />
                            </span>
                            <span
                              style={active ? { color: '#0B1020', fontWeight: 600 } : undefined}
                              className={`text-sm ${active ? '!font-semibold !text-[#0B1020]' : 'font-medium'}`}
                            >
                              {item.label}
                            </span>
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </nav>

            <div className="space-y-3 border-t border-white/6 pt-4">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false)
                  setSupportOpen(true)
                }}
                className="flex min-h-[52px] w-full items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-slate-200"
              >
                <span className="flex items-center gap-3">
                  <LifeBuoy className="h-4 w-4 text-blue-200" />
                  <span>Support</span>
                </span>
              </button>

              {viewerMode === 'authenticated_free' || viewerMode === 'authenticated_paid' ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex min-h-[52px] w-full items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-rose-200"
                >
                  <span className="flex items-center gap-3">
                    <LogOut className="h-4 w-4" />
                    <span>Logout</span>
                  </span>
                </button>
              ) : (
                <Link
                  href="/plans"
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-primary-gold w-full"
                >
                  Unlock full access
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <FeatureLockModal
        isOpen={Boolean(lockedFeature)}
        onClose={() => setLockedFeature(null)}
        title={lockedFeature?.title || 'Locked feature'}
        description={lockedFeature?.description || ''}
        benefit={lockedFeature?.benefit || ''}
        showUpgradeCta={viewerMode !== 'authenticated_paid'}
      />

      {supportOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="glass w-full rounded-t-[32px] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-lg sm:rounded-[32px] sm:p-8">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/12 text-blue-200">
                    <LifeBuoy className="h-5 w-5" />
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">Need help?</h2>
                </div>
                <p className="max-w-md text-sm leading-7 text-slate-300">
                  If you have any issue with your account, billing, or leads, reach us directly at{' '}
                  <a
                    href="mailto:info@mindrasolutions.com"
                    className="font-medium text-blue-200 transition hover:underline"
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

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href="mailto:info@mindrasolutions.com"
                className="btn-secondary min-h-[48px] gap-2 px-5"
              >
                <LifeBuoy className="h-4 w-4" />
                Email Support
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === href
  return pathname.startsWith(href)
}

function getItemHref(item: NavItem, viewerMode: ViewerMode) {
  if (item.label === 'Plan & Billing' && viewerMode !== 'authenticated_free' && viewerMode !== 'authenticated_paid') {
    return '/plans'
  }

  return item.href
}

function NavItemLabel({ item }: { item: NavItem }) {
  if (!item.accent) {
    return <span>{item.label}</span>
  }

  return (
    <span className="flex items-center gap-2">
      <span className="bg-[linear-gradient(90deg,#60a5fa,#a78bfa)] bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(96,165,250,0.18)]">
        {item.label}
      </span>
      {item.badge ? (
        <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-100 shadow-[0_0_16px_rgba(59,130,246,0.18)]">
          {item.badge}
        </span>
      ) : null}
    </span>
  )
}
