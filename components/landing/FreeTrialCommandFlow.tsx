'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Mail, MapPin, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { enableGuestTrialMode } from '@/lib/session/guest-trial-mode'
import { resetGuestSession } from '@/lib/session/resetGuestSession'
import { getOrCreateGuestSessionId, saveGuestCaptureEmail, upsertGuestLead } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'
import { type TrialLead, FREE_TRIAL_LEAD_LIMIT } from '@/lib/trial'
import { trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { createAnalyticsSearchId, trackEvent } from '@/lib/track'

type Phase = 'closed' | 'input' | 'searching' | 'reward' | 'emailCapture' | 'emailSuccess' | 'error'

const STEPS = [
  'Scanning business records',
  'Finding active businesses',
  'Inspecting websites',
  'Checking contact availability',
  'Validating lead quality',
  'Preparing your lead list',
]

function countLeadContacts(leads: TrialLead[]) {
  return leads.reduce(
    (acc, lead) => {
      if (lead.email?.trim()) acc.email += 1
      if (lead.phone?.trim()) acc.phone += 1
      if (lead.website?.trim()) acc.website += 1
      return acc
    },
    { email: 0, phone: 0, website: 0 }
  )
}

// Steps 0-4 are scheduled; step 5 ("Preparing your lead list") revealed only on backend completion
const STEP_DELAYS = [0, 900, 1800, 3000, 4600]

function fmtMMSS(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-2 text-slate-500 transition-colors hover:text-white"
    >
      <X className="h-4 w-4" />
    </button>
  )
}

function CmdBar({
  onClick,
  disabled,
  prefix,
  label,
  dot = 'blue',
  conversion = false,
}: {
  onClick?: () => void
  disabled?: boolean
  prefix: string
  label: string
  dot?: 'blue' | 'emerald' | 'slate'
  conversion?: boolean
}) {
  const dotClass =
    dot === 'blue'
      ? 'bg-blue-400/60'
      : dot === 'emerald'
        ? 'bg-emerald-400/60'
        : 'bg-slate-600'

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group relative w-full overflow-hidden text-left backdrop-blur-xl',
        disabled
          ? 'cursor-not-allowed rounded-[13px] border border-white/[0.05] bg-[rgba(10,18,32,0.40)] px-4 py-3.5 opacity-40'
          : conversion
            ? 'btn-primary-gold justify-start'
            : 'rounded-[13px] border border-white/[0.10] bg-[rgba(10,18,32,0.72)] px-4 py-3.5 transition-all duration-300 hover:border-white/[0.17] hover:bg-[rgba(14,24,44,0.80)] active:scale-[0.99]'
      )}
    >
      <span className="relative flex items-center gap-3">
        <span className="flex shrink-0 items-center gap-2">
          <span className={cn('h-1.5 w-1.5 rounded-full', disabled ? 'bg-slate-700' : dotClass)} />
          <span className={cn('text-[10px] font-semibold uppercase tracking-[0.22em]', conversion ? 'text-[#081225]/60' : 'text-slate-600')}>
            {prefix}
          </span>
        </span>
        <span className={cn('h-3.5 w-px shrink-0', conversion ? 'bg-[#081225]/18' : 'bg-white/[0.07]')} aria-hidden="true" />
        <span
          className={cn(
            'text-sm font-medium tracking-[-0.01em] transition-colors duration-200',
            disabled ? 'text-slate-600' : conversion ? 'text-[#081225]' : 'text-slate-300 group-hover:text-white'
          )}
        >
          {label}
        </span>
        {!disabled && (
          <span
            aria-hidden="true"
            className={cn(
              'ml-0.5 shrink-0 transition-all duration-200 group-hover:translate-x-0.5',
              conversion ? 'text-[#081225]/65 group-hover:text-[#081225]' : 'text-slate-600 group-hover:text-slate-400'
            )}
          >
            →
          </span>
        )}
      </span>
    </button>
  )
}

function GhostBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-2.5 text-sm text-slate-400 transition hover:border-white/[0.10] hover:text-slate-300"
    >
      {label}
    </button>
  )
}

function TextLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-center text-xs text-slate-600 transition hover:text-slate-400"
    >
      {label}
    </button>
  )
}

function LeadRow({ lead }: { lead: TrialLead }) {
  const contact = lead.email ?? lead.phone
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5">
      <div className="truncate text-sm font-medium text-white">{lead.company_name}</div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
        {lead.city && (
          <>
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.city}</span>
          </>
        )}
        {lead.industry && (
          <>
            <span className="text-slate-700">·</span>
            <span className="truncate">{lead.industry}</span>
          </>
        )}
        {contact && (
          <>
            <span className="text-slate-700">·</span>
            <span className="min-w-0 truncate text-slate-400">{contact}</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── Persistent bottom card (shows when modal is closed after leads generated) ─

function PersistentCard({
  remainingFreeLeads,
  onReSearch,
  onUpgrade,
  onDismiss,
}: {
  remainingFreeLeads: number
  onReSearch: () => void
  onUpgrade: () => void
  onDismiss: () => void
}) {
  const isAtLimit = remainingFreeLeads === 0

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 pointer-events-none sm:bottom-6">
      <div className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-[16px] border border-white/[0.08] bg-[rgba(8,14,26,0.92)] px-4 py-3 shadow-[0_16px_40px_rgba(2,6,18,0.5)] backdrop-blur-xl">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            isAtLimit ? 'bg-slate-600' : 'bg-blue-400/60'
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
          {isAtLimit
            ? 'Ready to keep prospecting?'
            : `You still have ${remainingFreeLeads} free lead${remainingFreeLeads !== 1 ? 's' : ''} available.`}
        </span>
        <button
          type="button"
          onClick={isAtLimit ? onUpgrade : onReSearch}
          className="shrink-0 rounded-[10px] border border-white/[0.09] bg-[rgba(10,18,32,0.72)] px-3 py-2 text-xs font-medium text-slate-300 transition-all hover:border-white/[0.15] hover:text-white"
        >
          {isAtLimit ? 'View plans →' : 'Run another search →'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-slate-600 transition hover:text-slate-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ── Phase components ──────────────────────────────────────────────────────────

function InputPhase({
  businessType,
  setBusinessType,
  location,
  setLocation,
  leadCount,
  setLeadCount,
  remainingFreeLeads,
  isReSearch,
  onSubmit,
  onClose,
  inputRef,
}: {
  businessType: string
  setBusinessType: (v: string) => void
  location: string
  setLocation: (v: string) => void
  leadCount: number
  setLeadCount: (v: number) => void
  remainingFreeLeads: number
  isReSearch: boolean
  onSubmit: () => void
  onClose: () => void
  inputRef: React.RefObject<HTMLInputElement>
}) {
  const canSubmit = businessType.trim().length > 0 && location.trim().length > 0
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) onSubmit()
  }

  // Build available count options based on remaining allowance
  const countOptions: number[] = []
  if (remainingFreeLeads >= 10) countOptions.push(10)
  if (remainingFreeLeads >= 25) {
    countOptions.push(25)
  } else if (remainingFreeLeads > 0 && remainingFreeLeads !== 10) {
    countOptions.push(remainingFreeLeads)
  }
  const options = countOptions.length > 0 ? countOptions : [Math.max(1, remainingFreeLeads)]
  const safeCount = options.includes(leadCount) ? leadCount : options[options.length - 1]

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400/50" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              {isReSearch
                ? `${remainingFreeLeads} free lead${remainingFreeLeads !== 1 ? 's' : ''} remaining`
                : 'Free trial'}
            </span>
          </div>
          <h2
            id="trial-flow-title"
            className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl"
          >
            {isReSearch ? 'Run another search' : 'Run your first lead search'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">Tell ALPA what to find.</p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <div className="mt-6 space-y-3">
        <div>
          <label htmlFor="trial-biz" className="mb-1.5 block text-xs font-medium text-slate-500">
            Find businesses like
          </label>
          <input
            ref={inputRef}
            id="trial-biz"
            className="input"
            placeholder="SEO agencies"
            value={businessType}
            onChange={e => setBusinessType(e.target.value)}
            onKeyDown={handleKey}
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="trial-loc" className="mb-1.5 block text-xs font-medium text-slate-500">
            In
          </label>
          <input
            id="trial-loc"
            className="input"
            placeholder="London"
            value={location}
            onChange={e => setLocation(e.target.value)}
            onKeyDown={handleKey}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            Number of leads
          </label>
          <div className={cn('grid gap-2', options.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
            {options.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setLeadCount(n)}
                className={cn(
                  'rounded-xl border py-2.5 text-sm font-medium transition-all duration-200',
                  safeCount === n
                    ? 'border-blue-400/[0.28] bg-blue-500/[0.10] text-white'
                    : 'border-white/[0.07] bg-white/[0.03] text-slate-400 hover:border-white/[0.12] hover:text-slate-200'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            setLeadCount(safeCount)
            onSubmit()
          }}
          className={cn(
            canSubmit
              ? 'btn-primary-gold group w-full'
              : 'inline-flex min-h-[60px] w-full cursor-not-allowed items-center justify-center rounded-[13px] border border-white/[0.05] bg-[rgba(10,18,32,0.40)] px-7 text-base font-semibold text-slate-600 opacity-40'
          )}
        >
          Run free lead search
          {canSubmit ? (
            <span
              aria-hidden="true"
              className="ml-2 transition-transform duration-200 group-hover:translate-x-0.5"
            >
              →
            </span>
          ) : null}
        </button>
      </div>
    </>
  )
}

function SearchingPhase({
  businessType,
  location,
  elapsed,
  stepsRevealed,
}: {
  businessType: string
  location: string
  elapsed: number
  stepsRevealed: number
}) {
  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400/80" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Searching
          </span>
        </div>
        <h2
          id="trial-flow-title"
          className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl"
        >
          Finding {businessType.toLowerCase()} in {location}
        </h2>
        <div className="mt-2 font-mono text-3xl font-light tabular-nums text-slate-300 sm:text-4xl">
          {fmtMMSS(elapsed)}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {STEPS.map((step, i) => {
          const revealed = i < stepsRevealed
          const active = i === stepsRevealed - 1
          const done = revealed && !active

          return (
            <div
              key={step}
              style={{ transitionDelay: revealed ? `${i * 40}ms` : '0ms' }}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all duration-500',
                revealed
                  ? active
                    ? 'translate-y-0 border-blue-400/[0.16] bg-blue-500/[0.07] opacity-100'
                    : 'translate-y-0 border-white/[0.06] bg-white/[0.025] opacity-60'
                  : 'translate-y-1 border-transparent bg-transparent opacity-0'
              )}
            >
              {active ? (
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-400" />
              ) : done ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-slate-600" />
              ) : (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-700" />
              )}
              <span className={cn('text-sm', active ? 'text-slate-200' : 'text-slate-500')}>
                {step}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function RewardPhase({
  leads,
  requestedCount,
  businessType,
  location,
  elapsed,
  totalLeadsGenerated,
  totalElapsedSeconds,
  remainingFreeLeads,
  onViewLeads,
  onEmailCapture,
  onReSearch,
  onUpgrade,
  onClose,
}: {
  leads: TrialLead[]
  requestedCount: number
  businessType: string
  location: string
  elapsed: number
  totalLeadsGenerated: number
  totalElapsedSeconds: number
  remainingFreeLeads: number
  onViewLeads: () => void
  onEmailCapture: () => void
  onReSearch: () => void
  onUpgrade: () => void
  onClose: () => void
}) {
  const count = leads.length
  const isAtLimit = remainingFreeLeads === 0
  const fewerThanRequested = count < requestedCount
  const preview = leads.slice(0, 3)

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              {isAtLimit ? 'Free limit reached' : 'Search complete'}
            </span>
          </div>
          <h2
            id="trial-flow-title"
            className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl"
          >
            {isAtLimit
              ? `You generated ${totalLeadsGenerated} leads in ${totalElapsedSeconds} seconds.`
              : fewerThanRequested
                ? `You found ${count} validated leads in ${elapsed} seconds.`
                : `You found ${count} leads in ${elapsed} seconds.`}
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">
            {isAtLimit
              ? 'Imagine doing that every day.'
              : fewerThanRequested
                ? 'ALPA only keeps leads it can validate.'
                : 'That\'s how fast ALPA works.'}
          </p>
          {!isAtLimit && (
            <p className="mt-2 text-sm text-slate-400">
              You still have{' '}
              <span className="font-medium text-slate-200">
                {remainingFreeLeads} free lead{remainingFreeLeads !== 1 ? 's' : ''}
              </span>{' '}
              available.
            </p>
          )}
          {isAtLimit && (
            <p className="mt-1.5 text-xs text-slate-600">Plans start at $9.99/month.</p>
          )}
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {preview.length > 0 && (
        <div className="mt-5 space-y-1.5">
          {preview.map(lead => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
          {count > 3 && (
            <button
              type="button"
              onClick={onViewLeads}
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5 text-center text-xs text-slate-500 transition hover:border-white/[0.10] hover:text-slate-400"
            >
              +{count - 3} more in dashboard
            </button>
          )}
        </div>
      )}

      <div className="mt-5 space-y-2.5">
        {isAtLimit ? (
          <>
            <CmdBar onClick={onUpgrade} prefix="Plans" label="Continue prospecting" dot="blue" conversion />
            <GhostBtn onClick={onEmailCapture} label="Email my leads" />
            <TextLink onClick={onViewLeads} label="View leads" />
          </>
        ) : (
          <>
            <CmdBar onClick={onViewLeads} prefix="Your leads" label="View leads" dot="emerald" conversion />
            <GhostBtn onClick={onReSearch} label="Run another free search" />
            <TextLink onClick={onEmailCapture} label="Email my leads" />
          </>
        )}
      </div>
    </>
  )
}

function EmailCapturePhase({
  totalLeads,
  email,
  setEmail,
  emailError,
  emailSending,
  onSend,
  onSkip,
  onClose,
}: {
  totalLeads: number
  email: string
  setEmail: (v: string) => void
  emailError: string
  emailSending: boolean
  onSend: () => void
  onSkip: () => void
  onClose: () => void
}) {
  const canSend = email.trim().length > 0 && !emailSending

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-blue-400/70" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Send your lead list
            </span>
          </div>
          <h2
            id="trial-flow-title"
            className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl"
          >
            Send your {totalLeads} leads
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            We&apos;ll send your leads to your inbox so you can work them later.
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <div className="mt-6">
        <label htmlFor="trial-email" className="mb-1.5 block text-xs font-medium text-slate-500">
          Email address
        </label>
        <input
          id="trial-email"
          type="email"
          className="input"
          placeholder="name@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSend()}
          autoComplete="email"
        />
        {emailError && <p className="mt-2 text-xs text-rose-400">{emailError}</p>}
      </div>

      <div className="mt-5 space-y-2.5">
        <button
          type="button"
          disabled={!canSend}
          onClick={onSend}
          className={cn(
            canSend
              ? 'btn-primary-gold group w-full'
              : 'inline-flex min-h-[60px] w-full cursor-not-allowed items-center justify-center rounded-[13px] border border-white/[0.05] bg-[rgba(10,18,32,0.40)] px-7 text-base font-semibold text-slate-600 opacity-40'
          )}
        >
          {emailSending ? 'Sending…' : 'Send my leads'}
          {canSend && !emailSending ? (
            <span aria-hidden="true" className="ml-2 transition-transform duration-200 group-hover:translate-x-0.5">
              →
            </span>
          ) : null}
        </button>
        <GhostBtn onClick={onSkip} label="Skip — view leads in dashboard" />
      </div>
    </>
  )
}

function EmailSuccessPhase({
  email,
  totalLeadsGenerated,
  totalElapsedSeconds,
  remainingFreeLeads,
  onViewLeads,
  onReSearch,
  onUpgrade,
  onClose,
}: {
  email: string
  totalLeadsGenerated: number
  totalElapsedSeconds: number
  remainingFreeLeads: number
  onViewLeads: () => void
  onReSearch: () => void
  onUpgrade: () => void
  onClose: () => void
}) {
  const isAtLimit = remainingFreeLeads === 0

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/80" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Email sent
            </span>
          </div>
          <h2
            id="trial-flow-title"
            className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl"
          >
            Your lead list is on its way.
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            You generated{' '}
            <span className="text-slate-300">
              {totalLeadsGenerated} lead{totalLeadsGenerated !== 1 ? 's' : ''}
            </span>{' '}
            in{' '}
            <span className="text-slate-300">
              {totalElapsedSeconds} second{totalElapsedSeconds !== 1 ? 's' : ''}
            </span>
            . Check{' '}
            <span className="text-slate-300">{email}</span>.
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <div className="mt-6 space-y-2.5">
        {isAtLimit ? (
          <>
            <CmdBar onClick={onUpgrade} prefix="Plans" label="Continue prospecting" dot="blue" conversion />
            <GhostBtn onClick={onViewLeads} label="View leads" />
          </>
        ) : (
          <>
            <CmdBar onClick={onReSearch} prefix="Free trial" label="Run another free search" dot="blue" conversion />
            <GhostBtn onClick={onViewLeads} label="View leads" />
          </>
        )}
      </div>
    </>
  )
}

function ErrorPhase({ onAdjust, onClose }: { onAdjust: () => void; onClose: () => void }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Search incomplete
            </span>
          </div>
          <h2
            id="trial-flow-title"
            className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl"
          >
            No results found
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            ALPA could not complete that search. Try a broader business type or location.
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="mt-6">
        <CmdBar onClick={onAdjust} prefix="Search" label="Adjust search" dot="blue" />
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FreeTrialCommandFlow() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('closed')

  // Input
  const [businessType, setBusinessType] = useState('')
  const [location, setLocation] = useState('')
  const [leadCount, setLeadCount] = useState<number>(25)
  const [requestedCount, setRequestedCount] = useState<number>(25)

  // Current search
  const [summaryLine, setSummaryLine] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [stepsRevealed, setStepsRevealed] = useState(0)
  const [leads, setLeads] = useState<TrialLead[]>([])

  // Session cumulative (persists across multiple searches in same flow session)
  const [totalLeadsGenerated, setTotalLeadsGenerated] = useState(0)
  const [totalElapsedSeconds, setTotalElapsedSeconds] = useState(0)
  const [allLeads, setAllLeads] = useState<TrialLead[]>([])

  // Email
  const [email, setEmail] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailError, setEmailError] = useState('')

  // Persistent card
  const [cardDismissed, setCardDismissed] = useState(false)

  // Refs
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const elapsedRef = useRef(0)
  const isFirstSearchRef = useRef(true)

  const remainingFreeLeads = Math.max(0, FREE_TRIAL_LEAD_LIMIT - totalLeadsGenerated)
  const isAtLimit = remainingFreeLeads === 0

  // Let floating widgets yield while the modal owns the conversion surface.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(phase === 'closed' ? 'alpa:trial-flow-inactive' : 'alpa:trial-flow-active'),
    )
  }, [phase])

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('alpa:trial-flow-inactive'))
    }
  }, [])

  // Listen for open event
  useEffect(() => {
    const open = () => setPhase('input')
    window.addEventListener('alpa:open-trial-flow', open)
    return () => window.removeEventListener('alpa:open-trial-flow', open)
  }, [])

  // Focus input when phase opens
  useEffect(() => {
    if (phase !== 'input') return
    const t = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(t)
  }, [phase])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current)
      stepTimers.current.forEach(clearTimeout)
      abortRef.current?.abort()
    }
  }, [])

  function stopTimer() {
    timerRef.current && clearInterval(timerRef.current)
    timerRef.current = null
  }

  function clearStepTimers() {
    stepTimers.current.forEach(clearTimeout)
    stepTimers.current = []
  }

  const close = useCallback(() => {
    abortRef.current?.abort()
    stopTimer()
    clearStepTimers()
    setPhase('closed')
  }, [])

  const openForReSearch = useCallback(() => {
    setLeads([])
    setElapsed(0)
    setStepsRevealed(0)
    setSummaryLine('')
    setPhase('input')
    // businessType and location preserved intentionally for easy modification
  }, [])

  const startSearch = useCallback(async () => {
    if (!businessType.trim() || !location.trim()) return

    // First search only: setup guest session and auth
    if (isFirstSearchRef.current) {
      enableGuestTrialMode()
      resetGuestSession({ regenerateSessionId: true })
      await supabase.auth.signOut()
      sessionStorage.setItem('alpa_prospector_onboarding_seen', '1')
      isFirstSearchRef.current = false
    }

    const guestId = getOrCreateGuestSessionId()
    const analyticsSearchId = createAnalyticsSearchId()
    const effectiveCount = Math.min(leadCount, remainingFreeLeads)
    setRequestedCount(effectiveCount)
    setCardDismissed(false)

    trackGaEvent('free_trial_search_start', {
      business_type: businessType,
      location,
      lead_count: effectiveCount,
    })
    void trackEvent('trial_search_started', {
      search_id: analyticsSearchId,
      metadata: { source: 'trial_flow', business_type: businessType, location },
    })

    setPhase('searching')
    setElapsed(0)
    elapsedRef.current = 0
    setStepsRevealed(1)

    const collected: TrialLead[] = []

    // Real elapsed timer
    const startTime = Date.now()
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(s)
      elapsedRef.current = s
    }, 500)

    // Progressive step reveal with varied timing; step 5 revealed on completion
    clearStepTimers()
    STEP_DELAYS.forEach((delay, i) => {
      const t = setTimeout(() => setStepsRevealed(i + 1), delay)
      stepTimers.current.push(t)
    })

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: businessType.trim(),
          defaultCity: location.trim(),
          maxLeads: effectiveCount,
          outputLeadLimit: effectiveCount,
          guestSessionId: guestId,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(trimmed.slice(6))
            if (evt.type === 'lead' && evt.payload) {
              const lead = evt.payload as TrialLead
              collected.unshift(lead)
              upsertGuestLead(lead)
            } else if (evt.type === 'result' && evt.payload?.summaryLine) {
              setSummaryLine(evt.payload.summaryLine as string)
            }
          } catch {
            // malformed SSE line
          }
        }
      }
    } catch (err) {
      clearStepTimers()
      stopTimer()
      if (err instanceof Error && err.name === 'AbortError') return
      setPhase('error')
      return
    }

    clearStepTimers()
    stopTimer()

    const finalElapsed = elapsedRef.current
    setElapsed(finalElapsed)
    // Reveal final step briefly before transition
    setStepsRevealed(STEPS.length)
    setLeads(collected)

    // Update cumulative session totals
    setTotalLeadsGenerated(prev => prev + collected.length)
    setTotalElapsedSeconds(prev => prev + finalElapsed)
    setAllLeads(prev => {
      const existingIds = new Set(prev.map(l => l.id))
      return [...collected.filter(l => !existingIds.has(l.id)), ...prev]
    })

    trackGaEvent('free_trial_search_complete', { lead_count: collected.length })
    const contactCounts = countLeadContacts(collected)
    void trackEvent('search_performed', {
      search_id: analyticsSearchId,
      query: businessType.trim(),
      search_query: businessType.trim(),
      business_type: businessType.trim(),
      location: location.trim(),
      filters_used: {
        requested_leads: effectiveCount,
        source: 'trial_flow',
      },
      leads_count: collected.length,
      number_of_results_returned: collected.length,
      number_of_results_with_email: contactCounts.email,
      number_of_results_with_phone: contactCounts.phone,
      number_of_results_with_website: contactCounts.website,
      search_duration_ms: finalElapsed * 1000,
      no_results: collected.length === 0,
    })
    void trackEvent('results_viewed', {
      search_id: analyticsSearchId,
      query: businessType.trim(),
      location: location.trim(),
      leads_count: collected.length,
    })

    setTimeout(() => {
      setPhase(collected.length === 0 ? 'error' : 'reward')
    }, 700)
  }, [businessType, location, leadCount, remainingFreeLeads])

  const sendEmail = useCallback(async () => {
    if (!email.trim() || emailSending) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Please enter a valid email address.')
      return
    }

    setEmailSending(true)
    setEmailError('')
    saveGuestCaptureEmail(email.trim())

    try {
      const res = await fetch('/api/results-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: email.trim(),
          leads: allLeads,
          summaryLine,
          elapsedSeconds: totalElapsedSeconds,
          detailLine: null,
          limitMessage: null,
        }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setEmailError(data?.error ?? 'Something went wrong. Please try again.')
        return
      }

      void trackEvent('email_captured', { email: email.trim(), leads_count: allLeads.length })
      trackGaEvent('email_captured', { capture_location: 'trial_flow', visitor_type: 'guest' })
      setPhase('emailSuccess')
    } catch {
      setEmailError('Something went wrong. Please try again.')
    } finally {
      setEmailSending(false)
    }
  }, [email, emailSending, allLeads, summaryLine, totalElapsedSeconds])

  const viewLeads = useCallback(() => router.push('/dashboard/leads'), [router])
  const upgrade = useCallback(() => router.push('/plans'), [router])

  // Persistent card: render when closed but leads exist
  if (phase === 'closed') {
    if (totalLeadsGenerated === 0 || cardDismissed) return null
    return (
      <PersistentCard
        remainingFreeLeads={remainingFreeLeads}
        onReSearch={() => setPhase('input')}
        onUpgrade={upgrade}
        onDismiss={() => setCardDismissed(true)}
      />
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-flow-title"
    >
      <div
        className="absolute inset-0 bg-[rgba(2,6,18,0.72)] backdrop-blur-sm"
        onClick={phase === 'input' ? close : undefined}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-lg sm:mx-4">
        <div className="relative overflow-hidden rounded-t-[28px] border border-white/[0.08] bg-[rgba(8,14,26,0.96)] shadow-[0_32px_80px_rgba(2,6,18,0.6)] backdrop-blur-2xl sm:rounded-[28px]">
          <div
            className="pointer-events-none absolute inset-x-16 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.32),transparent)]"
            aria-hidden="true"
          />

          <div className="p-6 sm:p-8">
            {phase === 'input' && (
              <InputPhase
                businessType={businessType}
                setBusinessType={setBusinessType}
                location={location}
                setLocation={setLocation}
                leadCount={leadCount}
                setLeadCount={setLeadCount}
                remainingFreeLeads={remainingFreeLeads}
                isReSearch={totalLeadsGenerated > 0}
                onSubmit={startSearch}
                onClose={close}
                inputRef={inputRef}
              />
            )}

            {phase === 'searching' && (
              <SearchingPhase
                businessType={businessType}
                location={location}
                elapsed={elapsed}
                stepsRevealed={stepsRevealed}
              />
            )}

            {phase === 'reward' && (
              <RewardPhase
                leads={leads}
                requestedCount={requestedCount}
                businessType={businessType}
                location={location}
                elapsed={elapsed}
                totalLeadsGenerated={totalLeadsGenerated}
                totalElapsedSeconds={totalElapsedSeconds}
                remainingFreeLeads={remainingFreeLeads}
                onViewLeads={viewLeads}
                onEmailCapture={() => setPhase('emailCapture')}
                onReSearch={openForReSearch}
                onUpgrade={upgrade}
                onClose={close}
              />
            )}

            {phase === 'emailCapture' && (
              <EmailCapturePhase
                totalLeads={allLeads.length}
                email={email}
                setEmail={setEmail}
                emailError={emailError}
                emailSending={emailSending}
                onSend={sendEmail}
                onSkip={viewLeads}
                onClose={close}
              />
            )}

            {phase === 'emailSuccess' && (
              <EmailSuccessPhase
                email={email}
                totalLeadsGenerated={totalLeadsGenerated}
                totalElapsedSeconds={totalElapsedSeconds}
                remainingFreeLeads={remainingFreeLeads}
                onViewLeads={viewLeads}
                onReSearch={openForReSearch}
                onUpgrade={upgrade}
                onClose={close}
              />
            )}

            {phase === 'error' && (
              <ErrorPhase onAdjust={() => setPhase('input')} onClose={close} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
