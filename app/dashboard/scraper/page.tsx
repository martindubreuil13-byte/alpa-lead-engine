'use client'

import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, MapPin } from 'lucide-react'
import LeadCard from '@/components/leads/LeadCard'
import { isAdmin, isAdminPlan, isPaid, isPaidPlan } from '@/lib/auth/access'
import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import FirstSuccessModal from '@/components/modals/FirstSuccessModal'
import PartialCompletionModal from '@/components/modals/PartialCompletionModal'
import SendLeadsModal from '@/components/modals/SendLeadsModal'
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
import ProspectorOnboardingOverlay from '@/components/scraper/ProspectorOnboardingOverlay'
import TrialLimitModal from '@/components/scraper/TrialLimitModal'

const LEAD_OPTIONS = ['10', '25', '50']
const FIRST_SUCCESS_MODAL_STORAGE_KEY = 'alpa_first_success_modal_seen'
const FIRST_SEARCH_STORAGE_KEY = 'alpa_first_search_tracked'

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m ? `${m}m ${r}s` : `${r}s`
}

function formatLeadLimit(limit: number) {
  return Number.isFinite(limit) ? String(limit) : 'Unlimited'
}

function translateActivity(msg: string) {
  if (msg === 'Finding businesses') return 'Finding businesses...'
  if (msg === 'Checking websites') return 'Enriching contacts...'
  if (msg === 'Extracting contacts') return 'Enriching contacts...'
  if (msg === 'Improving results') return 'Validating leads...'
  if (msg.includes('starting scraper')) return 'Launching prospecting engines…'
  if (msg.includes('Google') || msg.includes('Serper')) return 'Scanning business sources…'
  if (msg.includes('🔎')) return 'Exploring search patterns…'
  if (msg.includes('🔬')) return 'Inspecting business websites…'
  if (msg.includes('📥')) return 'Business discovered…'
  if (msg.includes('✨')) return 'Contact signal discovered…'
  if (msg.includes('🛑 discovery complete')) return 'Deep enrichment in progress...'
  if (msg.includes('🎉 Prospecting complete')) return 'Prospecting mission complete.'
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

function formatLeadDiscoveryLine(lead: TrialLead, fallbackLocation: string) {
  const name = lead.company_name?.trim()
  const city = lead.city?.trim()
  const website = formatLeadWebsite(lead.website)

  if (!name) {
    const location = city || fallbackLocation || 'Unknown location'
    return `✓ Business found — ${location}`
  }

  const base = city ? `✓ ${name} — ${city}` : `✓ ${name}`
  return website ? `${base} (${website})` : base
}

function formatReadableLog(msg: string) {
  if (!msg || isHiddenSystemLog(msg) || msg === '🟢 stream started') return null

  if (msg.startsWith('✓ ')) return msg

  const translated = translateActivity(msg)
  if (translated) return translated

  const discoveredMatch = msg.match(/^📦 discovered: (\d+)/)
  if (discoveredMatch) {
    return `${discoveredMatch[1]} businesses found`
  }

  const enrichedMatch = msg.match(/^📦 enriched: (\d+)/)
  if (enrichedMatch) {
    return `${enrichedMatch[1]} contacts enriched`
  }

  if (msg.includes('📥')) return null
  if (msg.includes('✨')) return null
  if (msg.includes('🛑 Mission aborted')) return 'Search stopped'
  if (msg.startsWith('❌')) return msg.replace(/^❌\s*/, '')

  return null
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

function isHiddenSystemLog(msg: string) {
  return msg.includes('api cost estimate') || msg.includes('SCRAPER API COST')
}

function formatLeadPreviewLocation(lead: TrialLead) {
  return [lead.city, lead.industry]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' • ')
}

function hasSeenFirstSuccessModal() {
  return typeof window !== 'undefined' && window.sessionStorage.getItem(FIRST_SUCCESS_MODAL_STORAGE_KEY) === '1'
}

function markFirstSuccessModalSeen() {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(FIRST_SUCCESS_MODAL_STORAGE_KEY, '1')
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

type InputProps = {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  invalid?: boolean
  errorText?: string | null
  helperText?: string
  icon?: ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    placeholder,
    value,
    onChange,
    disabled = false,
    invalid = false,
    errorText = null,
    helperText,
    icon,
  },
  ref
) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-200">{label}</label>
      <div
        className={`flex min-h-[48px] items-center gap-3 rounded-2xl border bg-[#07111f]/92 px-4 transition ${
          invalid
            ? 'border-amber-300/55 focus-within:border-amber-200/70 focus-within:ring-2 focus-within:ring-amber-300/15'
            : 'border-white/15 focus-within:border-cyan-300/45 focus-within:ring-2 focus-within:ring-cyan-300/12 sm:border-white/10 sm:focus-within:border-cyan-300/35 sm:focus-within:ring-cyan-300/10'
        }`}
      >
        {icon ? <div className="shrink-0 text-cyan-200/55">{icon}</div> : null}
        <input
          ref={ref}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-white placeholder:text-slate-600 outline-none disabled:opacity-60 sm:placeholder:text-slate-500"
        />
      </div>
      {invalid && errorText ? (
        <div className="text-xs text-amber-200">{errorText}</div>
      ) : helperText ? (
        <div className="hidden text-xs leading-5 text-slate-500 sm:block">{helperText}</div>
      ) : null}
    </div>
  )
})

export default function Page() {
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

  const [logs, setLogs] = useState<string[]>([])
  const [displayedLogs, setDisplayedLogs] = useState<string[]>([])
  const [discovered, setDiscovered] = useState(0)
  const [displayedDiscovered, setDisplayedDiscovered] = useState(0)
  const [enriched, setEnriched] = useState(0)
  const [activity, setActivity] = useState('Idle')
  const [completionResult, setCompletionResult] = useState<ScrapeResultPayload | null>(null)
  const [sessionSavedLeads, setSessionSavedLeads] = useState<TrialLead[]>([])
  const [guestClaimResult, setGuestClaimResult] = useState<StoredGuestClaimResult | null>(null)
  const [showFirstSuccessModal, setShowFirstSuccessModal] = useState(false)
  const [showPartialCompletionModal, setShowPartialCompletionModal] = useState(false)
  const [showSendLeadsModal, setShowSendLeadsModal] = useState(false)
  const [showTrialLimitModal, setShowTrialLimitModal] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [showValidation, setShowValidation] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)

  const [elapsed, setElapsed] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null)
  const [isMobileViewport, setIsMobileViewport] = useState(false)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const completionModalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logDrainTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logQueueRef = useRef<string[]>([])
  const activityFeedRef = useRef<HTMLDivElement | null>(null)
  const trialStartedTrackedRef = useRef(false)
  const trialLimitModalShownRef = useRef(false)
  const runStartUsageRef = useRef(0)
  const businessTypeRef = useRef<HTMLInputElement | null>(null)
  const cityRef = useRef<HTMLInputElement | null>(null)
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
  const progressTarget = Math.max(requestedLeadCount, discovered, enriched, 1)
  const missingBusinessType = !businessType.trim()
  const locationTarget = city.trim() || region.trim() || country.trim()
  const missingLocation = !locationTarget
  const hasMissingRequiredFields = missingBusinessType || missingLocation
  const isFinalizing = Boolean(completionResult) || activity === 'Prospecting mission complete.'
  const isEnriching =
    loading &&
    !isFinalizing &&
    (enriched > 0 ||
      activity.includes('Enrich') ||
      activity.includes('Inspecting') ||
      activity.includes('Contact') ||
      activity.includes('Checking') ||
      activity.includes('Deep enrichment'))
  const previewLeads = sessionSavedLeads.slice(0, 5)
  const skippedInvalidCount = guestClaimResult?.skipped_invalid ?? 0
  const skippedDuplicateCount = guestClaimResult?.skipped_duplicate ?? 0
  const showGuestClaimHelper = skippedInvalidCount > 0 || skippedDuplicateCount > 0
  const liveLogLines = displayedLogs
    .map((entry) => formatReadableLog(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry, index, entries) => entry !== entries[index - 1])
    .slice(-25)
  const discoveryPercent = Math.min((displayedDiscovered / progressTarget) * 100, 100)
  const enrichmentPercent = Math.min((enriched / progressTarget) * 100, 100)
  const liveFoundCount = Math.min(requestedLeadCount, Math.max(displayedDiscovered, enriched))
  const overallProgressPercent = Math.min((liveFoundCount / Math.max(requestedLeadCount, 1)) * 100, 100)
  const isValidating =
    loading &&
    !completionResult &&
    (activity.includes('Validating') ||
      activity.includes('Finalizing') ||
      activity.includes('complete'))
  const findingProgressPercent = Boolean(completionResult) || displayedDiscovered > 0 ? discoveryPercent : 0
  const enrichingProgressPercent = Boolean(completionResult)
    ? 100
    : isEnriching || enriched > 0
      ? enrichmentPercent
      : 0
  const validatingProgressPercent = completionResult
    ? 100
    : isValidating
      ? Math.max(20, Math.min(92, overallProgressPercent))
      : 0
  const stageItems = [
    {
      label: 'Finding businesses',
      active: loading && !isEnriching && !isValidating && !isFinalizing,
      complete: displayedDiscovered > 0 || enriched > 0 || Boolean(completionResult),
      progress: findingProgressPercent,
    },
    {
      label: 'Enriching contacts',
      active: isEnriching && !isValidating && !isFinalizing,
      complete: enriched > 0 || Boolean(completionResult),
      progress: enrichingProgressPercent,
    },
    {
      label: 'Validating leads',
      active: isValidating || isFinalizing,
      complete: Boolean(completionResult),
      progress: validatingProgressPercent,
    },
  ]
  const hasSearchCriteria = Boolean(businessType.trim() || city.trim())
  const searchHelperLine = hasSearchCriteria
    ? 'Searching businesses with publicly available contact information.'
    : 'ALPA will prepare a focused list based on your search criteria.'

  useEffect(() => {
    if (loading) {
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 1)
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
      if (completionModalTimeoutRef.current) {
        clearTimeout(completionModalTimeoutRef.current)
        completionModalTimeoutRef.current = null
      }
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

  useEffect(() => {
    if (displayedDiscovered === discovered) return

    const interval = window.setInterval(() => {
      setDisplayedDiscovered((current) => {
        if (current >= discovered) {
          window.clearInterval(interval)
          return current
        }

        const gap = discovered - current
        const step = gap > 12 ? 2 : 1
        const nextValue = Math.min(current + step, discovered)

        if (nextValue >= discovered) {
          window.clearInterval(interval)
        }

        return nextValue
      })
    }, 140)

    return () => {
      window.clearInterval(interval)
    }
  }, [discovered, displayedDiscovered])

  useEffect(() => {
    return () => {
      if (logDrainTimeoutRef.current) {
        clearTimeout(logDrainTimeoutRef.current)
        logDrainTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!activityFeedRef.current) return

    activityFeedRef.current.scrollTo({
      top: activityFeedRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [displayedLogs.length])

  function drainLogQueue() {
    if (logDrainTimeoutRef.current || logQueueRef.current.length === 0) return

    logDrainTimeoutRef.current = setTimeout(() => {
      const nextEntry = logQueueRef.current.shift()
      logDrainTimeoutRef.current = null

      if (nextEntry) {
        setDisplayedLogs((prev) => [...prev, nextEntry])
      }

      drainLogQueue()
    }, 80)
  }

  function enqueueLog(entry: string) {
    if (!entry) return

    setLogs((prev) => [...prev, entry])
    logQueueRef.current.push(entry)
    drainLogQueue()
  }

  function clearLogStream() {
    if (logDrainTimeoutRef.current) {
      clearTimeout(logDrainTimeoutRef.current)
      logDrainTimeoutRef.current = null
    }

    logQueueRef.current = []
    setLogs([])
    setDisplayedLogs([])
  }

  function resetProspectorUiState() {
    if (completionModalTimeoutRef.current) {
      clearTimeout(completionModalTimeoutRef.current)
      completionModalTimeoutRef.current = null
    }

    setLoading(false)
    clearLogStream()
    setDiscovered(0)
    setDisplayedDiscovered(0)
    setEnriched(0)
    setElapsed(0)
    setFinalElapsed(null)
    setValidationMessage('')
    setShowValidation(false)
    setCompletionResult(null)
    setGuestClaimResult(null)
    setShowPartialCompletionModal(false)
    setShowSendLeadsModal(false)
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

  async function runScrape() {
    try {
      if (hasMissingRequiredFields) {
        setShowValidation(true)
        setValidationMessage(
          missingBusinessType
            ? 'Please enter business type'
            : 'Please add a city, province/state, or country'
        )
        clearLogStream()
        setActivity('Missing required fields.')
        if (missingBusinessType) {
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

      if (completionModalTimeoutRef.current) {
        clearTimeout(completionModalTimeoutRef.current)
        completionModalTimeoutRef.current = null
      }

      setLoading(true)
      clearLogStream()
      setDiscovered(0)
      setDisplayedDiscovered(0)
      setEnriched(0)
      setElapsed(0)
      setFinalElapsed(null)
      setValidationMessage('')
      setShowValidation(false)
      setCompletionResult(null)
      setShowFirstSuccessModal(false)
      setShowPartialCompletionModal(false)
      setShowSendLeadsModal(false)
      setToastMessage('')
      setActivity('Finding businesses...')
      runStartUsageRef.current = resolvedUsageCount

      const payload = {
        query: businessType.trim(),
        region: region.trim(),
        defaultCity: locationTarget,
        country,
        maxLeads: requestedLeadCount,
        existingLeadCount: isGuest ? guestLeadCount : authenticatedLeadCount,
        guestSessionId: isGuest ? getOrCreateGuestSessionId() : null,
      }
      const analyticsSearchId = createAnalyticsSearchId()
      const searchStartedAt = Date.now()

      void trackEvent('scrape_started', {
        search_id: analyticsSearchId,
        query: payload.query,
        location: payload.defaultCity,
        metadata: {
          target: requestedLeadCount,
        },
      })
      trackGaEvent('lead_search_started', {
        query: payload.query,
        location: payload.defaultCity,
        requested_leads: requestedLeadCount,
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

      if (!res.body) {
        const errorText = await res.text().catch(() => '')
        throw new Error(errorText || 'Missing scraper response stream')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let latestResult: ScrapeResultPayload | null = null

      const handleMessage = (msg: string) => {
        if (!msg || msg === '🟢 stream started') return
        if (isHiddenSystemLog(msg)) return

        enqueueLog(msg)

        const translated = translateActivity(msg)
        if (translated) setActivity(translated)

        const discoveredMatch = msg.match(/^📦 discovered: (\d+)/)
        if (discoveredMatch) {
          setDiscovered(Number(discoveredMatch[1]) || 0)
        }

        const enrichedMatch = msg.match(/^📦 enriched: (\d+)/)
        if (enrichedMatch) {
          setEnriched(Number(enrichedMatch[1]) || 0)
        }

        if (msg.includes('📥')) {
          setDiscovered((d) => d + 1)
        }

        if (msg.includes('✨')) {
          setEnriched((e) => e + 1)
        }

        if (msg.includes('🎉 Prospecting complete')) {
          finish('Prospecting mission complete.')
        }

        if (
          msg.includes('❌ fatal') ||
          msg.includes('❌ invalid input') ||
          msg.includes('❌ missing authenticated user')
        ) {
          finish('Mission failed.')
        }
      }

      const handleResult = (result: ScrapeResultPayload) => {
        latestResult = result
        setDiscovered(result.discoveredCount)
        setEnriched(result.enrichedCount)
        setCompletionResult(result)
      }

      const handleLead = (lead: TrialLead) => {
        upsertGuestLead(lead)
        enqueueLog(formatLeadDiscoveryLine(lead, locationTarget))

        if (lead.email || lead.phone) {
          enqueueLog(`✓ Contact found for ${lead.company_name || 'business'}`)
          enqueueLog(`✓ Verified contact — ${lead.company_name || 'business'}`)
        }
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
          } catch {
            handleMessage(payload)
          }
        }
      }

      if (isAuthenticated && profile?.id) {
        await refreshAuthenticatedUsage(profile.id, profile.plan)
      }

      if (latestResult) {
        const finalResult: ScrapeResultPayload = latestResult as ScrapeResultPayload
        const contactCounts = countLeadContacts(finalResult.addedLeads)
        const searchEventName = shouldTrackFirstSearch() ? 'first_search_performed' : 'search_performed'
        void trackEvent(searchEventName, {
          search_id: analyticsSearchId,
          query: payload.query,
          search_query: payload.query,
          business_type: businessType.trim(),
          location: payload.defaultCity,
          filters_used: {
            region: region.trim() || null,
            country,
            requested_leads: requestedLeadCount,
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
          requested_leads: requestedLeadCount,
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

        const nextUsage = Math.min(resolvedLeadLimit, runStartUsageRef.current + finalResult.addedCount)
        const shouldShowLimitModal = nextUsage >= resolvedLeadLimit
        const shouldShowPartialCompletionModal =
          finalResult.addedCount > 0 && nextUsage < resolvedLeadLimit

        if (
          !shouldShowPartialCompletionModal &&
          !shouldShowLimitModal &&
          runStartUsageRef.current === 0 &&
          finalResult.addedCount > 0 &&
          !hasSeenFirstSuccessModal()
        ) {
          markFirstSuccessModalSeen()
          setShowFirstSuccessModal(true)
        }

        if (shouldShowPartialCompletionModal) {
          completionModalTimeoutRef.current = setTimeout(() => {
            setShowPartialCompletionModal(true)
            completionModalTimeoutRef.current = null
          }, 4800)
        }
      }

      if (abortRef.current === controller) {
        abortRef.current = null
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }

      const message =
        error instanceof Error ? error.message : 'Scrape failed'
      void trackEvent('search_performed', {
        search_id: createAnalyticsSearchId(),
        query: businessType.trim(),
        search_query: businessType.trim(),
        business_type: businessType.trim(),
        location: locationTarget,
        filters_used: {
          region: region.trim() || null,
          country,
          requested_leads: requestedLeadCount,
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
    if (!previewLeads.length) return

    const csv = buildLeadCsv(previewLeads)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'alpa-leads-preview.csv'
    link.click()
    URL.revokeObjectURL(link.href)
    void trackEvent('csv_downloaded', { leads_count: previewLeads.length })
    trackGaEvent('csv_downloaded', {
      query: businessType.trim(),
      location: locationTarget,
      leads_exported: previewLeads.length,
      visitor_type: visitorType,
      session_id: analyticsSessionId || undefined,
    })
  }

  async function addPreviewLeadToPipeline(id: string) {
    const targetLead = sessionSavedLeads.find((lead) => lead.id === id)
    if (!targetLead) return

    if (isFree) {
      requestInboxFocus()
      setToastMessage('Open your leads to manage pipeline actions.')
      router.push('/dashboard/leads')
      return
    }

    const { error } = await supabase
      .from('leads')
      .update({ status: 'pipeline' })
      .eq('id', id)

    if (error) {
      console.error('Preview pipeline update failed:', error)
      setToastMessage('Could not update pipeline right now.')
      return
    }

    setSessionSavedLeads((prev) =>
      prev.map((lead) => (lead.id === id ? { ...lead, status: 'pipeline' } : lead))
    )

    const storedResult = readStoredScrapeResult()
    if (storedResult) {
      writeStoredScrapeResult({
        ...storedResult,
        latestSavedLeads: storedResult.latestSavedLeads.map((lead) =>
          lead.id === id ? { ...lead, status: 'pipeline' } : lead
        ),
      })
    }

    setToastMessage(`${targetLead.company_name} added to pipeline.`)
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

  const liveLogPanel = (
    <section className="space-y-6 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,20,38,0.94),rgba(8,15,29,0.96))] p-5 shadow-[0_0_0_1px_rgba(59,130,246,0.06),0_24px_80px_rgba(2,8,23,0.42)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">
            Processing your leads
          </div>
          <div className="mt-2 text-lg font-semibold text-white">
            {loading || completionResult
              ? `${liveFoundCount} / ${requestedLeadCount} leads found`
              : 'Ready when you are'}
          </div>
        </div>

        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
          {formatTime(finalElapsed ?? elapsed)}
        </div>
      </div>

      <div className="space-y-3">
        {stageItems.map((item) => (
          <div key={item.label} className="rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    item.complete
                      ? 'bg-blue-400'
                      : item.active
                        ? 'animate-pulse bg-blue-300'
                        : 'bg-white/15'
                  }`}
                />
                <span
                  className={`text-sm ${
                    item.complete || item.active ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  {item.label}
                </span>
              </div>
              <span className="text-xs text-slate-500">{Math.round(item.progress)}%</span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-white/10 shadow-[inset_0_1px_2px_rgba(15,23,42,0.4)]">
              <div
                className="h-full bg-[linear-gradient(90deg,#3B82F6_0%,#60A5FA_100%)] shadow-[0_0_14px_rgba(59,130,246,0.28)] transition-all duration-500"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )

  const activityFeedSection = (
    <section className="w-full rounded-[30px] border border-white/8 bg-white/[0.03] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Activity feed
        </div>
        <div className="text-xs text-slate-500">
          {logs.length > 0 ? `${logs.length} events` : activity}
        </div>
      </div>

      <div
        ref={activityFeedRef}
        className="max-h-[220px] space-y-2 overflow-y-auto scroll-smooth rounded-2xl border border-white/8 bg-black/20 p-4 pr-3 select-text shadow-[0_0_0_1px_rgba(59,130,246,0.04)] sm:max-h-[260px] lg:max-h-[360px]"
      >
        {(liveLogLines.length > 0 ? liveLogLines : ['No activity yet']).map(
          (entry, index) => (
            <div
              key={`${entry}-${index}`}
              className="font-mono text-sm leading-6 text-slate-200 transition-all duration-300"
            >
              <span className="mr-2 text-blue-300">▸</span>
              {entry}
            </div>
          )
        )}
      </div>
    </section>
  )

  return (
    <>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:gap-10">
        {isFree ? <ProspectorOnboardingOverlay /> : null}
        {freeUsageWarning ? (
          <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-4 text-sm text-blue-100">
            {getUsageWarningMessage(resolvedUsageCount, resolvedLeadLimit)}
          </div>
        ) : null}

        <section className="w-full overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_32%),linear-gradient(180deg,rgba(11,20,38,0.96),rgba(7,13,26,0.98))] p-5 shadow-[0_24px_80px_rgba(2,8,23,0.42)] sm:p-6">
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void runScrape()
            }}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
                  PROSPECTOR
                </div>
                <h1 className="mt-2 text-[2rem] font-semibold leading-[1.04] tracking-[-0.04em] text-white sm:text-[2.6rem]">
                  Find contact-ready businesses
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 sm:hidden">
                  Choose who to target, where to search, and how many leads you want.
                </p>
                <p className="mt-2 hidden max-w-2xl text-[15px] leading-7 text-slate-400 sm:block">
                  Choose a business type, location, and lead count. ALPA will prepare a focused
                  list with available contact details.
                </p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
                {isPlanLoading || usageLoading
                  ? 'Preparing your workspace...'
                  : `Usage: ${resolvedUsageCount} / ${formatLeadLimit(resolvedLeadLimit)} leads this month`}
              </div>
            </div>

            <div className="rounded-[26px] border border-white/10 bg-white/[0.035] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.05fr)_minmax(220px,0.7fr)] lg:gap-0">
                <div className="lg:pr-3">
                  <Input
                    ref={businessTypeRef}
                    label="Business type"
                    value={businessType}
                    onChange={(value) => {
                      setBusinessType(value)
                      if (showValidation && value.trim()) {
                        clearValidation()
                      }
                    }}
                    placeholder={
                      isMobileViewport ? 'e.g. dentists, law firms' : 'dentists, law firms, architects'
                    }
                    helperText="Use 1–3 simple keywords."
                    disabled={loading}
                    invalid={showValidation && missingBusinessType}
                    errorText="Add a business type."
                    icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
                  />
                </div>

                <div className="border-white/8 lg:border-l lg:px-3">
                  <Input
                    ref={cityRef}
                    label="Location"
                    value={city}
                    onChange={(value) => {
                      setCity(value)
                      if (showValidation && (value.trim() || region.trim() || country.trim())) {
                        clearValidation()
                      }
                    }}
                    placeholder={
                      isMobileViewport ? 'e.g. Miami or California' : 'Miami, California, United Kingdom'
                    }
                    helperText="City, state, province, or country"
                    disabled={loading}
                    invalid={showValidation && missingLocation}
                    errorText="Add a location."
                    icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                  />
                </div>

                <div className="space-y-2 border-white/8 lg:border-l lg:pl-3">
                  <label className="text-sm font-medium text-slate-200">Lead count</label>
                  <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-[#07111f]/92 p-1.5 sm:max-w-xs lg:max-w-none">
                    {LEAD_OPTIONS.map((option) => {
                      const selected = maxLeads === option

                      return (
                        <button
                          key={option}
                          type="button"
                          disabled={loading}
                          onClick={() => setMaxLeads(option)}
                          className={`min-h-[48px] rounded-xl px-3 text-sm font-semibold transition disabled:opacity-60 ${
                            selected
                              ? 'border border-cyan-200/20 bg-white/[0.08] text-cyan-50 shadow-[0_8px_22px_rgba(8,145,178,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]'
                              : 'border border-transparent text-slate-400 hover:bg-white/[0.045] hover:text-white'
                          }`}
                          aria-pressed={selected}
                        >
                          {option}
                        </button>
                      )
                    })}
                  </div>
                  <div className="hidden text-xs leading-5 text-slate-500 sm:block">Default: 25</div>
                </div>
              </div>
            </div>

            {validationMessage ? <div className="text-sm text-amber-200">{validationMessage}</div> : null}

            <div className="flex flex-col gap-4 border-t border-white/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className={`text-sm leading-6 text-slate-400 ${hasSearchCriteria ? '' : 'hidden sm:block'}`}>
                {searchHelperLine}
              </div>

              <div className="flex flex-col gap-3 sm:min-w-[210px]">
                <button
                  type="submit"
                  disabled={loading || hasMissingRequiredFields}
                  className="min-h-[48px] rounded-2xl border border-cyan-200/20 bg-[linear-gradient(180deg,rgba(34,211,238,0.22),rgba(59,130,246,0.18))] px-6 text-sm font-semibold text-white shadow-[0_12px_34px_rgba(14,165,233,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-cyan-100/30 hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-none disabled:bg-white/[0.04] disabled:text-slate-500 disabled:shadow-none"
                >
                  {loading ? 'Finding leads...' : 'Find leads'}
                </button>

                {loading ? (
                  <button
                    type="button"
                    onClick={abortMission}
                    className="btn-ghost rounded-2xl px-5 py-3 text-sm font-medium"
                  >
                    Stop search
                  </button>
                ) : null}
              </div>
            </div>
          </form>
        </section>

        <div className="w-full">{liveLogPanel}</div>

        {activityFeedSection}

        {completionResult ? (
          <section className="w-full space-y-5 rounded-[30px] border border-white/8 bg-white/[0.03] p-5 sm:p-6">
            <div>
              <div className="text-2xl font-semibold text-white">{requestedLeadCount} leads found</div>
              <div className="mt-2 text-sm leading-6 text-slate-400">
                {normalizeSummaryLine(completionResult.summaryLine)}
              </div>
              {completionResult.limitMessage ? (
                <div className="mt-3 text-sm text-amber-200">{completionResult.limitMessage}</div>
              ) : null}
            </div>

            {(completionResult || guestClaimResult) && previewLeads.length > 0 ? (
              <div className="space-y-3">
                {previewLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    id={lead.id}
                    name={lead.company_name}
                    location={formatLeadPreviewLocation(lead) || 'Verified business lead'}
                    email={lead.email}
                    phone={lead.phone}
                    inPipeline={lead.status === 'pipeline'}
                    contacted={lead.status === 'contacted'}
                    isNew
                    context="prospector"
                    sourceUrl={lead.website}
                    onAddToPipeline={() => void addPreviewLeadToPipeline(lead.id)}
                  />
                ))}
              </div>
            ) : null}

            {showGuestClaimHelper ? (
              <div className="space-y-1 text-xs text-slate-500">
                {skippedInvalidCount > 0 ? (
                  <div>{skippedInvalidCount} leads skipped due to missing contact details</div>
                ) : null}
                {skippedDuplicateCount > 0 ? (
                  <div>{skippedDuplicateCount} duplicates removed</div>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => {
                if (!viewerEmail) {
                  setShowSendLeadsModal(true)
                } else {
                  downloadPreviewLeads()
                }
              }}
              className="btn-secondary min-h-[52px] w-full rounded-2xl px-5 text-base font-semibold"
            >
              Download leads
            </button>

            <div className="space-y-4 rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.03em] text-white">
                  Your leads are ready
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  You can review, download, or start outreach from your inbox.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  requestInboxFocus()
                  router.push('/dashboard/leads')
                }}
                className="btn-primary min-h-[56px] w-full rounded-2xl px-6 text-base font-semibold"
              >
                View my leads
              </button>

              <button
                type="button"
                onClick={resetSearchFlow}
                className="btn-secondary min-h-[52px] w-full rounded-2xl px-5 text-base font-medium"
              >
                Run another search
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <PartialCompletionModal
        isOpen={showPartialCompletionModal && Boolean(completionResult)}
        count={completionResult?.addedCount || 0}
        onClose={() => setShowPartialCompletionModal(false)}
        onViewLeads={() => {
          requestInboxFocus()
          setShowPartialCompletionModal(false)
          router.push('/dashboard/leads')
        }}
      />

      <FirstSuccessModal
        isOpen={showFirstSuccessModal}
        onClose={() => setShowFirstSuccessModal(false)}
        onEmailLeads={() => {
          setShowFirstSuccessModal(false)
          setShowSendLeadsModal(true)
        }}
      />

      <SendLeadsModal
        isOpen={showSendLeadsModal}
        onClose={() => setShowSendLeadsModal(false)}
        viewerEmail={viewerEmail}
        leads={sessionSavedLeads}
        summaryLine={completionResult?.summaryLine || `${sessionSavedLeads.length} leads ready from your ALPA session`}
        query={businessType.trim()}
        location={locationTarget}
        visitorType={visitorType}
        sessionId={analyticsSessionId}
        onSent={(message) => {
          setShowSendLeadsModal(false)
          setToastMessage(message)
        }}
      />

      <TrialLimitModal
        isOpen={showTrialLimitModal}
        onClose={() => setShowTrialLimitModal(false)}
        onEmailLeads={() => setShowSendLeadsModal(true)}
      />

      {toastMessage ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-white/10 bg-[#0b1220]/95 px-4 py-3 text-sm text-white shadow-[0_20px_50px_rgba(2,8,23,0.45)] backdrop-blur">
          {toastMessage}
        </div>
      ) : null}
    </>
  )
}
