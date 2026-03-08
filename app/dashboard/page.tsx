'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Page() {
  const [stats, setStats] = useState({
    total: 0,
    contacted: 0,
    followups: 0,
  })

  useEffect(() => {
    fetchStats()
  }, [])

  async function fetchStats() {
    const { count: total } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })

    const { count: contacted } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .in('status', ['contacted', 'in_discussion'])

    const { count: followups } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'followup_due')

    setStats({
      total: total || 0,
      contacted: contacted || 0,
      followups: followups || 0,
    })
  }

  return (
    <div className="relative space-y-16">
      
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] bg-cyan-500/10 blur-[160px] rounded-full" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-emerald-500/10 blur-[160px] rounded-full" />
      </div>

      <div className="relative space-y-5">
        <h1 className="text-5xl font-bold tracking-tight leading-tight">
          <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-blue-500 bg-clip-text text-transparent">
            ALPA Command Center
          </span>
        </h1>

        <p className="text-slate-400 text-lg max-w-2xl">
          Autonomous Lead Prospecting & Market Intelligence Operations
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <Metric title="Total Leads" value={stats.total} />
        <Metric title="Contacted" value={stats.contacted} />
        <Metric title="Follow-ups Due" value={stats.followups} highlight />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel
          title="Recent Activity"
          description="Live outreach actions, lead updates, and automation events will appear here."
        />
        <Panel
          title="Pipeline Snapshot"
          description="Real-time pipeline intelligence and stage distribution overview."
        />
      </div>

    </div>
  )
}

function Metric({ title, value, highlight }: any) {
  return (
    <div
      className={`relative glass p-8 rounded-2xl overflow-hidden group transition-all duration-300 hover:translate-y-[-4px] ${
        highlight ? 'ring-1 ring-emerald-400/40' : ''
      }`}
    >
      <div className="absolute -top-16 -right-16 w-52 h-52 bg-cyan-400/10 blur-3xl rounded-full opacity-60 group-hover:opacity-100 transition-opacity" />

      <div className="text-xs uppercase tracking-wider text-slate-500 relative">
        {title}
      </div>

      <div className="text-5xl font-bold mt-4 text-white tracking-tight relative">
        {value}
      </div>

      <div className="absolute bottom-4 right-5 flex items-center gap-2 text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </div>
    </div>
  )
}

function Panel({ title, description }: any) {
  return (
    <div className="glass p-9 rounded-2xl transition-all duration-300 hover:translate-y-[-4px] hover:shadow-xl hover:shadow-cyan-500/10">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-semibold text-white tracking-tight">
          {title}
        </h2>

        <span className="text-xs px-3 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">
          Module
        </span>
      </div>

      <p className="text-sm text-slate-400 leading-relaxed max-w-md">
        {description}
      </p>
    </div>
  )
}