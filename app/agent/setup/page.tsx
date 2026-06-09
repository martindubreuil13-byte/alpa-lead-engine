'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronRight, Loader2, Plus, Target, X, Zap } from 'lucide-react'

import DashboardShell from '@/components/dashboard/DashboardShell'
import type { UserCtaType } from '@/lib/agent/user-ctas'
import { isValidCtaValue, normalizeCtaValue, normalizeMissionCta } from '@/lib/agent/user-ctas'
import { safeFetch } from '@/lib/utils/safeFetch'

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

type MissionCtaForm = {
  id: string
  label: string
  type: UserCtaType
  value: string
  is_active: boolean
}

type Step = 'input' | 'thinking' | 'loading' | 'icp' | 'activating' | 'processing' | 'success'

const THINKING_LINES = [
  'Understanding your offer...',
  'Expanding your audience...',
  'Mapping search signals...',
  'Identifying best-fit segments...',
  'Building your strategy...',
]

const TARGET_OPTIONS = [10, 25, 50]

function buildDefaultStartAtLocal() {
  const base = new Date(Date.now() + 60 * 60 * 1000)
  base.setSeconds(0, 0)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}T${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`
}

function createMissionCta(type: UserCtaType = 'link'): MissionCtaForm {
  return {
    id: crypto.randomUUID(),
    label: '',
    type,
    value: '',
    is_active: true,
  }
}

export default function AgentSetupPage() {
  const router = useRouter()

  const [step, setStep] = useState<Step>('input')
  const [offer, setOffer] = useState('')
  const [audience, setAudience] = useState('')
  const [location, setLocation] = useState('')
  const [dailyTarget, setDailyTarget] = useState(25)
  const [customTarget, setCustomTarget] = useState('')
  const [missionCtas, setMissionCtas] = useState<MissionCtaForm[]>([])
  const [senderSignature, setSenderSignature] = useState('')
  const [startMode, setStartMode] = useState<'now' | 'later'>('now')
  const [startAtLocal, setStartAtLocal] = useState(buildDefaultStartAtLocal)
  const [scheduleTimezone, setScheduleTimezone] = useState('UTC')
  const [thinkingIndex, setThinkingIndex] = useState(0)
  const [expanded, setExpanded] = useState<ExpandedResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ICP editing
  const [allSegments, setAllSegments] = useState<string[]>([])
  const [selectedSegments, setSelectedSegments] = useState<string[]>([])
  const [customTagInput, setCustomTagInput] = useState('')
  const [showAllSegments, setShowAllSegments] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isCustomTarget = !TARGET_OPTIONS.includes(dailyTarget)

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (detected) setScheduleTimezone(detected)
    } catch {}
  }, [])

  // Thinking ticker
  useEffect(() => {
    if (step === 'thinking' || step === 'loading' || step === 'processing') {
      setThinkingIndex(0)
      intervalRef.current = setInterval(() => {
        setThinkingIndex((i) => (i + 1) % THINKING_LINES.length)
      }, 1800)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [step])

  // Seed ICP segments when result arrives
  useEffect(() => {
    if (expanded) {
      setAllSegments(expanded.icp_expanded)
      setSelectedSegments(expanded.icp_expanded)
      setCustomTagInput('')
      setShowAllSegments(false)
    }
  }, [expanded])

  function toggleSegment(seg: string) {
    setSelectedSegments((prev) =>
      prev.includes(seg) ? prev.filter((s) => s !== seg) : [...prev, seg]
    )
  }

  function removeSegment(seg: string) {
    setAllSegments((prev) => prev.filter((s) => s !== seg))
    setSelectedSegments((prev) => prev.filter((s) => s !== seg))
  }

  function addCustomSegment() {
    const tag = customTagInput.trim()
    if (!tag || allSegments.includes(tag)) return
    setAllSegments((prev) => [...prev, tag])
    setSelectedSegments((prev) => [...prev, tag])
    setCustomTagInput('')
  }

  function handleCustomTarget(val: string) {
    setCustomTarget(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n > 0) setDailyTarget(n)
  }

  function updateMissionCta(id: string, patch: Partial<MissionCtaForm>) {
    setMissionCtas((prev) =>
      prev.map((cta) => (cta.id === id ? { ...cta, ...patch } : cta))
    )
  }

  function addMissionCta() {
    setMissionCtas((prev) => [...prev, createMissionCta()])
  }

  function removeMissionCta(id: string) {
    setMissionCtas((prev) => prev.filter((cta) => cta.id !== id))
  }

function serializeMissionCtas() {
    return missionCtas
      .map((cta) => {
        const normalized = normalizeMissionCta({
          id: cta.id,
          label: cta.label.trim() || cta.value.trim() || null,
          type: cta.type,
          value: normalizeCtaValue(cta.type, cta.value),
          is_active: cta.is_active,
        })
        return normalized
      })
      .filter((cta): cta is NonNullable<typeof cta> => Boolean(cta))
      .filter((cta) => {
        if (cta.type === 'none') {
          return Boolean(cta.label)
        }
        if (cta.type === 'text') {
          return Boolean(cta.label)
        }
        return Boolean(cta.label && isValidCtaValue(cta.type, cta.value))
      })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!offer.trim() || !audience.trim() || !location.trim()) return

    setError(null)
    setStep('thinking')

    try {
      const url = '/api/agent/setup'
      console.log('[FETCH CALL]', { url })
      const res = await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer: offer.trim(),
          audience: audience.trim(),
          location: location.trim(),
        }),
      }, { timeout: 30000 })

      const data = await res.json()
      console.log('[SETUP RESPONSE]', data)

      if (data?.timeout) {
        console.warn('[agent] setup request timed out; backend may still complete', { url, data })
        setStep('processing')
        return
      }

      const result = data?.result ?? data?.data ?? data

      if (!result) {
        console.error('[agent] API error', 'missing result', { url, data })
        setError('Something went wrong. Please try again.')
        setStep('input')
        return
      }

      setExpanded(result as ExpandedResult)
      setStep('success')
    } catch (err) {
      console.error('[agent] fetch failed', { url: '/api/agent/setup', err })
      setError('Connection error. Please try again.')
      setStep('input')
    }
  }

  async function handleActivate() {
    if (!expanded || selectedSegments.length === 0) return
    setStep('activating')

    try {
      const url = '/api/agent/confirm'
      console.log('[FETCH CALL]', { url })
      const res = await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offer_input: offer,
          audience_input: audience,
          location_input: location,
          offer_context: expanded.offer_context,
          icp_expanded: selectedSegments,
          search_patterns: expanded.search_patterns,
          daily_target: dailyTarget,
          ctas: serializeMissionCtas(),
          sender_signature: senderSignature.trim() || null,
          start_mode: startMode,
          start_at_local: startMode === 'later' ? startAtLocal : null,
          schedule_timezone: scheduleTimezone,
          schedule_local_time: startMode === 'later' ? startAtLocal.split('T')[1] || null : null,
        }),
      })

      const data = await res.json()
      console.log('[ACTIVATE RESPONSE]', data)

      if (data?.timeout) {
        console.warn('[agent] activation request timed out; backend may still complete', { url, data })
        setStep('loading')
        setTimeout(() => {
          window.location.href = '/agent'
        }, 1500)
        return
      }

      const missionId = data?.missionId ?? data?.result?.missionId ?? data?.data?.missionId

      if (!missionId) {
        console.error('[agent] API error', 'missing missionId', { url, data })
        const isDev = process.env.NODE_ENV !== 'production'
        const devDetail = isDev && data.details ? ` (${data.error}: ${data.details})` : ''
        setError(`Couldn't create your mission. Please try again.${devDetail}`)
        setStep('input')
        return
      }

      await new Promise((r) => setTimeout(r, 800))
      router.push(`/agent/dashboard/${missionId}`)
    } catch (err) {
      console.error('[agent] fetch failed', { url: '/api/agent/confirm', err })
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(
        process.env.NODE_ENV !== 'production'
          ? `Connection error: ${msg}`
          : "Couldn't create your mission. Please try again.",
      )
      setStep('icp')
    }
  }

  const canSubmit =
    offer.trim() &&
    audience.trim() &&
    location.trim() &&
    dailyTarget > 0 &&
    (startMode === 'now' || Boolean(startAtLocal))

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <DashboardShell adminEmail={null}>
      <div className="relative flex min-h-[84vh] flex-col items-center justify-center px-4 py-10">

        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(59,130,246,0.09),transparent_65%)] blur-[100px]" />
        </div>

        <div className="relative w-full max-w-lg">

          {/* ── Step label ── */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/[0.07] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-blue-300">
              <span className={`h-1.5 w-1.5 rounded-full ${step === 'activating' || step === 'success' ? 'animate-ping bg-emerald-400' : 'animate-pulse bg-blue-400'}`} />
              {step === 'input' && 'Mission Setup'}
              {step === 'thinking' && 'Building Strategy'}
              {step === 'loading' && 'Finishing Setup'}
              {step === 'processing' && 'Processing'}
              {step === 'icp' && 'Define Targets'}
              {step === 'activating' && 'Activating'}
              {step === 'success' && 'Strategy Ready'}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {step === 'input' && 'Define your mission.'}
              {step === 'thinking' && 'One moment...'}
              {step === 'loading' && 'Almost ready...'}
              {step === 'processing' && 'Almost ready...'}
              {step === 'icp' && 'Who should I target?'}
              {step === 'activating' && "I'm on it."}
              {step === 'success' && 'Who should I target?'}
            </h1>
            {step === 'input' && (
              <p className="mt-2 text-sm text-slate-500">
                Tell me what you sell and who needs it. I'll handle the strategy.
              </p>
            )}
          </div>

          {/* ── STEP 1: Input form ── */}
          {step === 'input' && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="glass overflow-hidden rounded-2xl">
                {/* Offer */}
                <div className="border-b border-white/[0.06] p-5">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    What do you sell?
                  </label>
                  <textarea
                    value={offer}
                    onChange={(e) => setOffer(e.target.value)}
                    placeholder="e.g. Automated lead generation for marketing agencies"
                    rows={2}
                    className="w-full resize-none bg-transparent text-[15px] text-white placeholder:text-slate-700 outline-none"
                    autoFocus
                  />
                </div>

                {/* Audience */}
                <div className="border-b border-white/[0.06] p-5">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    Who buys it?
                  </label>
                  <textarea
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="e.g. Marketing agencies, SEO consultants, growth studios"
                    rows={2}
                    className="w-full resize-none bg-transparent text-[15px] text-white placeholder:text-slate-700 outline-none"
                  />
                </div>

                {/* Location */}
                <div className="p-5">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    Where are they?
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. United States, Toronto, UK"
                    className="w-full bg-transparent text-[15px] text-white placeholder:text-slate-700 outline-none"
                  />
                </div>
              </div>

              <div className="glass overflow-hidden rounded-2xl">
                {/* Daily target */}
                <div className="border-b border-white/[0.06] p-5">
                  <label className="mb-3 block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    Leads per day
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {TARGET_OPTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setDailyTarget(n); setCustomTarget('') }}
                        className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                          dailyTarget === n && !isCustomTarget
                            ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
                            : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <input
                      type="number"
                      value={customTarget}
                      onChange={(e) => handleCustomTarget(e.target.value)}
                      placeholder="Custom"
                      min={1}
                      max={10000}
                      className={`w-24 rounded-xl border bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition ${
                        isCustomTarget
                          ? 'border-blue-400/40 bg-blue-500/10'
                          : 'border-white/[0.08] hover:border-white/20'
                      }`}
                    />
                  </div>
                </div>

                {/* CTA */}
                <div className="border-b border-white/[0.06] p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                        Call To Action
                      </label>
                      <p className="text-sm text-slate-500">
                        Add one or more mission-specific CTAs. Drafts rotate active CTAs in order.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addMissionCta}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:text-white"
                    >
                      <Plus className="h-4 w-4" />
                      Add CTA
                    </button>
                  </div>

                  {missionCtas.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-4 text-sm text-slate-500">
                      No CTAs yet. Drafts will end with a soft close until you add one.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {missionCtas.map((cta) => (
                        <div
                          key={cta.id}
                          className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                              CTA
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateMissionCta(cta.id, { is_active: !cta.is_active })}
                                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                                  cta.is_active
                                    ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
                                    : 'border-white/[0.08] bg-white/[0.03] text-slate-500 hover:text-slate-300'
                                }`}
                              >
                                {cta.is_active ? 'Active' : 'Inactive'}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeMissionCta(cta.id)}
                                className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 text-slate-500 transition hover:text-slate-300"
                                aria-label="Delete CTA"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-[1.1fr_0.8fr]">
                            <input
                              type="text"
                              value={cta.label}
                              onChange={(e) => updateMissionCta(cta.id, { label: e.target.value })}
                              placeholder="e.g. Book a call"
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition hover:border-white/20 focus:border-blue-400/30"
                            />
                            <select
                              value={cta.type}
                              onChange={(e) =>
                                updateMissionCta(cta.id, {
                                  type: e.target.value as UserCtaType,
                                  value: e.target.value === 'none' ? '' : cta.value,
                                })
                              }
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition hover:border-white/20 focus:border-blue-400/30"
                            >
                              <option value="link">Link</option>
                              <option value="email">Email</option>
                              <option value="calendly">Calendly</option>
                              <option value="none">None</option>
                            </select>
                          </div>

                          {cta.type !== 'none' ? (
                            <input
                              type="text"
                              value={cta.value}
                              onChange={(e) => updateMissionCta(cta.id, { value: e.target.value })}
                              placeholder={
                                cta.type === 'email'
                                  ? 'you@example.com'
                                  : cta.type === 'calendly'
                                    ? 'https://calendly.com/your-handle'
                                    : 'https://your-link.com'
                              }
                              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition hover:border-white/20 focus:border-blue-400/30"
                            />
                          ) : (
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-slate-500">
                              This CTA will use a soft closing line with no link.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Schedule */}
                <div className="border-b border-white/[0.06] p-5 space-y-3">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    Schedule
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStartMode('now')}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                        startMode === 'now'
                          ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
                          : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                      }`}
                    >
                      Start now
                    </button>
                    <button
                      type="button"
                      onClick={() => setStartMode('later')}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                        startMode === 'later'
                          ? 'border-blue-400/40 bg-blue-500/15 text-blue-200'
                          : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                      }`}
                    >
                      Start later
                    </button>
                  </div>

                  {startMode === 'later' && (
                    <input
                      type="datetime-local"
                      value={startAtLocal}
                      onChange={(e) => setStartAtLocal(e.target.value)}
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition hover:border-white/20 focus:border-blue-400/30"
                    />
                  )}

                  <p className="text-xs text-slate-600">
                    Timezone: {scheduleTimezone}
                    {startMode === 'now'
                      ? ' • recurring runs will keep this local time'
                      : ' • recurring runs will follow this local time every day'}
                  </p>
                </div>

                {/* Signature (optional) */}
                <div className="p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <label className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                      Email signature
                    </label>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-700">optional</span>
                  </div>
                  <input
                    type="text"
                    value={senderSignature}
                    onChange={(e) => setSenderSignature(e.target.value)}
                    placeholder="e.g. Martin — ALPA"
                    className="w-full bg-transparent text-[15px] text-white placeholder:text-slate-700 outline-none"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-400/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="btn-primary-gold w-full gap-3"
              >
                Build my strategy
                <ChevronRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {/* ── STEP 2: Thinking ── */}
          {(step === 'thinking' || step === 'loading' || step === 'processing') && (
            <div className="space-y-4">
              <div className="glass overflow-hidden rounded-2xl p-8">
                {/* Animated orb */}
                <div className="mb-8 flex justify-center">
                  <div className="relative flex h-16 w-16 items-center justify-center">
                    <div className="absolute inset-0 animate-ping rounded-full bg-blue-500/20" />
                    <div className="absolute inset-2 animate-pulse rounded-full bg-blue-500/30" />
                    <Zap className="relative h-6 w-6 text-blue-300" strokeWidth={1.5} />
                  </div>
                </div>

                {/* Current task */}
                <div className="text-center">
                  <p
                    key={thinkingIndex}
                    className="text-base font-medium text-slate-300 transition-opacity duration-500"
                  >
                    {THINKING_LINES[thinkingIndex]}
                  </p>
                </div>

                {/* Dots */}
                <div className="mt-6 flex justify-center gap-1.5">
                  {THINKING_LINES.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${
                        i === thinkingIndex ? 'bg-blue-400' : 'bg-white/[0.08]'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Summary recap */}
              <div className="glass rounded-2xl px-5 py-4 space-y-2.5">
                {[
                  { label: 'Offer', value: offer },
                  { label: 'For', value: audience },
                  { label: 'Where', value: location },
                  { label: 'Target', value: `${dailyTarget} leads/day` },
                  {
                    label: 'Start',
                    value:
                      startMode === 'now'
                        ? `Now • ${scheduleTimezone}`
                        : `${new Date(startAtLocal).toLocaleString()} • ${scheduleTimezone}`,
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start gap-3 text-sm">
                    <span className="w-12 shrink-0 text-slate-600">{label}</span>
                    <span className="text-slate-400">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 3: ICP Review ── */}
          {(step === 'icp' || step === 'success') && expanded && (
            <div className="space-y-3">
              {/* Strategy summary card */}
              <div className="glass overflow-hidden rounded-2xl">
                <div className="border-b border-white/[0.06] px-5 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                    Strategy
                  </p>
                </div>
                <div className="space-y-3 p-5">
                  <div className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 text-slate-600">Your offer</span>
                    <span className="text-slate-300">{expanded.offer_context.what_you_do}</span>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 text-slate-600">Outcome</span>
                    <span className="text-slate-300">{expanded.offer_context.main_benefit}</span>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 text-slate-600">Target</span>
                    <span className="text-slate-300">{location} · {dailyTarget} leads/day</span>
                  </div>
                </div>
                {/* Angle highlight */}
                <div className="border-t border-blue-400/[0.12] bg-blue-500/[0.05] px-5 py-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-500/60">
                    Positioning Angle
                  </p>
                  <p className="mt-1.5 text-sm italic text-blue-200/80">
                    "{expanded.offer_context.angle}"
                  </p>
                </div>
              </div>

              {/* Segments */}
              <div className="glass overflow-hidden rounded-2xl">
                <div className="border-b border-white/[0.06] px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                        Target Segments
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Toggle, remove, or add your own
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-600">
                      {selectedSegments.length} active
                    </span>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Tag cloud */}
                  <div className="flex flex-wrap gap-2">
                    {(showAllSegments ? allSegments : allSegments.slice(0, 8)).map((seg) => {
                      const active = selectedSegments.includes(seg)
                      return (
                        <div
                          key={seg}
                          className={`inline-flex items-center gap-0.5 overflow-hidden rounded-xl border text-sm transition-all ${
                            active
                              ? 'border-blue-400/30 bg-blue-500/10 text-blue-200'
                              : 'border-white/[0.08] bg-white/[0.02] text-slate-500'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSegment(seg)}
                            className="px-3 py-1.5 text-left leading-none"
                          >
                            {seg}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSegment(seg)}
                            className="px-2 py-1.5 opacity-30 hover:opacity-70 transition"
                            aria-label={`Remove ${seg}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })}
                    {allSegments.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllSegments(!showAllSegments)}
                        className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-sm text-slate-600 transition hover:text-slate-400"
                      >
                        {showAllSegments ? 'Less' : `+${allSegments.length - 8} more`}
                      </button>
                    )}
                  </div>

                  {/* Add custom */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customTagInput}
                      onChange={(e) => setCustomTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addCustomSegment() }
                      }}
                      placeholder="Add a segment..."
                      className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-slate-700 outline-none focus:border-blue-400/30 transition"
                    />
                    <button
                      type="button"
                      onClick={addCustomSegment}
                      disabled={!customTagInput.trim()}
                      className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-slate-400 transition hover:border-blue-400/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Mission config reminder */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <Target className="h-4 w-4 shrink-0 text-slate-600" />
                <p className="text-xs text-slate-500">
                  {dailyTarget} leads/day · {startMode === 'now' ? 'starts now' : 'starts later'} · {serializeMissionCtas().length} active CTA{serializeMissionCtas().length === 1 ? '' : 's'}
                </p>
              </div>

              {error && (
                <div className="rounded-xl border border-red-400/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleActivate()}
                  disabled={selectedSegments.length === 0}
                  className="btn-primary-gold flex-1 gap-2.5"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Activate Mission
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('input'); setExpanded(null); setError(null) }}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-[15px] font-medium text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
                >
                  Edit
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Activating ── */}
          {step === 'activating' && (
            <div className="glass rounded-2xl p-12 text-center">
              <div className="mb-6 flex justify-center">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
                  <div className="absolute inset-2 rounded-full bg-emerald-500/20" />
                  <Loader2 className="relative h-6 w-6 animate-spin text-emerald-300" />
                </div>
              </div>
              <p className="text-base font-medium text-slate-300">Activating your mission...</p>
              <p className="mt-1.5 text-sm text-slate-600">Agent will start searching in moments.</p>
            </div>
          )}

        </div>
      </div>
    </DashboardShell>
  )
}
