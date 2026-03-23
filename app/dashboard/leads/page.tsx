'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  user_id: string
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
  const [selected, setSelected] = useState<string[]>([])

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
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

    console.log('Current user:', userData)
    console.log('Current user error:', userError)
    console.log('Current session:', sessionData)
    console.log('Current session error:', sessionError)

    const { data: leadSample, error: leadSampleError } = await supabase
      .from('leads')
      .select('id, user_id, status, company_name')
      .eq('status', 'inbox')
      .limit(1)

    console.log('Lead sample:', leadSample)
    console.log('Lead sample error:', leadSampleError)

    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'inbox')
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

  async function moveToPipeline(ids: string[]) {
    if (ids.length === 0) return

    const { data: userData, error: userError } = await supabase.auth.getUser()
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    const selectedLeads = leads
      .filter(lead => ids.includes(lead.id))
      .map(lead => ({
        id: lead.id,
        user_id: lead.user_id,
        status: lead.status,
      }))

    console.log(ids)
    console.log('Current user:', userData)
    console.log('Current user error:', userError)
    console.log('Current session:', sessionData)
    console.log('Current session error:', sessionError)
    console.log('Selected leads before update:', selectedLeads)
    console.log('auth.uid vs lead.user_id:', {
      authUid: userData.user?.id ?? null,
      leadUserIds: selectedLeads.map(lead => lead.user_id),
    })

    const { data, error } = await supabase
      .from('leads')
      .update({ status: 'pipeline' })
      .select('id, user_id, status')
      .in('id', ids)

    console.log('Move result:', data)
    console.log('Move error:', error)

    if (error) {
      console.error('Move failed:', error.message)
      return
    }

    setLeads(prev => prev.filter(l => !ids.includes(l.id)))
    setSelected(prev => prev.filter(id => !ids.includes(id)))
  }

  async function deleteLeads(ids: string[]) {
    if (!ids.length) return

    console.log('Deleting leads:', ids)

    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)

    console.log('Delete error:', error)

    if (error) {
      console.error('Delete failed:', error.message)
      return
    }

    setLeads(prev => prev.filter(l => !ids.includes(l.id)))
    setSelected(prev => prev.filter(id => !ids.includes(id)))
  }

  function toggleSelect(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelected(filtered.map(lead => lead.id))
      return
    }

    setSelected([])
  }

  const cities = Array.from(new Set(leads.map(l => l.city))).sort()
  const allFilteredSelected =
    filtered.length > 0 && filtered.every(lead => selected.includes(lead.id))

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
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={e => toggleSelectAll(e.target.checked)}
          />
          Select all
        </label>

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

      <div className="glass p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-300">
          {selected.length} selected
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => moveToPipeline(selected)}
            disabled={selected.length === 0}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              selected.length === 0
                ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
            }`}
          >
            Move to Pipeline
          </button>

          <button
            onClick={() => deleteLeads(selected)}
            disabled={selected.length === 0}
            className={`px-4 py-2 text-sm rounded-lg transition ${
              selected.length === 0
                ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
            }`}
          >
            Delete
          </button>
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
          <div key={lead.id} className="glass p-5 rounded-xl">

            <label className="flex items-center gap-4 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(lead.id)}
                onChange={() => toggleSelect(lead.id)}
              />

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
            </label>
          </div>
        ))}
      </div>

    </div>
  )
}
