'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  city: string
  email: string | null
  phone: string | null
  status: string | null
  created_at: string
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [filtered, setFiltered] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('all')

  useEffect(() => {
    fetchLeads()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [search, cityFilter, leads])

  /* ---------- FETCH ONLY NEW / UNASSIGNED LEADS ---------- */

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('*')
.not('status', 'in', '(pipeline,enrich,contacted,follow_up,closed,not_interested)')
      .order('created_at', { ascending: false })

    if (data) setLeads(data)
    setLoading(false)
  }

  /* ---------- FILTERING ---------- */

  function applyFilters() {
    let result = [...leads]

    if (search) {
      result = result.filter(l =>
        l.company_name.toLowerCase().includes(search.toLowerCase())
      )
    }

    if (cityFilter !== 'all') {
      result = result.filter(l => l.city === cityFilter)
    }

    setFiltered(result)
  }

  /* ---------- ACTIONS ---------- */

  async function moveToPipeline(id: string) {
    await supabase.from('leads').update({ status: 'pipeline' }).eq('id', id)
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  async function enrichLater(id: string) {
    await supabase.from('leads').update({ status: 'enrich' }).eq('id', id)
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  async function deleteLead(id: string) {
    await supabase.from('leads').delete().eq('id', id)
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  const cities = Array.from(new Set(leads.map(l => l.city))).sort()

  if (loading) return <div className="text-slate-400">Loading leads...</div>

  return (
    <div className="space-y-8">

      {/* HEADER */}
      <div>
        <h1 className="text-4xl font-bold text-white">Leads Inbox</h1>
        <p className="text-slate-400 mt-2">
          New leads waiting to be reviewed and assigned
        </p>
      </div>

      {/* FILTER BAR */}
      <div className="glass p-5 rounded-xl flex flex-wrap gap-4 items-center">

        <input
          placeholder="Search company..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm
                     text-slate-200 placeholder:text-slate-500
                     focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />

        <select
          value={cityFilter}
          onChange={e => setCityFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm
                     text-slate-200 focus:outline-none"
        >
          <option value="all">All Cities</option>
          {cities.map(c => <option key={c}>{c}</option>)}
        </select>

        <div className="text-sm text-slate-400 ml-auto">
          {filtered.length} new leads
        </div>
      </div>

      {/* EMPTY STATE */}
      {filtered.length === 0 && (
        <div className="glass p-12 rounded-xl text-center text-slate-400">
          Inbox clear 🎉 <br />
          <span className="text-sm">All leads have been processed</span>
        </div>
      )}

      {/* LEADS LIST */}
      <div className="space-y-4">
        {filtered.map(lead => (
          <div key={lead.id} className="glass p-5 rounded-xl flex justify-between items-center">

            <div>
              <div className="font-semibold text-white">
                {lead.company_name}
              </div>

              <div className="text-xs text-slate-400 mt-1">
                {lead.city}
                {' • '}
                {lead.email ? lead.email : 'No Email'}
                {' • '}
                {lead.phone ? lead.phone : 'No Phone'}
              </div>
            </div>

            <div className="flex gap-2">

              <button
                onClick={() => moveToPipeline(lead.id)}
                className="px-3 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              >
                ✅ Move to Pipeline
              </button>

              <button
                onClick={() => enrichLater(lead.id)}
                className="px-3 py-1.5 text-xs rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
              >
                🟡 Enrich Later
              </button>

              <button
                onClick={() => deleteLead(lead.id)}
                className="px-3 py-1.5 text-xs rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"
              >
                ❌ Delete
              </button>

            </div>
          </div>
        ))}
      </div>

    </div>
  )
}