'use client'

import { useEffect, useRef, useState } from 'react'

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

type InputProps = {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

function Input({ label, placeholder, value, onChange, disabled = false }: InputProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-slate-400">{label}</label>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-white placeholder:text-slate-500 disabled:opacity-60"
      />
    </div>
  )
}

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

  const [businessType, setBusinessType] = useState('')
  const [country, setCountry] = useState('Canada')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [maxLeads, setMaxLeads] = useState('25')

  const [logs, setLogs] = useState<string[]>([])
  const [discovered, setDiscovered] = useState(0)
  const [enriched, setEnriched] = useState(0)
  const [activity, setActivity] = useState('Idle')

  const [elapsed, setElapsed] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const max = Number(maxLeads)

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
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  function finish(customActivity?: string) {
    if (abortRef.current) {
      abortRef.current = null
    }

    setLoading(false)
    if (customActivity) setActivity(customActivity)
  }

  async function runScrape() {
    try {
      if (!businessType.trim() || !city.trim()) {
        setLogs(['❌ Please enter both business type and city'])
        setActivity('Missing required fields.')
        return
      }

      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }

      setLoading(true)
      setLogs([])
      setDiscovered(0)
      setEnriched(0)
      setElapsed(0)
      setFinalElapsed(null)
      setActivity('Launching prospecting engines…')

      const payload = {
        query: businessType.trim(),
        region: region.trim(),
        defaultCity: city.trim(),
        country,
        maxLeads: Number(maxLeads),
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

        if (
          msg.includes('❌ fatal') ||
          msg.includes('❌ invalid input') ||
          msg.includes('❌ missing authenticated user')
        ) {
          finish('Mission failed.')
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
            handleMessage(line.slice(5).trimStart())
          }
        }
      }

      buffer += decoder.decode()

      if (buffer.trim()) {
        const lines = buffer.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          handleMessage(line.slice(5).trimStart())
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
    <div className="space-y-12">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
          Prospecting System
        </div>
        <h1 className="mt-2 text-4xl font-bold text-white">Prospector Engine</h1>
        <p className="mt-2 text-slate-400">
          Discover and enrich businesses by category and location.
        </p>
      </div>

      <div className="glass space-y-10 p-10">
        <div className="grid gap-8 md:grid-cols-2">
          <Input
            label="Type of business"
            value={businessType}
            onChange={setBusinessType}
            placeholder="plumber, florist, dentist..."
            disabled={loading}
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
            label="City"
            value={city}
            onChange={setCity}
            placeholder="Montreal, Austin..."
            disabled={loading}
          />
        </div>

        <div className="flex gap-4">
          <button
            onClick={runScrape}
            disabled={loading}
            className="btn-primary px-8 py-3 disabled:opacity-60"
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
  )
}
