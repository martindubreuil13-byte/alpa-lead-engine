'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import EmailConfidenceBadge from '@/components/leads/EmailConfidenceBadge'

type Lead = {
  id: string
  company_name: string
  city: string | null
  email: string | null
  email_source: string | null
  email_confidence: 'high' | 'medium' | 'low' | null
  is_generic_email: boolean
  phone: string | null
  website: string | null
  status: string | null
  created_at: string
}

export default function LeadLibraryPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'inbox' | 'pipeline' | 'contacted'>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    setLoading(true)

    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      setLoading(false)
      return
    }

    setLeads(data || [])
    setLoading(false)
  }

  async function updateStatus(id: string, status: string) {
    const ids = [id]

    if (!ids.length) return

    console.log(ids)

    const { data, error } = await supabase
      .from('leads')
      .update({ status })
      .in('id', ids)

    console.log('Move result:', data)
    console.log('Move error:', error)

    if (error) {
      console.error('Move failed:', error.message)
      return
    }

    await fetchLeads()
    setSelectedLead(null)
  }

  async function deleteLead(id: string) {
    const ids = [id]

    if (!ids.length) return

    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)

    if (error) {
      console.error('Delete failed:', error.message)
      return
    }

    await fetchLeads()
    setSelectedLead(null)
  }

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return leads.filter((lead) => {
      const matchesFilter =
        filter === 'all' ? true : lead.status === filter

      if (!matchesFilter) return false

      if (!normalizedSearch) return true

      const haystack = [
        lead.company_name,
        lead.email,
        lead.phone,
        lead.city,
        lead.website,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [leads, filter, search])

  if (loading) {
    return <div className="text-slate-400">Loading leads...</div>
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-bold text-white">Lead Library</h1>
        <p className="text-slate-400 mt-2">
          All leads across your system — one source of truth
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-3 flex-wrap">
          {['all', 'inbox', 'pipeline', 'contacted'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-4 py-2 text-sm rounded-lg ${
                filter === f
                  ? 'bg-white/10 text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="w-full lg:w-96">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, email, phone, city, website..."
            className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/40"
          />
        </div>
      </div>

      {selectedLead && (
        <div className="glass p-6 rounded-xl border border-white/10">
          <div className="flex justify-between items-start gap-6 flex-col lg:flex-row">
            <div>
              <div className="text-xl font-bold text-white">
                {selectedLead.company_name}
              </div>

              <div className="text-sm text-slate-400 mt-1">
                {selectedLead.city || '-'}
              </div>

              <div className="mt-3 space-y-1 text-sm text-slate-300">
                <div>Email: {selectedLead.email || 'N/A'}</div>
                <div>Phone: {selectedLead.phone || 'N/A'}</div>
                <div>Website: {selectedLead.website || 'N/A'}</div>
                <div>Status: {selectedLead.status || 'N/A'}</div>
                <div>
                  Confidence: <EmailConfidenceBadge confidence={selectedLead.email_confidence} />
                </div>
                <div>Generic Email: {selectedLead.is_generic_email ? 'Yes' : 'No'}</div>
                <div>Email Source: {selectedLead.email_source || 'N/A'}</div>
              </div>

              {selectedLead.website && (
                <a
                  href={selectedLead.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-3 text-cyan-400 hover:underline text-sm"
                >
                  🌐 Visit Website
                </a>
              )}
            </div>

            <div className="flex flex-col gap-2 items-start lg:items-end">
              <button
                onClick={() => setSelectedLead(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✖ Close
              </button>

              <button
                onClick={() => updateStatus(selectedLead.id, 'pipeline')}
                className="px-3 py-1.5 text-xs rounded bg-blue-500/20 text-blue-300"
              >
                ➜ Move to Pipeline
              </button>

              <button
                onClick={() => updateStatus(selectedLead.id, 'contacted')}
                className="px-3 py-1.5 text-xs rounded bg-emerald-500/20 text-emerald-300"
              >
                ✔ Mark Contacted
              </button>

              <button
                onClick={() => deleteLead(selectedLead.id)}
                className="px-3 py-1.5 text-xs rounded bg-red-500/20 text-red-300"
              >
                🗑 Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {filteredLeads.length === 0 && (
          <div className="glass p-6 rounded-xl text-slate-400 text-sm">
            No leads found.
          </div>
        )}

        {filteredLeads.map((lead) => (
          <div
            key={lead.id}
            onClick={() => setSelectedLead(lead)}
            className="glass p-5 rounded-xl flex justify-between items-center cursor-pointer hover:bg-white/5"
          >
            <div>
              <div className="font-semibold text-white">
                {lead.company_name}
              </div>

              <div className="text-xs text-slate-400 mt-1">
                {lead.city || '-'}
              </div>

              <div className="text-xs mt-2 text-slate-300">
                {lead.email || 'No email'}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <EmailConfidenceBadge confidence={lead.email_confidence} />
                {lead.is_generic_email && (
                  <span className="inline-flex rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                    Generic
                  </span>
                )}
              </div>
            </div>

            <StatusBadge status={lead.status} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const base = 'px-3 py-1 text-xs rounded-full font-medium'

  if (status === 'pipeline') {
    return <span className={`${base} bg-blue-500/20 text-blue-300`}>Pipeline</span>
  }

  if (status === 'contacted') {
    return <span className={`${base} bg-emerald-500/20 text-emerald-300`}>Contacted</span>
  }

  return <span className={`${base} bg-slate-500/20 text-slate-300`}>Inbox</span>
}
