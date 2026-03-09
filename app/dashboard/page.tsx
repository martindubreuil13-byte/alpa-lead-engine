'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Page() {
  const [stats, setStats] = useState({
    total: 0,
    contactable: 0,
    newLeads: 0,
    outreach: 0,
    followups: 0,
  })

  const [pipeline, setPipeline] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchStats()
    fetchPipeline()
  }, [])

  async function fetchStats() {
    // TOTAL
    const { count: total } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })

    // CONTACTABLE (has email OR phone)
    const { data: contactableData } = await supabase
      .from('leads')
      .select('email, phone')

    const contactable =
      contactableData?.filter(l => l.email || l.phone).length || 0

    // NEW (not yet touched)
    const { count: newLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new')

    // IN OUTREACH
    const { count: outreach } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .in('status', ['contacted', 'in_discussion'])

    // FOLLOWUPS
    const { count: followups } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'followup_due')

    setStats({
      total: total || 0,
      contactable,
      newLeads: newLeads || 0,
      outreach: outreach || 0,
      followups: followups || 0,
    })
  }

  async function fetchPipeline() {
    const { data } = await supabase.from('leads').select('status')
    if (!data) return

    const counts: Record<string, number> = {}
    data.forEach(l => {
      const s = l.status || 'new'
      counts[s] = (counts[s] || 0) + 1
    })
    setPipeline(counts)
  }

  const outreachRate =
    stats.total > 0 ? Math.round((stats.outreach / stats.total) * 100) : 0

  const readinessRate =
    stats.total > 0 ? Math.round((stats.contactable / stats.total) * 100) : 0

  return (
    <div className="relative space-y-16">

      {/* Glow Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] bg-cyan-500/10 blur-[160px] rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-emerald-500/10 blur-[160px] rounded-full" />
      </div>

      {/* Header */}
      <div className="relative space-y-5">
        <h1 className="text-5xl font-bold tracking-tight leading-tight">
          <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-blue-500 bg-clip-text text-transparent">
            ALPA Command Center
          </span>
        </h1>

        <p className="text-slate-400 text-lg max-w-2xl">
          Your outreach operations at a glance.
        </p>
      </div>

      {/* METRICS */}
      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        <Metric title="Total Leads" value={stats.total} />
        <Metric title="Contactable Leads" value={stats.contactable} highlight />
        <Metric title="New Leads" value={stats.newLeads} />

        <Metric title="In Outreach" value={stats.outreach} />
        <Metric title="Follow-ups Due" value={stats.followups} highlight />
        <Metric title="Outreach Rate" value={`${outreachRate}%`} />

        <Metric title="Lead Readiness" value={`${readinessRate}%`} />
      </div>

      {/* PANELS */}
      <div className="grid gap-8 lg:grid-cols-2">
        <PipelinePanel pipeline={pipeline} />
        <RecentActivityPanel />
      </div>

    </div>
  )
}

/* ---------- METRIC CARD ---------- */

function Metric({ title, value, highlight }: any) {
  return (
    <div
      className={`relative glass p-8 rounded-2xl overflow-hidden group transition-all duration-300 hover:translate-y-[-4px] ${
        highlight ? 'ring-1 ring-emerald-400/40' : ''
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-500">
        {title}
      </div>

      <div className="text-5xl font-bold mt-4 text-white tracking-tight">
        {value}
      </div>

      <div className="absolute bottom-4 right-5 flex items-center gap-2 text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </div>
    </div>
  )
}

/* ---------- PIPELINE PANEL ---------- */

function PipelinePanel({ pipeline }: any) {
  const entries = Object.entries(pipeline)

  return (
    <div className="glass p-9 rounded-2xl">
      <h2 className="text-xl font-semibold text-white mb-6">
        Pipeline Snapshot
      </h2>

      <div className="space-y-4">
        {entries.length === 0 ? (
          <div className="text-slate-500 text-sm">No pipeline data yet</div>
        ) : (
          entries.map(([stage, count]: any) => (
            <div key={stage} className="flex justify-between">
              <span className="text-slate-300 capitalize">
                {stage.replace('_', ' ')}
              </span>
              <span className="text-white font-semibold">{count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ---------- RECENT ACTIVITY ---------- */

function RecentActivityPanel() {
  return (
    <div className="glass p-9 rounded-2xl">
      <h2 className="text-xl font-semibold text-white mb-4">
        Recent Activity
      </h2>

      <div className="text-slate-400 text-sm space-y-2">
        <p>• New lead imports will appear here</p>
        <p>• Outreach actions will be tracked</p>
        <p>• Pipeline movements will be logged</p>
      </div>
    </div>
  )
}