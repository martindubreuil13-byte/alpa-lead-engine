'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAdmin, isAdminPlan, isPaid, isPaidPlan } from '@/lib/auth/access'
import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import {
  getGuestLeads,
  getOrCreateGuestSessionId,
  mergeGuestLeads,
  saveGuestLeads,
  upsertGuestLead,
} from '@/lib/guest-session'
import {
  clearGuestTrialMode,
  isGuestTrialModeForced,
} from '@/lib/session/guest-trial-mode'
import {
  clearStoredGuestClaimResult,
  requestInboxFocus,
  readStoredGuestClaimResult,
  readStoredScrapeResult,
  type StoredGuestClaimResult,
  writeStoredScrapeResult,
} from '@/lib/session/scrape-result'
import { supabase } from '@/lib/supabase'
import { GUEST_LEADS_UPDATED_EVENT, type TrialLead } from '@/lib/trial'
import {
  countCountableLeads,
  getLeadLimit,
  getUsageState,
  getUsageWarningMessage,
  readStoredUsage,
  writeStoredUsage,
} from '@/lib/usage/usage'
import { buildLeadCsv } from '@/lib/leads/csv'
import {
  createAnalyticsSearchId,
  trackEvent,
} from '@/lib/track'
import { FREE_TRIAL_LEAD_LIMIT } from '@/lib/trial'
import {
  applyDiscoveryLog,
  applyProgressEvent,
  confirmDiscoveryResult,
  INITIAL_DISCOVERY_PROGRESS,
  type DiscoveryProgress,
} from '@/lib/scraper/discover-progress'
import { buildActivityItems, isHiddenSystemLog } from '@/lib/scraper/live-activity'
import { parseProgressEvent } from '@/lib/scraper/progress-events'
import {
  buildSearchFailure,
  isFatalSearchLog,
  resolveSearchOutcome,
  type SearchFailure,
  type SearchFailureKind,
} from '@/lib/scraper/search-failure'
import DiscoverEngine from '@/components/scraper/DiscoverEngine'
import ResultsIndex from '@/components/scraper/ResultsIndex'
import usePrefersReducedMotion from '@/components/scraper/usePrefersReducedMotion'
import useResultsReveal from '@/components/scraper/useResultsReveal'
import DiscoverSearchForm from '@/components/scraper/DiscoverSearchForm'
import {
  countUnreadableWebsites,
  describeSettledNote,
  describeShown,
  summarizeContacts,
  toResultRow,
} from '@/lib/scraper/results-summary'
import { ACHIEVEMENT_HOLD_MS, buildEngineView } from '@/lib/scraper/engine-view'
import {
  advanceRunTimings,
  EMPTY_RUN_TIMINGS,
  startRunTimings,
  type RunTimings,
} from '@/lib/scraper/stage-timing'
import ProspectorOnboardingOverlay from '@/components/scraper/ProspectorOnboardingOverlay'
import TrialLimitModal from '@/components/scraper/TrialLimitModal'
import {
  getPrivatePreviewResearchStatus,
  mergePrivatePreviewResearch,
  shouldRefreshPrivatePreviewResearch,
} from '@/lib/commercial-intelligence/private-preview-research'

const LEAD_OPTIONS = ['10', '25', '50']
const FIRST_SEARCH_STORAGE_KEY = 'alpa_first_search_tracked'

function formatLeadLimit(limit: number) {
  return Number.isFinite(limit) ? String(limit) : 'Unlimited'
}

function translateActivity(msg: string) {
  if (msg === 'Finding businesses') return 'Finding businesses...'
  if (msg === 'Checking websites') return 'Checking websites...'
  if (msg === 'Extracting contacts') return 'Checking websites...'
  if (msg === 'Improving results') return 'Searching additional sources...'
  if (msg.includes('starting scraper')) return 'Starting discovery...'
  if (msg.includes('Google') || msg.includes('Serper')) return 'Scanning business sources…'
  if (msg.includes('🔎')) return 'Exploring search patterns…'
  if (msg.includes('🔬')) return 'Inspecting business websites…'
  if (msg.includes('📥')) return 'Business discovered…'
  if (msg.includes('✨')) return 'Contact signal discovered…'
  if (msg.includes('🎉 Prospecting complete')) return 'Saving results...'
  if (msg.includes('⚠️ no leads found')) return 'No leads found. Try another query.'
  return null
}

function formatLeadWebsite(website: string | null) {
  if (!website) return null

  try {
    const normalized = website.startsWith('http') ? website : `https://${website}`
    return new URL(normalized).hostname.replace(/^www\./, '')
  } catch {
    return website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null
  }
}

function formatLocationSegment(segment: string) {
  const trimmed = segment.trim()
  if (!trimmed) return trimmed

  if (/^[a-z]{2,3}$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function normalizeSummaryLine(summaryLine: string) {
  const marker = ' found in '
  const markerIndex = summaryLine.toLowerCase().indexOf(marker)

  if (markerIndex === -1) return summaryLine

  const prefix = summaryLine.slice(0, markerIndex + marker.length)
  const rawLocation = summaryLine.slice(markerIndex + marker.length)
  const formattedLocation = rawLocation
    .split(',')
    .map((segment) => formatLocationSegment(segment))
    .join(', ')

  return `${prefix}${formattedLocation}`
}


function shouldTrackFirstSearch() {
  if (typeof window === 'undefined') return false
  if (window.localStorage.getItem(FIRST_SEARCH_STORAGE_KEY) === '1') return false
  window.localStorage.setItem(FIRST_SEARCH_STORAGE_KEY, '1')
  return true
}

function countLeadContacts(leads: TrialLead[]) {
  return leads.reduce(
    (acc, lead) => {
      if (lead.email?.trim()) acc.email += 1
      if (lead.phone?.trim()) acc.phone += 1
      if (lead.website?.trim()) acc.website += 1
      return acc
    },
    { email: 0, phone: 0, website: 0 }
  )
}




function parseSavedSummary(logs: string[]) {
  const savedLog = [...logs].reverse().find((log) => log.startsWith('💾 saved:'))
  if (!savedLog) {
    return { saved: 0, duplicates: 0, invalid: 0, dbErrors: 0 }
  }

  const saved = Number(savedLog.match(/saved:\s*(\d+)/)?.[1] || 0)
  const duplicates = Number(savedLog.match(/duplicates:\s*(\d+)/)?.[1] || 0)
  const invalid = Number(savedLog.match(/invalid:\s*(\d+)/)?.[1] || 0)
  const dbErrors = Number(savedLog.match(/db errors:\s*(\d+)/)?.[1] || 0)

  return { saved, duplicates, invalid, dbErrors }
}

function parseFilteredWithoutContactCount(logs: string[]) {
  return logs.reduce((total, log) => {
    const match = log.match(/^Filtered out (\d+) leads without contact info/)
    return total + Number(match?.[1] || 0)
  }, 0)
}


type ScrapeResultPayload = {
  summaryLine: string
  detailLine: string | null
  limitMessage: string | null
  locationLabel: string
  discoveredCount: number
  enrichedCount: number
  addedCount: number
  addedLeads: TrialLead[]
}

type ViewerMode = 'resolving' | 'guest_trial' | 'authenticated_free' | 'authenticated_paid'

type SearchCriteria = {
  businessType: string
  location: string
  leadCount: string
  region?: string
  country?: string
}

const PRIVATE_PREVIEW_POLL_INTERVAL_MS = 20_000

export function DiscoverExperience({ privatePreview = false }: { privatePreview?: boolean }) {
  const router = useRouter()
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [loading, setLoading] = useState(false)
  const [viewerMode, setViewerMode] = useState<ViewerMode>('resolving')
  const [analyticsSessionId, setAnalyticsSessionId] = useState<string | null>(null)
  const [guestLeadCount, setGuestLeadCount] = useState(0)
  const [authenticatedLeadCount, setAuthenticatedLeadCount] = useState(0)
  const [viewerEmail, setViewerEmail] = useState('')

  const [businessType, setBusinessType] = useState('')
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState('25')

  // "Run Again" from the dashboard links here with ?q=<business type>&loc=<location>.
  // Prefill the form only; the search is never started automatically.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get('q')?.trim()
    const loc = params.get('loc')?.trim()
    if (!q && !loc) return

    if (q) setBusinessType(q.slice(0, 120))
    if (loc) setCity(loc.slice(0, 120))
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  const [logs, setLogs] = useState<string[]>([])
  const [displayedLogs, setDisplayedLogs] = useState<string[]>([])
  const [progress, setProgress] = useState<DiscoveryProgress>(INITIAL_DISCOVERY_PROGRESS)
  const [activity, setActivity] = useState('Idle')
  const [completionResult, setCompletionResult] = useState<ScrapeResultPayload | null>(null)
  // Why the last search failed. Persists after loading ends and is cleared when a new search starts.
  const [searchFailureKind, setSearchFailureKind] = useState<SearchFailureKind | null>(null)
  const [sessionSavedLeads, setSessionSavedLeads] = useState<TrialLead[]>([])
  const [guestClaimResult, setGuestClaimResult] = useState<StoredGuestClaimResult | null>(null)
  const [showTrialLimitModal, setShowTrialLimitModal] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [showValidation, setShowValidation] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)

  const [elapsed, setElapsed] = useState(0)
  // Client-observed stage timing (the stream has no server timestamps) and a wall-clock tick.
  const [runTimings, setRunTimings] = useState<RunTimings>(EMPTY_RUN_TIMINGS)
  const [nowMs, setNowMs] = useState(0)
  // When the most recent real event arrived; drives the honest "taking longer" state.
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null)
  const [isMobileViewport, setIsMobileViewport] = useState(false)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const trialStartedTrackedRef = useRef(false)
  const trialLimitModalShownRef = useRef(false)
  const runStartUsageRef = useRef(0)
  const businessTypeRef = useRef<HTMLInputElement | null>(null)
  const cityRef = useRef<HTMLInputElement | null>(null)
  const engineRef = useRef<HTMLElement | null>(null)
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const isGuest = viewerMode === 'guest_trial'
  const isAuthenticated = viewerMode === 'authenticated_free' || viewerMode === 'authenticated_paid'
  const visitorType = isPaid(profile) ? 'paid' : isAuthenticated ? 'logged_in' : isGuest ? 'anonymous' : 'unknown'
  const plan = profile?.plan ?? null
  const resolvedPlan = plan || 'free'
  const isFree = isGuest || plan === 'free'
  const isPlanLoading = !isGuest && (viewerMode === 'resolving' || profileLoading || !plan)
  const requestedLeadCount = Number(maxLeads)
  const resolvedLeadLimit = getLeadLimit(resolvedPlan)
  const resolvedUsageCount = isGuest ? guestLeadCount : authenticatedLeadCount
  const usageState =
    !isPlanLoading ? getUsageState(resolvedUsageCount, resolvedLeadLimit) : 'normal'

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 639px)')
    const syncMobileViewport = () => setIsMobileViewport(mediaQuery.matches)

    syncMobileViewport()
    mediaQuery.addEventListener('change', syncMobileViewport)

    return () => {
      mediaQuery.removeEventListener('change', syncMobileViewport)
    }
  }, [])

  useEffect(() => {
    if (trialStartedTrackedRef.current) return
    if (viewerMode === 'resolving') return

    trialStartedTrackedRef.current = true
    void trackEvent('trial_started', {
      metadata: {
        source: 'prospector_page',
        visitor_type: visitorType,
      },
    })
    trackGaEvent('free_trial_started', {
      source_page: getSourcePage(),
      visitor_type: visitorType,
      session_id: analyticsSessionId || undefined,
    })
  }, [analyticsSessionId, viewerMode, visitorType])
  const usageBlocked = usageState === 'blocked'
  const usageWarning = usageState === 'warning'

  useEffect(() => {
    if (usageBlocked && isFree && !trialLimitModalShownRef.current) {
      trialLimitModalShownRef.current = true
      void trackEvent('trial_expired', {
        metadata: {
          lead_limit: resolvedLeadLimit,
          leads_used: resolvedUsageCount,
          visitor_type: visitorType,
        },
      })
      setShowTrialLimitModal(true)
    }
  }, [resolvedLeadLimit, resolvedUsageCount, usageBlocked, isFree, visitorType])
  const freeUsageWarning = !isPlanLoading && isFree && (usageWarning || usageBlocked)
  const missingBusinessType = !businessType.trim()
  const locationTarget = city.trim() || region.trim() || country.trim()
  const missingLocation = !locationTarget
  const hasMissingRequiredFields = missingBusinessType || missingLocation
  const previewLeads = sessionSavedLeads.slice(0, 5)
  const displayedPreviewLeads = privatePreview ? sessionSavedLeads : previewLeads
  const privatePreviewLeadIds = privatePreview
    ? sessionSavedLeads.map((lead) => lead.id).filter(Boolean).join(',')
    : ''
  const hasPendingPrivateResearch =
    privatePreview &&
    sessionSavedLeads.length > 0 &&
    shouldRefreshPrivatePreviewResearch(sessionSavedLeads)

  useEffect(() => {
    if (!hasPendingPrivateResearch || !privatePreviewLeadIds) return

    let cancelled = false
    const refreshResearch = async () => {
      try {
        const response = await fetch('/api/leads/private-preview-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: privatePreviewLeadIds.split(',') }),
        })
        if (!response.ok) return

        const payload = await response.json()
        if (!cancelled && payload?.ok && Array.isArray(payload.data)) {
          setSessionSavedLeads((current) => mergePrivatePreviewResearch(current, payload.data))
        }
      } catch (error) {
        console.warn(
          '[private-preview] research refresh unavailable:',
          error instanceof Error ? error.message : 'Unknown error'
        )
      }
    }

    void refreshResearch()
    const interval = window.setInterval(refreshResearch, PRIVATE_PREVIEW_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [hasPendingPrivateResearch, privatePreviewLeadIds])

  const skippedInvalidCount = guestClaimResult?.skipped_invalid ?? 0
  const skippedDuplicateCount = guestClaimResult?.skipped_duplicate ?? 0
  const showGuestClaimHelper = skippedInvalidCount > 0 || skippedDuplicateCount > 0
  const liveActivityItems = buildActivityItems(displayedLogs)
  const websiteScanCount = logs.filter((entry) => entry.startsWith('🔬 ')).length
  const emailFoundCount = logs.filter((entry) => entry.startsWith('✨ ')).length
  const savedSummary = parseSavedSummary(logs)
  const filteredWithoutContactCount = parseFilteredWithoutContactCount(logs)
  const invalidFilteredCount = savedSummary.invalid + filteredWithoutContactCount
  // The search interface becomes the engine while a run is in progress. When the authoritative
  // result arrives the same engine settles into a compact summary and the results sit beneath it:
  // the form does not come back, and nothing is replaced.
  const isLive = loading && !completionResult
  const isSettled = completionResult !== null
  const showEngine = isLive || isSettled
  // Contact figures describe the businesses actually returned, and are shown only with the result.
  const settledContacts = completionResult ? summarizeContacts(completionResult.addedLeads) : null
  const settledNote = completionResult
    ? describeSettledNote({
        discovered: progress.discoveredFinal,
        added: completionResult.addedCount,
        duplicates: savedSummary.duplicates,
        invalid: invalidFilteredCount,
        unreadable: countUnreadableWebsites(completionResult.addedLeads),
      })
    : null
  const resultRows = displayedPreviewLeads.map((lead) =>
    toResultRow(lead, { researchState: privatePreview ? getPrivatePreviewResearchStatus(lead) : null })
  )
  const resultsNote = describeShown(displayedPreviewLeads.length, sessionSavedLeads.length)
  const profileNote = privatePreview
    ? 'Business Profiles are a separate step; where research has finished, its synopsis appears here.'
    : isGuest
      ? 'Business Profiles are a separate step and are available with an account.'
      : 'Business Profiles are available separately.'
  const engineView = buildEngineView({
    progress,
    timings: runTimings,
    nowMs,
    lastEventAt,
    requestedCount: Number.isFinite(requestedLeadCount) && requestedLeadCount > 0 ? requestedLeadCount : null,
    businessType: businessType.trim(),
    location: locationTarget,
    running: loading,
    holdMs: prefersReducedMotion ? 0 : ACHIEVEMENT_HOLD_MS,
  })
  const searchFailure: SearchFailure | null =
    searchFailureKind && !completionResult
      ? buildSearchFailure(searchFailureKind, { savedCount: progress.saves?.saved ?? 0 })
      : null

  useEffect(() => {
    setRunTimings((current) => advanceRunTimings(current, progress, Date.now()))
  }, [progress])

  // When the results are ready, move the customer's attention to them once, gently. It does nothing
  // while they are typing or have been scrolling on their own, and respects reduced motion.
  useResultsReveal({
    ready: isSettled,
    reducedMotion: prefersReducedMotion,
    anchorRef: engineRef,
    headingRef: resultsHeadingRef,
    engineRef,
  })

  // When a search starts the form becomes the engine; make sure it is actually in view.
  useEffect(() => {
    if (!isLive) return
    const frame = window.requestAnimationFrame(() => {
      const element = engineRef.current
      if (!element) return
      const { top } = element.getBoundingClientRect()
      if (top < 0 || top > window.innerHeight * 0.5) {
        element.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isLive, prefersReducedMotion])

  useEffect(() => {
    if (loading) {
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 1)
        setNowMs(Date.now())
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (elapsed > 0 && finalElapsed === null) {
        setFinalElapsed(elapsed)
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [loading, elapsed, finalElapsed])

  useEffect(() => {
    if (userLoading) return
    void loadViewerMode()

    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [user, userLoading])

  useEffect(() => {
    if (!isAuthenticated || !profile?.id) return
    void refreshAuthenticatedUsage(profile.id, profile.plan)
  }, [isAuthenticated, profile?.id, profile?.plan])

  useEffect(() => {
    if (userLoading) return
    if (profileLoading) return
    void loadViewerMode()
  }, [profile?.id, profile?.plan, profileLoading, user, userLoading])

  useEffect(() => {
    if (!isGuest) return

    const syncGuestLeadCount = () => {
      setGuestLeadCount(countCountableLeads(getGuestLeads()))
    }

    syncGuestLeadCount()
    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeadCount)

    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeadCount)
    }
  }, [isGuest])

  useEffect(() => {
    if (!toastMessage) return

    const timeout = window.setTimeout(() => {
      setToastMessage('')
    }, 3600)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [toastMessage])

  useEffect(() => {
    console.log('SCRAPER LOAD:', {
      plan,
      usage: isGuest ? guestLeadCount : authenticatedLeadCount,
    })
  }, [authenticatedLeadCount, guestLeadCount, isGuest, plan])

  function enqueueLog(entry: string) {
    if (!entry) return

    // Shown as it arrives so the feed and the counters never disagree.
    setLogs((prev) => [...prev, entry])
    setDisplayedLogs((prev) => [...prev, entry])
  }

  function clearLogStream() {
    setLogs([])
    setDisplayedLogs([])
  }

  function resetProspectorUiState() {
    setLoading(false)
    clearLogStream()
    setProgress(INITIAL_DISCOVERY_PROGRESS)
    setRunTimings(EMPTY_RUN_TIMINGS)
    setElapsed(0)
    setFinalElapsed(null)
    setValidationMessage('')
    setShowValidation(false)
    setCompletionResult(null)
    setSearchFailureKind(null)
    setGuestClaimResult(null)
    setToastMessage('')
    setActivity('Idle')
    clearStoredGuestClaimResult()
  }

  async function loadViewerMode() {
    setGuestClaimResult(readStoredGuestClaimResult())

    const forcedGuestTrial = isGuestTrialModeForced()
    console.log('SCRAPER INIT', {
      forcedGuestTrial,
      authenticated: Boolean(user?.id),
      userId: user?.id ?? null,
    })

    if (forcedGuestTrial) {
      if (user?.id) {
        console.log('AUTH RESOLVED: authenticated session found during guest trial, signing out', {
          userId: user.id,
        })
        await supabase.auth.signOut()
      }

      const nextGuestLeadCount = countCountableLeads(getGuestLeads())
      const nextGuestSessionId = getOrCreateGuestSessionId()
      console.log('USAGE SOURCE: guest localStorage', { count: nextGuestLeadCount })
      setViewerMode('guest_trial')
      setAnalyticsSessionId(nextGuestSessionId)
      setViewerEmail('')
      setGuestLeadCount(nextGuestLeadCount)
      setSessionSavedLeads(getGuestLeads())
      setAuthenticatedLeadCount(0)
      return
    }

    const nextIsGuest = !user
    const nextGuestLeadCount = nextIsGuest ? countCountableLeads(getGuestLeads()) : 0

    if (nextIsGuest) {
      console.log('SCRAPER INIT: guest session detected', {
        localStorageUsage: nextGuestLeadCount,
      })
      setViewerMode('guest_trial')
      setAnalyticsSessionId(getOrCreateGuestSessionId())
      setViewerEmail('')
      setGuestLeadCount(nextGuestLeadCount)
      setSessionSavedLeads(getGuestLeads())
      setAuthenticatedLeadCount(0)
      setUsageLoading(false)
      return
    }

    if (profileLoading) {
      console.log('AUTH RESOLVED: authenticated user found, waiting for profile', {
        userId: user.id,
      })
      setViewerMode('resolving')
      return
    }

    const effectivePlan = profile?.plan
    if (!effectivePlan) {
      setViewerMode('resolving')
      return
    }
    const cachedUsage = readStoredUsage(user.id)
    const nextViewerMode =
      isAdmin(profile) || isPaid(profile) || isAdminPlan(effectivePlan) || isPaidPlan(effectivePlan)
        ? 'authenticated_paid'
        : 'authenticated_free'

    clearGuestTrialMode()
    console.log('AUTH RESOLVED', {
      userId: user.id,
      plan: effectivePlan,
      viewerMode: nextViewerMode,
    })
    console.log('USAGE SOURCE: localStorage(auth)', { count: cachedUsage })

    setViewerMode(nextViewerMode)
    setAnalyticsSessionId(null)
    setViewerEmail(user.email || '')
    setGuestLeadCount(0)
    setSessionSavedLeads(readStoredScrapeResult()?.latestSavedLeads ?? [])
    setAuthenticatedLeadCount(cachedUsage)
    await refreshAuthenticatedUsage(user.id, effectivePlan)
  }

  async function refreshAuthenticatedUsage(userId: string, planOverride?: string) {
    const effectivePlan = planOverride ?? profile?.plan
    if (!effectivePlan) return
    setUsageLoading(true)
    const freePlan = effectivePlan === 'free'

    if (freePlan) {
      const { count, error } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .or('email.not.is.null,phone.not.is.null')

      if (error) {
        console.error('Usage count failed:', error.message)
        setUsageLoading(false)
        return
      }

      const nextCount = count || 0
      console.log('USAGE SOURCE: free lead count', {
        userId,
        count: nextCount,
        plan: effectivePlan,
      })
      setAuthenticatedLeadCount(nextCount)
      writeStoredUsage(userId, nextCount, effectivePlan)
      setUsageLoading(false)
      return
    }

    const nowIso = new Date().toISOString()
    const { data: usageRow, error } = await supabase
      .from('usage')
      .select('leads_used, leads_limit, period_start, period_end')
      .eq('user_id', userId)
      .lte('period_start', nowIso)
      .gte('period_end', nowIso)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('Usage lookup failed:', error.message)
      setUsageLoading(false)
      return
    }

    const nextCount = usageRow?.leads_used ?? 0
    console.log('USAGE SOURCE: usage table', {
      userId,
      count: nextCount,
      plan: effectivePlan,
    })
    setAuthenticatedLeadCount(nextCount)
    writeStoredUsage(userId, nextCount, effectivePlan)
    setUsageLoading(false)
  }

  function finish(customActivity?: string) {
    if (abortRef.current) {
      abortRef.current = null
    }

    setLoading(false)
    if (customActivity) setActivity(customActivity)
  }

  async function runScrape(criteria?: SearchCriteria) {
    const activeBusinessType = criteria?.businessType ?? businessType
    const activeRegion = criteria?.region ?? region
    const activeCountry = criteria?.country ?? country
    const activeLeadCount = criteria?.leadCount ?? maxLeads
    const activeRequestedLeadCount = Number(activeLeadCount)
    const activeLocationTarget =
      criteria?.location?.trim() || city.trim() || activeRegion.trim() || activeCountry.trim()
    const activeMissingBusinessType = !activeBusinessType.trim()
    const activeMissingLocation = !activeLocationTarget

    // Outcome tracking for this run. A failure is only recorded while no authoritative
    // result has confirmed completion, and the first failure wins.
    let resultHandled = false
    let fatalSeen = false
    const failSearch = (kind: SearchFailureKind) => {
      if (resultHandled) return
      setSearchFailureKind((current) => current ?? kind)
    }

    try {
      if (criteria) {
        setBusinessType(activeBusinessType)
        setCity(criteria.location)
        setRegion(activeRegion)
        setCountry(activeCountry)
        setMaxLeads(activeLeadCount)
      }

      if (activeMissingBusinessType || activeMissingLocation) {
        setShowValidation(true)
        setValidationMessage(
          activeMissingBusinessType
            ? 'Please enter business type'
            : 'Please add a city, province/state, or country'
        )
        clearLogStream()
        setActivity('Missing required fields.')
        if (activeMissingBusinessType) {
          businessTypeRef.current?.focus()
        } else {
          cityRef.current?.focus()
        }
        return
      }

      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }

      setLoading(true)
      setRunTimings(startRunTimings(Date.now()))
      setNowMs(Date.now())
      setLastEventAt(Date.now())
      setSearchFailureKind(null)
      clearLogStream()
      setProgress(INITIAL_DISCOVERY_PROGRESS)
      setElapsed(0)
      setFinalElapsed(null)
      setValidationMessage('')
      setShowValidation(false)
      setCompletionResult(null)
      setToastMessage('')
      setActivity('Finding businesses...')
      runStartUsageRef.current = resolvedUsageCount

      const payload = {
        query: activeBusinessType.trim(),
        region: activeRegion.trim(),
        defaultCity: activeLocationTarget,
        country: activeCountry,
        maxLeads: activeRequestedLeadCount,
        existingLeadCount: isGuest ? guestLeadCount : authenticatedLeadCount,
        guestSessionId: isGuest ? getOrCreateGuestSessionId() : null,
        privatePreview,
      }
      const analyticsSearchId = createAnalyticsSearchId()
      const searchStartedAt = Date.now()

      void trackEvent('scrape_started', {
        search_id: analyticsSearchId,
        query: payload.query,
        location: payload.defaultCity,
        metadata: {
          target: activeRequestedLeadCount,
        },
      })
      trackGaEvent('lead_search_started', {
        query: payload.query,
        location: payload.defaultCity,
        requested_leads: activeRequestedLeadCount,
        visitor_type: visitorType,
        session_id: payload.guestSessionId || undefined,
      })

      const controller = new AbortController()
      abortRef.current = controller

      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        // 403 = plan limit, 401 = signed out. Never show the raw response body.
        const outcome = resolveSearchOutcome({ resultConfirmed: false, httpStatus: res.status })
        if (outcome.status === 'failed') failSearch(outcome.kind)
        finish('Mission failed.')
        return
      }

      if (!res.body) {
        throw new Error('Missing scraper response stream')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let latestResult: ScrapeResultPayload | null = null

      const handleMessage = (msg: string) => {
        if (!msg || msg === '🟢 stream started') return
        if (isHiddenSystemLog(msg)) return

        enqueueLog(msg)
        setLastEventAt(Date.now())
        setProgress((current) => applyDiscoveryLog(current, msg))

        const translated = translateActivity(msg)
        if (translated) setActivity(translated)

        // The final log line is informational. The live state stays up until the
        // authoritative `result` event arrives (see handleResult).
        if (isFatalSearchLog(msg)) {
          fatalSeen = true
          failSearch('server')
          finish('Mission failed.')
        }
      }

      const finalizeResult = (finalResult: ScrapeResultPayload) => {
        const contactCounts = countLeadContacts(finalResult.addedLeads)
        const searchEventName = shouldTrackFirstSearch() ? 'first_search_performed' : 'search_performed'
        void trackEvent(searchEventName, {
          search_id: analyticsSearchId,
          query: payload.query,
          search_query: payload.query,
          business_type: activeBusinessType.trim(),
          location: payload.defaultCity,
          filters_used: {
            region: activeRegion.trim() || null,
            country: activeCountry,
            requested_leads: activeRequestedLeadCount,
          },
          leads_count: finalResult.addedCount,
          number_of_results_returned: finalResult.addedCount,
          number_of_results_with_email: contactCounts.email,
          number_of_results_with_phone: contactCounts.phone,
          number_of_results_with_website: contactCounts.website,
          search_duration_ms: Date.now() - searchStartedAt,
          no_results: finalResult.addedCount === 0,
        })
        void trackEvent('scrape_completed', {
          search_id: analyticsSearchId,
          query: payload.query,
          location: payload.defaultCity,
          leads_count: finalResult.addedCount,
        })
        void trackEvent('results_viewed', {
          search_id: analyticsSearchId,
          query: payload.query,
          location: payload.defaultCity,
          leads_count: finalResult.addedCount,
        })
        trackGaEvent('lead_search_completed', {
          query: payload.query,
          location: payload.defaultCity,
          requested_leads: activeRequestedLeadCount,
          leads_found: finalResult.addedCount,
          duration_seconds: elapsed || undefined,
          visitor_type: visitorType,
          session_id: payload.guestSessionId || undefined,
        })
        trackGaEvent('lead_results_viewed', {
          query: payload.query,
          location: payload.defaultCity,
          leads_found: finalResult.addedCount,
          visitor_type: visitorType,
          session_id: payload.guestSessionId || undefined,
        })
        const sessionLeads = isGuest
          ? mergeGuestLeads(getGuestLeads(), finalResult.addedLeads)
          : finalResult.addedLeads

        if (isGuest && finalResult.addedLeads.length > 0) {
          saveGuestLeads(sessionLeads)
        }

        writeStoredScrapeResult({
          totalFoundLeads: isGuest ? sessionLeads.length : finalResult.enrichedCount,
          savedLeads: isGuest ? sessionLeads.length : finalResult.addedCount,
          latestSavedLeads: sessionLeads,
        })
        setSessionSavedLeads(sessionLeads)

        // Commercial Intelligence queue processing now handled by self-driving worker in My Leads
        // When user navigates to My Leads, worker will automatically process pending items
      }


      const handleResult = (result: ScrapeResultPayload) => {
        if (resultHandled) return
        resultHandled = true
        latestResult = result

        setProgress((current) => confirmDiscoveryResult(current))
        setCompletionResult(result)
        finalizeResult(result)
        finish('Discovery complete.')

        // Usage display refreshes in the background; it never delays the results.
        if (isAuthenticated && profile?.id) {
          void refreshAuthenticatedUsage(profile.id, profile.plan)
        }
      }

      const handleProgress = (raw: unknown) => {
        const event = parseProgressEvent(raw)
        if (event) {
          setLastEventAt(Date.now())
          setProgress((current) => applyProgressEvent(current, event))
        }
      }

      const handleLead = (lead: TrialLead) => {
        // Guest leads arrive as real events; only the stored trial list is updated.
        upsertGuestLead(lead)
      }

      while (true) {
        const { value, done } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          const lines = event.split('\n')

          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trimStart()

            try {
              const parsed = JSON.parse(payload)

              if (parsed?.type === 'log') {
                handleMessage(String(parsed.message || ''))
              }

              if (parsed?.type === 'lead' && parsed.payload) {
                handleLead(parsed.payload as TrialLead)
              }

              if (parsed?.type === 'result' && parsed.payload) {
                handleResult(parsed.payload as ScrapeResultPayload)
              }

              if (parsed?.type === 'progress') {
                handleProgress(parsed)
              }
            } catch {
              handleMessage(payload)
            }
          }
        }
      }

      buffer += decoder.decode()

      if (buffer.trim()) {
        const lines = buffer.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trimStart()

          try {
            const parsed = JSON.parse(payload)

            if (parsed?.type === 'log') {
              handleMessage(String(parsed.message || ''))
            }

            if (parsed?.type === 'lead' && parsed.payload) {
              handleLead(parsed.payload as TrialLead)
            }

            if (parsed?.type === 'result' && parsed.payload) {
              handleResult(parsed.payload as ScrapeResultPayload)
            }

            if (parsed?.type === 'progress') {
              handleProgress(parsed)
            }
          } catch {
            handleMessage(payload)
          }
        }
      }

      // The stream ended. Without an authoritative result this is a failure the customer
      // must be able to see; it is never reported as completion.
      if (!latestResult) {
        const outcome = resolveSearchOutcome({ resultConfirmed: resultHandled, fatalSeen })
        if (outcome.status === 'failed') failSearch(outcome.kind)
        finish()
      }

      if (abortRef.current === controller) {
        abortRef.current = null
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      if (isAbort) {
        return
      }

      const outcome = resolveSearchOutcome({ resultConfirmed: resultHandled, thrown: error })
      // The result already confirmed completion; a late connection error must not undo it
      // or be reported as a failed search.
      if (outcome.status === 'completed') {
        return
      }
      if (outcome.status === 'failed') failSearch(outcome.kind)

      const message =
        error instanceof Error ? error.message : 'Scrape failed'
      void trackEvent('search_performed', {
        search_id: createAnalyticsSearchId(),
        query: activeBusinessType.trim(),
        search_query: activeBusinessType.trim(),
        business_type: activeBusinessType.trim(),
        location: activeLocationTarget,
        filters_used: {
          region: activeRegion.trim() || null,
          country: activeCountry,
          requested_leads: activeRequestedLeadCount,
        },
        error_message: message,
        no_results: true,
      })

      clearLogStream()
      enqueueLog(`❌ ${message}`)
      setActivity('Mission failed.')
      setLoading(false)
    }
  }

  function abortMission() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    enqueueLog('🛑 Mission aborted')
    setActivity('Mission aborted')
    setLoading(false)
  }

  function downloadPreviewLeads() {
    const exportLeads = privatePreview ? sessionSavedLeads : previewLeads
    if (!exportLeads.length) return

    const csv = buildLeadCsv(exportLeads)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'alpa-leads-preview.csv'
    link.click()
    URL.revokeObjectURL(link.href)
    void trackEvent('csv_downloaded', { leads_count: exportLeads.length })
    trackGaEvent('csv_downloaded', {
      query: businessType.trim(),
      location: locationTarget,
      leads_exported: exportLeads.length,
      visitor_type: visitorType,
      session_id: analyticsSessionId || undefined,
    })
  }

  function clearValidation() {
    setShowValidation(false)
    setValidationMessage('')
  }

  function resetSearchFlow() {
    resetProspectorUiState()
    setBusinessType('')
    setCountry('')
    setRegion('')
    setCity('')
    setMaxLeads('25')
    setSessionSavedLeads([])
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:gap-10">
        {isFree ? <ProspectorOnboardingOverlay /> : null}
        {freeUsageWarning ? (
          <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-4 text-sm text-blue-100">
            {getUsageWarningMessage(resolvedUsageCount, resolvedLeadLimit)}
          </div>
        ) : null}

        {!showEngine ? (
          <DiscoverSearchForm
            businessType={businessType}
            location={city}
            resultCount={maxLeads}
            resultOptions={LEAD_OPTIONS}
            disabled={loading}
            showValidation={showValidation}
            missingBusinessType={missingBusinessType}
            missingLocation={missingLocation}
            validationMessage={validationMessage}
            usageText={
              isPlanLoading || usageLoading
                ? 'Preparing your workspace...'
                : `${resolvedUsageCount} of ${formatLeadLimit(resolvedLeadLimit)} businesses discovered this month`
            }
            submitDisabled={loading || hasMissingRequiredFields}
            isMobile={isMobileViewport}
            onBusinessTypeChange={(value) => {
              setBusinessType(value)
              if (showValidation && value.trim()) {
                clearValidation()
              }
            }}
            onLocationChange={(value) => {
              setCity(value)
              if (showValidation && (value.trim() || region.trim() || country.trim())) {
                clearValidation()
              }
            }}
            onResultCountChange={setMaxLeads}
            onSubmit={() => void runScrape()}
            businessTypeRef={businessTypeRef}
            locationRef={cityRef}
          />
        ) : null}

        {searchFailure && !loading ? (
          <SearchFailureNotice
            failure={searchFailure}
            onRetry={() => void runScrape()}
            onViewLeads={() => {
              requestInboxFocus()
              router.push('/dashboard/my-leads')
            }}
          />
        ) : null}

        {showEngine ? (
          <DiscoverEngine
            view={engineView}
            activity={liveActivityItems}
            results={isSettled ? settledContacts : null}
            settledNote={settledNote}
            onStop={abortMission}
            onNewSearch={resetSearchFlow}
            footnote="Times are measured in your browser."
            rootRef={engineRef}
          />
        ) : null}

        {completionResult ? (
          <>
            {completionResult.limitMessage ? (
              <p className="text-sm text-[#d8c28a]">{completionResult.limitMessage}</p>
            ) : null}

            <ResultsIndex
              rows={resultRows}
              headingRef={resultsHeadingRef}
              note={resultsNote}
              profileNote={profileNote}
              showResearchStatus={privatePreview}
              emptyMessage="No businesses were added from this search. Try a different business type or location."
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => {
                      requestInboxFocus()
                      router.push('/dashboard/my-leads')
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-[#0b1a33] underline decoration-[#7a5f27] decoration-2 underline-offset-8 transition-colors hover:text-[#7a5f27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27]"
                  >
                    View in My Leads
                  </button>
                  <button
                    type="button"
                    onClick={downloadPreviewLeads}
                    disabled={!displayedPreviewLeads.length}
                    className="inline-flex min-h-[44px] items-center rounded-sm text-sm font-medium text-[#5b6372] transition-colors hover:text-[#0b1a33] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Export CSV
                  </button>
                </>
              }
            />

            {showGuestClaimHelper ? (
              <div className="space-y-1 text-xs text-white/55">
                {skippedInvalidCount > 0 ? (
                  <div>{skippedInvalidCount} leads skipped due to missing contact details</div>
                ) : null}
                {skippedDuplicateCount > 0 ? (
                  <div>{skippedDuplicateCount} duplicates removed</div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <TrialLimitModal
        isOpen={!privatePreview && showTrialLimitModal}
        onClose={() => setShowTrialLimitModal(false)}
        onExportCsv={() => {
          setShowTrialLimitModal(false)
          downloadPreviewLeads()
        }}
      />

      {toastMessage ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-white/10 bg-[#0b1220]/95 px-4 py-3 text-sm text-white shadow-[0_20px_50px_rgba(2,8,23,0.45)] backdrop-blur">
          {toastMessage}
        </div>
      ) : null}
    </>
  )
}

function SearchFailureNotice({
  failure,
  onRetry,
  onViewLeads,
}: {
  failure: SearchFailure
  onRetry: () => void
  onViewLeads: () => void
}) {
  const actionClass =
    'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] px-4 text-sm font-medium text-white/90 transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a]'

  return (
    // role="alert" makes screen readers announce the failure as soon as it appears.
    <section role="alert" aria-atomic="true" className="w-full border-y border-white/10 py-6">
      <h2 className="text-lg font-medium text-white">{failure.title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">{failure.body}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {failure.actions.includes('my-leads') ? (
          <button type="button" onClick={onViewLeads} className={actionClass}>
            View My Leads
          </button>
        ) : null}
        {failure.actions.includes('billing') ? (
          <Link href="/dashboard/billing" className={actionClass}>
            View Plan &amp; Billing
          </Link>
        ) : null}
        {failure.actions.includes('sign-in') ? (
          <Link href="/login" className={actionClass}>
            Sign in
          </Link>
        ) : null}
        {failure.actions.includes('retry') ? (
          <button type="button" onClick={onRetry} className={actionClass}>
            Try again
          </button>
        ) : null}
      </div>
    </section>
  )
}

export default function Page() {
  return <DiscoverExperience />
}
