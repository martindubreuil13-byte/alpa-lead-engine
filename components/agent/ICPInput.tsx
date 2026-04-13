'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronUp,
  Globe,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  SquarePen,
  ThumbsUp,
} from 'lucide-react'

import type { ICPData } from '@/lib/ai/icp'
import AgentInsightPanel, { INSIGHT_POINTS } from '@/components/agent/AgentInsightPanel'
import ICPPreview from '@/components/agent/ICPPreview'
import MissionBuilder from '@/components/agent/MissionBuilder'

type SavedIcpRecord = {
  id: string
  data: ICPData
  isActive: boolean
  status: string
  createdAt: string
}

type ICPInputProps = {
  initialSavedIcps?: SavedIcpRecord[]
  builderOnly?: boolean
}

const EXAMPLE_COPY = `I help freelancers and small agencies generate leads automatically.

Most of them waste hours every week manually searching and reaching out, which limits their growth.

My solution automates lead generation and outreach so they can focus on closing deals and delivering value.

The goal is to get them to try it for free and experience the speed and efficiency firsthand.`

const STEPS = [
  'Understanding your offer',
  'Identifying target businesses',
  'Mapping pain points',
  'Finalizing your ICP',
]

export default function ICPInput({ initialSavedIcps = [], builderOnly = false }: ICPInputProps) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{ id: string | null; data: ICPData } | null>(null)
  const [savedIcps, setSavedIcps] = useState<SavedIcpRecord[]>(initialSavedIcps)
  const [showBuilder, setShowBuilder] = useState(() => builderOnly || initialSavedIcps.length === 0)
  const [showExample, setShowExample] = useState(false)
  const [showMobileHowItWorks, setShowMobileHowItWorks] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [locationMode, setLocationMode] = useState<'global' | 'custom'>('global')
  const [locationInput, setLocationInput] = useState('')
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  const activeIcp = savedIcps.find((item) => item.isActive) ?? null
  const draftIcps = savedIcps.filter((item) => !item.isActive)

  useEffect(() => {
    if (!loading) {
      setStepIndex(0)
    }
  }, [loading])

  useEffect(() => {
    if (!loading || stepIndex >= STEPS.length - 1) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setStepIndex((current) => Math.min(current + 1, STEPS.length - 1))
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loading, stepIndex])

  async function generateIcp() {
    if (!input.trim()) return

    setLoading(true)
    setStepIndex(0)
    setError(null)
    setWarning(null)

    try {
      const response = await fetch('/api/agent/icp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input,
          location: locationMode === 'global' ? 'Global' : locationInput,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed')
      }

      const nextPreview = {
        industries: data.target_businesses,
        excluded: [],
        location: data.locations,
        company_size: '',
        pain_points: data.pain_points,
        angles: data.messaging_angles,
        summary: data.summary,
      }

      const savedRecordId = typeof data.saved_record_id === 'string' ? data.saved_record_id : null

      if (savedRecordId) {
        setSavedIcps((current) => [
          {
            id: savedRecordId,
            data: nextPreview,
            isActive: Boolean(data.is_active),
            status: typeof data.status === 'string' ? data.status : 'draft',
            createdAt: new Date().toISOString(),
          },
          ...current,
        ])
      }

      setPreview({
        id: savedRecordId,
        data: nextPreview,
      })
    } catch (err) {
      console.error(err)
      setError('Failed to generate ICP')
      alert('Failed to generate ICP')
    } finally {
      setLoading(false)
    }
  }

  async function regenerateIcp() {
    if (!input.trim()) return

    await generateIcp()
  }

  function startOver() {
    setPreview(null)
    setInput('')
    setLocationInput('')
    setLocationMode('global')
    setError(null)
    setWarning(null)
    setStepIndex(0)
    setShowBuilder(builderOnly || savedIcps.length === 0)
  }

  async function activateIcp(id: string | null) {
    if (!id) return

    setActionLoadingId(id)
    setError(null)

    try {
      const response = await fetch('/api/agent/icp/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to activate ICP')
      }

      setSavedIcps((current) =>
        current.map((item) => ({
          ...item,
          isActive: item.id === id,
          status: item.id === id ? 'active' : 'draft',
        }))
      )

      setPreview(null)
      setShowBuilder(builderOnly ? true : false)
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Failed to activate ICP')
    } finally {
      setActionLoadingId(null)
    }
  }

  async function deleteIcp(id: string | null) {
    if (!id) return

    setActionLoadingId(id)
    setError(null)

    try {
      const response = await fetch('/api/agent/icp/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete ICP')
      }

      const remainingIcps = savedIcps.filter((item) => item.id !== id)
      setSavedIcps(remainingIcps)
      setPreview((current) => (current?.id === id ? null : current))
      setShowBuilder((current) => current || builderOnly || remainingIcps.length === 0)
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Failed to delete ICP')
    } finally {
      setActionLoadingId(null)
    }
  }

  if (preview) {
    return (
      <div className="space-y-4">
        {warning ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {warning}
          </div>
        ) : null}

        <section className="glass overflow-hidden p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200">
              Draft
            </span>
          </div>
          <ICPPreview data={preview.data} />
        </section>

        <div className="glass p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => {
                void activateIcp(preview.id)
              }}
              disabled={!preview.id || actionLoadingId === preview.id}
              className="btn-primary min-h-[52px] w-full gap-2 rounded-2xl text-sm font-semibold sm:w-auto sm:px-5"
            >
              <ThumbsUp className="h-4 w-4" />
              <span>{actionLoadingId === preview.id ? 'Activating...' : 'Activate ICP'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPreview(null)
                setShowBuilder(true)
              }}
              className="btn-secondary min-h-[52px] w-full gap-2 rounded-2xl border-white/10 bg-white/[0.04] text-slate-100 sm:w-auto sm:px-5"
            >
              <SquarePen className="h-4 w-4" />
              <span>Edit</span>
            </button>

            <button
              type="button"
              onClick={() => {
                void regenerateIcp()
              }}
              disabled={loading}
              className={`btn-secondary min-h-[52px] w-full gap-2 rounded-2xl sm:w-auto sm:px-5 ${
                loading ? 'cursor-not-allowed text-slate-500' : 'text-slate-100'
              }`}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span>{loading ? 'Regenerating...' : 'Regenerate'}</span>
            </button>

            <button
              type="button"
              onClick={startOver}
              className="btn-secondary min-h-[52px] w-full rounded-2xl border-white/10 bg-white/[0.04] text-slate-200 sm:w-auto sm:px-5"
            >
              Start Over
            </button>

            {preview.id ? (
              <button
                type="button"
                onClick={() => {
                  void deleteIcp(preview.id)
                }}
                disabled={actionLoadingId === preview.id}
                className="btn-secondary min-h-[52px] w-full rounded-2xl border-white/10 bg-white/[0.04] text-slate-200 sm:w-auto sm:px-5"
              >
                {actionLoadingId === preview.id ? 'Deleting...' : 'Delete ICP'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!builderOnly && activeIcp ? (
        <section className="glass overflow-hidden p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                Active ICP
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  Current targeting strategy
                </h2>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100">
                  Active
                </span>
              </div>
            </div>

            {!showBuilder ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowBuilder(true)}
                  className="btn-secondary min-h-[48px] rounded-2xl border-white/10 bg-white/[0.04] px-4 text-slate-100"
                >
                  Create new ICP
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteIcp(activeIcp.id)
                  }}
                  disabled={actionLoadingId === activeIcp.id}
                  className="btn-secondary min-h-[48px] rounded-2xl border-white/10 bg-white/[0.04] px-4 text-slate-200"
                >
                  {actionLoadingId === activeIcp.id ? 'Deleting...' : 'Delete ICP'}
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-5">
            <ICPPreview data={activeIcp.data} />
          </div>

          <div className="mt-5">
            <MissionBuilder icpId={activeIcp.id} />
          </div>
        </section>
      ) : null}

      {draftIcps.length > 0 && !preview ? (
        <section className="glass overflow-hidden p-4 sm:p-6">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
              Draft ICPs
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Saved strategies waiting to be activated
            </h2>
          </div>

          <div className="mt-5 space-y-4">
            {draftIcps.map((draft) => (
              <div key={draft.id} className="rounded-3xl border border-white/8 bg-white/[0.02] p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200">
                    Draft
                  </span>
                  <div className="text-xs text-slate-500">
                    {new Date(draft.createdAt).toLocaleDateString()}
                  </div>
                </div>

                <ICPPreview data={draft.data} />

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      void activateIcp(draft.id)
                    }}
                    disabled={actionLoadingId === draft.id}
                    className="btn-primary min-h-[48px] rounded-2xl sm:px-5"
                  >
                    {actionLoadingId === draft.id ? 'Activating...' : 'Activate ICP'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void deleteIcp(draft.id)
                    }}
                    disabled={actionLoadingId === draft.id}
                    className="btn-secondary min-h-[48px] rounded-2xl border-white/10 bg-white/[0.04] px-4 text-slate-200"
                  >
                    {actionLoadingId === draft.id ? 'Deleting...' : 'Delete ICP'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showBuilder ? (
        <section className="glass p-4 sm:p-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
                ICP Builder
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                Describe your ideal customer in plain language
              </h2>
              <p className="text-sm leading-6 text-slate-400">
                Start with what you sell, who you help, and the outcome you create. Agent Mode will shape it into a structured ICP.
              </p>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
              <button
                type="button"
                onClick={() => setShowExample((current) => !current)}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-medium text-slate-100 transition hover:bg-white/[0.03]"
              >
                <span>Need inspiration?</span>
                {showExample ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>

              {showExample ? (
                <div className="rounded-xl border border-white/10 bg-[#0a1424]/75 p-4 text-sm leading-7 text-slate-300">
                  {EXAMPLE_COPY}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3 sm:p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                Location
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setLocationMode('global')}
                  className={`min-h-[48px] rounded-2xl border px-4 text-sm transition sm:flex-1 ${
                    locationMode === 'global'
                      ? 'border-blue-400/24 bg-blue-500/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300'
                  }`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <Globe className="h-4 w-4" />
                    <span>Global</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setLocationMode('custom')}
                  className={`min-h-[48px] rounded-2xl border px-4 text-sm transition sm:flex-1 ${
                    locationMode === 'custom'
                      ? 'border-blue-400/24 bg-blue-500/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300'
                  }`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <MapPin className="h-4 w-4" />
                    <span>Custom</span>
                  </span>
                </button>
              </div>

              {locationMode === 'custom' ? (
                <label className="mt-3 block">
                  <span className="sr-only">Custom location</span>
                  <input
                    value={locationInput}
                    onChange={(event) => setLocationInput(event.target.value)}
                    placeholder="e.g. United States, Europe, Quebec"
                    className="input min-h-[52px] rounded-2xl bg-[#06101f]/90 px-4 text-sm text-white transition duration-200 focus:ring-2 focus:ring-blue-500/40"
                  />
                </label>
              ) : null}
            </div>

            <label className="block">
              <span className="sr-only">ICP description</span>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={7}
                placeholder="Describe what you do, who you help, and the problem you solve..."
                className={`input min-h-[188px] rounded-2xl bg-[#06101f]/90 px-4 py-4 text-sm leading-7 text-white transition duration-200 focus:ring-2 focus:ring-blue-500/40 ${
                  input.trim()
                    ? 'shadow-[0_0_0_1px_rgba(59,130,246,0.08),0_0_28px_rgba(59,130,246,0.08),inset_0_1px_0_rgba(255,255,255,0.03)]'
                    : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                }`}
              />
            </label>

            <button
              type="button"
              onClick={() => {
                void generateIcp()
              }}
              disabled={loading || !input.trim() || (locationMode === 'custom' && !locationInput.trim())}
              className={`btn-primary min-h-[56px] w-full gap-2 rounded-2xl text-sm font-semibold ${
                loading || !input.trim() || (locationMode === 'custom' && !locationInput.trim())
                  ? 'cursor-not-allowed border-white/10 bg-white/[0.05] text-slate-500 shadow-none hover:bg-white/[0.05]'
                  : 'shadow-[0_18px_40px_rgba(59,130,246,0.18)]'
              }`}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="flex items-center gap-1.5">
                <span>{loading ? STEPS[stepIndex] : 'Generate ICP'}</span>
                {loading ? <span className="animate-pulse text-blue-100/80">...</span> : null}
              </span>
            </button>

            {error ? (
              <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {!builderOnly ? (
      <section className="glass p-4 lg:hidden">
        <button
          type="button"
          onClick={() => setShowMobileHowItWorks((current) => !current)}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
              Guide
            </div>
            <div className="mt-1 text-base font-semibold text-white">How this works</div>
          </div>
          {showMobileHowItWorks ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {showMobileHowItWorks ? (
          <div className="mt-4 space-y-3">
            <AgentInsightPanel />
            <div className="hidden">
              {INSIGHT_POINTS.join('')}
            </div>
          </div>
        ) : null}
      </section>
      ) : null}
    </div>
  )
}
