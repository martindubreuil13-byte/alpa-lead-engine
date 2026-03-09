'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  city: string
  industry: string | null
  email: string | null
  phone: string | null
  status: string | null
}

export default function EnrichPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'enrich')
      .order('created_at', { ascending: false })

    if (data) setLeads(data)
    setLoading(false)
  }

  async function moveToPipeline(id: string) {
    await supabase.from('leads').update({ status: 'pipeline' }).eq('id', id)
    fetchLeads()
  }

  async function deleteLead(id: string) {
    await supabase.from('leads').delete().eq('id', id)
    fetchLeads()
  }

  async function retryEnrich(lead: Lead) {
    await fetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lead.id }),
    })

    fetchLeads()
  }

  if (loading) return <div className="text-slate-400">Loading enrichment queue...</div>

  const total = leads.length
  const missingEmail = leads.filter(l => !l.email).length
  const missingPhone = leads.filter(l => !l.phone).length

  return (
    <div className="space-y-10">

      {/* HEADER */}
      <div>
        <h1 className="text-4xl font-bold text-white">Enrichment Center</h1>
        <p className="text-slate-400 mt-2">
          Improve lead data before moving them to outreach
        </p>
      </div>

      {/* STATS */}
      <div className="grid gap-6 md:grid-cols-3">
        <Stat title="Waiting for Enrichment" value={total} />
        <Stat title="Missing Email" value={missingEmail} />
        <Stat title="Missing Phone" value={missingPhone} />
      </div>

      {/* LEADS */}
      <div className="space-y-5">
        {leads.length === 0 && (
          <div className="glass p-6 rounded-xl text-slate-400 text-sm">
            No leads waiting for enrichment 🎉
          </div>
        )}

        {leads.map(lead => (
          <div key={lead.id} className="glass p-6 rounded-xl flex justify-between items-center">

            <div>
              <div className="font-semibold text-white">
                {lead.company_name}
              </div>

              <div className="text-xs text-slate-400 mt-1">
                {lead.city} • {lead.industry || 'Unknown industry'}
              </div>

              <div className="mt-3 text-xs space-y-1">
                <div className={lead.email ? 'text-emerald-400' : 'text-red-400'}>
                  Email: {lead.email || 'Missing'}
                </div>
                <div className={lead.phone ? 'text-emerald-400' : 'text-red-400'}>
                  Phone: {lead.phone || 'Missing'}
                </div>
              </div>
            </div>

            <div className="flex gap-2">

              <button
                onClick={() => retryEnrich(lead)}
                className="px-3 py-1.5 text-xs rounded bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
              >
                🔄 Re-Enrich
              </button>

              <button
                onClick={() => moveToPipeline(lead.id)}
                className="px-3 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              >
                ✅ Pipeline
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

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <div className="glass p-6 rounded-xl">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <div className="text-3xl font-bold text-white mt-2">
        {value}
      </div>
    </div>
  )
}