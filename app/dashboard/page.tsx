'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const PIPELINE_STATUSES = [
  'pipeline',
  'contacted',
  'followup_due',
] as const

const PAGE_SIZE = 1000

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
    fetchDashboardData()
  }, [])

  async function fetchDashboardData() {
    await Promise.all([fetchStats(), fetchPipeline()])
  }

  async function fetchAllLeadStatuses(): Promise<LeadStatusRow[]> {
    const allRows: LeadStatusRow[] = []
    let from = 0

    while (true) {
      const to = from + PAGE_SIZE - 1

      const { data, error } = await supabase
        .from('leads')
        .select('status')
        .range(from, to)

      if (error) throw error

      if (!data || data.length === 0) break

      allRows.push(...data)

      if (data.length < PAGE_SIZE) break

      from += PAGE_SIZE
    }

    return allRows
  }

  async function fetchStats() {
    try {
      const [totalRes, allStatuses] = await Promise.all([
        supabase.from('leads').select('*', { count: 'exact', head: true }),
        fetchAllLeadStatuses(),
      ])

      const total = totalRes.count || 0

      const inbox = allStatuses.filter(l => l.status === 'inbox').length

      setStats({
        total,
        inbox,
      })

    } catch (err) {
      console.error('fetchStats error:', err)
    }
  }

  async function fetchPipeline() {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('status')
        .in('status', [...PIPELINE_STATUSES])

      if (error) {
        console.error('fetchPipeline error:', error)
        return
      }

      const counts: Record<string, number> = {}

      data?.forEach(row => {
        const status = row.status || 'pipeline'
        counts[status] = (counts[status] || 0) + 1
      })

      setPipelineBreakdown(counts)

    } catch (err) {
      console.error('fetchPipeline error:', err)
    }
  }

  const activePipeline =
    (pipelineBreakdown['pipeline'] || 0) +
    (pipelineBreakdown['contacted'] || 0) +
    (pipelineBreakdown['followup_due'] || 0)

  const contacted = pipelineBreakdown['contacted'] || 0
  const followups = pipelineBreakdown['followup_due'] || 0

  const contactRate =
    activePipeline > 0
      ? Math.round((contacted / activePipeline) * 100)
      : 0

  return (
    <div className="relative space-y-16">
      <div className="relative space-y-5">
        <h1 className="text-5xl font-bold tracking-tight leading-tight">
          <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-blue-500 bg-clip-text text-transparent">
            ALPA Command Center
          </span>
        </h1>

        <p className="text-slate-400 text-lg max-w-2xl">
          Your outreach engine in motion.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        <Metric title="Total Leads" value={stats.total} />
        <Metric title="Inbox" value={stats.inbox} highlight />

        <Metric title="Active Pipeline" value={activePipeline} />
        <Metric title="Contacted" value={contacted} />
        <Metric title="Follow-ups Due" value={followups} highlight />

        <Metric title="Contact Rate" value={`${contactRate}%`} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <PipelinePanel pipeline={pipelineBreakdown} />
        <RecentActivityPanel />
      </div>
    </div>
  )
}

function Metric({ title, value, highlight }: any) {
  return (
    <div className={`glass p-8 rounded-2xl ${highlight ? 'ring-1 ring-emerald-400/40' : ''}`}>
      <div className="text-xs uppercase text-slate-500">{title}</div>
      <div className="text-5xl font-bold mt-4 text-white">{value}</div>
    </div>
  )
}

function PipelinePanel({ pipeline }: any) {
  const order = ['pipeline', 'contacted', 'followup_due']

  const entries = order
    .filter(key => pipeline[key] > 0)
    .map(key => [key, pipeline[key]])

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

function RecentActivityPanel() {
  return (
    <div className="glass p-9 rounded-2xl">
      <h2 className="text-xl font-semibold text-white mb-4">
        System Logic
      </h2>

      <div className="text-slate-400 text-sm space-y-2">
        <p>• Leads enter Inbox</p>
        <p>• Move to Pipeline when ready</p>
        <p>• Follow-ups are triggered after delay</p>
        <p>• Non-responses exit pipeline automatically</p>
      </div>
    </div>
  )
}