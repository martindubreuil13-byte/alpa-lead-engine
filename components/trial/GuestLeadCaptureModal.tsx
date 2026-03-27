'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import {
  getGuestCaptureEmail,
  getGuestLeads,
  getOrCreateGuestSessionId,
  saveGuestCaptureEmail,
} from '@/lib/guest-session'

type CaptureTrigger = 'export' | 'copy' | 'limit'

const PLAN_OPTIONS = [
  {
    name: 'Starter',
    price: '$9.99',
    detail: 'Unlock full lead access for lightweight outbound.',
  },
  {
    name: 'Operator',
    price: '$29.99',
    detail: 'Keep generating, exporting, and working the pipeline daily.',
  },
]

function getTriggerLabel(trigger: CaptureTrigger) {
  if (trigger === 'copy') return 'copy your leads'
  if (trigger === 'limit') return 'save this batch'
  return 'export your leads'
}

export default function GuestLeadCaptureModal({
  isOpen,
  onClose,
  trigger,
}: {
  isOpen: boolean
  onClose: () => void
  trigger: CaptureTrigger
}) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const previewCount = useMemo(() => Math.min(getGuestLeads().length, 8), [isOpen, submitted])

  useEffect(() => {
    if (!isOpen) return
    setEmail(getGuestCaptureEmail())
    setError('')
    setSubmitted(false)
  }, [isOpen])

  async function handleSubmit() {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter your email to continue')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const guestSessionId = getOrCreateGuestSessionId()
      const leads = getGuestLeads()

      const res = await fetch('/api/guest/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          guestSessionId,
          trigger,
          leads,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to send your preview')
      }

      saveGuestCaptureEmail(trimmedEmail)
      setSubmitted(true)
    } catch (submitError: any) {
      setError(submitError?.message || 'Failed to send your preview')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#0b1220] p-7 shadow-[0_30px_80px_rgba(2,8,23,0.62)] sm:p-8">
        {!submitted ? (
          <>
            <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">
              Guest Access
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
              Save your leads
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Enter your email and we&apos;ll send you your results.
            </p>
            <p className="mt-3 text-sm text-slate-500">
              You&apos;re trying to {getTriggerLabel(trigger)}. We&apos;ll only email a preview of your best {previewCount} leads.
            </p>

            <div className="mt-6 space-y-3">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-300/25"
              />
              {error ? <div className="text-sm text-rose-300">{error}</div> : null}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.92),rgba(20,184,166,0.95))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.24)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Sending preview...' : 'Send my preview'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 text-base font-semibold text-slate-200"
              >
                Maybe later
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">
              Preview Sent
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
              Your preview is on the way
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Check your inbox for a preview of your leads, then unlock the full list and keep generating leads.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {PLAN_OPTIONS.map((plan) => (
                <div
                  key={plan.name}
                  className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5"
                >
                  <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {plan.name}
                  </div>
                  <div className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                    {plan.price}
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-400">{plan.detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.92),rgba(20,184,166,0.95))] px-6 text-base font-semibold text-slate-950 shadow-[0_18px_40px_rgba(14,165,233,0.24)]"
              >
                Unlock full access
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 text-base font-semibold text-slate-200"
              >
                Keep exploring
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
