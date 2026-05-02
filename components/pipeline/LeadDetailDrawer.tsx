'use client'

import { useEffect } from 'react'
import { Archive, ExternalLink, Mail, Phone, RotateCcw, Send, X } from 'lucide-react'

import {
  canSendFollowup as canSendFollowupForLead,
  formatDate,
  getDaysSince,
  getDrawerNextActionLabel,
  getPipelineLifecycleStatus,
  getUrgencyTone,
  isReadyForFollowup,
  normalizeBaseStage,
  normalizeUrl,
  type Lead,
} from '@/lib/pipeline/lifecycle'
import { cn } from '@/lib/utils'

type LeadDetailDrawerProps = {
  lead: Lead | null
  isClosing?: boolean
  onClose: () => void
  onSendInitial: (lead: Lead) => void
  onSendFollowup: (lead: Lead) => void
  onMoveClosed: (lead: Lead) => void
}

export default function LeadDetailDrawer({
  lead,
  isClosing = false,
  onClose,
  onSendInitial,
  onSendFollowup,
  onMoveClosed,
}: LeadDetailDrawerProps) {
  useEffect(() => {
    if (!lead) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lead, onClose])

  if (!lead) return null

  const stage = getPipelineLifecycleStatus(lead)
  const tone = getUrgencyTone(lead)
  const website = normalizeUrl(lead.website)
  const days = getDaysSince(lead.first_contact_at)
  const canSendInitial = stage === 'ready' && Boolean(lead.email)
  const canSendFollowup = canSendFollowupForLead(lead) && Boolean(lead.email)
  const followupRecommended = isReadyForFollowup(lead)
  const followupHelper = getFollowupHelper(lead, followupRecommended)
  const canClose = stage !== 'closed'

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${lead.company_name} details`}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          'glass fixed inset-x-0 bottom-0 max-h-[88dvh] overflow-hidden rounded-b-none rounded-t-[28px] border-white/12 shadow-[0_-24px_70px_rgba(2,8,23,0.62)] transition duration-200 sm:inset-y-3 sm:left-auto sm:right-3 sm:h-[calc(100dvh-1.5rem)] sm:max-h-none sm:w-[420px] sm:rounded-[24px]',
          'animate-[pipelineSheetIn_180ms_ease-out]'
        )}
      >
        <style jsx global>{`
          @keyframes pipelineSheetIn {
            from {
              opacity: 0;
              transform: translateY(18px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @media (min-width: 640px) {
            @keyframes pipelineSheetIn {
              from {
                opacity: 0;
                transform: translateX(18px);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }
          }
        `}</style>

        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-white/8 p-5">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', dotClass(tone))} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {normalizeBaseStage(lead).replace('_', ' ')}
                </span>
              </div>
              <h2 className="truncate text-xl font-semibold tracking-tight text-white">{lead.company_name}</h2>
              <p className="mt-1 truncate text-sm text-slate-400">{[lead.industry, lead.city].filter(Boolean).join(' · ') || 'Location unavailable'}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
              aria-label="Close details"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <div className="grid grid-cols-2 gap-3">
              <DetailStat label="Next Action" value={getDrawerNextActionLabel(lead)} tone={tone} />
              <DetailStat label="Age" value={days === null ? 'Not contacted' : `Day ${days}`} tone={tone} />
              <DetailStat label="Last Contact" value={formatDate(lead.last_contact_at) || 'Never'} />
              <DetailStat label="Follow-up Due" value={formatDate(lead.followup_due_at) || '-'} />
              <DetailStat label="Attempts" value={String(lead.outreach_attempts || 0)} />
              <DetailStat label="Closed" value={formatDate(lead.closed_at) || '-'} />
            </div>

            <section className="space-y-2">
              <SectionTitle>Contact</SectionTitle>
              <ContactRow icon={Mail} label="Email" value={lead.email || 'Unavailable'} href={lead.email ? `mailto:${lead.email}` : null} />
              <ContactRow icon={Phone} label="Phone" value={lead.phone || 'Unavailable'} href={lead.phone ? `tel:${lead.phone}` : null} />
              <ContactRow icon={ExternalLink} label="Website" value={website || 'Unavailable'} href={website} external />
            </section>

            <section className="space-y-2">
              <SectionTitle>Lifecycle</SectionTitle>
              <TimestampRow label="First contacted" value={lead.first_contact_at} />
              <TimestampRow label="Follow-up sent" value={lead.followup_sent_at} />
              <TimestampRow label="Final attempt sent" value={lead.final_attempt_sent_at} />
              <TimestampRow label="Last contacted" value={lead.last_contact_at} />
            </section>

            {lead.notes ? (
              <section className="space-y-2">
                <SectionTitle>Notes</SectionTitle>
                <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-3 text-sm leading-6 text-slate-300">
                  {lead.notes}
                </div>
              </section>
            ) : null}
          </div>

          <div className="grid gap-2 border-t border-white/8 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:grid-cols-1">
            <button
              type="button"
              onClick={() => onSendInitial(lead)}
              disabled={!canSendInitial}
              className={actionClass(!canSendInitial)}
            >
              <Send className="h-4 w-4" />
              Send email
            </button>
            <button
              type="button"
              onClick={() => onSendFollowup(lead)}
              disabled={!canSendFollowup}
              className={actionClass(!canSendFollowup, 'secondary')}
            >
              <RotateCcw className="h-4 w-4" />
              {followupRecommended ? 'Send follow-up' : 'Follow up early'}
            </button>
            {followupHelper ? (
              <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-xs leading-5 text-slate-500">
                {followupHelper}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onMoveClosed(lead)}
              disabled={!canClose || isClosing}
              className={actionClass(!canClose || isClosing, 'quiet')}
            >
              <Archive className="h-4 w-4" />
              {isClosing ? 'Closing...' : 'Move to closed'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

function dotClass(tone: ReturnType<typeof getUrgencyTone>) {
  return {
    new: 'bg-blue-300 shadow-[0_0_10px_rgba(96,165,250,0.28)]',
    waiting: 'bg-sky-400/70',
    ready: 'bg-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.32)]',
    overdue: 'bg-red-300 shadow-[0_0_12px_rgba(248,113,113,0.32)]',
    final: 'bg-violet-300/75',
    closed: 'bg-emerald-300/60',
  }[tone]
}

function actionClass(disabled: boolean, variant: 'primary' | 'secondary' | 'quiet' = 'primary') {
  return cn(
    'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition',
    disabled
      ? 'cursor-not-allowed border-white/8 bg-white/[0.03] text-slate-600'
      : variant === 'primary'
        ? 'border-blue-300/20 bg-blue-500 text-white shadow-[0_10px_30px_rgba(59,130,246,0.18)] hover:bg-blue-400'
        : variant === 'secondary'
          ? 'border-amber-300/18 bg-amber-500/10 text-amber-100 hover:bg-amber-500/14'
          : 'border-white/10 bg-white/[0.045] text-slate-200 hover:bg-white/[0.08]'
  )
}

function getFollowupHelper(lead: Lead, recommended: boolean) {
  if (!canSendFollowupForLead(lead)) return null
  const stage = getPipelineLifecycleStatus(lead)
  if (stage === 'final_attempt') return 'Manual retry is available if this lead still deserves another touch.'
  if (recommended) return 'System-recommended follow-up is ready.'

  const dueAt = lead.followup_due_at ? new Date(lead.followup_due_at).getTime() : Number.NaN
  if (Number.isNaN(dueAt)) return 'You can follow up manually when the timing makes sense.'

  const remainingDays = Math.max(1, Math.ceil((dueAt - Date.now()) / 86_400_000))
  return `Recommended follow-up in ${remainingDays} day${remainingDays === 1 ? '' : 's'}. You can follow up early manually.`
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{children}</h3>
}

function DetailStat({ label, value, tone }: { label: string; value: string; tone?: ReturnType<typeof getUrgencyTone> }) {
  return (
    <div className={cn('rounded-2xl border border-white/8 bg-white/[0.035] p-3', tone === 'ready' && 'border-amber-300/18 bg-amber-500/[0.06]', tone === 'overdue' && 'border-red-300/18 bg-red-500/[0.05]')}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-100">{value}</div>
    </div>
  )
}

function ContactRow({ icon: Icon, label, value, href, external = false }: { icon: typeof Mail; label: string; value: string; href: string | null; external?: boolean }) {
  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <span className="block truncate text-sm text-slate-200">{value}</span>
      </span>
    </>
  )

  if (!href) {
    return <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 opacity-60">{content}</div>
  }

  return (
    <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 transition hover:border-blue-300/22 hover:bg-white/[0.055]">
      {content}
    </a>
  )
}

function TimestampRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200">{formatDate(value) || '-'}</span>
    </div>
  )
}
