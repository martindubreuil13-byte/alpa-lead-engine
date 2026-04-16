'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Send, Trash2, XCircle, Zap } from 'lucide-react'

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
  review_status: 'draft' | 'approved' | 'sent' | 'rejected'
  created_at: string
}

// ─── Badges ──────────────────────────────────────────────────────────────────

function statusBadge(status: 'draft' | 'approved' | 'sent' | 'rejected') {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    )
  }
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-300">
        <Send className="h-3 w-3" />
        Sent
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

function matchBadge(personalizationScore: number | null) {
  if (personalizationScore == null) return null
  if (personalizationScore >= 4) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        High match
      </span>
    )
  }
  if (personalizationScore >= 2) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium text-amber-300/80">
        Medium match
      </span>
    )
  }
  return null
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0d1424] px-5 py-3 text-sm text-slate-200 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      {message}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OutreachQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeItem, setActiveItem] = useState<QueueItem | null>(null)
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'sent' | 'rejected'>('all')

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set())
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
  }

  useEffect(() => {
    void fetchQueue()
  }, [])

  async function fetchQueue() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

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

  // ── Update (approve / reject / save) ────────────────────────────────────

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
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== queueId) return item
        if (action === 'approve') return { ...item, review_status: 'approved' as const, ...(payload || {}) }
        if (action === 'reject') return { ...item, review_status: 'rejected' as const }
        return { ...item, ...(payload || {}) }
      })
    )
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function callDelete(ids: string[]): Promise<boolean> {
    const res = await fetch('/api/agent/outreach-queue/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    return res.ok
  }

  async function handleDeleteSingle(item: QueueItem) {
    const confirmMsg =
      item.review_status === 'approved'
        ? 'This email is approved. Delete anyway?'
        : 'Delete this email?'
    if (!window.confirm(confirmMsg)) return

    setDeleting(true)
    const ok = await callDelete([item.id])
    if (ok) {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next })
      if (activeItem?.id === item.id) setActiveItem(null)
      showToast('Deleted successfully')
    }
    setDeleting(false)
  }

  async function handleDeleteSelected() {
    const ids = [...selectedIds]
    if (!ids.length) return
    const approvedCount = items.filter((i) => ids.includes(i.id) && i.review_status === 'approved').length
    const confirmMsg =
      approvedCount > 0
        ? `${approvedCount} approved email${approvedCount > 1 ? 's' : ''} included. Delete ${ids.length} selected?`
        : `Delete ${ids.length} selected email${ids.length > 1 ? 's' : ''}?`
    if (!window.confirm(confirmMsg)) return

    setDeleting(true)
    const ok = await callDelete(ids)
    if (ok) {
      setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)))
      setSelectedIds(new Set())
      showToast(`Deleted ${ids.length} email${ids.length > 1 ? 's' : ''}`)
    }
    setDeleting(false)
  }

  async function handleClearRejected() {
    const rejectedIds = items
      .filter((i) => i.review_status === 'rejected')
      .map((i) => i.id)
    if (!rejectedIds.length) return
    if (!window.confirm(`Clear ${rejectedIds.length} rejected email${rejectedIds.length > 1 ? 's' : ''}?`)) return

    setDeleting(true)
    const ok = await callDelete(rejectedIds)
    if (ok) {
      setItems((prev) => prev.filter((i) => i.review_status !== 'rejected'))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        rejectedIds.forEach((id) => next.delete(id))
        return next
      })
      showToast(`Cleared ${rejectedIds.length} rejected email${rejectedIds.length > 1 ? 's' : ''}`)
    }
    setDeleting(false)
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async function callSend(ids: string[]): Promise<{ sent: number; failed: number } | null> {
    const res = await fetch('/api/agent/outreach-queue/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    if (!res.ok) return null
    return res.json() as Promise<{ sent: number; failed: number }>
  }

  async function handleSendSingle(item: QueueItem) {
    if (!item.contact_email) {
      window.alert('Missing email address — cannot send.')
      return
    }
    if (!window.confirm(`Send email to ${item.contact_email}?`)) return

    setSendingIds((prev) => new Set(prev).add(item.id))
    const result = await callSend([item.id])
    if (result && result.sent > 0) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, review_status: 'sent' as const } : i))
      )
      showToast('Email sent')
    } else {
      showToast('Send failed — check logs')
    }
    setSendingIds((prev) => { const next = new Set(prev); next.delete(item.id); return next })
  }

  async function handleSendSelected() {
    const approvedIds = [...selectedIds].filter(
      (id) => items.find((i) => i.id === id)?.review_status === 'approved'
    )
    if (!approvedIds.length) return

    const missingEmail = approvedIds.filter(
      (id) => !items.find((i) => i.id === id)?.contact_email
    )
    if (missingEmail.length > 0) {
      window.alert(`${missingEmail.length} selected item${missingEmail.length > 1 ? 's have' : ' has'} no email address and will be skipped.`)
    }

    const sendable = approvedIds.filter(
      (id) => items.find((i) => i.id === id)?.contact_email
    )
    if (!sendable.length) return
    if (!window.confirm(`Send ${sendable.length} email${sendable.length > 1 ? 's' : ''}?`)) return

    setSendingIds((prev) => { const next = new Set(prev); sendable.forEach((id) => next.add(id)); return next })
    const result = await callSend(sendable)
    if (result) {
      if (result.sent > 0) {
        setItems((prev) =>
          prev.map((i) => {
            if (!sendable.includes(i.id)) return i
            return { ...i, review_status: 'sent' as const }
          })
        )
        setSelectedIds(new Set())
        showToast(`${result.sent} email${result.sent > 1 ? 's' : ''} sent${result.failed > 0 ? `, ${result.failed} failed` : ''}`)
      } else {
        showToast('Send failed — check logs')
      }
    }
    setSendingIds((prev) => { const next = new Set(prev); sendable.forEach((id) => next.delete(id)); return next })
  }

  // ── Send test ────────────────────────────────────────────────────────────

  async function handleSendTest(item: QueueItem) {
    if (!item.full_email && !item.body) return
    setTestingIds((prev) => new Set(prev).add(item.id))
    try {
      const res = await fetch('/api/agent/outreach-queue/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      if (res.ok) {
        showToast('Test email sent to your inbox')
      } else {
        showToast('Test send failed — check logs')
      }
    } finally {
      setTestingIds((prev) => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }

  // ── Selection helpers ────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = filter === 'all' ? items : items.filter((i) => i.review_status === filter)
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((i) => next.delete(i.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((i) => next.add(i.id))
        return next
      })
    }
  }

  // ── Callbacks for ReviewPanel ────────────────────────────────────────────

  const handleSave = useCallback(
    async (id: string, payload: { subject: string; full_email: string }) => {
      await callUpdate(id, 'save', payload)
      setActiveItem((prev) => (prev?.id === id ? { ...prev, ...payload } : prev))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const handleApprove = useCallback(
    async (id: string, payload: { subject: string; full_email: string }) => {
      await callUpdate(id, 'approve', payload)
      setActiveItem(null)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const handleReject = useCallback(async (id: string) => {
    await callUpdate(id, 'reject')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        Loading your outreach queue...
      </div>
    )
  }

  const rejectedCount = items.filter((i) => i.review_status === 'rejected').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-white">Outreach Queue</h1>
          <p className="mt-2 text-slate-400">
            Review, refine, and approve your next outbound messages.
          </p>
        </div>
        {rejectedCount > 0 && (
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleClearRejected()}
            className="flex items-center gap-2 rounded-xl border border-red-400/15 bg-transparent px-4 py-2 text-sm font-medium text-red-400/70 transition hover:border-red-400/30 hover:text-red-300 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear rejected ({rejectedCount})
          </button>
        )}
      </div>

      {/* Stats row */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Total', count: items.length },
            { label: 'Drafts', count: items.filter((i) => i.review_status === 'draft').length },
            { label: 'Approved', count: items.filter((i) => i.review_status === 'approved').length },
            { label: 'Sent', count: items.filter((i) => i.review_status === 'sent').length },
            { label: 'Rejected', count: rejectedCount },
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
      )}

      {/* Filter tabs */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(['all', 'draft', 'approved', 'sent', 'rejected'] as const).map((value) => (
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
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <span className="text-sm text-slate-400">
            {selectedIds.size} selected
          </span>
          {[...selectedIds].some((id) => items.find((i) => i.id === id)?.review_status === 'approved') && (
            <button
              type="button"
              disabled={[...selectedIds].some((id) => sendingIds.has(id))}
              onClick={() => void handleSendSelected()}
              className="flex items-center gap-2 rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-300 transition hover:bg-blue-500/18 hover:text-white disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              Send selected
            </button>
          )}
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDeleteSelected()}
            className="flex items-center gap-2 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 transition hover:bg-red-500/18 hover:text-white disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-slate-500 transition hover:text-slate-300"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="glass rounded-2xl p-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10">
            <Zap className="h-6 w-6 text-violet-300" />
          </div>
          <h2 className="text-xl font-semibold text-white">No emails in queue</h2>
          <p className="mt-2 text-sm text-slate-400">
            Emails will appear here once your agent generates drafts.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-slate-400">
          No items match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Select all row */}
          <div className="flex items-center gap-3 px-1">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 cursor-pointer rounded border-white/20 bg-white/[0.04] accent-violet-500"
            />
            <span className="text-xs text-slate-500">
              {allFilteredSelected ? 'Deselect all' : `Select all ${filtered.length}`}
            </span>
          </div>

          {filtered.map((item) => {
            const isSelected = selectedIds.has(item.id)
            return (
              <div
                key={item.id}
                className={`rounded-xl border bg-[linear-gradient(180deg,rgba(8,15,29,0.96),rgba(8,14,28,0.92))] p-5 shadow-[0_12px_40px_rgba(2,8,23,0.26)] transition ${
                  isSelected ? 'border-violet-400/25' : 'border-white/10'
                }`}
              >
                {/* Card top row */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-white/[0.04] accent-violet-500"
                    />
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-white">
                        {item.company_name || 'Unknown company'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                        {item.contact_email && (
                          <span className="max-w-[240px] truncate">{item.contact_email}</span>
                        )}
                        {item.location && (
                          <span className="text-slate-500">{item.location}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {statusBadge(item.review_status)}
                    {matchBadge(item.personalization_score)}
                    {contextBadge(item.context_status)}
                    {sourceBadge(item.source)}
                    {/* Single delete */}
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDeleteSingle(item)}
                      title="Delete"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 text-slate-600 transition hover:border-red-400/20 hover:text-red-400 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Subject */}
                {item.subject && (
                  <div className="mt-4 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Subject
                    </div>
                    <div className="mt-1 text-sm font-medium text-white">{item.subject}</div>
                  </div>
                )}

                {/* Email preview */}
                {item.full_email && (
                  <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Preview
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-slate-300">
                      {item.full_email}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveItem(item)}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white"
                  >
                    Review
                  </button>

                  {item.review_status !== 'approved' && item.review_status !== 'sent' && (
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
                  )}

                  {item.review_status === 'approved' && (
                    item.contact_email ? (
                      <button
                        type="button"
                        disabled={sendingIds.has(item.id)}
                        onClick={() => void handleSendSingle(item)}
                        className="flex items-center gap-1.5 rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 transition hover:bg-blue-500/18 hover:text-white disabled:opacity-40"
                      >
                        {sendingIds.has(item.id) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Send
                      </button>
                    ) : (
                      <span className="rounded-lg border border-amber-400/20 bg-amber-500/8 px-3 py-2 text-sm text-amber-400/70">
                        Missing email address
                      </span>
                    )
                  )}

                  {item.review_status !== 'sent' && (item.full_email || item.body) && (
                    <button
                      type="button"
                      disabled={testingIds.has(item.id)}
                      onClick={() => void handleSendTest(item)}
                      className="rounded-lg border border-white/8 bg-transparent px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-violet-400/20 hover:text-violet-300 disabled:opacity-40"
                    >
                      {testingIds.has(item.id) ? (
                        <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
                      ) : (
                        'Send test'
                      )}
                    </button>
                  )}

                  {item.review_status === 'sent' && (
                    <span className="text-xs text-slate-500">Sent · waiting for replies</span>
                  )}

                  {item.review_status !== 'rejected' && item.review_status !== 'sent' && (
                    <button
                      type="button"
                      onClick={() => void callUpdate(item.id, 'reject')}
                      className="rounded-lg border border-white/8 bg-transparent px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-red-400/20 hover:text-red-400"
                    >
                      Reject
                    </button>
                  )}
                </div>
              </div>
            )
          })}
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

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
