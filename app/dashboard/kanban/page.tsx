'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  industry: string
  city: string
  status: string
  created_at: string
}

const COLUMNS = [
  { key: 'new', title: 'New' },
  { key: 'ready', title: 'Ready' },
  { key: 'contacted', title: 'Contacted' },
  { key: 'follow_up', title: 'Follow-up Due' },
  { key: 'closed', title: 'Closed' },
]

export default function Page() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) setLeads(data)
    setLoading(false)
  }

  if (loading) {
    return <div className="text-slate-400">Loading pipeline...</div>
  }

  return (
    <div className="space-y-10">

      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Pipeline
        </h1>
        <p className="text-slate-400 mt-2">
          Track outreach progress across stages
        </p>
      </div>

      {/* Board */}
      <div className="grid gap-6 xl:grid-cols-5">
        {COLUMNS.map((col) => {
          const columnLeads = leads.filter(
            (l) => normalize(l.status) === col.key
          )

          return (
            <div key={col.key} className="glass p-5 space-y-4">

              {/* Column Header */}
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-white">
                  {col.title}
                </h2>
                <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-slate-300">
                  {columnLeads.length}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-4">
                {columnLeads.length === 0 && (
                  <div className="text-xs text-slate-500 italic">
                    No leads
                  </div>
                )}

                {columnLeads.map((lead) => (
                  <KanbanCard key={lead.id} lead={lead} />
                ))}
              </div>

            </div>
          )
        })}
      </div>
    </div>
  )
}

function KanbanCard({ lead }: { lead: Lead }) {
  return (
    <div className="glass p-4 hover:scale-[1.02] transition cursor-pointer">

      <div className="font-semibold text-white text-sm">
        {lead.company_name}
      </div>

      <div className="text-xs text-slate-400 mt-1">
        {lead.industry} • {lead.city}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          Added {timeAgo(lead.created_at)}
        </span>

        <span className={`text-[11px] px-2 py-1 rounded ${heatColor(lead.status)}`}>
          {heatLabel(lead.status)}
        </span>
      </div>

    </div>
  )
}

/* ---------- Helpers ---------- */

function normalize(status: string = '') {
  return status.toLowerCase().replace(/\s/g, '_')
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

function heatLabel(status: string) {
  const s = normalize(status)
  if (s === 'new') return 'Cold'
  if (s === 'ready') return 'Warm'
  if (s === 'contacted') return 'Hot'
  if (s === 'follow_up') return 'Active'
  return 'Closed'
}

function heatColor(status: string) {
  const s = normalize(status)
  if (s === 'new') return 'bg-slate-400/10 text-slate-300'
  if (s === 'ready') return 'bg-emerald-400/10 text-emerald-300'
  if (s === 'contacted') return 'bg-orange-400/10 text-orange-300'
  if (s === 'follow_up') return 'bg-cyan-400/10 text-cyan-300'
  return 'bg-purple-400/10 text-purple-300'
}