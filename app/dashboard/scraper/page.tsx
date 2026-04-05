'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAdmin, isAdminPlan, isPaid, isPaidPlan } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import FirstSuccessModal from '@/components/modals/FirstSuccessModal'
import PartialCompletionModal from '@/components/modals/PartialCompletionModal'
import ScrapeCompletionModal from '@/components/modals/ScrapeCompletionModal'
import SendLeadsModal from '@/components/modals/SendLeadsModal'
import FirstRunOverlay from '@/components/scraper/FirstRunOverlay'
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
import { FREE_TRIAL_LEAD_LIMIT } from '@/lib/trial'

const COUNTRY_OPTIONS = [
  'Canada',
  'United States',
  'United Kingdom',
  'France',
  'Australia',
  'Germany',
  'United Arab Emirates',
  'Singapore',
  'India',
  'Mexico',
  'Brazil',
  'Other',
]

const LEAD_OPTIONS = ['10', '25', '50']
const FIRST_SUCCESS_MODAL_STORAGE_KEY = 'alpa_first_success_modal_seen'

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

function formatReadableLog(msg: string) {
  if (!msg || isHiddenSystemLog(msg) || msg === '🟢 stream started') return null

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

  if (msg.includes('📥')) return 'Business added to the results feed'
  if (msg.includes('✨')) return 'Contact details enriched'
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
  },
  ref
) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-400">{label}</label>
      <input
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border bg-[#0b1220] px-4 py-2 text-white placeholder:text-slate-500 disabled:opacity-60 ${
          invalid ? 'border-red-500/70 focus:ring-2 focus:ring-red-500/20' : 'border-white/10'
        }`}
      />
      {invalid && errorText ? (
        <div className="text-xs text-red-400">{errorText}</div>
      ) : null}
    </div>
  )
})

type SelectProps = {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  invalid?: boolean
  errorText?: string | null
  placeholder?: string
}

function Select({
  label,
  options,
  value,
  onChange,
  disabled = false,
  invalid = false,
  errorText = null,
  placeholder,
}: SelectProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-400">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border bg-[#0b1220] px-4 py-3 text-white disabled:opacity-60 ${
          invalid ? 'border-red-500/70 focus:ring-2 focus:ring-red-500/20' : 'border-white/10'
        }`}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {invalid && errorText ? <div className="text-xs text-red-400">{errorText}</div> : null}
    </div>
  )
}

export default function Page() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [loading, setLoading] = useState(false)
  const [viewerMode, setViewerMode] = useState<ViewerMode>(() =>
    isGuestTrialModeForced() ? 'guest_trial' : 'resolving'
  )
  const [guestLeadCount, setGuestLeadCount] = useState(0)
  const [authenticatedLeadCount, setAuthenticatedLeadCount] = useState(0)
  const [viewerEmail, setViewerEmail] = useState('')

  const [businessType, setBusinessType] = useState('')
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState('25')
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1)

  const [logs, setLogs] = useState<string[]>([])
  const [discovered, setDiscovered] = useState(0)
  const [displayedDiscovered, setDisplayedDiscovered] = useState(0)
  const [enriched, setEnriched] = useState(0)
  const [activity, setActivity] = useState('Idle')
  const [completionResult, setCompletionResult] = useState<ScrapeResultPayload | null>(null)
  const [sessionSavedLeads, setSessionSavedLeads] = useState<TrialLead[]>([])
  const [guestClaimResult, setGuestClaimResult] = useState<StoredGuestClaimResult | null>(null)
  const [showFirstSuccessModal, setShowFirstSuccessModal] = useState(false)
  const [showPartialCompletionModal, setShowPartialCompletionModal] = useState(false)
  const [showCompletionModal, setShowCompletionModal] = useState(false)
  const [showSendLeadsModal, setShowSendLeadsModal] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [showValidation, setShowValidation] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)

  const [elapsed, setElapsed] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const completionModalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runStartUsageRef = useRef(0)
  const businessTypeRef = useRef<HTMLInputElement | null>(null)
  const cityRef = useRef<HTMLInputElement | null>(null)
  const isGuest = viewerMode === 'guest_trial'
  const isAuthenticated = viewerMode === 'authenticated_free' || viewerMode === 'authenticated_paid'
  const plan = profile?.plan ?? null
  const resolvedPlan = plan || 'free'
  const isFree = isGuest || plan === 'free'
  const isPlanLoading = !isGuest && (viewerMode === 'resolving' || profileLoading || !plan)
  const requestedLeadCount = Number(maxLeads)
  const resolvedLeadLimit = getLeadLimit(resolvedPlan)
  const resolvedUsageCount = isGuest ? guestLeadCount : authenticatedLeadCount
  const usageState =
    !isPlanLoading ? getUsageState(resolvedUsageCount, resolvedLeadLimit) : 'normal'
  const usageBlocked = usageState === 'blocked'
  const usageWarning = usageState === 'warning'
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
  const stepLabel = `Step ${currentStep} of 3`
  const liveLogLines = logs
    .map((entry) => formatReadableLog(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry, index, entries) => entry !== entries[index - 1])
    .slice(-8)
  const showLivePanel = loading || Boolean(completionResult) || liveLogLines.length > 0
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
    void loadViewerMode()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void loadViewerMode()
    })

    return () => {
      if (completionModalTimeoutRef.current) {
        clearTimeout(completionModalTimeoutRef.current)
        completionModalTimeoutRef.current = null
      }
      subscription.unsubscribe()
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !profile?.id) return
    void refreshAuthenticatedUsage(profile.id, profile.plan)
  }, [isAuthenticated, profile?.id, profile?.plan])

  useEffect(() => {
    if (profileLoading) return
    void loadViewerMode()
  }, [profile?.id, profile?.plan, profileLoading])

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

  function resetProspectorUiState() {
    if (completionModalTimeoutRef.current) {
      clearTimeout(completionModalTimeoutRef.current)
      completionModalTimeoutRef.current = null
    }

    setLoading(false)
    setLogs([])
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
    setShowCompletionModal(false)
    setShowSendLeadsModal(false)
    setToastMessage('')
    setActivity('Idle')
    clearStoredGuestClaimResult()
  }

  async function loadViewerMode() {
    setGuestClaimResult(readStoredGuestClaimResult())

    const {
      data: { user },
    } = await supabase.auth.getUser()
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
      console.log('USAGE SOURCE: guest localStorage', { count: nextGuestLeadCount })
      setViewerMode('guest_trial')
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
        setLogs([])
        setActivity('Missing required fields.')
        if (missingBusinessType) {
          businessTypeRef.current?.focus()
          setCurrentStep(1)
        } else {
          cityRef.current?.focus()
          setCurrentStep(2)
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
      setLogs([])
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
      setShowCompletionModal(false)
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

        setLogs((prev) => [...prev, msg])

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

        if ((isFree && shouldShowLimitModal) || shouldShowPartialCompletionModal) {
          completionModalTimeoutRef.current = setTimeout(() => {
            if (isFree && shouldShowLimitModal) {
              setShowCompletionModal(true)
            } else if (shouldShowPartialCompletionModal) {
              setShowPartialCompletionModal(true)
            }
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

      setLogs([`❌ ${message}`])
      setActivity('Mission failed.')
      setLoading(false)
    }
  }

  function abortMission() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    setLogs((prev) => [...prev, '🛑 Mission aborted'])
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
  }

  function clearValidation() {
    setShowValidation(false)
    setValidationMessage('')
  }

  function goToNextStep() {
    if (currentStep === 1) {
      if (missingBusinessType) {
        setShowValidation(true)
        setValidationMessage('Please enter business type')
        businessTypeRef.current?.focus()
        return
      }

      clearValidation()
      setCurrentStep(2)
      return
    }

    if (currentStep === 2) {
      if (missingLocation) {
        setShowValidation(true)
        setValidationMessage('Please add a city, province/state, or country')
        cityRef.current?.focus()
        return
      }

      clearValidation()
      setCurrentStep(3)
    }
  }

  function goToPreviousStep() {
    clearValidation()
    setCurrentStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current))
  }

  const liveLogPanel = (
    <section className="space-y-6 rounded-[30px] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(14,24,42,0.92),rgba(11,18,32,0.96))] p-5 shadow-[0_0_0_1px_rgba(34,211,238,0.06),0_24px_80px_rgba(2,8,23,0.42)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/80">
            Processing your leads
          </div>
          <div className="mt-2 text-lg font-semibold text-white">
            {liveFoundCount} / {requestedLeadCount} leads found
          </div>
        </div>

        <div className="rounded-full border border-cyan-300/12 bg-cyan-300/8 px-3 py-1 text-xs text-cyan-100/80">
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
                      ? 'bg-emerald-400'
                      : item.active
                        ? 'animate-pulse bg-cyan-300'
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
                className="h-full bg-[linear-gradient(90deg,#3B82F6_0%,#22D3EE_55%,#10B981_100%)] shadow-[0_0_14px_rgba(34,211,238,0.28)] transition-all duration-500"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )

  const activityFeedSection = showLivePanel ? (
    <section className="w-full rounded-[30px] border border-white/8 bg-white/[0.03] p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Activity feed
        </div>
        <div className="text-xs text-slate-500">{activity}</div>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-white/8 bg-black/20 p-4 pr-3">
        {(liveLogLines.length > 0 ? liveLogLines : ['Waiting to start your search...']).map(
          (entry, index) => (
            <div
              key={`${entry}-${index}`}
              className="font-mono text-sm leading-6 text-slate-200 transition-opacity duration-300"
            >
              <span className="mr-2 text-cyan-300">▸</span>
              {entry}
            </div>
          )
        )}
      </div>
    </section>
  ) : null

  return (
    <>
      <FirstRunOverlay />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:gap-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <div>
            <h1 className="text-[2.15rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-[2.8rem]">
              Find your first leads
            </h1>
            <p className="mt-3 text-base leading-7 text-slate-300">
              Start with 25 free leads. No setup needed.
            </p>
            {(isPlanLoading || usageLoading) && (
              <div className="mt-3 text-sm text-slate-500">Preparing your workspace...</div>
            )}
          </div>

          {freeUsageWarning ? (
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-4 text-sm text-cyan-100">
              {getUsageWarningMessage(resolvedUsageCount, resolvedLeadLimit)}
            </div>
          ) : null}

          <div className="space-y-5 rounded-[28px] border border-white/8 bg-white/[0.03] p-5 transition-all duration-300 sm:p-6">
            <div className="text-sm font-medium text-slate-400">{stepLabel}</div>

            <div className="space-y-4 transition-all duration-300">
              {currentStep === 1 ? (
                <>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
                      What are you looking for?
                    </h2>
                  </div>

                  <Input
                    ref={businessTypeRef}
                    label="Type of business"
                    value={businessType}
                    onChange={(value) => {
                      setBusinessType(value)
                      if (showValidation && value.trim()) {
                        clearValidation()
                      }
                    }}
                    placeholder="e.g. restaurants, gyms"
                    disabled={loading}
                    invalid={showValidation && missingBusinessType}
                    errorText="Required field"
                  />
                </>
              ) : null}

              {currentStep === 2 ? (
                <>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">Where?</h2>
                  </div>

                  <Select
                    label="Country"
                    options={COUNTRY_OPTIONS}
                    value={country}
                    onChange={(value) => {
                      setCountry(value)
                      if (showValidation && (city.trim() || region.trim() || value.trim())) {
                        clearValidation()
                      }
                    }}
                    disabled={loading}
                    placeholder="Required"
                  />

                  <Input
                    label="Province / State"
                    value={region}
                    onChange={(value) => {
                      setRegion(value)
                      if (showValidation && (city.trim() || value.trim() || country.trim())) {
                        clearValidation()
                      }
                    }}
                    placeholder="Optional"
                    disabled={loading}
                  />

                  <Input
                    ref={cityRef}
                    label="City"
                    value={city}
                    onChange={(value) => {
                      setCity(value)
                      if (showValidation && (value.trim() || region.trim() || country.trim())) {
                        clearValidation()
                      }
                    }}
                    placeholder="Optional (more precise results)"
                    disabled={loading}
                  />
                </>
              ) : null}

              {currentStep === 3 ? (
                <>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">
                      How many leads?
                    </h2>
                  </div>

                  <Select
                    label="Number of leads"
                    options={LEAD_OPTIONS}
                    value={maxLeads}
                    onChange={setMaxLeads}
                    disabled={loading}
                  />

                  <div className="rounded-2xl border border-white/8 bg-[#0b1220] px-4 py-4 text-sm text-slate-300">
                    {isPlanLoading || usageLoading
                      ? 'Loading usage...'
                      : `Usage: ${resolvedUsageCount} / ${formatLeadLimit(resolvedLeadLimit)} leads this month`}
                  </div>
                </>
              ) : null}
            </div>

            {validationMessage ? <div className="text-sm text-red-400">{validationMessage}</div> : null}

            <div className="flex flex-col gap-3">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={goToPreviousStep}
                  disabled={loading}
                  className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/12 bg-white/[0.03] px-5 text-base font-medium text-white transition hover:bg-white/[0.06] disabled:opacity-60"
                >
                  Back
                </button>
              ) : null}

              {currentStep < 3 ? (
                <button
                  type="button"
                  onClick={goToNextStep}
                  disabled={loading}
                  className="inline-flex min-h-[56px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] px-6 text-base font-semibold text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition disabled:opacity-60"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={runScrape}
                  disabled={loading || hasMissingRequiredFields}
                  className="inline-flex min-h-[56px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] px-6 text-base font-semibold text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Generating leads...' : 'Generate Leads'}
                </button>
              )}

              {currentStep === 3 ? (
                <div className="text-center text-sm text-slate-400">
                  No signup required • Results in seconds
                </div>
              ) : null}

              {loading ? (
                <button
                  onClick={abortMission}
                  className="w-full rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm font-medium text-red-300 transition hover:bg-red-500/15"
                >
                  Stop search
                </button>
              ) : null}
            </div>
          </div>

        </div>

        {showLivePanel ? <div className="w-full">{liveLogPanel}</div> : null}

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
                  <div
                    key={lead.id}
                    className="rounded-2xl border border-white/8 bg-[#0b1220] px-4 py-4"
                  >
                    <div className="text-base font-semibold text-white">{lead.company_name}</div>
                    <div className="mt-1 text-sm text-slate-400">
                      {formatLeadPreviewLocation(lead) || 'Location details coming in'}
                    </div>
                    <div className="mt-2 text-sm text-cyan-100">
                      {lead.email || lead.phone || lead.website || 'Contact enrichment complete'}
                    </div>
                  </div>
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
              onClick={downloadPreviewLeads}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-white/14 bg-white/[0.04] px-5 text-base font-semibold text-white transition hover:bg-white/[0.07]"
            >
              Download leads
            </button>
          </section>
        ) : null}
      </div>

      <ScrapeCompletionModal
        isOpen={isFree && showCompletionModal && Boolean(completionResult)}
        onClose={() => {
          requestInboxFocus()
          setShowCompletionModal(false)
          router.push('/dashboard/leads')
        }}
        summaryLine={completionResult?.summaryLine || ''}
        detailLine={completionResult?.detailLine || ''}
        addedLeads={sessionSavedLeads}
        viewerEmail={viewerEmail}
        onDownload={() => setToastMessage('Want a copy in your inbox?')}
        onEmailSent={(message) => setToastMessage(message)}
      />

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
        onViewLeads={() => {
          requestInboxFocus()
          setShowFirstSuccessModal(false)
          router.push('/dashboard/leads')
        }}
      />

      <SendLeadsModal
        isOpen={showSendLeadsModal}
        onClose={() => setShowSendLeadsModal(false)}
        viewerEmail={viewerEmail}
        leads={sessionSavedLeads}
        summaryLine={completionResult?.summaryLine || `${sessionSavedLeads.length} leads ready from your ALPA session`}
        onSent={(message) => {
          setShowSendLeadsModal(false)
          setToastMessage(message)
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
