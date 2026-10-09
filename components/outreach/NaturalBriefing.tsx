'use client'

import { useMemo, useState } from 'react'

export type DesiredAction =
  | 'book_meeting'
  | 'request_quotation'
  | 'visit_website'
  | 'reply'
  | 'schedule_demo'
  | 'call'

export type PreparationMode = 'self' | 'assist' | 'review'

export interface OutreachBriefing {
  offering: string
  audience: string
  desiredAction: DesiredAction
  desiredActionLabel: string
  ctaDetail: string
  preparationMode: PreparationMode
}

interface NaturalBriefingProps {
  onNext: (briefing: OutreachBriefing) => void
}

type BriefingStage = 'offering' | 'audience' | 'action' | 'cta' | 'mode'

const ACTION_OPTIONS: Array<{
  value: DesiredAction
  label: string
  detailLabel?: string
  detailPlaceholder?: string
  detailOptional?: boolean
}> = [
  {
    value: 'book_meeting',
    label: 'Book a meeting',
    detailLabel: 'Booking link',
    detailPlaceholder: 'Example: https://calendly.com/your-name/intro',
  },
  {
    value: 'request_quotation',
    label: 'Request a quotation',
    detailLabel: 'Quotation page or instructions',
    detailPlaceholder: 'Example: Reply with your project details, or https://...',
    detailOptional: true,
  },
  {
    value: 'visit_website',
    label: 'Visit your website',
    detailLabel: 'Website URL',
    detailPlaceholder: 'Example: https://yourcompany.com',
  },
  {
    value: 'reply',
    label: 'Reply to the message',
  },
  {
    value: 'schedule_demo',
    label: 'Schedule a demo',
    detailLabel: 'Demo booking link',
    detailPlaceholder: 'Example: https://calendly.com/your-name/demo',
  },
  {
    value: 'call',
    label: 'Call you',
    detailLabel: 'Phone number',
    detailPlaceholder: 'Example: +1 555 010 1234',
  },
]

const PREPARATION_OPTIONS: Array<{
  value: PreparationMode
  label: string
  note: string
}> = [
  {
    value: 'review',
    label: 'Prepare everything for review',
    note: 'Recommended. ALPA drafts the outreach, you approve before sending.',
  },
  {
    value: 'assist',
    label: 'Help me write it',
    note: 'Use ALPA for structure and personalization, keep more control.',
  },
  {
    value: 'self',
    label: "I'll write it myself",
    note: 'Use the business recommendation, then write the message manually.',
  },
]

const AUDIENCE_SUGGESTIONS = [
  'Tech startups',
  'Restaurants',
  'Dental clinics',
  'Marketing agencies',
  'Accounting firms',
  'Small manufacturers',
  'Founder-led companies',
]

function compact(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function isBroadAudience(value: string) {
  const cleaned = compact(value).toLowerCase()
  if (!cleaned) return false

  return ['businesses', 'companies', 'small businesses', 'smes', 'startups'].includes(cleaned)
}

function offerObservation(offering: string) {
  const cleaned = compact(offering)
  if (!cleaned) return ''

  if (/\b(coach|consult|strategy|architecture|advisory|service|agency)\b/i.test(cleaned)) {
    return 'This is a high-trust offer, so the audience matters more than volume.'
  }

  if (/\b(software|platform|tool|app|automation|system)\b/i.test(cleaned)) {
    return 'This needs buyers with a clear operational pain and enough maturity to act.'
  }

  return 'Good. I will use this to judge who is most likely to respond.'
}

function actionNeedsDetail(action: DesiredAction | null) {
  if (!action) return false
  return action !== 'reply'
}

function getActionOption(action: DesiredAction | null) {
  return ACTION_OPTIONS.find((option) => option.value === action) || null
}

export function NaturalBriefing({ onNext }: NaturalBriefingProps) {
  const [stage, setStage] = useState<BriefingStage>('offering')
  const [offering, setOffering] = useState('')
  const [audience, setAudience] = useState('')
  const [desiredAction, setDesiredAction] = useState<DesiredAction | null>(null)
  const [customAction, setCustomAction] = useState('')
  const [ctaDetail, setCtaDetail] = useState('')
  const [preparationMode, setPreparationMode] = useState<PreparationMode>('review')

  const selectedAction = getActionOption(desiredAction)
  const actionLabel = desiredAction
    ? selectedAction?.label || compact(customAction)
    : compact(customAction)
  const requiresDetail = actionNeedsDetail(desiredAction)
  const canContinueFromAction = Boolean(desiredAction || compact(customAction))
  const canContinueFromCta =
    !requiresDetail || selectedAction?.detailOptional || compact(ctaDetail).length > 0

  const previousAnswers = useMemo(
    () => [
      { label: 'Selling', value: compact(offering), active: stage === 'offering' },
      { label: 'Reaching', value: compact(audience), active: stage === 'audience' },
      { label: 'Action', value: actionLabel, active: stage === 'action' || stage === 'cta' },
    ].filter((item) => item.value && !item.active),
    [actionLabel, audience, offering, stage]
  )

  const handleOfferingContinue = () => {
    if (!compact(offering)) return
    setStage('audience')
  }

  const handleAudienceContinue = () => {
    if (!compact(audience)) return
    setStage('action')
  }

  const handleActionContinue = () => {
    if (!canContinueFromAction) return
    setStage(requiresDetail ? 'cta' : 'mode')
  }

  const handleCtaContinue = () => {
    if (!canContinueFromCta) return
    setStage('mode')
  }

  const handleModeContinue = () => {
    if (!compact(offering) || !compact(audience) || !actionLabel) return

    onNext({
      offering: compact(offering),
      audience: compact(audience),
      desiredAction: desiredAction || 'reply',
      desiredActionLabel: actionLabel,
      ctaDetail: compact(ctaDetail),
      preparationMode,
    })
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300/80">
          Prepare today's outreach
        </p>
        <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
          Prepare today&apos;s client acquisition.
        </h1>
      </div>

      {previousAnswers.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {previousAnswers.map((answer) => (
            <button
              key={answer.label}
              type="button"
              onClick={() => {
                if (answer.label === 'Selling') setStage('offering')
                if (answer.label === 'Reaching') setStage('audience')
                if (answer.label === 'Action') setStage('action')
              }}
              className="rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2 text-left text-xs text-slate-400 transition hover:border-white/16 hover:text-slate-200"
            >
              <span className="mr-2 text-slate-500">{answer.label}</span>
              <span className="text-slate-300">{answer.value}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(8,13,25,0.72))] p-5 shadow-[0_18px_54px_rgba(2,8,23,0.24)] sm:p-6">
        {stage === 'offering' ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold leading-8 text-white">
                Tell me about the product or service you want to sell today.
              </h2>
            </div>
            <textarea
              value={offering}
              onChange={(event) => setOffering(event.target.value)}
              placeholder="Example: business architecture coaching for early-stage companies preparing to scale"
              className="min-h-36 w-full resize-none rounded-lg border border-violet-300/24 bg-white/[0.06] px-5 py-4 text-lg leading-8 text-white outline-none transition placeholder:italic placeholder:text-slate-500/55 focus:border-violet-200/70 focus:bg-white/[0.08]"
            />
            <button
              type="button"
              onClick={handleOfferingContinue}
              disabled={!compact(offering)}
              className="rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Continue
            </button>
          </div>
        ) : null}

        {stage === 'audience' ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-violet-300/14 bg-violet-400/8 px-4 py-3 text-sm leading-6 text-violet-100">
              {offerObservation(offering)}
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold leading-8 text-white">
                Who do you want to reach today?
              </h2>
              <p className="text-sm leading-6 text-slate-400">
                Pick one segment for this outreach, even if your business can serve more.
              </p>
            </div>
            <input
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              placeholder="Example: founder-led SaaS companies with small sales teams"
              className="w-full rounded-lg border border-violet-300/24 bg-white/[0.06] px-5 py-4 text-lg text-white outline-none transition placeholder:italic placeholder:text-slate-500/55 focus:border-violet-200/70 focus:bg-white/[0.08]"
            />
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setAudience(suggestion)}
                  className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-slate-300 transition hover:border-violet-300/34 hover:text-white"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            {isBroadAudience(audience) ? (
              <p className="rounded-lg border border-amber-300/16 bg-amber-300/8 px-4 py-3 text-sm leading-6 text-amber-100">
                That is broad. You could narrow this to startups, SMEs, agencies, or founder-led service businesses.
              </p>
            ) : null}
            <button
              type="button"
              onClick={handleAudienceContinue}
              disabled={!compact(audience)}
              className="rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Continue
            </button>
          </div>
        ) : null}

        {stage === 'action' ? (
          <div className="space-y-5">
            <h2 className="text-2xl font-semibold leading-8 text-white">
              What should they do after receiving your message?
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {ACTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setDesiredAction(option.value)
                    setCustomAction('')
                    setCtaDetail('')
                  }}
                  className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                    desiredAction === option.value
                      ? 'border-violet-200/70 bg-violet-400/18 text-white'
                      : 'border-white/10 bg-white/[0.035] text-slate-300 hover:border-white/20 hover:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              value={customAction}
              onChange={(event) => {
                setCustomAction(event.target.value)
                setDesiredAction(null)
                setCtaDetail('')
              }}
              placeholder="Or type a specific action"
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-5 py-4 text-base text-white outline-none transition placeholder:italic placeholder:text-slate-500/55 focus:border-violet-200/60"
            />
            <button
              type="button"
              onClick={handleActionContinue}
              disabled={!canContinueFromAction}
              className="rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Continue
            </button>
          </div>
        ) : null}

        {stage === 'cta' && selectedAction ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold leading-8 text-white">
                Add the destination for that action.
              </h2>
              <p className="text-sm leading-6 text-slate-400">
                This gives the outreach a concrete next step.
              </p>
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-200">
                {selectedAction.detailLabel}
                {selectedAction.detailOptional ? (
                  <span className="ml-2 text-slate-500">(optional)</span>
                ) : null}
              </span>
              <input
                value={ctaDetail}
                onChange={(event) => setCtaDetail(event.target.value)}
                placeholder={selectedAction.detailPlaceholder}
                className="w-full rounded-lg border border-violet-300/24 bg-white/[0.06] px-5 py-4 text-lg text-white outline-none transition placeholder:italic placeholder:text-slate-500/55 focus:border-violet-200/70 focus:bg-white/[0.08]"
              />
            </label>
            <button
              type="button"
              onClick={handleCtaContinue}
              disabled={!canContinueFromCta}
              className="rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Continue
            </button>
          </div>
        ) : null}

        {stage === 'mode' ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold leading-8 text-white">
                How would you like to prepare the outreach?
              </h2>
              <p className="text-sm leading-6 text-slate-400">
                You stay in control. Nothing is sent from this preparation step.
              </p>
            </div>
            <div className="grid gap-3">
              {PREPARATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPreparationMode(option.value)}
                  className={`rounded-lg border px-4 py-4 text-left transition ${
                    preparationMode === option.value
                      ? 'border-violet-200/70 bg-violet-400/18'
                      : 'border-white/10 bg-white/[0.035] hover:border-white/20'
                  }`}
                >
                  <span className="block text-base font-semibold text-white">{option.label}</span>
                  <span className="mt-1 block text-sm leading-6 text-slate-400">{option.note}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleModeContinue}
              className="rounded-lg bg-violet-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-400"
            >
              Continue to recommendations
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
