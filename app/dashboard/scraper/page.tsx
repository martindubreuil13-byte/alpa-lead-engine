'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import ScrapeCompletionModal from '@/components/modals/ScrapeCompletionModal'
import {
  getGuestLeads,
  getOrCreateGuestSessionId,
  upsertGuestLead,
} from '@/lib/guest-session'
import {
  clearGuestTrialMode,
  isGuestTrialModeForced,
} from '@/lib/session/guest-trial-mode'
import { resetGuestSession } from '@/lib/session/resetGuestSession'
import {
  requestInboxFocus,
  writeStoredScrapeResult,
} from '@/lib/session/scrape-result'
import { supabase } from '@/lib/supabase'
import { FREE_TRIAL_LEAD_LIMIT, GUEST_LEADS_UPDATED_EVENT, type TrialLead } from '@/lib/trial'
import {
  countCountableLeads,
  getClampedLeadUsage,
  getLeadLimit,
  getRemainingLeadCapacity,
  getUsageState,
  getUsageWarningMessage,
  readStoredUsage,
  writeStoredUsage,
} from '@/lib/usage/usage'

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

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m ? `${m}m ${r}s` : `${r}s`
}

function translateActivity(msg: string) {
  if (msg === 'Finding businesses') return 'Finding businesses'
  if (msg === 'Checking websites') return 'Checking websites'
  if (msg === 'Extracting contacts') return 'Extracting contacts'
  if (msg === 'Improving results') return 'Improving results'
  if (msg.includes('starting scraper')) return 'Launching prospecting engines…'
  if (msg.includes('Google') || msg.includes('Serper')) return 'Scanning business sources…'
  if (msg.includes('🔎')) return 'Exploring search patterns…'
  if (msg.includes('🔬')) return 'Inspecting business websites…'
  if (msg.includes('📥')) return 'Business discovered…'
  if (msg.includes('✨')) return 'Contact signal discovered…'
  if (msg.includes('🛑 discovery complete')) return 'Discovery complete. Enriching leads…'
  if (msg.includes('🎉 Prospecting complete')) return 'Prospecting mission complete.'
  if (msg.includes('⚠️ no leads found')) return 'No leads found. Try another query.'
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

type ScrapeResultPayload = {
  summaryLine: string
  detailLine: string | null
  limitMessage: string | null
  locationLabel: string
  highQualityContactCount: number | null
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
}

function Select({ label, options, value, onChange, disabled = false }: SelectProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-400">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-white disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
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
  const [country, setCountry] = useState('Canada')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState('25')

  const [logs, setLogs] = useState<string[]>([])
  const [discovered, setDiscovered] = useState(0)
  const [displayedDiscovered, setDisplayedDiscovered] = useState(0)
  const [enriched, setEnriched] = useState(0)
  const [activity, setActivity] = useState('Idle')
  const [completionResult, setCompletionResult] = useState<ScrapeResultPayload | null>(null)
  const [showCompletionModal, setShowCompletionModal] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [showValidation, setShowValidation] = useState(false)

  const [elapsed, setElapsed] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const completionModalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guestSafetyResetCheckedRef = useRef(false)
  const businessTypeRef = useRef<HTMLInputElement | null>(null)
  const cityRef = useRef<HTMLInputElement | null>(null)
  const isGuest = viewerMode === 'guest_trial'
  const isAuthenticated = viewerMode === 'authenticated_free' || viewerMode === 'authenticated_paid'
  const requestedLeadCount = Number(maxLeads)
  const remainingGuestCapacity = Math.max(FREE_TRIAL_LEAD_LIMIT - guestLeadCount, 0)
  const leadPlan = viewerMode === 'authenticated_paid' ? 'starter' : 'free'
  const leadLimit = getLeadLimit(leadPlan)
  const leadsUsed = isGuest ? guestLeadCount : getClampedLeadUsage(authenticatedLeadCount, leadPlan)
  const remainingLeadCapacity = isGuest
    ? remainingGuestCapacity
    : getRemainingLeadCapacity(authenticatedLeadCount, leadPlan)
  const usageState = isAuthenticated ? getUsageState(leadsUsed, leadLimit) : 'normal'
  const usageBlocked = isAuthenticated && usageState === 'blocked'
  const usageWarning = isAuthenticated && usageState === 'warning'
  const progressTarget = Math.max(requestedLeadCount, discovered, enriched, 1)
  const missingBusinessType = !businessType.trim()
  const missingCity = !city.trim()
  const hasMissingRequiredFields = missingBusinessType || missingCity

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
    }, 2600)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [toastMessage])

  useEffect(() => {
    console.log('SCRAPER MODE UPDATED', {
      viewerMode,
      guestLeadCount,
      authenticatedLeadCount,
      leadLimit,
      leadsUsed,
      usageBlocked,
    })
  }, [authenticatedLeadCount, guestLeadCount, leadLimit, leadsUsed, usageBlocked, viewerMode])

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
    setShowCompletionModal(false)
    setToastMessage('')
    setActivity('Idle')
  }

  async function loadViewerMode() {
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

      if (
        !guestSafetyResetCheckedRef.current &&
        nextGuestLeadCount >= FREE_TRIAL_LEAD_LIMIT
      ) {
        guestSafetyResetCheckedRef.current = true
        console.log('AUTO RESET TRIGGERED ON LOAD')
        resetGuestSession({ regenerateSessionId: true })
        resetProspectorUiState()
        setViewerMode('guest_trial')
        setViewerEmail('')
        setGuestLeadCount(0)
        setAuthenticatedLeadCount(0)
        return
      }

      guestSafetyResetCheckedRef.current = true
      setViewerMode('guest_trial')
      setViewerEmail('')
      setGuestLeadCount(nextGuestLeadCount)
      setAuthenticatedLeadCount(0)
      return
    }

    const nextIsGuest = !user
    const nextGuestLeadCount = nextIsGuest ? countCountableLeads(getGuestLeads()) : 0

    if (nextIsGuest) {
      console.log('SCRAPER INIT: guest session detected', {
        localStorageUsage: nextGuestLeadCount,
      })

      if (
        !guestSafetyResetCheckedRef.current &&
        nextGuestLeadCount >= FREE_TRIAL_LEAD_LIMIT
      ) {
        guestSafetyResetCheckedRef.current = true
        console.log('AUTO RESET TRIGGERED ON LOAD')
        resetGuestSession({ regenerateSessionId: true })
        resetProspectorUiState()
        setViewerMode('guest_trial')
        setViewerEmail('')
        setGuestLeadCount(0)
        setAuthenticatedLeadCount(0)
        return
      }

      guestSafetyResetCheckedRef.current = true
      setViewerMode('guest_trial')
      setViewerEmail('')
      setGuestLeadCount(nextGuestLeadCount)
      setAuthenticatedLeadCount(0)
      return
    }

    if (profileLoading) {
      console.log('AUTH RESOLVED: authenticated user found, waiting for profile', {
        userId: user.id,
      })
      setViewerMode('resolving')
      return
    }

    const effectivePlan = profile?.plan ?? 'free'
    const cachedUsage = getClampedLeadUsage(readStoredUsage(user.id), effectivePlan)
    const nextViewerMode = effectivePlan === 'starter' ? 'authenticated_paid' : 'authenticated_free'

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
    setAuthenticatedLeadCount(cachedUsage)
    await refreshAuthenticatedUsage(user.id, effectivePlan)
  }

  async function refreshAuthenticatedUsage(userId: string, planOverride?: string) {
    const { count, error } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .or('email.not.is.null,phone.not.is.null')

    if (error) {
      console.error('Usage count failed:', error.message)
      return
    }

    const effectivePlan = planOverride ?? profile?.plan ?? 'free'
    const nextCount = getClampedLeadUsage(count || 0, effectivePlan)
    console.log('USAGE SOURCE: db', {
      userId,
      rawCount: count || 0,
      clampedCount: nextCount,
      plan: effectivePlan,
    })
    setAuthenticatedLeadCount(nextCount)
    writeStoredUsage(userId, nextCount, effectivePlan)
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
        setValidationMessage('Please enter business type and city')
        setLogs([])
        setActivity('Missing required fields.')
        if (missingBusinessType) {
          businessTypeRef.current?.focus()
        } else if (missingCity) {
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
      setLogs([])
      setDiscovered(0)
      setDisplayedDiscovered(0)
      setEnriched(0)
      setElapsed(0)
      setFinalElapsed(null)
      setValidationMessage('')
      setShowValidation(false)
      setCompletionResult(null)
      setShowCompletionModal(false)
      setToastMessage('')
      setActivity('Launching prospecting engines…')

      const payload = {
        query: businessType.trim(),
        region: region.trim(),
        defaultCity: city.trim(),
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
        writeStoredScrapeResult({
          totalFoundLeads: result.enrichedCount,
          savedLeads: result.addedCount,
          latestSavedLeads: result.addedLeads,
        })
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
        completionModalTimeoutRef.current = setTimeout(() => {
          setShowCompletionModal(true)
          completionModalTimeoutRef.current = null
        }, 3500)
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

  const discoveryPercent = Math.min((displayedDiscovered / progressTarget) * 100, 100)
  const enrichmentPercent = Math.min((enriched / progressTarget) * 100, 100)

  return (
    <>
      <div className="space-y-12">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
          Prospecting System
        </div>
        <h1 className="mt-2 text-4xl font-bold text-white">Prospector Engine</h1>
        <p className="mt-2 text-slate-400">
          {isGuest
            ? 'Discover and enrich businesses instantly. Your free trial stores up to 25 leads.'
            : 'Discover and enrich businesses by category and location.'}
        </p>
      </div>

      {usageBlocked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-4 text-amber-200">
          <span>Lead storage limit reached. Searches still run, but no new leads can be added until you upgrade.</span>
          <Link
            href="/plans"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-4 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5"
          >
            Upgrade to Starter
          </Link>
        </div>
      ) : usageWarning ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-5 py-4 text-cyan-100">
          <span>{getUsageWarningMessage(leadsUsed, leadLimit)}</span>
          <Link
            href="/plans"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-cyan-300/30 bg-white/[0.05] px-4 text-sm font-semibold text-cyan-100 transition hover:bg-white/[0.08]"
          >
            Upgrade to Starter
          </Link>
        </div>
      ) : null}

      <div className="glass space-y-10 p-10">
        <div className="grid gap-8 md:grid-cols-2">
          <Input
            ref={businessTypeRef}
            label="Type of business"
            value={businessType}
            onChange={(value) => {
              setBusinessType(value)
              if (showValidation) {
                const nextMissingBusinessType = !value.trim()
                if (!nextMissingBusinessType && !missingCity) {
                  setValidationMessage('')
                }
              }
            }}
            placeholder="plumber, florist, dentist..."
            disabled={loading}
            invalid={showValidation && missingBusinessType}
            errorText="Required field"
          />

          <Select
            label="Number of leads"
            options={LEAD_OPTIONS}
            value={maxLeads}
            onChange={setMaxLeads}
            disabled={loading}
          />

          <Select
            label="Country"
            options={COUNTRY_OPTIONS}
            value={country}
            onChange={setCountry}
            disabled={loading}
          />

          <Input
            label="Province / State"
            value={region}
            onChange={setRegion}
            placeholder="Quebec, California..."
            disabled={loading}
          />

          <Input
            ref={cityRef}
            label="City"
            value={city}
            onChange={(value) => {
              setCity(value)
              if (showValidation) {
                const nextMissingCity = !value.trim()
                if (!missingBusinessType && !nextMissingCity) {
                  setValidationMessage('')
                }
              }
            }}
            placeholder="Montreal, Austin..."
            disabled={loading}
            invalid={showValidation && missingCity}
            errorText="Required field"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          <span>
            Usage: {leadsUsed} / {leadLimit} enriched leads
          </span>
          {usageBlocked ? (
            <Link href="/plans" className="font-medium text-cyan-200 transition hover:text-white">
              Upgrade to Starter
            </Link>
          ) : null}
        </div>

        {validationMessage ? (
          <div className="text-sm text-red-400">{validationMessage}</div>
        ) : null}

        <div className="flex gap-4">
          <button
            onClick={runScrape}
            disabled={loading || hasMissingRequiredFields}
            className="btn-primary px-8 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Running...' : 'Run Lead Search'}
          </button>

          {loading ? (
            <button
              onClick={abortMission}
              className="rounded-xl border border-red-500/30 bg-red-500/20 px-6 py-3 text-red-400"
            >
              Abort Mission
            </button>
          ) : null}
        </div>

        <div className="space-y-6">
          <div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>Businesses found</span>
              <span>{displayedDiscovered} found</span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
                style={{ width: `${discoveryPercent}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>Contacts found</span>
              <span>{enriched} found</span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-green-500 transition-all duration-300"
                style={{ width: `${enrichmentPercent}%` }}
              />
            </div>
          </div>
        </div>

        {completionResult ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-5 py-4">
            <div className="text-lg font-semibold text-white">{normalizeSummaryLine(completionResult.summaryLine)}</div>
            {completionResult.detailLine ? (
              <div className="mt-1 text-sm text-emerald-100/80">{completionResult.detailLine}</div>
            ) : null}
            {completionResult.limitMessage ? (
              <div className="mt-3 text-sm text-amber-200">{completionResult.limitMessage}</div>
            ) : null}
          </div>
        ) : null}

        <div className="relative flex h-10 items-center overflow-hidden rounded-xl border border-white/10 bg-black/30">
          <div className="animate-marquee whitespace-nowrap px-4 font-mono text-sm text-emerald-300">
            {activity}
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-4">
          {logs.map((log, i) => (
            <div key={i} className="font-mono text-sm text-emerald-300">
              ▸ {log}
            </div>
          ))}
        </div>

        <div className="font-mono text-xs text-slate-400">
          ⏱ {formatTime(finalElapsed ?? elapsed)}
        </div>
      </div>
      </div>

      <ScrapeCompletionModal
        isOpen={showCompletionModal && Boolean(completionResult)}
        onClose={() => {
          requestInboxFocus()
          setShowCompletionModal(false)
          router.push('/dashboard/leads')
        }}
        summaryLine={completionResult?.summaryLine || ''}
        detailLine={completionResult?.detailLine || ''}
        addedLeads={completionResult?.addedLeads || []}
        viewerEmail={viewerEmail}
        onDownload={() => setToastMessage('Want a copy in your inbox?')}
        onEmailSent={(message) => setToastMessage(message)}
      />

      {toastMessage ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-white/10 bg-[#0b1220]/95 px-4 py-3 text-sm text-white shadow-[0_20px_50px_rgba(2,8,23,0.45)] backdrop-blur">
          {toastMessage}
        </div>
      ) : null}
    </>
  )
}
