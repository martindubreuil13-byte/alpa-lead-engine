'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { isAdmin, isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { supabase } from '@/lib/supabase'
import { getGuestLeads } from '@/lib/guest-session'
import { readStoredScrapeResult } from '@/lib/session/scrape-result'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'

/**
 * Only ACTIVE pipeline stages
 */
const PIPELINE_STATUSES = ['pipeline', 'contacted', 'followup_due'] as const

type LeadStatusRow = {
  status: string | null
  email?: string | null
  phone?: string | null
}

type Stats = {
  saved: number
  inbox: number
  found: number
  ready: number
}

function hasContactDetails(lead: Pick<LeadStatusRow, 'email' | 'phone'>) {
  return Boolean(String(lead.email || '').trim() || String(lead.phone || '').trim())
}

export default function Page() {
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [stats, setStats] = useState<Stats>({
    saved: 0,
    inbox: 0,
    found: 0,
    ready: 0,
  })

  const [pipelineBreakdown, setPipelineBreakdown] = useState<Record<string, number>>({})
  const [isGuest, setIsGuest] = useState(false)

  useEffect(() => {
    loadDashboard()

    const refreshGuest = () => {
      loadGuestStats()
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, refreshGuest)
    }
  }, [])

  async function loadDashboard() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsGuest(true)
      loadGuestStats()
      return
    }

    setIsGuest(false)
    await Promise.all([loadStats(user.id), loadPipeline(user.id)])
  }

  function loadGuestStats() {
    const guestLeads = getGuestLeads()
    const inbox = guestLeads.filter((lead) => lead.status === 'inbox').length
    const storedScrapeResult = readStoredScrapeResult()
    const ready = guestLeads.filter((lead) => hasContactDetails(lead)).length

    setStats({
      saved: guestLeads.length,
      inbox,
      found: storedScrapeResult?.totalFoundLeads ?? guestLeads.length,
      ready,
    })

    const counts: Record<string, number> = {}
    guestLeads.forEach((lead) => {
      const key = lead.status || 'pipeline'
      counts[key] = (counts[key] || 0) + 1
    })
    setPipelineBreakdown(counts)
  }

  /**
   * STATS
   */
  async function loadStats(currentUserId: string) {
    try {
      const storedScrapeResult = readStoredScrapeResult()
      const { data } = await supabase
        .from('leads')
        .select('status, email, phone')
        .eq('user_id', currentUserId)

      const inbox = data?.filter((l) => l.status === 'inbox').length || 0
      const saved = data?.length || 0
      const ready = data?.filter((lead) => hasContactDetails(lead)).length || 0

      setStats({
        saved,
        inbox,
        found: storedScrapeResult?.totalFoundLeads ?? saved,
        ready,
      })

    } catch (err) {
      console.error('Stats error:', err)
    }
  }

  /**
   * PIPELINE
   */
  async function loadPipeline(currentUserId: string) {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('status')
        .eq('user_id', currentUserId)
        .in('status', [...PIPELINE_STATUSES])

      if (error) throw error

      const counts: Record<string, number> = {}

      data?.forEach((row) => {
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
  const isFreeViewer = isGuest || (!profileLoading && !isAdmin(profile) && !isPaid(profile))

  if (stats.saved === 0) {
    return (
      <div className="space-y-10">
        <div className="glass rounded-[28px] p-10">
          <h2 className="text-3xl font-semibold text-white">Start finding your first leads</h2>
          <p className="mt-4 text-slate-400">Run your first search and we&apos;ll bring the next step into focus.</p>
          <div className="mt-8">
            <Link
              href="/dashboard/scraper"
              className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.24)]"
            >
              Start Prospecting
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!isGuest && profileLoading) {
    return <div className="text-slate-400">Loading dashboard...</div>
  }

  if (isFreeViewer) {
    return (
      <div className="space-y-8">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(8,15,29,0.98))] p-10 shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
          <div className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
            Progress checkpoint
          </div>
          <h2 className="mt-5 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            You&apos;ve built your first lead list
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
            {stats.saved} {stats.saved === 1 ? 'lead is' : 'leads are'} now in your inbox. Some are ready to contact right now.
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard/leads"
              className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.24)]"
            >
              Go to my leads
            </Link>
          </div>
          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="text-base text-slate-300">Want to contact, track, and follow up from one place?</p>
            <div className="mt-4">
              <Link
                href="/plans"
                className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
              >
                Unlock outreach
              </Link>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="Leads found"
            value={stats.saved}
            caption="Leads in this session"
          />
          <SummaryCard
            title="Ready to contact"
            value={stats.ready}
            caption="Include email or phone"
          />
          <SummaryCard
            title="Next step"
            value="Review leads"
            caption="Start with the strongest opportunities"
          />
        </div>
      </div>
    )
  }

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
          {isGuest ? 'Your free trial workspace at a glance.' : 'Your prospecting system at a glance.'}
        </p>
      </div>

      {/* METRICS */}
      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        <Metric title="Found Leads" value={stats.found} />
        <Metric title="Saved Leads" value={stats.saved} />
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

function SummaryCard({
  title,
  value,
  caption,
}: {
  title: string
  value: number | string
  caption: string
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-6 shadow-[0_18px_40px_rgba(2,8,23,0.18)]">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <div className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-400">{caption}</div>
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
