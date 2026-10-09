'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { getGuestLeads } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'
import { getLeadLimit } from '@/lib/usage/usage'

type RecentSearch = {
  id: string
  query: string
  location: string | null
  createdAt: string | null
  leadsCount: number | null
}

type DashboardData = {
  loading: boolean
  discovered: number
  allowance: number
  paidCycle: boolean
  saved: number
  researched: number
  recentSearches: RecentSearch[]
}

const EMPTY_DASHBOARD: DashboardData = {
  loading: true,
  discovered: 0,
  allowance: 25,
  paidCycle: false,
  saved: 0,
  researched: 0,
  recentSearches: [],
}

// Plans whose usage is tracked per billing period in the `usage` table.
// Free accounts are counted from saved leads with contact details (same as Plan & Billing).
const CYCLE_PLANS = new Set(['admin', 'prospector', 'starter', 'pro'])

// scrape_completed and search_performed are both logged for one search, a second or so apart.
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000
const MAX_RECENT_SEARCHES = 5

function formatNumber(value: number) {
  return new Intl.NumberFormat('en').format(value)
}

function formatDate(value: string | null) {
  if (!value) return 'Recent'
  try {
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
      new Date(value)
    )
  } catch {
    return 'Recent'
  }
}

function dedupeSearches(rows: RecentSearch[]) {
  const kept: RecentSearch[] = []

  for (const row of rows) {
    const key = `${row.query.trim().toLowerCase()}|${(row.location || '').trim().toLowerCase()}`
    const time = row.createdAt ? new Date(row.createdAt).getTime() : NaN
    const duplicate = kept.some((existing) => {
      const existingKey = `${existing.query.trim().toLowerCase()}|${(existing.location || '').trim().toLowerCase()}`
      const existingTime = existing.createdAt ? new Date(existing.createdAt).getTime() : NaN
      return existingKey === key && Math.abs(existingTime - time) <= DUPLICATE_WINDOW_MS
    })

    if (!duplicate) kept.push(row)
    if (kept.length >= MAX_RECENT_SEARCHES) break
  }

  return kept
}

async function fetchRecentSearches(userId: string): Promise<RecentSearch[]> {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('id, query, location, leads_count, created_at')
    .eq('user_id', userId)
    .in('event', ['scrape_completed', 'search_performed', 'first_search_performed'])
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) {
    console.warn('[dashboard] recent searches unavailable:', error.message)
    return []
  }

  return dedupeSearches(
    (data || [])
      .map((row) => ({
        id: row.id,
        query: row.query || '',
        location: row.location,
        createdAt: row.created_at,
        leadsCount: row.leads_count,
      }))
      .filter((row) => row.query.trim())
  )
}

async function fetchDiscovered(userId: string, plan: string) {
  if (!CYCLE_PLANS.has(plan)) {
    const { count, error } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .or('email.not.is.null,phone.not.is.null')

    if (error) throw error
    return { discovered: count ?? 0, allowance: getLeadLimit(plan), paidCycle: false }
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('usage')
    .select('leads_used, leads_limit')
    .eq('user_id', userId)
    .lte('period_start', nowIso)
    .gte('period_end', nowIso)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return {
    discovered: data?.leads_used ?? 0,
    allowance: data?.leads_limit ?? getLeadLimit(plan),
    paidCycle: true,
  }
}

export default function Page() {
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [data, setData] = useState<DashboardData>(EMPTY_DASHBOARD)
  const [isGuest, setIsGuest] = useState(false)

  useEffect(() => {
    if (userLoading || profileLoading) return
    void loadDashboard()

    const refreshGuest = () => {
      if (!user) loadGuestDashboard()
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    return () => window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
  }, [profileLoading, profile?.id, profile?.plan, user, userLoading])

  async function loadDashboard() {
    if (!user) {
      loadGuestDashboard()
      return
    }

    setIsGuest(false)
    setData((current) => ({ ...current, loading: true }))

    try {
      const plan = profile?.plan || 'free'
      const [discoveredResult, savedResult, researchedResult, recentSearches] = await Promise.all([
        fetchDiscovered(user.id, plan),
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        // Only research that actually produced a profile counts; failed/pending/skipped do not.
        supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('ci_enrichment_status', 'completed')
          .not('commercial_profile', 'is', null),
        fetchRecentSearches(user.id),
      ])

      if (savedResult.error) throw savedResult.error
      if (researchedResult.error) throw researchedResult.error

      setData({
        loading: false,
        ...discoveredResult,
        saved: savedResult.count ?? 0,
        researched: researchedResult.count ?? 0,
        recentSearches,
      })
    } catch (error) {
      console.error('[dashboard] load failed:', error)
      setData((current) => ({ ...current, loading: false }))
    }
  }

  function loadGuestDashboard() {
    const guestLeadCount = getGuestLeads().length

    setIsGuest(true)
    setData({
      ...EMPTY_DASHBOARD,
      loading: false,
      discovered: guestLeadCount,
      allowance: 25,
      saved: guestLeadCount,
    })
  }

  if (!isGuest && !profile && !profileLoading) {
    return null
  }

  const discoveredLabel = data.paidCycle ? 'Discovered this cycle' : 'Discovered'
  const discoveredDetail = data.paidCycle
    ? `of ${formatNumber(data.allowance)} in your plan`
    : `of ${formatNumber(data.allowance)} free leads`

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Your business discovery overview.</p>
        </div>
        <Link href="/dashboard/scraper" className="btn-primary-gold sm:shrink-0">
          Discover Businesses
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={discoveredLabel}
          value={data.discovered}
          detail={discoveredDetail}
          loading={data.loading}
        />
        <StatCard label="Saved businesses" value={data.saved} detail="All-time total" loading={data.loading} />
        <StatCard
          label="Research completed"
          value={data.researched}
          detail="Businesses with a research profile"
          loading={data.loading}
        />
      </section>

      <RecentSearches searches={data.recentSearches} loading={data.loading} isGuest={isGuest} />
    </div>
  )
}

function StatCard({
  label,
  value,
  detail,
  loading,
}: {
  label: string
  value: number
  detail: string
  loading: boolean
}) {
  return (
    <div className="flex h-full min-h-[112px] flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-sm font-medium text-slate-400">{label}</div>
      <div>
        <div className="text-3xl font-semibold tracking-tight text-white tabular-nums">
          {loading ? '–' : formatNumber(value)}
        </div>
        <div className="mt-1 text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  )
}

function RecentSearches({
  searches,
  loading,
  isGuest,
}: {
  searches: RecentSearch[]
  loading: boolean
  isGuest: boolean
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-white">Recent searches</h2>

      {searches.length > 0 ? (
        <div className="mt-3 divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
          {searches.map((search) => {
            const params = new URLSearchParams({ q: search.query })
            if (search.location) params.set('loc', search.location)

            return (
              <div
                key={search.id}
                className="flex flex-col gap-2 bg-slate-950/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">
                    {search.query}
                    {search.location ? (
                      <span className="font-normal text-slate-400"> · {search.location}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatDate(search.createdAt)}
                    {search.leadsCount !== null ? ` · ${formatNumber(search.leadsCount)} results` : ''}
                  </div>
                </div>
                <Link
                  href={`/dashboard/scraper?${params.toString()}`}
                  className="inline-flex min-h-[36px] shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-3.5 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.09]"
                >
                  Run Again
                </Link>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          {loading
            ? 'Loading your searches…'
            : isGuest
              ? 'Searches appear here once you create an account.'
              : 'No searches yet. Start with Discover Businesses.'}
        </p>
      )}
    </section>
  )
}
