'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  city: string
  industry: string | null
  status: string | null
}

const STAGES = [
  { key: 'pipeline', title: 'Ready to Contact' },
  { key: 'contacted', title: 'Contacted' },
  { key: 'followup_due', title: 'Follow-up Due' },
  { key: 'not_interested', title: 'Not Interested' },
]

export default function KanbanPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('id, company_name, city, industry, status')

    if (data) setLeads(data)
    setLoading(false)
  }

  async function moveLead(id: string, newStatus: string) {
    await supabase.from('leads').update({ status: newStatus }).eq('id', id)
    fetchLeads()
  }

  function toggleSelect(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function clearSelection() {
    setSelected([])
  }

  function toggleColumn(leadsInColumn: Lead[], checked: boolean) {
    const ids = leadsInColumn.map(l => l.id)
    if (checked) {
      setSelected(prev => Array.from(new Set([...prev, ...ids])))
    } else {
      setSelected(prev => prev.filter(id => !ids.includes(id)))
    }
  }

  if (loading) return <div className="text-slate-400">Loading pipeline...</div>

  return (
    <div className="space-y-10">

      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-white">Kanban</h1>
        <p className="text-slate-400 mt-2">
          Manage active outreach and deal flow
        </p>
      </div>

      {/* Batch Toolbar */}
      <div className="glass p-4 flex items-center justify-between">
        <div className="text-sm text-white">
          {selected.length} selected
        </div>

        <div className="flex gap-3">
          <button
            disabled={selected.length === 0}
            className={`px-4 py-2 rounded-lg transition ${
              selected.length === 0
                ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
            }`}
          >
            📧 Send Email
          </button>

          <button
            onClick={clearSelection}
            disabled={selected.length === 0}
            className={`px-4 py-2 rounded-lg transition ${
              selected.length === 0
                ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                : 'bg-white/10 text-slate-300 hover:bg-white/20'
            }`}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Columns */}
      <div className="grid gap-6 xl:grid-cols-4">
        {STAGES.map(stage => {
          const stageLeads = leads.filter(l => (l.status || '') === stage.key)
          const allSelected =
            stageLeads.length > 0 &&
            stageLeads.every(l => selected.includes(l.id))

          return (
            <div key={stage.key} className="glass p-5 space-y-4">
              
              {/* Column Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleColumn(stageLeads, e.target.checked)}
                  />
                  <h2 className="font-semibold text-white">{stage.title}</h2>
                </div>

                <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-slate-300">
                  {stageLeads.length}
                </span>
              </div>

              {/* Leads */}
              <div className="space-y-4">
                {stageLeads.length === 0 && (
                  <div className="text-xs text-slate-500 italic">No leads</div>
                )}

                {stageLeads.map(lead => (
                  <Card
                    key={lead.id}
                    lead={lead}
                    moveLead={moveLead}
                    selected={selected.includes(lead.id)}
                    toggleSelect={toggleSelect}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Card({
  lead,
  moveLead,
  selected,
  toggleSelect,
}: {
  lead: Lead
  moveLead: (id: string, status: string) => void
  selected: boolean
  toggleSelect: (id: string) => void
}) {
  return (
    <div className={`glass p-4 space-y-4 border ${selected ? 'border-blue-400/40' : 'border-white/5'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggleSelect(lead.id)}
          className="mt-1"
        />

        <div>
          <div className="font-semibold text-white text-sm">
            {lead.company_name}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {lead.industry || 'Business'} • {lead.city}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MoveBtn label="Ready" onClick={() => moveLead(lead.id, 'pipeline')} color="blue" />
        <MoveBtn label="Contacted" onClick={() => moveLead(lead.id, 'contacted')} color="emerald" />
        <MoveBtn label="Follow-up" onClick={() => moveLead(lead.id, 'followup_due')} color="cyan" />
        <MoveBtn label="Not Interested" onClick={() => moveLead(lead.id, 'not_interested')} color="red" />
      </div>
    </div>
  )
}

function MoveBtn({
  label,
  onClick,
  color,
}: {
  label: string
  onClick: () => void
  color: 'blue' | 'emerald' | 'cyan' | 'red'
}) {
  const styles = {
    blue: 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 ring-1 ring-blue-400/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 ring-1 ring-emerald-400/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 ring-1 ring-cyan-400/30',
    red: 'bg-red-500/15 text-red-300 hover:bg-red-500/25 ring-1 ring-red-400/30',
  }

  return (
    <button
      onClick={onClick}
      className={`w-full h-9 flex items-center justify-center rounded-lg text-xs font-semibold whitespace-nowrap transition ${styles[color]}`}
    >
      {label}
    </button>
  )
}