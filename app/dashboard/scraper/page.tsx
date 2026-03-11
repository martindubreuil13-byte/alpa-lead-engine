'use client'

import { useEffect, useRef, useState } from 'react'

const COUNTRY_OPTIONS = [
  'Canada','United States','United Kingdom','France','Australia',
  'Germany','United Arab Emirates','Singapore','India','Mexico','Brazil','Other',
]

const LEAD_OPTIONS = ['10','25','50']

const MODE_OPTIONS = [
  { value: 'fast', label: '⚡ Fast (limited sources)' },
  { value: 'deep', label: '🧭 Slow (unlimited depth)' },
  { value: 'balanced', label: '💣 Balanced (Surprise Me)' },
]

export default function Page() {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])

  const [businessType, setBusinessType] = useState('restaurants')
  const [country, setCountry] = useState('Canada')
  const [region, setRegion] = useState('Quebec')
  const [city, setCity] = useState('Montreal')
  const [maxLeads, setMaxLeads] = useState('25')
  const [mode, setMode] = useState('balanced')

  // TIMER
  const [elapsed, setElapsed] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (loading) {
      setFinalElapsed(null)
      timerRef.current = setInterval(() => {
        setElapsed(e => e + 1)
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      if (elapsed > 0 && finalElapsed === null) setFinalElapsed(elapsed)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [loading])

  async function runScrape() {
    try {
      setLoading(true)
      setProgress(0)
      setLogs([])
      setElapsed(0)
      setFinalElapsed(null)

      const startRes = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: businessType,
          region,
          defaultCity: city,
          country,
          maxLeads,
          mode,
        }),
      })

      if (!startRes.ok) throw new Error()

      setLogs(['Initializing scraper...'])

      const eventSource = new EventSource('/api/scrape')

      eventSource.onmessage = (event) => {
        const msg = event.data as string
        if (!msg || msg === 'ℹ️ Scraper idle') return

        setLogs(prev => [...prev, msg])

        const match = msg.match(/\((\d+)\/(\d+)\)/)
        if (match) {
          const current = Number(match[1])
          const total = Number(match[2])
          setProgress(Math.min(100, Math.round((current / total) * 100)))
        }

        if (msg.includes('🎉 Scrape complete')) {
          eventSource.close()
          setLoading(false)
          setProgress(100)
        }

        if (msg.includes('❌')) {
          eventSource.close()
          setLoading(false)
        }
      }

      eventSource.onerror = () => {
        eventSource.close()
        setLoading(false)
        setLogs(prev => [...prev, '❌ Connection lost'])
      }
    } catch {
      setLoading(false)
      setLogs(prev => [...prev, '❌ Scrape failed'])
    }
  }

  return (
    <div className="space-y-12">

      {/* HEADER */}
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Lead Search</div>
        <h1 className="text-4xl font-bold text-white mt-2">Scraper</h1>
        <p className="text-slate-400 mt-2">Search businesses by category and location.</p>
      </div>

      <div className="glass p-10 space-y-10">

        {/* SEARCH SETUP */}
        <div className="grid md:grid-cols-2 gap-8">
          <Input label="Type of business" value={businessType} onChange={setBusinessType} placeholder="marketing agency" />
          <Select label="Number of leads" options={LEAD_OPTIONS} value={maxLeads} onChange={setMaxLeads} />
          <Select label="Country" options={COUNTRY_OPTIONS} value={country} onChange={setCountry} />
          <Input label="Province / State" value={region} onChange={setRegion} placeholder="Quebec" />
          <Input label="City" value={city} onChange={setCity} placeholder="Montreal" />
          <Select
            label="Prospecting Mode"
            options={MODE_OPTIONS.map(o => o.label)}
            value={MODE_OPTIONS.find(o => o.value === mode)?.label || ''}
            onChange={(v) => setMode(MODE_OPTIONS.find(o => o.label === v)?.value || 'balanced')}
          />
        </div>

        {/* MISSION TIMER PANEL */}
        {(loading || finalElapsed !== null) && (
          <div className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-[#0b1220] to-[#0e1628] p-4 shadow-lg shadow-cyan-500/10">
            <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-cyan-400/10 blur-2xl" />
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-400/70">
                Scraper Mission Timer
              </div>
              <div className={`text-xs font-semibold ${loading ? 'text-emerald-400' : 'text-slate-400'}`}>
                {loading ? 'RUNNING' : 'COMPLETED'}
              </div>
            </div>
            <div className="mt-3 font-mono text-2xl text-white tracking-wider">
              ⏱ {formatTime(finalElapsed ?? elapsed)}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {loading ? 'Scanning sources and enriching leads…' : 'Final execution time'}
            </div>
          </div>
        )}

        {/* RUN BUTTON */}
        <button onClick={runScrape} disabled={loading} className="btn-primary px-8 py-3">
          {loading ? 'Searching leads…' : 'Run Lead Search'}
        </button>

        {/* PROGRESS */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-2 bg-white/10 rounded">
            <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* LOGS */}
        <div className="bg-black/30 border border-white/10 rounded-xl p-4 max-h-64 overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="text-emerald-300 font-mono text-sm">▸ {log}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

function formatTime(s:number){
  const m=Math.floor(s/60);const r=s%60
  return m?`${m}m ${r}s`:`${r}s`
}

function Input({label,placeholder,value,onChange}:{label:string,placeholder:string,value:string,onChange:(v:string)=>void}){
  return(
    <div className="space-y-2">
      <label className="text-sm text-slate-400">{label}</label>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-[#0b1220] border border-white/10 rounded-xl px-4 py-2 text-white"/>
    </div>
  )
}

function Select({label,options,value,onChange}:{label:string,options:string[],value:string,onChange:(v:string)=>void}){
  return(
    <div className="space-y-2">
      <label className="text-sm text-slate-400">{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        className="w-full bg-[#0b1220] border border-white/10 rounded-xl px-4 py-2 text-white">
        {options.map(o=><option key={o}>{o}</option>)}
      </select>
    </div>
  )
}