'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

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
  discovered: number
  allowance: number
  paidCycle: boolean
  saved: number
  researched: number
  recentSearches: RecentSearch[]
}

// loading: nothing is known yet; error: a query failed; ready: all data loaded.
type Status = 'loading' | 'error' | 'ready'

const EMPTY_DATA: DashboardData = {
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

// Example searches only prefill Discover (?q=&loc=); they never start a search.
const EXAMPLE_SEARCHES = [
  { query: 'Dental clinics', location: 'Austin' },
  { query: 'Marketing agencies', location: 'Miami' },
  { query: 'Accountants', location: 'Toronto' },
]

const STEPS = [
  { title: 'Discover', body: 'Search by business type and place.' },
  { title: 'Understand', body: 'ALPA studies each business’s website and summarizes what it does.' },
  { title: 'Decide', body: 'Copy contact details or export your results as a CSV.' },
]

const SEEN_RESEARCH_KEY = 'alpa_dashboard_researched_seen'

function formatNumber(value: number) {
  return new Intl.NumberFormat('en').format(value)
}

function discoverHref(query: string, location: string | null) {
  const params = new URLSearchParams({ q: query })
  if (location) params.set('loc', location)
  return `/dashboard/scraper?${params.toString()}`
}

function formatWhen(value: string | null) {
  if (!value) return 'Recently'
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return 'Recently'

  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000)

  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(then)
}

function readSeenResearch(userId: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${SEEN_RESEARCH_KEY}:${userId}`)
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeSeenResearch(userId: string, value: number) {
  try {
    window.localStorage.setItem(`${SEEN_RESEARCH_KEY}:${userId}`, String(value))
  } catch {
    // Storage can be unavailable (private windows); the notice is a convenience only.
  }
}

function dedupeSearches(rows: RecentSearch[]) {
  const kept: RecentSearch[] = []
  const keyOf = (row: RecentSearch) =>
    `${row.query.trim().toLowerCase()}|${(row.location || '').trim().toLowerCase()}`

  for (const row of rows) {
    const time = row.createdAt ? new Date(row.createdAt).getTime() : NaN
    const duplicate = kept.some((existing) => {
      const existingTime = existing.createdAt ? new Date(existing.createdAt).getTime() : NaN
      return keyOf(existing) === keyOf(row) && Math.abs(existingTime - time) <= DUPLICATE_WINDOW_MS
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

  if (error) throw error

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
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<DashboardData>(EMPTY_DATA)
  const [isGuest, setIsGuest] = useState(false)
  const [today, setToday] = useState<string | null>(null)
  const [newResearch, setNewResearch] = useState(0)
  const noticeHandled = useRef(false)

  // The date is formatted after mount so server and browser time zones cannot disagree.
  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
    )
  }, [])

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
    setStatus('loading')

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

      const researched = researchedResult.count ?? 0

      // Quiet feedback when research finished since the last visit. No polling: it is
      // computed once per page view from data already loaded.
      if (!noticeHandled.current) {
        noticeHandled.current = true
        const seen = readSeenResearch(user.id)
        setNewResearch(seen !== null && researched > seen ? researched - seen : 0)
        writeSeenResearch(user.id, researched)
      }

      setData({
        ...discoveredResult,
        saved: savedResult.count ?? 0,
        researched,
        recentSearches,
      })
      setStatus('ready')
    } catch (error) {
      console.error('[dashboard] load failed:', error)
      setStatus('error')
    }
  }

  function loadGuestDashboard() {
    const guestLeadCount = getGuestLeads().length

    setIsGuest(true)
    setData({ ...EMPTY_DATA, discovered: guestLeadCount, saved: guestLeadCount })
    setStatus('ready')
  }

  if (!isGuest && !profile && !profileLoading) {
    return null
  }

  // "Genuinely empty" is only decided once every query has succeeded.
  const isEmpty =
    status === 'ready' &&
    data.saved === 0 &&
    data.discovered === 0 &&
    data.researched === 0 &&
    data.recentSearches.length === 0

  return (
    <div className="mx-auto w-full max-w-4xl pb-16 pt-2 sm:pt-6">
      <header className="dash-rise flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="h-4 text-xs font-medium uppercase tracking-[0.18em] text-white/55" aria-hidden={!today}>
            {today}
          </p>
          <h1 className="mt-4 font-display text-[2.75rem] leading-[1.02] tracking-tight text-white/95 sm:text-[3.45rem]">
            Your business universe.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-white/70">
            Discover businesses. Understand what they do. Find your next opportunity.
          </p>
        </div>
        <Link href="/dashboard/scraper" className="btn-primary-gold btn-quiet sm:shrink-0">
          Discover businesses
        </Link>
      </header>

      <div className="mt-12 sm:mt-14" aria-busy={status === 'loading'}>
        {status === 'loading' ? <LoadingState /> : null}
        {status === 'error' ? <ErrorState onRetry={() => void loadDashboard()} /> : null}
        {isEmpty ? <EmptyState /> : null}
        {status === 'ready' && !isEmpty ? (
          <PopulatedState data={data} newResearch={newResearch} isGuest={isGuest} />
        ) : null}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-10" role="status" aria-label="Loading your overview">
      <div className="grid gap-6 border-y border-white/10 py-8 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="space-y-3 motion-safe:animate-pulse">
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="h-10 w-20 rounded bg-white/10" />
            <div className="h-3 w-32 rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>
      <div className="space-y-4 motion-safe:animate-pulse">
        <div className="h-3 w-32 rounded bg-white/10" />
        <div className="h-px w-full bg-white/10" />
        <div className="h-5 w-2/3 rounded bg-white/[0.06]" />
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-y border-white/10 py-10" role="alert">
      <p className="text-lg text-white/90">We couldn’t load your overview.</p>
      <p className="mt-2 text-sm text-white/60">Your data is safe. Check your connection and try again.</p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-6">
        Try again
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="space-y-14">
      <section aria-labelledby="how-it-works" className="dash-rise" style={{ animationDelay: '80ms' }}>
        <h2 id="how-it-works" className="text-xs font-medium uppercase tracking-[0.18em] text-white/55">
          Where to begin
        </h2>
        <ol className="mt-5 divide-y divide-white/10 border-y border-white/10">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-5 py-5">
              <span className="w-5 pt-0.5 text-sm tabular-nums text-white/55" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <div className="text-base font-medium text-white/95">{step.title}</div>
                <p className="mt-1 text-sm leading-6 text-white/60">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="try-search" className="dash-rise" style={{ animationDelay: '160ms' }}>
        <h2 id="try-search" className="text-xs font-medium uppercase tracking-[0.18em] text-white/55">
          Or start from an example
        </h2>
        <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          {EXAMPLE_SEARCHES.map((example) => (
            <li key={`${example.query}-${example.location}`}>
              <Link
                href={discoverHref(example.query, example.location)}
                className="group inline-flex min-h-[44px] items-center rounded text-base text-white/80 underline decoration-white/20 underline-offset-[6px] transition hover:text-white hover:decoration-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]"
                aria-label={`Prefill Discover with ${example.query} in ${example.location}`}
              >
                {example.query} <span className="px-1.5 text-white/40">·</span> {example.location}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-white/55">Examples only fill in the search form. Nothing runs until you start it.</p>
      </section>
    </div>
  )
}

function PopulatedState({
  data,
  newResearch,
  isGuest,
}: {
  data: DashboardData
  newResearch: number
  isGuest: boolean
}) {
  const discoveredLabel = data.paidCycle ? 'Discovered this cycle' : 'Discovered'
  const discoveredDetail = data.paidCycle
    ? `of ${formatNumber(data.allowance)} in your plan`
    : `of ${formatNumber(data.allowance)} free leads`

  return (
    <div className="space-y-12">
      <section aria-label="Overview" className="dash-rise" style={{ animationDelay: '80ms' }}>
        <dl className="grid divide-y divide-white/10 border-y border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Figure label={discoveredLabel} value={data.discovered} detail={discoveredDetail} first />
          <Figure label="Saved businesses" value={data.saved} detail="All-time total" />
          <Figure label="Research completed" value={data.researched} detail="Businesses with a research profile" accent />
        </dl>

        {newResearch > 0 ? (
          <p role="status" className="dash-fade mt-5 flex items-center gap-3 text-sm text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-[#d8c28a]" aria-hidden="true" />
            {newResearch === 1 ? '1 new research profile is ready.' : `${formatNumber(newResearch)} new research profiles are ready.`}
            <Link
              href="/dashboard/my-leads"
              className="rounded text-[#d8c28a] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]"
            >
              View in My Leads
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="recent-searches" className="dash-rise" style={{ animationDelay: '160ms' }}>
        <h2 id="recent-searches" className="text-xs font-medium uppercase tracking-[0.18em] text-white/55">
          Recent searches
        </h2>

        {data.recentSearches.length > 0 ? (
          <ol className="mt-5 divide-y divide-white/10 border-y border-white/10">
            {data.recentSearches.map((search) => (
              <li key={search.id}>
                <Link
                  href={discoverHref(search.query, search.location)}
                  aria-label={`Run again: ${search.query}${search.location ? ` in ${search.location}` : ''}`}
                  className="dash-row group flex min-h-[76px] flex-col gap-1.5 py-5 transition-colors hover:bg-white/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#d8c28a] sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[1.0625rem] font-semibold leading-snug text-white">
                      {search.query}
                      {search.location ? <span className="font-normal text-white/70"> · {search.location}</span> : null}
                    </span>
                    <span className="mt-1 block text-sm text-white/65">
                      {formatWhen(search.createdAt)}
                      {search.leadsCount !== null ? ` · ${formatNumber(search.leadsCount)} results` : ''}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2 text-sm text-white/70 transition-colors group-hover:text-[#d8c28a]" aria-hidden="true">
                    Run again
                    <span className="dash-row-arrow">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 border-y border-white/10 py-6 text-sm text-white/60">
            {isGuest ? 'Create an account to keep a history of your searches.' : 'Your searches will appear here.'}
          </p>
        )}
      </section>
    </div>
  )
}

function Figure({
  label,
  value,
  detail,
  first = false,
  accent = false,
}: {
  label: string
  value: number
  detail: string
  first?: boolean
  accent?: boolean
}) {
  return (
    <div className={`py-7 sm:py-8 ${first ? 'sm:pr-8' : 'sm:px-8'}`}>
      <dt className="text-sm text-white/75">{label}</dt>
      <dd className="mt-3">
        <span className={`block font-display text-6xl leading-none tabular-nums ${accent ? 'text-[#d8c28a]' : 'text-white/95'}`}>
          {formatNumber(value)}
        </span>
        <span className="mt-3 block text-xs text-white/65">{detail}</span>
      </dd>
    </div>
  )
}
