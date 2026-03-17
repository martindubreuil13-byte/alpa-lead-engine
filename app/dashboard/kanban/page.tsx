'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import SendCampaignModal from '@/components/email/SendCampaignModal'

type Lead = {
  id: string
  company_name: string
  city: string
  industry: string | null
  status: string
  contacted_at?: string | null
}

const STAGES = [
  { key: 'pipeline', title: 'Ready to Contact' },
  { key: 'contacted', title: 'Contacted' },
  { key: 'followup_due', title: 'Follow-up Due' },
]

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [isSendModalOpen, setIsSendModalOpen] = useState(false)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    setLoading(true)

    const { data, error } = await supabase
      .from('leads')
      .select('id, company_name, city, industry, status, contacted_at')
      .in('status', ['pipeline', 'contacted', 'followup_due'])

    if (error) {
      console.error('Error fetching leads:', error)
      setLoading(false)
      return
    }

    setLeads(data || [])
    setLoading(false)
  }

  async function moveLead(id: string, newStatus: string) {
    const payload: any = {
      status: newStatus,
      status_updated_at: new Date().toISOString(),
    }

    if (newStatus === 'contacted') {
      payload.contacted_at = new Date().toISOString()
    }

    if (newStatus === 'followup_sent') {
      payload.followup_sent_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', id)

    if (error) {
      console.error('Error updating lead:', error)
      return
    }

    // optimistic update
    setLeads(prev =>
      prev
        .map(l => (l.id === id ? { ...l, ...payload } : l))
        .filter(l => ['pipeline', 'contacted', 'followup_due'].includes(l.status))
    )
  }

  async function batchMarkContacted(ids: string[]) {
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('leads')
      .update({
        status: 'contacted',
        contacted_at: now,
        status_updated_at: now,
      })
      .in('id', ids)

    if (error) {
      console.error('Batch update failed:', error)
      return
    }

    // optimistic update
    setLeads(prev =>
      prev.map(l =>
        ids.includes(l.id)
          ? { ...l, status: 'contacted', contacted_at: now }
          : l
      )
    )

    setSelected([])
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

  return (
    <>
      <div className="space-y-10">

        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-white">Pipeline</h1>
          <p className="text-slate-400 mt-2">
            Execute outreach and manage active leads
          </p>
        </div>

        {/* Batch Toolbar */}
        <div className="glass p-4 flex items-center justify-between">
          <div className="text-sm text-white">
            {selected.length} selected
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsSendModalOpen(true)}
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

        {/* Loading */}
        {loading && (
          <div className="text-slate-400">Loading pipeline...</div>
        )}

        {/* Columns */}
        {!loading && (
          <div className="grid gap-6 xl:grid-cols-3">
            {STAGES.map(stage => {
              const stageLeads = leads.filter(l => l.status === stage.key)

              const allSelected =
                stageLeads.length > 0 &&
                stageLeads.every(l => selected.includes(l.id))

              return (
                <div key={stage.key} className="glass p-5 space-y-4">

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) =>
                          toggleColumn(stageLeads, e.target.checked)
                        }
                      />
                      <h2 className="font-semibold text-white">
                        {stage.title}
                      </h2>
                    </div>

                    <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-slate-300">
                      {stageLeads.length}
                    </span>
                  </div>

                  <div className="space-y-4">
                    {stageLeads.length === 0 && (
                      <div className="text-xs text-slate-500 italic">
                        No leads
                      </div>
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
        )}
      </div>

      {/* Email Modal */}
      <SendCampaignModal
        isOpen={isSendModalOpen}
        onClose={() => setIsSendModalOpen(false)}
        selectedIds={selected}
        onSent={() => batchMarkContacted(selected)}
      />
    </>
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
    <div className={`glass p-4 space-y-4 border ${
      selected ? 'border-blue-400/40' : 'border-white/5'
    }`}>

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
        <MoveBtn label="Follow-up" onClick={() => moveLead(lead.id, 'followup_due')} color="cyan" />
        <MoveBtn label="Reject" onClick={() => moveLead(lead.id, 'rejected')} color="red" />
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
  color: 'cyan' | 'red'
}) {
  const styles = {
    cyan: 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 ring-1 ring-cyan-400/30',
    red: 'bg-red-500/15 text-red-300 hover:bg-red-500/25 ring-1 ring-red-400/30',
  }

  return (
    <button
      onClick={onClick}
      className={`w-full h-9 flex items-center justify-center rounded-lg text-xs font-semibold transition ${styles[color]}`}
    >
      {label}
    </button>
  )
}