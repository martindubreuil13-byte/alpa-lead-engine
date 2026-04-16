'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock, XCircle, Zap } from 'lucide-react'

import ReviewPanel from '@/components/outreach/ReviewPanel'
import { supabase } from '@/lib/supabase'

type QueueItem = {
  id: string
  company_name: string | null
  contact_email: string | null
  location: string | null
  website: string | null
  subject: string | null
  hook: string | null
  body: string | null
  cta: string | null
  full_email: string | null
  personalization_score: number | null
  quality_score: number | null
  context_status: string
  context_title: string | null
  context_description: string | null
  context_h1: string | null
  source: string
  review_status: 'draft' | 'approved' | 'rejected'
  created_at: string
}

function statusBadge(status: 'draft' | 'approved' | 'rejected') {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300">
        <XCircle className="h-3 w-3" />
        Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-400">
      <Clock className="h-3 w-3" />
      Draft
    </span>
  )
}

function contextBadge(status: string) {
  if (status === 'enriched') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
        <Zap className="h-2.5 w-2.5" />
        Enriched
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-500">
      Basic
    </span>
  )
}

function sourceBadge(source: string) {
  if (source === 'agent') {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-400/18 bg-blue-500/8 px-2 py-0.5 text-[10px] font-medium text-blue-300">
        Agent
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-500">
      Manual
    </span>
  )
}

export default function OutreachQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeItem, setActiveItem] = useState<QueueItem | null>(null)
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'rejected'>('all')

  useEffect(() => {
    void fetchQueue()
  }, [])

  async function fetchQueue() {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('outreach_queue')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[outreach-queue] fetch error:', error)
    } else {
      setItems((data || []) as QueueItem[])
    }

    setLoading(false)
  }

  async function callUpdate(
    queueId: string,
    action: 'approve' | 'reject' | 'save',
    payload?: { subject?: string; full_email?: string }
  ) {
    const res = await fetch('/api/agent/outreach-queue/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queueId, action, payload }),
    })

    if (!res.ok) {
      console.error('[outreach-queue] update failed:', await res.text())
      return
    }

    // Optimistic update
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== queueId) return item
        const now = new Date().toISOString()
        if (action === 'approve') {
          return { ...item, review_status: 'approved' as const, ...(payload || {}) }
        }
        if (action === 'reject') {
          return { ...item, review_status: 'rejected' as const }
        }
        return { ...item, ...(payload || {}) }
      })
    )
  }

  const handleSave = useCallback(
    async (id: string, payload: { subject: string; full_email: string }) => {
      await callUpdate(id, 'save', payload)
      setActiveItem((prev) => (prev?.id === id ? { ...prev, ...payload } : prev))
    },
    []
  )

  const handleApprove = useCallback(
    async (id: string, payload: { subject: string; full_email: string }) => {
      await callUpdate(id, 'approve', payload)
      setActiveItem(null)
    },
    []
  )

  const handleReject = useCallback(async (id: string) => {
    await callUpdate(id, 'reject')
  }, [])

  const filtered = filter === 'all' ? items : items.filter((i) => i.review_status === filter)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        Loading your outreach queue...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold text-white">Outreach Queue</h1>
        <p className="mt-2 text-slate-400">
          Review, refine, and approve your next outbound messages.
        </p>
      </div>

      {/* Stats row */}
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Total', count: items.length },
            { label: 'Drafts', count: items.filter((i) => i.review_status === 'draft').length },
            { label: 'Approved', count: items.filter((i) => i.review_status === 'approved').length },
            { label: 'Rejected', count: items.filter((i) => i.review_status === 'rejected').length },
          ].map(({ label, count }) => (
            <div
              key={label}
              className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center"
            >
              <div className="text-xl font-semibold text-white">{count}</div>
              <div className="mt-0.5 text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Filter tabs */}
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {(['all', 'draft', 'approved', 'rejected'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm capitalize transition ${
                filter === value
                  ? 'border-white/20 bg-white/10 text-white'
                  : 'border-white/8 bg-white/[0.03] text-slate-400 hover:border-white/15 hover:text-white'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="glass rounded-2xl p-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10">
            <Zap className="h-6 w-6 text-violet-300" />
          </div>
          <h2 className="text-xl font-semibold text-white">No drafts yet</h2>
          <p className="mt-2 text-sm text-slate-400">
            Prepare outreach from your inbox or agent leads.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-slate-400">
          No items match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.96),rgba(8,14,28,0.92))] p-5 shadow-[0_12px_40px_rgba(2,8,23,0.26)] transition"
            >
              {/* Card top row */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-white">
                    {item.company_name || 'Unknown company'}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                    {item.contact_email ? (
                      <span className="truncate max-w-[240px]">{item.contact_email}</span>
                    ) : null}
                    {item.location ? (
                      <span className="text-slate-500">{item.location}</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {statusBadge(item.review_status)}
                  {contextBadge(item.context_status)}
                  {sourceBadge(item.source)}
                </div>
              </div>

              {/* Subject */}
              {item.subject ? (
                <div className="mt-4 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Subject
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">{item.subject}</div>
                </div>
              ) : null}

              {/* Email preview */}
              {item.full_email ? (
                <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Preview
                  </div>
                  <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-slate-300">
                    {item.full_email}
                  </p>
                </div>
              ) : null}

              {/* Actions */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveItem(item)}
                  className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white"
                >
                  Review
                </button>

                {item.review_status !== 'approved' ? (
                  <button
                    type="button"
                    onClick={() =>
                      void callUpdate(item.id, 'approve', {
                        subject: item.subject || '',
                        full_email: item.full_email || '',
                      })
                    }
                    className="rounded-lg border border-emerald-400/20 bg-emerald-500/8 px-3 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/15 hover:text-white"
                  >
                    Approve
                  </button>
                ) : null}

                {item.review_status !== 'rejected' ? (
                  <button
                    type="button"
                    onClick={() => void callUpdate(item.id, 'reject')}
                    className="rounded-lg border border-white/8 bg-transparent px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-red-400/20 hover:text-red-400"
                  >
                    Reject
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review side panel */}
      <ReviewPanel
        item={activeItem}
        onClose={() => setActiveItem(null)}
        onSave={handleSave}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  )
}
