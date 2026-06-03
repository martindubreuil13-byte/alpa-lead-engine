'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Search, Send, Trash2, XCircle, Zap } from 'lucide-react'

import ReviewPanel from '@/components/outreach/ReviewPanel'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import {
  buildOutreachSenderProfile,
  type OutreachSenderProfile,
  type OutreachSenderSettings,
} from '@/lib/outreach/render-email'
import { supabase } from '@/lib/supabase'
import { safeFetch } from '@/lib/utils/safeFetch'

type QueueItem = {
  id: string
  lead_id: string | null
  template_id: string | null
  automation_step: AutomationStepValue | null
  company_name: string | null
  contact_email: string | null
  location: string | null
  website: string | null
  subject: string | null
  hook: string | null
  body: string | null
  cta: string | null
  cta_label: string | null
  cta_type: string | null
  cta_value: string | null
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

type SendFailure = {
  queueId?: string | null
  leadId?: string | null
  recipient?: string | null
  subject?: string | null
  message?: string | null
  resendError?: Record<string, unknown>
}
type SendResult = {
  sent: number
  failed: number
  error?: string
  message?: string
  queueId?: string | null
  recipient?: string | null
  failures?: SendFailure[]
}
type TimeoutResult = { timeout: true }
type SendOutcome = { result: SendResult | null; timedOut: boolean }
type ReviewStatus = 'draft' | 'approved' | 'sent' | 'rejected'
type StatusFilter = 'all' | ReviewStatus
type SourceFilter = 'all' | 'pipeline_automation' | 'manual' | 'agent'
type AutomationStepValue = 'first_outreach' | 'follow_up' | 'final_attempt'
type StepFilter = 'all' | AutomationStepValue
type TemplateRow = {
  id: string
  name: string | null
  subject: string | null
}
type QueueStats = {
  total: number
  draft: number
  approved: number
  sent: number
  rejected: number
  pipelineAutomation: number
}

const PAGE_SIZE = 50
const EMPTY_STATS: QueueStats = {
  total: 0,
  draft: 0,
  approved: 0,
  sent: 0,
  rejected: 0,
  pipelineAutomation: 0,
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
  if (source === 'pipeline_automation') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-400/18 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        Pipeline Automation
      </span>
    )
  }
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

function stepLabel(step: StepFilter | null) {
  if (step === 'first_outreach') return 'First Outreach'
  if (step === 'follow_up') return 'Follow-Up'
  if (step === 'final_attempt') return 'Final Attempt'
  return 'Unknown Step'
}

function stepBadge(step: StepFilter | null) {
  if (!step || step === 'all') return null
  return (
    <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium text-amber-200">
      {stepLabel(step)}
    </span>
  )
}

function ctaBadge(label: string | null, type: string | null) {
  if (!label) return null
  return (
    <span className="inline-flex items-center rounded-full border border-cyan-400/18 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
      {type ? `${label} · ${type}` : label}
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

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-white/[0.08] bg-slate-950/46 px-3 text-sm font-medium text-slate-100 outline-none transition focus:border-violet-300/24 focus:bg-slate-950/62"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OutreachQueuePage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [items, setItems] = useState<QueueItem[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [senderProfile, setSenderProfile] = useState<OutreachSenderProfile | undefined>()
  const [stats, setStats] = useState<QueueStats>(EMPTY_STATS)
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeItem, setActiveItem] = useState<QueueItem | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [stepFilter, setStepFilter] = useState<StepFilter>('all')
  const [templateFilter, setTemplateFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('draft')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set())
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queueRequestRef = useRef(0)

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
  }

  useEffect(() => {
    if (userLoading) return
    void fetchQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userLoading, sourceFilter, stepFilter, templateFilter, statusFilter, searchQuery, page])

  useEffect(() => {
    if (userLoading || !user) return
    void fetchFilterMetadata()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userLoading])

  useEffect(() => {
    setPage(1)
    setSelectedIds(new Set())
  }, [sourceFilter, stepFilter, templateFilter, statusFilter, searchQuery])

  async function fetchQueue() {
    const requestId = queueRequestRef.current + 1
    queueRequestRef.current = requestId

    try {
      setLoading(true)
      if (!user) return

      let query = supabase
        .from('outreach_queue')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

      query = applyQueueFilters(query)

      const [queueResult, statsResult] = await Promise.all([
        query,
        fetchQueueStats(),
      ])

      if (requestId !== queueRequestRef.current) return

      const { data, error, count } = queueResult

      if (error) {
        console.error('[outreach-queue] fetch error:', error)
      } else {
        setItems((data || []) as QueueItem[])
        setFilteredTotal(count ?? 0)
      }

      setStats(statsResult)
    } finally {
      if (requestId === queueRequestRef.current) {
        setLoading(false)
      }
    }
  }

  async function fetchFilterMetadata() {
    if (!user) return

    const templatesQuery = supabase
      .from('templates')
      .select('id, name, subject')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const senderSettingsQuery = supabase
      .from('sender_settings')
      .select('sender_name, sender_email, company_name, job_title, phone, website, logo_url')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const [templatesResult, senderSettingsResult] = await Promise.all([
      templatesQuery,
      senderSettingsQuery,
    ])

    if (templatesResult.error) {
      console.error('[outreach-queue] templates fetch error:', templatesResult.error)
    } else {
      setTemplates((templatesResult.data || []) as TemplateRow[])
    }

    if (senderSettingsResult.error) {
      console.error('[outreach-queue] sender settings fetch error:', senderSettingsResult.error)
    } else {
      setSenderProfile(
        buildOutreachSenderProfile(
          senderSettingsResult.data as OutreachSenderSettings | null,
          {
            name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
            email: user.email || null,
          }
        )
      )
    }
  }

  function applyQueueFilters(query: any) {
    let nextQuery = query

    if (statusFilter !== 'all') {
      nextQuery = nextQuery.eq('review_status', statusFilter)
    }

    if (sourceFilter !== 'all') {
      nextQuery = nextQuery.eq('source', sourceFilter)
    }

    if (stepFilter !== 'all') {
      nextQuery = nextQuery.eq('source', 'pipeline_automation')
      nextQuery = nextQuery.eq('automation_step', stepFilter)
    }

    if (templateFilter !== 'all') {
      nextQuery = nextQuery.eq('template_id', templateFilter)
    }

    const search = searchQuery.trim().replace(/[%,]/g, ' ')
    if (search) {
      nextQuery = nextQuery.or(
        `company_name.ilike.%${search}%,contact_email.ilike.%${search}%,location.ilike.%${search}%`
      )
    }

    return nextQuery
  }

  async function fetchQueueStats(): Promise<QueueStats> {
    if (!user) return EMPTY_STATS

    const countBy = (status?: ReviewStatus) => {
      let query = supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)

      if (status) {
        query = query.eq('review_status', status)
      }

      return query
    }

    const [
      total,
      draft,
      approved,
      sent,
      rejected,
      pipelineAutomation,
    ] = await Promise.all([
      countBy(),
      countBy('draft'),
      countBy('approved'),
      countBy('sent'),
      countBy('rejected'),
      supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('source', 'pipeline_automation'),
    ])

    for (const result of [total, draft, approved, sent, rejected, pipelineAutomation]) {
      if (result.error) {
        console.error('[outreach-queue] count fetch error:', result.error)
      }
    }

    return {
      total: total.count ?? 0,
      draft: draft.count ?? 0,
      approved: approved.count ?? 0,
      sent: sent.count ?? 0,
      rejected: rejected.count ?? 0,
      pipelineAutomation: pipelineAutomation.count ?? 0,
    }
  }

  // ── Update (approve / reject / save) ────────────────────────────────────

  async function callUpdate(
    queueId: string,
    action: 'approve' | 'reject' | 'save',
    payload?: { subject?: string; full_email?: string }
  ) {
    if (!queueId) return
    const url = '/api/agent/outreach-queue/update'
    console.log('[FETCH CALL]', { url, queueId, action })
    try {
      await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId, action, payload }),
      })
    } catch (err) {
      console.error('[agent] fetch failed', { url, queueId, action, err })
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
    if (action !== 'save') {
      void fetchQueue()
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function callDelete(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return false
    const url = '/api/agent/outreach-queue/delete'
    console.log('[FETCH CALL]', { url, ids })
    try {
      await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      return true
    } catch (err) {
      console.error('[agent] fetch failed', { url, ids, err })
      return false
    }
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
      void fetchQueue()
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
      void fetchQueue()
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
      void fetchQueue()
    }
    setDeleting(false)
  }

  async function handleApproveSelected() {
    const ids = [...selectedIds].filter(
      (id) => items.find((item) => item.id === id)?.review_status === 'draft'
    )
    if (!ids.length) return

    setApproving(true)
    try {
      const response = await fetch('/api/outreach/batch-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })

      if (!response.ok) {
        console.error('[outreach-queue] batch approve failed:', await response.text())
        showToast('Approve failed - check logs')
        return
      }

      setItems((prev) =>
        prev.map((item) =>
          ids.includes(item.id) ? { ...item, review_status: 'approved' as const } : item
        )
      )
      setSelectedIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setActiveItem((prev) =>
        prev && ids.includes(prev.id) ? { ...prev, review_status: 'approved' as const } : prev
      )
      showToast(`Approved ${ids.length} message${ids.length > 1 ? 's' : ''}`)
      void fetchQueue()
    } catch (error) {
      console.error('[outreach-queue] batch approve error:', error)
      showToast('Approve failed - check logs')
    } finally {
      setApproving(false)
    }
  }

  // ── Send ─────────────────────────────────────────────────────────────────

  async function callSend(ids: string[]): Promise<SendOutcome> {
    if (ids.length === 0) return { result: null, timedOut: false }
    const url = '/api/agent/outreach-queue/send'
    console.log('[FETCH CALL]', { url, ids })
    try {
      const res = await safeFetch(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        },
        { timeout: 20000 }
      )
      const data = await res.json() as SendResult | TimeoutResult
      if ('timeout' in data && data.timeout) {
        return { result: null, timedOut: true }
      }
      if (!('sent' in data) || !('failed' in data)) {
        return { result: null, timedOut: false }
      }
      if (data.failed > 0 || data.failures?.length) {
        console.error('[outreach-queue] send diagnostic response:', data)
      }
      return { result: data, timedOut: false }
    } catch (err) {
      if (err instanceof Error && err.message === 'Request timeout') {
        return { result: null, timedOut: true }
      }
      console.error('[agent] fetch failed', { url, ids, err })
      return { result: null, timedOut: false }
    }
  }

  async function handleSendSingle(item: QueueItem) {
    if (!item.contact_email) {
      window.alert('Missing email address — cannot send.')
      return
    }
    if (!window.confirm(`Send email to ${item.contact_email}?`)) return

    setSendingIds((prev) => new Set(prev).add(item.id))
    const { result, timedOut } = await callSend([item.id])
    if (result && result.sent > 0) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, review_status: 'sent' as const } : i))
      )
      showToast('Email sent')
      void fetchQueue()
    } else if (timedOut) {
      showToast('Sending is taking longer than expected. Please wait...')
    } else {
      showToast(result?.message || result?.failures?.[0]?.message || 'Send failed — check logs')
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
    const { result, timedOut } = await callSend(sendable)
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
        void fetchQueue()
      } else {
        showToast(result.message || result.failures?.[0]?.message || 'Send failed — check logs')
      }
    } else if (timedOut) {
      showToast('Sending is taking longer than expected. Please wait...')
    }
    setSendingIds((prev) => { const next = new Set(prev); sendable.forEach((id) => next.delete(id)); return next })
  }

  // ── Send test ────────────────────────────────────────────────────────────

  async function handleSendTest(item: QueueItem) {
    if (!item.full_email && !item.body) return
    setTestingIds((prev) => new Set(prev).add(item.id))
    try {
      const url = '/api/agent/outreach-queue/send-test'
      console.log('[FETCH CALL]', { url, id: item.id })
      await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      showToast('Test email sent to your inbox')
    } catch (err) {
      console.error('[agent] fetch failed', { url: '/api/agent/outreach-queue/send-test', id: item.id, err })
      showToast('Test send failed — check logs')
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

  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))
  const filtered = items
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))
  const selectedDraftCount = [...selectedIds].filter(
    (id) => items.find((item) => item.id === id)?.review_status === 'draft'
  ).length

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
      {stats.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: 'Total', count: stats.total },
            { label: 'Drafts', count: stats.draft },
            { label: 'Approved', count: stats.approved },
            { label: 'Sent', count: stats.sent },
            { label: 'Rejected', count: stats.rejected },
            { label: 'Pipeline Automation', count: stats.pipelineAutomation },
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

      {/* Filters */}
      {stats.total > 0 && (
        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.028] p-3 shadow-[0_16px_42px_rgba(2,8,23,0.18)] backdrop-blur-xl">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_170px_170px_170px_220px]">
            <label className="group relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition group-focus-within:text-violet-200" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, email, location..."
                className="h-11 w-full rounded-xl border border-white/[0.08] bg-slate-950/46 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/24 focus:bg-slate-950/62"
              />
            </label>

            <FilterSelect
              label="Status"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'draft', label: 'Ready to Review' },
                { value: 'approved', label: 'Approved' },
                { value: 'sent', label: 'Sent' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />

            <FilterSelect
              label="Source"
              value={sourceFilter}
              onChange={(value) => setSourceFilter(value as SourceFilter)}
              options={[
                { value: 'all', label: 'All Sources' },
                { value: 'pipeline_automation', label: 'Pipeline Automation' },
                { value: 'manual', label: 'Manual' },
                { value: 'agent', label: 'Agent' },
              ]}
            />

            <FilterSelect
              label="Step"
              value={stepFilter}
              onChange={(value) => setStepFilter(value as StepFilter)}
              options={[
                { value: 'all', label: 'All Steps' },
                { value: 'first_outreach', label: 'First Outreach' },
                { value: 'follow_up', label: 'Follow-Up' },
                { value: 'final_attempt', label: 'Final Attempt' },
              ]}
            />

            <FilterSelect
              label="Template"
              value={templateFilter}
              onChange={setTemplateFilter}
              options={[
                { value: 'all', label: 'All Templates' },
                ...templates.map((template) => ({
                  value: template.id,
                  label: template.name || template.subject || 'Untitled template',
                })),
              ]}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              Showing {items.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredTotal)} of {filteredTotal}
            </span>
            {(sourceFilter !== 'all' || stepFilter !== 'all' || templateFilter !== 'all' || statusFilter !== 'draft' || searchQuery.trim()) ? (
              <button
                type="button"
                onClick={() => {
                  setSourceFilter('all')
                  setStepFilter('all')
                  setTemplateFilter('all')
                  setStatusFilter('draft')
                  setSearchQuery('')
                }}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
              >
                Reset filters
              </button>
            ) : null}
          </div>
        </section>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <span className="text-sm text-slate-400">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            disabled={approving || selectedDraftCount === 0}
            onClick={() => void handleApproveSelected()}
            className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/18 hover:text-white disabled:opacity-40"
          >
            {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Approve Selected
          </button>
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
      {stats.total === 0 ? (
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
          No queue items match the current filters.
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
              {allFilteredSelected ? 'Deselect page' : `Select ${filtered.length} on this page`}
            </span>
          </div>

          {filtered.map((item) => {
            const isSelected = selectedIds.has(item.id)
            const template = item.template_id ? templates.find((current) => current.id === item.template_id) : null
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
                    {stepBadge(item.automation_step)}
                    {template ? (
                      <span className="inline-flex max-w-[180px] items-center truncate rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        {template.name || template.subject || 'Untitled template'}
                      </span>
                    ) : null}
                    {ctaBadge(item.cta_label, item.cta_type)}
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

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <div className="text-sm text-slate-400">
                Page {page} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Review side panel */}
      <ReviewPanel
        item={activeItem}
        senderProfile={senderProfile}
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
