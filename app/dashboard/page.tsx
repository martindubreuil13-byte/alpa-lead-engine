'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Only ACTIVE pipeline stages
 */
const PIPELINE_STATUSES = ['pipeline', 'contacted', 'followup_due'] as const

type LeadStatusRow = {
  status: string | null
}

type Stats = {
  total: number
  inbox: number
}

export default function Page() {
  const [stats, setStats] = useState<Stats>({
    total: 0,
    inbox: 0,
  })

  const [pipelineBreakdown, setPipelineBreakdown] = useState<Record<string, number>>({})

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    await Promise.all([loadStats(), loadPipeline()])
  }

  /**
   * STATS
   */
  async function loadStats() {
    try {
      const { count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })

      const { data } = await supabase
        .from('leads')
        .select('status')

      const inbox = data?.filter(l => l.status === 'inbox').length || 0

      setStats({
        total: count || 0,
        inbox,
      })

    } catch (err) {
      console.error('Stats error:', err)
    }
  }

  /**
   * PIPELINE
   */
  async function loadPipeline() {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('status')
        .in('status', [...PIPELINE_STATUSES])

      if (error) throw error

      const counts: Record<string, number> = {}

      data?.forEach(row => {
        const key = row.status || 'pipeline'
        counts[key] = (counts[key] || 0) + 1
      })

      setPipelineBreakdown(counts)

    } catch (err) {
      console.error('Pipeline error:', err)
    }
  }

  /**
   * METRICS
   */
  const pipeline = pipelineBreakdown['pipeline'] || 0
  const contacted = pipelineBreakdown['contacted'] || 0
  const followups = pipelineBreakdown['followup_due'] || 0

  const activePipeline = pipeline + contacted + followups

  const contactRate =
    activePipeline > 0
      ? Math.round((contacted / activePipeline) * 100)
      : 0

  return (
    <div className="space-y-16">

      {/* HEADER */}
      <div className="space-y-4">
        <h1 className="text-5xl font-bold">
          <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-blue-500 bg-clip-text text-transparent">
            ALPA Command Center
          </span>
        </h1>

        <p className="text-slate-400">
          Your prospecting system at a glance.
        </p>
      </div>

      {/* METRICS */}
      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        <Metric title="Total Leads" value={stats.total} />
        <Metric title="Inbox" value={stats.inbox} highlight />

        <Metric title="Active Pipeline" value={activePipeline} />
        <Metric title="Contacted" value={contacted} />
        <Metric title="Follow-ups Due" value={followups} highlight />

        <Metric title="Contact Rate" value={`${contactRate}%`} />
      </div>

      {/* PANELS */}
      <div className="grid gap-8 lg:grid-cols-2">
        <PipelinePanel pipeline={pipelineBreakdown} />
        <SystemPanel />
      </div>

    </div>
  )
}

/**
 * METRIC CARD
 */
function Metric({ title, value, highlight }: any) {
  return (
    <div className={`glass p-8 rounded-2xl ${highlight ? 'ring-1 ring-emerald-400/40' : ''}`}>
      <div className="text-xs uppercase text-slate-500">{title}</div>
      <div className="text-5xl font-bold mt-4 text-white">{value}</div>
    </div>
  )
}

/**
 * PIPELINE PANEL
 */
function PipelinePanel({ pipeline }: any) {
  const order = ['pipeline', 'contacted', 'followup_due']

  return (
    <div className="glass p-9 rounded-2xl">
      <h2 className="text-xl font-semibold text-white mb-6">
        Pipeline Snapshot
      </h2>

      <div className="space-y-4">
        {order.map(key => (
          <div key={key} className="flex justify-between">
            <span className="text-slate-300 capitalize">
              {key.replace('_', ' ')}
            </span>
            <span className="text-white font-semibold">
              {pipeline[key] || 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * SYSTEM PANEL
 */
function SystemPanel() {
  return (
    <div className="glass p-9 rounded-2xl">
      <h2 className="text-xl font-semibold text-white mb-4">
        System Flow
      </h2>

      <div className="text-slate-400 text-sm space-y-2">
        <p>• Leads enter Inbox</p>
        <p>• Moved to Pipeline when ready</p>
        <p>• First contact sent</p>
        <p>• Follow-up triggered after delay</p>
        <p>• No response leads exit pipeline</p>
      </div>
    </div>
  )
}