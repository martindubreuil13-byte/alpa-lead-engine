'use client'

import { Download, Eye, Mail, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import StartCheckoutButton from '@/components/checkout/StartCheckoutButton'
import { saveGuestCaptureEmail } from '@/lib/guest-session'
import { buildLeadCsv } from '@/lib/leads/csv'
import type { TrialLead } from '@/lib/trial'

function formatLocationSegment(segment: string) {
  const trimmed = segment.trim()
  if (!trimmed) return trimmed

  if (/^[a-z]{2,3}$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) return word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

function normalizeSummaryLine(summaryLine: string) {
  const marker = ' found in '
  const markerIndex = summaryLine.toLowerCase().indexOf(marker)

  if (markerIndex === -1) return summaryLine

  const prefix = summaryLine.slice(0, markerIndex + marker.length)
  const rawLocation = summaryLine.slice(markerIndex + marker.length)
  const formattedLocation = rawLocation
    .split(',')
    .map((segment) => formatLocationSegment(segment))
    .join(', ')

  return `${prefix}${formattedLocation}`
}

export default function ScrapeCompletionModal({
  isOpen,
  onClose,
  summaryLine,
  detailLine,
  addedLeads,
  viewerEmail,
  onDownload,
  onEmailSent,
}: {
  isOpen: boolean
  onClose: () => void
  summaryLine: string
  detailLine: string
  addedLeads: TrialLead[]
  viewerEmail: string
  onDownload?: () => void
  onEmailSent?: (message: string) => void
}) {
  const [email, setEmail] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [responseMessage, setResponseMessage] = useState('')
  const [entered, setEntered] = useState(false)
  const normalizedSummaryLine = normalizeSummaryLine(summaryLine)
  const leadCount = addedLeads.length

  useEffect(() => {
    if (!isOpen) return
    setEmail(viewerEmail)
    setShowEmailInput(false)
    setSending(false)
    setError('')
    setSuccessMessage('')
    setResponseMessage('')
    setEntered(false)

    const timeout = window.setTimeout(() => {
      setEntered(true)
    }, 30)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [isOpen, viewerEmail])

  function handleDownload() {
    if (addedLeads.length === 0) return

    const csv = buildLeadCsv(addedLeads)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'alpa-leads.csv'
    link.click()
    URL.revokeObjectURL(url)
    onDownload?.()
  }

  async function handleSendEmail() {
    if (!viewerEmail && !showEmailInput) {
      setShowEmailInput(true)
      return
    }

    const targetEmail = (viewerEmail || email).trim()
    if (!targetEmail) {
      setError('Enter your email to receive these leads.')
      setShowEmailInput(true)
      return
    }

    if (addedLeads.length === 0) {
      setError('No session leads are available to email yet.')
      return
    }

    setSending(true)
    setError('')
    setSuccessMessage('')
    setResponseMessage('')
    saveGuestCaptureEmail(targetEmail)

    try {
      const res = await fetch('/api/results-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: targetEmail,
          leads: addedLeads,
          summaryLine: normalizedSummaryLine,
          detailLine: null,
          limitMessage: null,
        }),
      })

      const data = await res.json().catch(() => null)

      if (res.status !== 200) {
        const failureMessage = data?.error || data?.message || 'Email failed: Unknown error'
        setError('Something went wrong. Please try again.')
        setResponseMessage(failureMessage)
        return
      }

      const nextMessage = 'Email sent. It may take a few minutes to arrive.'
      setResponseMessage('')
      setSuccessMessage(nextMessage)
      onEmailSent?.(nextMessage)
    } catch (sendError: any) {
      setError('Something went wrong. Please try again.')
      setResponseMessage(`Email failed: ${sendError?.message || 'Unknown error'}`)
    } finally {
      setSending(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 backdrop-blur-sm transition-all duration-500 ${
        entered ? 'bg-slate-950/75 opacity-100' : 'bg-slate-950/0 opacity-0'
      }`}
    >
      <div
        className={`w-full max-w-2xl rounded-[30px] border border-white/10 bg-[#0b1220] p-8 shadow-[0_30px_90px_rgba(2,8,23,0.68)] transition-all duration-500 ${
          entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-[0.98] opacity-0'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100">
            <Sparkles className="h-3.5 w-3.5" />
            Prospecting Complete
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:text-white"
            aria-label="Close completion modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">
          You just found your first clients
        </h2>

        <div className="mt-5 space-y-3 text-base leading-7 text-slate-300">
          <p>You discovered {leadCount} businesses ready to contact in seconds.</p>
          <p>This was your free sample. You&apos;ve reached your limit.</p>
          <p>Imagine doing this every day.</p>
        </div>

        {showEmailInput && !viewerEmail ? (
          <div className="mt-6 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-300/25"
            />
            <div className="text-sm text-slate-500">
              We&apos;ll send only the leads saved in this run. If you don&apos;t see it, check your spam folder.
            </div>
          </div>
        ) : null}

        {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}
        {successMessage ? <div className="mt-4 text-sm text-emerald-300">{successMessage}</div> : null}
        {responseMessage ? (
          <div className="mt-2 text-sm text-slate-400">{responseMessage}</div>
        ) : null}

        <div className="mt-8 space-y-3">
          <StartCheckoutButton
            label="Unlock 300 leads/month — $29.99"
            email={viewerEmail || email}
            source="scrape_completion"
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#1D4ED8_0%,#3B82F6_35%,#22D3EE_70%,#8B5CF6_100%)] px-6 text-base font-semibold text-white shadow-[0_0_18px_rgba(34,211,238,0.35),0_0_40px_rgba(139,92,246,0.25),0_12px_35px_rgba(29,78,216,0.45)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(34,211,238,0.6),0_0_55px_rgba(139,92,246,0.45),0_16px_45px_rgba(29,78,216,0.6)] active:scale-[0.97]"
          />

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleDownload}
              disabled={addedLeads.length === 0}
              className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-medium transition-all duration-200 ${
                addedLeads.length === 0
                  ? 'cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500'
                  : 'border-white/15 bg-white/[0.03] text-white hover:bg-white/[0.08]'
              }`}
            >
              <Download className="h-4 w-4" />
              Download CSV
            </button>

            <button
              type="button"
              onClick={() => void handleSendEmail()}
              disabled={sending || addedLeads.length === 0}
              className={`inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-medium transition-all duration-200 ${
                sending || addedLeads.length === 0
                  ? 'cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500'
                  : 'border-white/15 bg-white/[0.03] text-white hover:bg-white/[0.08]'
              }`}
            >
              <Mail className="h-4 w-4" />
              {sending ? 'Sending...' : showEmailInput && !viewerEmail ? 'Save my copy' : 'Save to my email'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.03] px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-white/[0.08]"
            >
              <Eye className="h-4 w-4" />
              View my leads
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
