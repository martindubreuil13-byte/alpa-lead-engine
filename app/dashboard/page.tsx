'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Page() {
  const [stats, setStats] = useState({
    total: 0,
    inbox: 0,
    review: 0,
    pipeline: 0,
    contacted: 0,
    followups: 0,
  })

  const [pipelineBreakdown, setPipelineBreakdown] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchStats()
    fetchPipeline()
  }, [])

  async function fetchStats() {
    const { data } = await supabase
      .from('leads')
      .select('status')

    if (!data) return

    const total = data.length

    const inbox = data.filter(l =>
      !l.status || l.status === '' || l.status === 'new'
    ).length

    const review = data.filter(l =>
      l.status === 'enrich'
    ).length

    const pipeline = data.filter(l =>
      l.status === 'pipeline'
    ).length

    const contacted = data.filter(l =>
      l.status === 'contacted'
    ).length

    const followups = data.filter(l =>
      l.status === 'followup_due'
    ).length

    setStats({
      total,
      inbox,
      review,
      pipeline,
      contacted,
      followups,
    })
  }

  async function fetchPipeline() {
    const { data } = await supabase
      .from('leads')
      .select('status')
      .in('status', ['pipeline','contacted','followup_due','not_interested'])

    if (!data) return

    const counts: Record<string, number> = {}
    data.forEach(l => {
      const s = l.status || 'pipeline'
      counts[s] = (counts[s] || 0) + 1
    })
    setPipelineBreakdown(counts)
  }

  const contactRate =
    stats.pipeline > 0 ? Math.round((stats.contacted / stats.pipeline) * 100) : 0

  return (
    <div className="relative space-y-16">

      {/* HEADER */}
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
        <Metric title="Inbox" value={stats.inbox} highlight />
        <Metric title="Review Leads" value={stats.review} />

        <Metric title="Active Pipeline" value={stats.pipeline} />
        <Metric title="Contacted" value={stats.contacted} />
        <Metric title="Follow-ups Due" value={stats.followups} highlight />

        <Metric title="Pipeline Contact Rate" value={`${contactRate}%`} />
      </div>

      {/* PANELS */}
      <div className="grid gap-8 lg:grid-cols-2">
        <PipelinePanel pipeline={pipelineBreakdown} />
        <RecentActivityPanel />
      </div>

    </div>
  )
}

/* ---------- METRIC CARD ---------- */

function Metric({ title, value, highlight }: any) {
  return (
    <div className={`relative glass p-8 rounded-2xl overflow-hidden ${
      highlight ? 'ring-1 ring-emerald-400/40' : ''
    }`}>
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
          <div className="text-slate-500 text-sm">No pipeline activity yet</div>
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
        <p>• New leads appear in Inbox</p>
        <p>• Review Leads are saved for later</p>
        <p>• Pipeline tracks active outreach</p>
      </div>
    </div>
  )
}