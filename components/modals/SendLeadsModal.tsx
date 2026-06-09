'use client'

import { Mail, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { saveGuestCaptureEmail } from '@/lib/guest-session'
import { trackEvent } from '@/lib/track'
import type { TrialLead } from '@/lib/trial'

export default function SendLeadsModal({
  isOpen,
  onClose,
  viewerEmail,
  leads,
  summaryLine,
  onSent,
  query,
  location,
  visitorType = 'unknown',
  sessionId,
}: {
  isOpen: boolean
  onClose: () => void
  viewerEmail: string
  leads: TrialLead[]
  summaryLine: string
  onSent?: (message: string) => void
  query?: string
  location?: string
  visitorType?: 'anonymous' | 'logged_in' | 'paid' | 'unknown'
  sessionId?: string | null
}) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setEmail(viewerEmail)
    setSending(false)
    setError('')
    setEntered(false)

    const timeout = window.setTimeout(() => {
      setEntered(true)
    }, 30)

    trackGaEvent('email_export_opened', {
      query,
      location,
      leads_count: leads.length,
      visitor_type: visitorType,
      session_id: sessionId || undefined,
    })

    return () => {
      window.clearTimeout(timeout)
    }
  }, [isOpen, leads.length, location, query, sessionId, viewerEmail, visitorType])

  async function handleSend() {
    const targetEmail = (viewerEmail || email).trim()

    if (!targetEmail) {
      setError('Enter your email to receive these leads.')
      return
    }

    if (leads.length === 0) {
      setError('No session leads are available to email yet.')
      return
    }

    setSending(true)
    setError('')
    saveGuestCaptureEmail(targetEmail)

    try {
      const res = await fetch('/api/results-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: targetEmail,
          leads,
          summaryLine,
          detailLine: null,
          limitMessage: null,
        }),
      })

      const data = await res.json().catch(() => null)

      if (res.status !== 200) {
        setError(data?.error || 'Something went wrong. Please try again.')
        return
      }

      void trackEvent('email_captured', {
        email: targetEmail,
        leads_count: leads.length,
      })
      void trackEvent('email_export_sent', {
        email: targetEmail,
        leads_count: leads.length,
      })
      void trackEvent('email_exported', {
        email: targetEmail,
        leads_count: leads.length,
      })
      trackGaEvent('email_captured', {
        capture_location: 'email_export',
        visitor_type: visitorType,
        session_id: sessionId || undefined,
      })
      trackGaEvent('email_export_sent', {
        query,
        location,
        leads_count: leads.length,
        visitor_type: visitorType,
        session_id: sessionId || undefined,
      })
      onSent?.('Email sent. It may take a few minutes to arrive.')
      onClose()
    } catch {
      setError('Something went wrong. Please try again.')
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
        className={`w-full max-w-xl rounded-[30px] border border-white/10 bg-[#0b1220] p-8 shadow-[0_30px_90px_rgba(2,8,23,0.68)] transition-all duration-500 ${
          entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-[0.98] opacity-0'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
            <Mail className="h-3.5 w-3.5" />
            Send Leads
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:text-white"
            aria-label="Close send leads modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">
          Send your leads
        </h2>

        <div className="mt-5 space-y-3 text-base leading-7 text-slate-300">
          <p>We&apos;ll send a copy of your leads to your inbox.</p>
        </div>

        {!viewerEmail ? (
          <div className="mt-6 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-300/25"
            />
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            Sending to <span className="font-medium text-white">{viewerEmail}</span>
          </div>
        )}

        {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || leads.length === 0}
            className={`inline-flex min-h-[60px] items-center justify-center gap-2 rounded-[13px] px-7 text-base font-semibold ${
              sending || leads.length === 0
                ? 'cursor-not-allowed border border-white/10 bg-white/5 text-slate-500'
                : 'btn-primary-gold'
            }`}
          >
            <Mail className="h-4 w-4" />
            {sending ? 'Sending...' : 'Save my leads'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[54px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 text-base font-semibold text-slate-200 transition hover:bg-white/[0.08]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
