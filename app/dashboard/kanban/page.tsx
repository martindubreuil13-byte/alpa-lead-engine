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

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([])
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

  if (loading) return <div className="text-slate-400">Loading pipeline...</div>

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-bold text-white">Pipeline</h1>
        <p className="text-slate-400 mt-2">
          Manage active outreach and deal flow
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        {STAGES.map(stage => {
          const stageLeads = leads.filter(l => (l.status || '') === stage.key)

          return (
            <div key={stage.key} className="glass p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-white">
                  {stage.title}
                </h2>
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
}: {
  lead: Lead
  moveLead: (id: string, status: string) => void
}) {
  return (
    <div className="glass p-4 space-y-4">
      <div>
        <div className="font-semibold text-white text-sm">
          {lead.company_name}
        </div>
        <div className="text-xs text-slate-400 mt-1">
          {lead.industry || 'Business'} • {lead.city}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MoveBtn
          label="Ready"
          onClick={() => moveLead(lead.id, 'pipeline')}
          color="blue"
        />

        <MoveBtn
          label="Contacted"
          onClick={() => moveLead(lead.id, 'contacted')}
          color="emerald"
        />

        <MoveBtn
          label="Follow-up"
          onClick={() => moveLead(lead.id, 'followup_due')}
          color="cyan"
        />

        <MoveBtn
          label="Not Interested"
          onClick={() => moveLead(lead.id, 'not_interested')}
          color="red"
        />
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
      className={`
        w-full
        h-9
        flex
        items-center
        justify-center
        rounded-lg
        text-xs
        font-semibold
        whitespace-nowrap
        transition
        ${styles[color]}
      `}
    >
      {label}
    </button>
  )
}