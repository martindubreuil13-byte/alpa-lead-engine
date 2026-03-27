'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import GuestLeadCaptureModal from '@/components/trial/GuestLeadCaptureModal'
import {
  getGuestCaptureEmail,
  getGuestLeads,
  getOrCreateGuestSessionId,
  upsertGuestLead,
} from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'
import { FREE_TRIAL_LEAD_LIMIT, GUEST_LEADS_UPDATED_EVENT, type TrialLead } from '@/lib/trial'

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
  if (msg.includes('🎉 done')) return 'Prospecting mission complete.'
  if (msg.includes('⚠️ no leads found')) return 'No leads found. Try another query.'
  return null
}

function isHiddenSystemLog(msg: string) {
  return msg.includes('api cost estimate') || msg.includes('SCRAPER API COST')
}

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
  const [loading, setLoading] = useState(false)
  const [isGuest, setIsGuest] = useState(false)
  const [guestLeadCount, setGuestLeadCount] = useState(0)
  const [showPaywall, setShowPaywall] = useState(false)
  const [trialMessage, setTrialMessage] = useState('')

  const [businessType, setBusinessType] = useState('')
  const [country, setCountry] = useState('Canada')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState('25')

  const [logs, setLogs] = useState<string[]>([])
  const [discovered, setDiscovered] = useState(0)
  const [enriched, setEnriched] = useState(0)
  const [activity, setActivity] = useState('Idle')
  const [validationMessage, setValidationMessage] = useState('')
  const [showValidation, setShowValidation] = useState(false)

  const [elapsed, setElapsed] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const businessTypeRef = useRef<HTMLInputElement | null>(null)
  const cityRef = useRef<HTMLInputElement | null>(null)
  const previousGuestLeadCountRef = useRef(0)

  const requestedLeadCount = Number(maxLeads)
  const remainingGuestCapacity = Math.max(FREE_TRIAL_LEAD_LIMIT - guestLeadCount, 0)
  const max = isGuest
    ? remainingGuestCapacity > 0
      ? Math.min(requestedLeadCount, remainingGuestCapacity)
      : requestedLeadCount
    : requestedLeadCount
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

    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isGuest) return

    const syncGuestLeadCount = () => {
      setGuestLeadCount(getGuestLeads().length)
    }

    syncGuestLeadCount()
    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeadCount)

    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeadCount)
    }
  }, [isGuest])

  useEffect(() => {
    if (!isGuest) {
      previousGuestLeadCountRef.current = 0
      return
    }

    if (
      previousGuestLeadCountRef.current < FREE_TRIAL_LEAD_LIMIT &&
      guestLeadCount >= FREE_TRIAL_LEAD_LIMIT &&
      !getGuestCaptureEmail()
    ) {
      setTrialMessage("You've reached your free limit")
      setShowPaywall(true)
    }

    previousGuestLeadCountRef.current = guestLeadCount
  }, [guestLeadCount, isGuest])

  async function loadViewerMode() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const nextIsGuest = !user
    setIsGuest(nextIsGuest)
    setGuestLeadCount(nextIsGuest ? getGuestLeads().length : 0)
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
      if (isGuest && guestLeadCount >= FREE_TRIAL_LEAD_LIMIT) {
        setTrialMessage("You've reached your free limit")
        if (!getGuestCaptureEmail()) {
          setShowPaywall(true)
        }
        return
      }

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

      const guestRequestLimit = isGuest
        ? Math.min(requestedLeadCount, remainingGuestCapacity)
        : requestedLeadCount

      setLoading(true)
      setLogs([])
      setDiscovered(0)
      setEnriched(0)
      setElapsed(0)
      setFinalElapsed(null)
      setValidationMessage('')
      setShowValidation(false)
      setTrialMessage('')
      setActivity('Launching prospecting engines…')

      const payload = {
        query: businessType.trim(),
        region: region.trim(),
        defaultCity: city.trim(),
        country,
        maxLeads: guestRequestLimit,
        existingLeadCount: isGuest ? guestLeadCount : 0,
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

      const handleMessage = (msg: string) => {
        if (!msg || msg === '🟢 stream started') return
        if (isHiddenSystemLog(msg)) return

        setLogs((prev) => [...prev, msg])

        const translated = translateActivity(msg)
        if (translated) setActivity(translated)

        if (msg.includes('📥')) {
          setDiscovered((d) => Math.min(d + 1, max))
        }

        if (msg.includes('✨')) {
          setEnriched((e) => Math.min(e + 1, max))
        }

        if (msg.includes('🎉 done')) {
          finish('Prospecting mission complete.')
        }

        if (msg.includes("You've reached your free limit")) {
          setTrialMessage("You've reached your free limit")
          if (!getGuestCaptureEmail()) {
            setShowPaywall(true)
          }
        }

        if (
          msg.includes('❌ fatal') ||
          msg.includes('❌ invalid input') ||
          msg.includes('❌ missing authenticated user')
        ) {
          finish('Mission failed.')
        }
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
          } catch {
            handleMessage(payload)
          }
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

  const discoveryPercent = Math.min((discovered / max) * 100, 100)
  const enrichmentPercent = Math.min((enriched / max) * 100, 100)

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

      {trialMessage ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-4 text-amber-200">
          {trialMessage}
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
              <span>Business Discovery</span>
              <span>{discovered}/{max}</span>
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
              <span>Contact Intelligence</span>
              <span>{enriched}/{max}</span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-green-500 transition-all duration-300"
                style={{ width: `${enrichmentPercent}%` }}
              />
            </div>
          </div>
        </div>

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

      <GuestLeadCaptureModal
        isOpen={showPaywall}
        trigger="limit"
        onClose={() => setShowPaywall(false)}
      />
    </>
  )
}
