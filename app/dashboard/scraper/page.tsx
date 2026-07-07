'use client'

import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Globe, Mail, MapPin, Phone } from 'lucide-react'
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
  if (msg.includes('starting scraper')) return 'Starting discovery...'
  if (msg.includes('Google') || msg.includes('Serper')) return 'Scanning business sources…'
  if (msg.includes('🔎')) return 'Exploring search patterns…'
  if (msg.includes('🔬')) return 'Inspecting business websites…'
  if (msg.includes('📥')) return 'Business discovered…'
  if (msg.includes('✨')) return 'Contact signal discovered…'
  if (msg.includes('🛑 discovery complete')) return 'Deep enrichment in progress...'
  if (msg.includes('🎉 Prospecting complete')) return 'Discovery complete.'
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

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}


function getLogName(msg: string, prefix: string) {
  return msg.slice(prefix.length).split('|')[0].trim()
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

function formatSearchDescription(query: string, location: string) {
  const trimmedQuery = query.trim()
  const trimmedLocation = location.trim()

  if (trimmedQuery && trimmedLocation) {
    return `Searching ${trimmedQuery} in ${trimmedLocation}...`
  }

  if (trimmedQuery) return `Searching for ${trimmedQuery}...`
  if (trimmedLocation) return `Searching businesses in ${trimmedLocation}...`

  return 'ALPA will prepare a focused list based on your search criteria.'
}

type LiveActivityItem = {
  label: string
  detail?: string
  tone?: 'default' | 'success' | 'warning' | 'error'
}

type DiscoveryReportItem = {
  label: string
  value: string | number
}

function formatLiveActivity(msg: string): LiveActivityItem | null {
  if (!msg || isHiddenSystemLog(msg) || msg === '🟢 stream started') return null

  if (msg.startsWith('✓ Contact found for ')) {
    return {
      label: 'Contact information extracted',
      detail: getLogName(msg, '✓ Contact found for '),
      tone: 'success',
    }
  }

  if (msg.startsWith('✓ Verified contact — ')) {
    return {
      label: 'Lead validated',
      detail: getLogName(msg, '✓ Verified contact — '),
      tone: 'success',
    }
  }

  if (msg.startsWith('✓ ')) {
    return { label: 'Found', detail: getLogName(msg, '✓ '), tone: 'success' }
  }

  if (msg.startsWith('🔎 ')) {
    return { label: 'Searching', detail: getLogName(msg, '🔎 ') }
  }

  if (msg === '🛰️ Serper priority pass') {
    return { label: 'Searching map results' }
  }

  if (msg.startsWith('🛰️ Google improvement pass')) {
    return { label: 'Searching Google for stronger matches' }
  }

  if (msg.startsWith('📥 ')) {
    return { label: 'Found', detail: getLogName(msg, '📥 '), tone: 'success' }
  }

  if (msg.startsWith('🔬 ')) {
    return { label: 'Checking website', detail: getLogName(msg, '🔬 ') }
  }

  if (msg.startsWith('✨ ')) {
    return { label: 'Email found', detail: getLogName(msg, '✨ '), tone: 'success' }
  }

  if (msg.startsWith('⛔ no website: ')) {
    return { label: 'No website found', detail: getLogName(msg, '⛔ no website: '), tone: 'warning' }
  }

  if (msg.startsWith('⛔ no email: ')) {
    return { label: 'No email found', detail: getLogName(msg, '⛔ no email: '), tone: 'warning' }
  }

  if (msg.startsWith('🧩 improved ')) {
    return { label: 'Lead improved', detail: getLogName(msg, '🧩 improved '), tone: 'success' }
  }

  const discoveredMatch = msg.match(/^📦 discovered: (\d+)/)
  if (discoveredMatch) {
    return {
      label: 'Businesses discovered',
      detail: pluralize(Number(discoveredMatch[1]), 'business', 'businesses'),
      tone: 'success',
    }
  }

  const enrichedMatch = msg.match(/^📦 enriched: (\d+)/)
  if (enrichedMatch) {
    return { label: 'Businesses validated', detail: pluralize(Number(enrichedMatch[1]), 'business'), tone: 'success' }
  }

  const metricsMatch = msg.match(/^📊(?: improved)? websites: (\d+), valid emails: (\d+), enrichment rate: ([\d.]+%?)/)
  if (metricsMatch) {
    return {
      label: 'ALPA Quality Check',
      detail: `${metricsMatch[1]} websites checked, ${metricsMatch[2]} valid emails`,
      tone: 'success',
    }
  }

  const savedMatch = msg.match(/^💾 saved: (\d+), duplicates: (\d+), invalid: (\d+), db errors: (\d+)/)
  if (savedMatch) {
    return {
      label: 'Added to My Leads',
      detail: `${savedMatch[1]} saved, ${savedMatch[2]} duplicates removed, ${savedMatch[3]} invalid filtered`,
      tone: 'success',
    }
  }

  if (msg.startsWith('⚠️ duplicate skipped: ')) {
    return { label: 'Duplicate removed', detail: getLogName(msg, '⚠️ duplicate skipped: '), tone: 'warning' }
  }

  if (msg.startsWith('⚠️ invalid lead skipped: ')) {
    return { label: 'Invalid business filtered', detail: getLogName(msg, '⚠️ invalid lead skipped: '), tone: 'warning' }
  }

  const filteredMatch = msg.match(/^Filtered out (\d+) leads without contact info/)
  if (filteredMatch) {
    return {
      label: 'Invalid businesses filtered',
      detail: pluralize(Number(filteredMatch[1]), 'lead'),
      tone: 'warning',
    }
  }

  if (msg === '⚡ Improving results with Google...') {
    return { label: 'Searching for stronger contact signals' }
  }

  if (msg === '✅ early stop: enrichment target reached') {
    return { label: 'Quality target reached', tone: 'success' }
  }

  if (msg === '✅ Serper satisfied quality targets') {
    return { label: 'Quality target satisfied', tone: 'success' }
  }

  if (msg.includes('🛑 Mission aborted')) return { label: 'Search stopped', tone: 'warning' }
  if (msg.includes('🎉 Prospecting complete')) return { label: 'Discovery complete', tone: 'success' }
  if (msg.startsWith('❌')) return { label: msg.replace(/^❌\s*/, ''), tone: 'error' }

  return null
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

type RecentSearch = {
  id: string
  businessType: string
  location: string
  leadCount: string | null
}

type SearchCriteria = {
  businessType: string
  location: string
  leadCount: string
  region?: string
  country?: string
}

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

async function fetchRecentSearches(userId: string): Promise<RecentSearch[]> {
  const { data, error } = await supabase
    .from('search_analytics')
    .select('id, search_query, business_type, location, filters_used, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(4)

  if (error) {
    console.warn('[discover] recent searches unavailable:', error.message)
    return []
  }

  return (data || [])
    .map((row) => {
      const filters = row.filters_used as Record<string, unknown> | null
      const requestedLeads = filters && typeof filters.requested_leads !== 'undefined'
        ? String(filters.requested_leads)
        : null

      return {
        id: row.id,
        businessType: row.business_type || row.search_query || '',
        location: row.location || '',
        leadCount: LEAD_OPTIONS.includes(requestedLeads || '') ? requestedLeads : null,
      }
    })
    .filter((row) => row.businessType.trim() && row.location.trim())
}

function getMetricIcon(label: string) {
  switch (label.toLowerCase()) {
    case 'websites':
      return <Globe className="h-5 w-5" strokeWidth={1.5} />
    case 'emails':
      return <Mail className="h-5 w-5" strokeWidth={1.5} />
    case 'phones':
      return <Phone className="h-5 w-5" strokeWidth={1.5} />
    case 'businesses':
    default:
      return <Building2 className="h-5 w-5" strokeWidth={1.5} />
  }
}

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
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])
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
  const isFinalizing = Boolean(completionResult) || activity === 'Discovery complete.'
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
  const liveActivityItems = displayedLogs
    .map((entry) => formatLiveActivity(entry))
    .filter((entry): entry is LiveActivityItem => Boolean(entry))
    .filter((entry, index, entries) => {
      const previous = entries[index - 1]
      return !previous || entry.label !== previous.label || entry.detail !== previous.detail
    })
    .slice(-25)
  const websiteScanCount = logs.filter((entry) => entry.startsWith('🔬 ')).length
  const emailFoundCount = logs.filter((entry) => entry.startsWith('✨ ')).length
  const noWebsiteCount = logs.filter((entry) => entry.startsWith('⛔ no website: ')).length
  const noEmailCount = logs.filter((entry) => entry.startsWith('⛔ no email: ')).length
  const savedSummary = parseSavedSummary(logs)
  const filteredWithoutContactCount = parseFilteredWithoutContactCount(logs)
  const invalidFilteredCount = savedSummary.invalid + filteredWithoutContactCount
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
      detail:
        discovered > 0
          ? pluralize(discovered, 'business', 'businesses') + ' discovered'
          : 'Searching live business sources',
      active: loading && !isEnriching && !isValidating && !isFinalizing,
      complete: displayedDiscovered > 0 || enriched > 0 || Boolean(completionResult),
      progress: findingProgressPercent,
    },
    {
      label: 'Enriching contacts',
      detail:
        websiteScanCount > 0
          ? pluralize(websiteScanCount, 'website') + ' analyzed'
          : enriched > 0
            ? pluralize(enriched, 'contact') + ' enriched'
            : 'Checking websites and contact pages',
      active: isEnriching && !isValidating && !isFinalizing,
      complete: enriched > 0 || Boolean(completionResult),
      progress: enrichingProgressPercent,
    },
    {
      label: 'Validating leads',
      detail:
        enriched > 0
          ? pluralize(enriched, 'business', 'businesses') + ' validated'
          : 'Filtering for contact-ready leads',
      active: isValidating || isFinalizing,
      complete: Boolean(completionResult),
      progress: validatingProgressPercent,
    },
  ]
  const canShowRecentSearches = !loading && !completionResult && recentSearches.length > 0
  const completionSubtext = isGuest
    ? 'Added to your trial lead list.'
    : 'Saved to My Leads.'
  const completionContactCounts = completionResult ? countLeadContacts(completionResult.addedLeads) : null
  const averageTimePerValidatedLead =
    completionResult && completionResult.enrichedCount > 0 && finalElapsed !== null
      ? Math.max(1, Math.round(finalElapsed / completionResult.enrichedCount))
      : null
  const discoveryReportCandidates: Array<DiscoveryReportItem | null> = completionResult
    ? [
        { label: 'Businesses', value: completionResult.discoveredCount },
        completionContactCounts
          ? { label: 'Websites', value: completionContactCounts.website }
          : null,
        completionContactCounts
          ? { label: 'Emails', value: completionContactCounts.email }
          : null,
        completionContactCounts
          ? { label: 'Phones', value: completionContactCounts.phone }
          : null,
      ]
    : []
  const discoveryReportItems = discoveryReportCandidates.filter(
    (item): item is DiscoveryReportItem => item !== null
  )
  const qualityCheckItems = [
    savedSummary.duplicates > 0 ? 'Duplicate businesses removed' : null,
    invalidFilteredCount > 0 || noWebsiteCount > 0 || noEmailCount > 0 ? 'Weak contacts filtered' : null,
    completionResult && completionResult.addedCount > 0 ? 'Contact information verified' : null,
    completionResult && !isGuest && completionResult.addedCount > 0 ? 'Saved to My Leads' : null,
  ].filter((item): item is string => Boolean(item))
  const hasSearchCriteria = Boolean(businessType.trim() || city.trim())
  const searchHelperLine = formatSearchDescription(businessType, locationTarget)

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
    if (!user?.id) {
      setRecentSearches([])
      return
    }

    void fetchRecentSearches(user.id).then(setRecentSearches)
  }, [user?.id])

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
        query: activeBusinessType.trim(),
        region: activeRegion.trim(),
        defaultCity: activeLocationTarget,
        country: activeCountry,
        maxLeads: activeRequestedLeadCount,
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
          finish('Discovery complete.')
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
        enqueueLog(formatLeadDiscoveryLine(lead, activeLocationTarget))

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

        // Commercial Intelligence queue processing now handled by self-driving worker in My Leads
        // When user navigates to My Leads, worker will automatically process pending items
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

  function runRecentSearch(search: RecentSearch) {
    // TODO: If search analytics stops storing requested_leads, restore lead count
    // from backend-supported search metadata instead of guessing in the UI.
    const leadCount = search.leadCount || '25'
    void runScrape({
      businessType: search.businessType,
      location: search.location,
      leadCount,
      region: '',
      country: '',
    })
  }

  const liveDiscoveryPanel = (
    <section className="space-y-6 rounded-[30px] border border-cyan-200/12 bg-[linear-gradient(180deg,rgba(11,20,38,0.96),rgba(8,15,29,0.98))] p-5 shadow-[0_0_0_1px_rgba(34,211,238,0.06),0_24px_80px_rgba(2,8,23,0.42)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
            Live discovery
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-white">
            Finding your leads
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Searching businesses, checking websites, and validating contact details.
          </p>
        </div>

        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
          {formatTime(finalElapsed ?? elapsed)}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-3">
          {stageItems.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/7 bg-white/[0.025] px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      item.complete
                        ? 'bg-emerald-300'
                        : item.active
                          ? 'animate-pulse bg-cyan-200'
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

              <div className="mb-3 text-xs leading-5 text-slate-400">{item.detail}</div>

              <div className="h-2 overflow-hidden rounded-full bg-white/10 shadow-[inset_0_1px_2px_rgba(15,23,42,0.4)]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#67E8F9_0%,#A7F3D0_100%)] shadow-[0_0_14px_rgba(34,211,238,0.24)] transition-all duration-500"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Live activity
            </div>
            <div className="text-xs text-slate-500">
              {logs.length > 0 ? `${logs.length} events` : activity}
            </div>
          </div>

          <div
            ref={activityFeedRef}
            className="max-h-[260px] space-y-2 overflow-y-auto scroll-smooth pr-2 select-text lg:max-h-[330px]"
          >
            {(liveActivityItems.length > 0
              ? liveActivityItems
              : [{ label: searchHelperLine || 'Preparing discovery...' }]).map(
              (entry, index) => (
                <div
                  key={`${entry.label}-${entry.detail || ''}-${index}`}
                  className="rounded-xl border border-white/6 bg-white/[0.025] px-3 py-2 text-sm leading-6 text-slate-200 transition-all duration-300"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                        entry.tone === 'success'
                          ? 'bg-emerald-300'
                          : entry.tone === 'warning'
                            ? 'bg-amber-300'
                            : entry.tone === 'error'
                              ? 'bg-rose-300'
                              : 'bg-cyan-200'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-slate-200">{entry.label}</div>
                      {entry.detail ? (
                        <div className="truncate text-xs leading-5 text-slate-500">{entry.detail}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <button
          type="button"
          onClick={abortMission}
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
        >
          Stop search
        </button>
      ) : null}
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
                  DISCOVER
                </div>
                <h1 className="mt-2 text-[2rem] font-semibold leading-[1.04] tracking-[-0.04em] text-white sm:text-[2.6rem]">
                  Find new business leads
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 sm:hidden">
                  Tell ALPA who you want to find. We&apos;ll search, verify, and prepare leads.
                </p>
                <p className="mt-2 hidden max-w-2xl text-[15px] leading-7 text-slate-400 sm:block">
                  Tell ALPA who you want to find. We&apos;ll search, verify, and prepare
                  contact-ready leads in seconds.
                </p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
                {isPlanLoading || usageLoading
                  ? 'Preparing your workspace...'
                  : `${resolvedUsageCount} of ${formatLeadLimit(resolvedLeadLimit)} leads used this month`}
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
                  className="btn-primary-gold w-full"
                >
                  {loading ? 'Finding leads...' : 'Find leads'}
                </button>
              </div>
            </div>
          </form>
        </section>

        {canShowRecentSearches ? (
          <section className="rounded-[28px] border border-white/8 bg-white/[0.025] p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.025em] text-white">
                  Recent searches
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Run a previous discovery again with the same criteria.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {recentSearches.map((search) => (
                <div
                  key={search.id}
                  className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {search.businessType}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{search.location}</span>
                      {search.leadCount ? <span>{search.leadCount} leads</span> : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => runRecentSearch(search)}
                    disabled={loading}
                    className="inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-2xl border border-cyan-200/14 bg-cyan-200/[0.06] px-4 text-sm font-medium text-cyan-50 transition hover:bg-cyan-200/[0.1] disabled:opacity-60"
                  >
                    Run again
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {loading ? <div className="w-full">{liveDiscoveryPanel}</div> : null}

        {completionResult ? (
          <section className="w-full space-y-8 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,25,45,0.85),rgba(11,18,35,0.88))] p-5 shadow-[0_24px_64px_rgba(2,8,23,0.35)] sm:p-8">
            {completionResult.limitMessage ? (
              <div className="text-sm text-amber-200">{completionResult.limitMessage}</div>
            ) : null}

            <div className="space-y-3 opacity-0 animate-[fadeInUp_0.5s_ease-out_0.1s_forwards]">
              <div className="flex items-end gap-4">
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium uppercase tracking-[0.15em] text-emerald-300/80">Discovery complete</p>
                  <div className="flex items-baseline gap-3">
                    <h2 className="text-5xl font-semibold tracking-[-0.02em] text-white sm:text-6xl">
                      {completionResult.addedCount}
                    </h2>
                    <span className="text-base font-medium text-slate-300">contact-ready leads</span>
                  </div>
                </div>
              </div>
              {averageTimePerValidatedLead !== null ? (
                <p className="text-sm text-slate-400">
                  Validated in {formatTime(averageTimePerValidatedLead)} average per lead
                </p>
              ) : null}
            </div>

            {qualityCheckItems.length > 0 ? (
              <div className="flex flex-wrap gap-2 opacity-0 animate-[fadeInUp_0.5s_ease-out_0.25s_forwards]">
                {qualityCheckItems.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-200 transition-all duration-300 hover:bg-emerald-500/15"
                  >
                    <span className="text-emerald-300 text-sm">✓</span>
                    <span className="text-slate-200">{item}</span>
                  </span>
                ))}
              </div>
            ) : null}

            {discoveryReportItems.length > 0 ? (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 opacity-0 animate-[fadeInUp_0.5s_ease-out_0.4s_forwards]">
                {discoveryReportItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 transition-all duration-300 hover:bg-white/[0.04] hover:border-white/12"
                  >
                    <div className="mb-2 text-slate-400">
                      {getMetricIcon(item.label)}
                    </div>
                    <div className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-white">
                      {item.value}
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-400 capitalize">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {(completionResult || guestClaimResult) && previewLeads.length > 0 ? (
              <div className="space-y-3 pt-4 opacity-0 animate-[fadeInUp_0.5s_ease-out_0.55s_forwards]">
                <h3 className="text-sm font-medium tracking-[0.05em] text-slate-400">
                  Preview ({previewLeads.length} of {sessionSavedLeads.length})
                </h3>
                <div className="space-y-2">
                  {previewLeads.map((lead) => (
                    <div key={lead.id} className="opacity-0 animate-[fadeInUp_0.4s_ease-out_0.6s_forwards]">
                      <LeadCard
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
                    </div>
                  ))}
                </div>
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

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                onClick={() => {
                  requestInboxFocus()
                  router.push('/dashboard/leads')
                }}
                className="btn-primary-gold w-full lg:col-span-2"
              >
                View in My Leads
              </button>

              <button
                type="button"
                onClick={downloadPreviewLeads}
                disabled={!previewLeads.length}
                className="btn-secondary min-h-[52px] w-full rounded-2xl px-5 text-base font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                Export CSV
              </button>

              <button
                type="button"
                onClick={() => setShowSendLeadsModal(true)}
                disabled={!sessionSavedLeads.length}
                className="btn-secondary min-h-[52px] w-full rounded-2xl px-5 text-base font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                Email CSV
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={resetSearchFlow}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl px-4 text-sm font-medium text-slate-500 transition hover:text-slate-300"
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
          router.push('/dashboard/my-leads')
        }}
        elapsedSeconds={finalElapsed || 0}
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
