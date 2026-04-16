'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'

type OfferContext = {
  what_you_do: string
  who_you_help: string
  main_benefit: string
  angle: string
}

type ExpandedResult = {
  offer_context: OfferContext
  icp_expanded: string[]
  search_patterns: string[]
}

type Step = 'input' | 'thinking' | 'confirm' | 'activating'

const THINKING_MESSAGES = [
  'Understanding your offer...',
  'Expanding your audience...',
  'Mapping search patterns...',
  'Identifying target segments...',
  'Building your strategy...',
]

const DAILY_TARGET_PRESETS = [10, 25, 50]

export default function AgentSetupPage() {
  const router = useRouter()

  const [step, setStep] = useState<Step>('input')
  const [offer, setOffer] = useState('')
  const [audience, setAudience] = useState('')
  const [location, setLocation] = useState('')
  const [dailyTarget, setDailyTarget] = useState(10)
  const [customTarget, setCustomTarget] = useState('')
  const [cta, setCta] = useState('')
  const [sendWindow, setSendWindow] = useState('')
  const [senderSignature, setSenderSignature] = useState('')
  const [thinkingIndex, setThinkingIndex] = useState(0)
  const [expanded, setExpanded] = useState<ExpandedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAllIcp, setShowAllIcp] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isCustomTarget = !DAILY_TARGET_PRESETS.includes(dailyTarget)

  useEffect(() => {
    if (step === 'thinking') {
      intervalRef.current = setInterval(() => {
        setThinkingIndex((i) => (i + 1) % THINKING_MESSAGES.length)
      }, 2100)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [step])

  function handleCustomTargetChange(val: string) {
    setCustomTarget(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n > 0) setDailyTarget(n)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!offer.trim() || !audience.trim() || !location.trim() || !cta.trim()) return

    setError(null)
    setStep('thinking')

    try {
      const res = await fetch('/api/agent/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer: offer.trim(),
          audience: audience.trim(),
          location: location.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.result) {
        setError('Something went wrong. Please try again.')
        setStep('input')
        return
      }

      setExpanded(data.result as ExpandedResult)
      setStep('confirm')
    } catch {
      setError('Connection error. Please try again.')
      setStep('input')
    }
  }

  async function handleConfirm() {
    if (!expanded) return
    setStep('activating')

    try {
      const res = await fetch('/api/agent/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_input: offer,
          audience_input: audience,
          location_input: location,
          offer_context: expanded.offer_context,
          icp_expanded: expanded.icp_expanded,
          search_patterns: expanded.search_patterns,
          daily_target: dailyTarget,
          cta: cta.trim(),
          send_window: sendWindow.trim() || null,
          sender_signature: senderSignature.trim() || null,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.missionId) {
        setError("We couldn't create your mission. Please try again.")
        setStep('confirm')
        return
      }

      await new Promise((r) => setTimeout(r, 900))
      router.push(`/agent/dashboard/${data.missionId}`)
    } catch {
      setError("We couldn't create your mission. Please try again.")
      setStep('confirm')
    }
  }

  const canSubmit = offer.trim() && audience.trim() && location.trim() && cta.trim() && dailyTarget > 0

  return (
    <DashboardShell adminEmail={null}>
      <div className="flex min-h-[76vh] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          {/* Step heading */}
          <div className="mb-10 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              {step === 'activating' ? 'Activating' : 'Agent Setup'}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {step === 'input' && "Let's build your lead engine."}
              {step === 'thinking' && 'Thinking...'}
              {step === 'confirm' && 'Does this look right?'}
              {step === 'activating' && "I'm on it."}
            </h1>
          </div>

          {/* ── Step 1: Input ── */}
          {step === 'input' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="glass rounded-2xl p-6 space-y-5">
                {/* Offer */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    What are you offering?
                  </div>
                  <textarea
                    value={offer}
                    onChange={(e) => setOffer(e.target.value)}
                    placeholder="I help agencies get more clients through automated lead generation"
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-slate-600 outline-none focus:border-blue-400/40 focus:ring-1 focus:ring-blue-400/20 transition"
                    autoFocus
                  />
                </div>

                {/* Audience */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Who is it for?
                  </div>
                  <textarea
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="Marketing agencies, digital consultants, growth studios"
                    rows={2}
                    className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-slate-600 outline-none focus:border-blue-400/40 focus:ring-1 focus:ring-blue-400/20 transition"
                  />
                </div>

                {/* Location */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Where are your clients?
                  </div>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="US, UK"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-slate-600 outline-none focus:border-blue-400/40 focus:ring-1 focus:ring-blue-400/20 transition"
                  />
                </div>

                {/* Daily Target */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Daily lead target
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {DAILY_TARGET_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setDailyTarget(n); setCustomTarget('') }}
                        className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                          dailyTarget === n && !isCustomTarget
                            ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
                            : 'border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-white'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <input
                      type="number"
                      value={customTarget}
                      onChange={(e) => handleCustomTargetChange(e.target.value)}
                      placeholder="Custom"
                      min={1}
                      max={10000}
                      className={`w-24 rounded-xl border px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition bg-white/[0.04] focus:ring-1 focus:ring-blue-400/20 ${
                        isCustomTarget
                          ? 'border-blue-400/40 bg-blue-500/15'
                          : 'border-white/10 hover:border-white/20'
                      }`}
                    />
                  </div>
                </div>

                {/* CTA */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    What's your CTA?
                  </div>
                  <input
                    type="text"
                    value={cta}
                    onChange={(e) => setCta(e.target.value)}
                    placeholder="Book a 15-min strategy call"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-slate-600 outline-none focus:border-blue-400/40 focus:ring-1 focus:ring-blue-400/20 transition"
                  />
                </div>

                {/* Send Window (optional) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Send window
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-600">optional</span>
                  </div>
                  <input
                    type="text"
                    value={sendWindow}
                    onChange={(e) => setSendWindow(e.target.value)}
                    placeholder="Mon–Fri, 9am–5pm EST"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-slate-600 outline-none focus:border-blue-400/40 focus:ring-1 focus:ring-blue-400/20 transition"
                  />
                </div>

                {/* Email Signature (optional) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Email signature
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-600">optional</span>
                  </div>
                  <input
                    type="text"
                    value={senderSignature}
                    onChange={(e) => setSenderSignature(e.target.value)}
                    placeholder="e.g. Martin — ALPA Team"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-slate-600 outline-none focus:border-blue-400/40 focus:ring-1 focus:ring-blue-400/20 transition"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-xl border border-blue-400/25 bg-blue-500/12 px-5 py-3.5 text-sm font-semibold text-blue-100 shadow-[0_0_28px_rgba(59,130,246,0.18)] transition hover:bg-blue-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Build my lead engine
              </button>
            </form>
          )}

          {/* ── Step 2: Thinking ── */}
          {step === 'thinking' && (
            <div className="glass rounded-2xl p-8 space-y-8">
              <div className="flex items-center gap-3">
                <span className="flex h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.9)]" />
                <span
                  key={thinkingIndex}
                  className="text-base text-slate-300 transition-opacity duration-300"
                >
                  {THINKING_MESSAGES[thinkingIndex]}
                </span>
              </div>

              <div className="border-t border-white/8 pt-5 space-y-2 text-sm text-slate-500">
                <div><span className="text-slate-600">Offer:</span> {offer}</div>
                <div><span className="text-slate-600">For:</span> {audience}</div>
                <div><span className="text-slate-600">Where:</span> {location}</div>
                <div><span className="text-slate-600">Target:</span> {dailyTarget} leads/day</div>
              </div>
            </div>
          )}

          {/* ── Step 3: Confirm ── */}
          {step === 'confirm' && expanded && (
            <div className="space-y-4">
              <div className="glass rounded-2xl p-6 space-y-5">
                <div className="space-y-3 text-sm leading-relaxed">
                  <div>
                    <span className="text-slate-500">You help:</span>{' '}
                    <span className="text-white">{expanded.offer_context.who_you_help}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Offer:</span>{' '}
                    <span className="text-white">{expanded.offer_context.what_you_do}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Target:</span>{' '}
                    <span className="text-white">{location}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Daily target:</span>{' '}
                    <span className="text-white">{dailyTarget} leads/day</span>
                  </div>
                  <div>
                    <span className="text-slate-500">CTA:</span>{' '}
                    <span className="text-white">{cta}</span>
                  </div>
                </div>

                <div className="border-t border-white/8 pt-4 space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    I'll search for
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(showAllIcp ? expanded.icp_expanded : expanded.icp_expanded.slice(0, 5)).map((s) => (
                      <span
                        key={s}
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-sm text-slate-200"
                      >
                        {s}
                      </span>
                    ))}
                    {expanded.icp_expanded.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setShowAllIcp(!showAllIcp)}
                        className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1 text-sm text-slate-500 transition hover:text-slate-300"
                      >
                        {showAllIcp ? 'Show less' : `+${expanded.icp_expanded.length - 5} more`}
                      </button>
                    )}
                  </div>
                </div>

                <div className="border-t border-white/8 pt-4 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Angle
                  </div>
                  <div className="rounded-xl border border-blue-400/15 bg-blue-500/[0.07] px-4 py-3 text-sm italic text-blue-200">
                    "{expanded.offer_context.angle}"
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-5 py-3.5 text-sm font-semibold text-emerald-200 shadow-[0_0_24px_rgba(16,185,129,0.14)] transition hover:bg-emerald-500/18 hover:text-white"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Looks good — activate
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('input'); setExpanded(null) }}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3.5 text-sm font-medium text-slate-300 transition hover:bg-white/8 hover:text-white"
                >
                  Edit
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Activating ── */}
          {step === 'activating' && (
            <div className="glass rounded-2xl p-10 text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-500/10">
                <span className="h-3 w-3 animate-ping rounded-full bg-emerald-400" />
              </div>
              <p className="text-slate-400 text-sm">Activating your mission...</p>
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  )
}
