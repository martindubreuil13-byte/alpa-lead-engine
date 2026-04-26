'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye, Pencil, X } from 'lucide-react'

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
  cta_label: string | null
  cta_type: string | null
  cta_value: string | null
  full_email: string | null
  context_title: string | null
  context_description: string | null
  context_h1: string | null
  context_status: string
  review_status: 'draft' | 'approved' | 'sent' | 'rejected'
}

type ReviewPanelProps = {
  item: QueueItem | null
  onClose: () => void
  onSave: (id: string, payload: { subject: string; full_email: string }) => Promise<void>
  onApprove: (id: string, payload: { subject: string; full_email: string }) => Promise<void>
  onReject: (id: string) => Promise<void>
}

export default function ReviewPanel({ item, onClose, onSave, onApprove, onReject }: ReviewPanelProps) {
  const [subject, setSubject] = useState('')
  const [email, setEmail] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (item) {
      setSubject(item.subject || '')
      setEmail(item.full_email || '')
      setTab('edit')
    }
  }, [item])

  useEffect(() => {
    if (!item) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [item, onClose])

  if (!item) return null

  const hasContext = item.context_status === 'enriched' && (item.context_h1 || item.context_description)

  async function handleSave() {
    if (!item) return
    setSaving(true)
    await onSave(item.id, { subject, full_email: email })
    setSaving(false)
  }

  async function handleApprove() {
    if (!item) return
    setSaving(true)
    await onApprove(item.id, { subject, full_email: email })
    setSaving(false)
  }

  async function handleReject() {
    if (!item) return
    setSaving(true)
    await onReject(item.id)
    setSaving(false)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[#060c18]/96 shadow-[inset_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
          <div>
            <div className="text-base font-semibold text-white">
              {item.company_name || 'Review Draft'}
            </div>
            {item.contact_email ? (
              <div className="mt-0.5 text-sm text-slate-400">{item.contact_email}</div>
            ) : null}
            {item.cta_label ? (
              <div className="mt-2 inline-flex items-center rounded-full border border-cyan-400/18 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-300">
                CTA · {item.cta_label}{item.cta_type ? ` (${item.cta_type})` : ''}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/8 hover:text-white"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-white/8 px-6 pt-3 pb-0">
          <button
            type="button"
            onClick={() => setTab('edit')}
            className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition ${
              tab === 'edit'
                ? 'border-b-2 border-violet-400 text-violet-300'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition ${
              tab === 'preview'
                ? 'border-b-2 border-violet-400 text-violet-300'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Website context (shown in both tabs) */}
          {hasContext ? (
            <div className="rounded-xl border border-violet-400/15 bg-violet-500/[0.07] px-4 py-3 space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300/70">
                Website context
              </div>
              {item.context_h1 ? (
                <div className="text-sm font-medium text-violet-100">{item.context_h1}</div>
              ) : null}
              {item.context_description ? (
                <div className="text-sm text-slate-400 leading-relaxed">{item.context_description}</div>
              ) : null}
            </div>
          ) : null}

          {/* ── EDIT TAB ── */}
          {tab === 'edit' && (
            <>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-400/40 focus:ring-1 focus:ring-violet-400/20"
                  placeholder="Subject line..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Email
                </label>
                <textarea
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  rows={12}
                  className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-slate-500 outline-none focus:border-violet-400/40 focus:ring-1 focus:ring-violet-400/20"
                  placeholder="Email body..."
                />
              </div>
            </>
          )}

          {/* ── PREVIEW TAB ── */}
          {tab === 'preview' && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03]">
              {/* Email header row */}
              <div className="space-y-2 border-b border-white/8 px-5 py-4">
                <div className="flex items-baseline gap-3">
                  <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Subject
                  </span>
                  <span className="text-sm font-semibold text-white">{subject || '—'}</span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    To
                  </span>
                  <span className="text-sm text-slate-300">{item.contact_email || '—'}</span>
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    From
                  </span>
                  <span className="text-sm text-slate-300">ALPA by MINDRA &lt;info@mindrasolutions.com&gt;</span>
                </div>
              </div>

              {/* Email body */}
              <div className="px-5 py-5">
                {email ? (
                  <p
                    className="text-sm leading-relaxed text-slate-200"
                    style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {email}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500 italic">No content yet.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-white/8 px-6 py-4 flex flex-wrap items-center gap-3">
          {item.review_status !== 'sent' && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={saving}
              className="flex-1 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.1)] transition hover:bg-emerald-500/18 hover:text-white disabled:opacity-50"
            >
              Approve
            </button>
          )}

          {tab === 'edit' && item.review_status !== 'sent' && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              Save edits
            </button>
          )}

          {item.review_status !== 'sent' && item.review_status !== 'rejected' && (
            <button
              type="button"
              onClick={handleReject}
              disabled={saving}
              className="rounded-lg border border-red-400/15 bg-transparent px-4 py-2.5 text-sm font-medium text-red-400/80 transition hover:border-red-400/30 hover:text-red-300 disabled:opacity-50"
            >
              Reject
            </button>
          )}

          {item.review_status === 'sent' && (
            <span className="text-sm text-slate-500">Sent · read-only</span>
          )}
        </div>
      </div>
    </>
  )
}
