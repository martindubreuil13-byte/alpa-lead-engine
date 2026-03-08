'use client'

import { useState } from 'react'

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

const LEAD_OPTIONS = ['10', '25', '50', '100']

export default function Page() {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [showSuccess, setShowSuccess] = useState(false)

  const [businessType, setBusinessType] = useState('restaurants')
  const [country, setCountry] = useState('Canada')
  const [region, setRegion] = useState('Quebec')
  const [city, setCity] = useState('Montreal')
  const [maxLeads, setMaxLeads] = useState('25')

  async function runScrape() {
    try {
      setLoading(true)
      setShowSuccess(false)
      setProgress(0)
      setLogs([])

      const startRes = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: businessType,
          region,
          defaultCity: city,
          country,
          maxLeads,
        }),
      })

      if (!startRes.ok) {
        throw new Error('Failed to start scraper')
      }

      setProgress(8)
      setLogs(['Initializing scraper...'])

      const startTime = Date.now()
      const eventSource = new EventSource('/api/scrape')

      eventSource.onmessage = (event) => {
        const msg = event.data as string
        if (!msg || msg === 'ℹ️ Scraper idle') return

        setLogs((prev) => [...prev, msg])

setProgress((prev) => {
  if (msg.includes('🎉 Scrape complete')) return 100
  if (msg.includes('❌')) return prev

  // Detect "(3/20)" pattern from backend logs
  const match = msg.match(/\((\d+)\/(\d+)\)/)
  if (match) {
    const current = Number(match[1])
    const total = Number(match[2])
    return Math.min(100, Math.round((current / total) * 100))
  }

  return prev
})

        if (msg.includes('🎉 Scrape complete')) {
          eventSource.close()
          setLoading(false)
          setShowSuccess(true)
          setLogs((prev) => [
            ...prev,
            `⏱ Completed in ${formatElapsed(Date.now() - startTime)}`,
          ])
          setTimeout(() => setProgress(0), 1200)
        }

        if (msg.includes('❌')) {
          eventSource.close()
          setLoading(false)
        }
      }

      eventSource.onerror = () => {
        eventSource.close()
        setLoading(false)
        setLogs((prev) => [...prev, '❌ Connection lost'])
      }
    } catch {
      setLoading(false)
      setLogs((prev) => [...prev, '❌ Scrape failed'])
    }
  }

  return (
    <div className="space-y-12">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
          Lead Search
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white mt-2">
          Scraper
        </h1>
        <p className="text-slate-400 mt-2">
          Search businesses by category and location, then enrich them for outreach.
        </p>
      </div>

      <div className="glass p-10 space-y-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-cyan-400/10 blur-3xl" />

        <div className="space-y-2 relative">
          <h2 className="text-2xl font-semibold text-white">Search Setup</h2>
          <p className="text-slate-400 text-sm">
            Keep the search specific. City-first targeting will usually produce cleaner leads.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 relative">
          <Input
            label="Type of business"
            value={businessType}
            onChange={setBusinessType}
            placeholder="marketing agency"
          />

          <Select
            label="Number of leads"
            options={LEAD_OPTIONS}
            value={maxLeads}
            onChange={setMaxLeads}
          />

          <Select
            label="Country"
            options={COUNTRY_OPTIONS}
            value={country}
            onChange={setCountry}
          />

          <Input
            label="Province / State"
            value={region}
            onChange={setRegion}
            placeholder="Quebec"
          />

          <Input
            label="City"
            value={city}
            onChange={setCity}
            placeholder="Montreal"
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 mb-2">
            Search Preview
          </div>
          <div className="text-sm text-slate-300">
            {buildSearchPreview(businessType, city, region, country)}
          </div>
        </div>

        <div className="flex gap-5 pt-2 relative">
          <button
            onClick={runScrape}
            disabled={loading}
            className="btn-primary px-8 py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-cyan-500/20"
          >
            {loading ? 'Searching leads…' : 'Run Lead Search'}
          </button>
        </div>

        {(loading || logs.length > 0) && (
          <div className="space-y-5 pt-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Live search progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-white/8 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="bg-black/30 border border-white/10 rounded-2xl p-5 max-h-64 overflow-y-auto shadow-inner shadow-black/20">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Live scraper activity
                </div>
                <div className="text-xs text-slate-500">
                  {loading ? 'Running' : 'Finished'}
                </div>
              </div>

              <div className="space-y-2 font-mono text-sm">
                {logs.length === 0 ? (
                  <div className="text-slate-500">Waiting to start…</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="text-emerald-300/90 break-words">
                      ▸ {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-4">
          <div className="glass w-full max-w-lg rounded-3xl border border-white/10 p-8 md:p-10 shadow-2xl shadow-black/30">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              </div>

              <div className="flex-1 space-y-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Lead generation finished
                </div>

                <div className="text-2xl font-semibold text-white">
                  New leads are ready for review
                </div>

                <div className="text-slate-400 leading-6">
                  Your search completed successfully. Review the imported leads,
                  check contact readiness, and move the best ones into outreach.
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                onClick={() => setShowSuccess(false)}
                className="px-5 py-3 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 transition"
              >
                Stay here
              </button>

              <a
                href="/dashboard/leads"
                className="btn-primary px-6 py-3 text-center"
              >
                View Leads
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildSearchPreview(
  businessType: string,
  city: string,
  region: string,
  country: string
) {
  const cleanBusiness = businessType.trim() || 'businesses'
  const parts = [city.trim(), region.trim(), country.trim()].filter(Boolean)
  return `${cleanBusiness} in ${parts.join(', ')}`
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

function Input({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-3">
      <label className="text-sm text-slate-400">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#0b1220] border border-white/10 rounded-xl px-5 py-3 text-slate-100 placeholder:text-slate-500 caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400/40 shadow-inner shadow-black/30 transition-all"
      />
    </div>
  )
}

function Select({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-3">
      <label className="text-sm text-slate-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#0b1220] border border-white/10 rounded-xl px-5 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-400/40 shadow-inner shadow-black/30 transition-all"
      >
        {options.map((o: string) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}