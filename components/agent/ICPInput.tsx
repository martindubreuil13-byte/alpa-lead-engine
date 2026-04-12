'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles, SquarePen, ThumbsUp } from 'lucide-react'

import AgentInsightPanel, { INSIGHT_POINTS } from '@/components/agent/AgentInsightPanel'
import ICPPreview, { type ICPPreviewData } from '@/components/agent/ICPPreview'

const MOCK_ICP: ICPPreviewData = {
  industries: ['Marketing agencies', 'Freelancers'],
  excluded: ['Hospitals', 'Manufacturing'],
  location: ['US', 'Canada'],
  company_size: 'Solo to small teams',
  pain_points: ['Inconsistent leads', 'Manual outreach'],
  angles: ['Automate client acquisition'],
}

function sleep(delay: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delay)
  })
}

const EXAMPLE_COPY = `I help freelancers and small agencies generate leads automatically.

Most of them waste hours every week manually searching and reaching out, which limits their growth.

My solution automates lead generation and outreach so they can focus on closing deals and delivering value.

The goal is to get them to try it for free and experience the speed and efficiency firsthand.`

const LOADING_MESSAGES = [
  'Analyzing your positioning...',
  'Defining target segments...',
]

export default function ICPInput() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<ICPPreviewData | null>(null)
  const [showExample, setShowExample] = useState(false)
  const [showMobileHowItWorks, setShowMobileHowItWorks] = useState(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)

  useEffect(() => {
    if (!loading) {
      setLoadingMessageIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % LOADING_MESSAGES.length)
    }, 700)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [loading])

  async function generateIcp() {
    if (!input.trim()) return

    setLoading(true)
    await sleep(1000)
    setPreview(MOCK_ICP)
    setLoading(false)
  }

  async function regenerateIcp() {
    if (!input.trim()) return

    setLoading(true)
    await sleep(1000)
    setPreview(MOCK_ICP)
    setLoading(false)
  }

  if (preview) {
    return (
      <div className="space-y-4">
        <ICPPreview data={preview} />

        <div className="glass p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => console.log('approved')}
              className="btn-primary min-h-[52px] w-full gap-2 rounded-2xl text-sm font-semibold sm:w-auto sm:px-5"
            >
              <ThumbsUp className="h-4 w-4" />
              <span>Approve</span>
            </button>

            <button
              type="button"
              onClick={() => setPreview(null)}
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
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
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
            disabled={loading || !input.trim()}
            className={`btn-primary min-h-[56px] w-full gap-2 rounded-2xl text-sm font-semibold ${
              loading || !input.trim()
                ? 'cursor-not-allowed border-white/10 bg-white/[0.05] text-slate-500 shadow-none hover:bg-white/[0.05]'
                : 'shadow-[0_18px_40px_rgba(59,130,246,0.18)]'
            }`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>{loading ? LOADING_MESSAGES[loadingMessageIndex] : 'Generate ICP'}</span>
          </button>
        </div>
      </section>

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
    </div>
  )
}
