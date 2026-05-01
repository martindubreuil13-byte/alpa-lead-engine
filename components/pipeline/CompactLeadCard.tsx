'use client'

import { memo } from 'react'
import { Mail } from 'lucide-react'

import {
  formatDate,
  getDaysSince,
  getNextActionLabel,
  getPipelineLifecycleStatus,
  getUrgencyTone,
  type Lead,
} from '@/lib/pipeline/lifecycle'
import { cn } from '@/lib/utils'

type CompactLeadCardProps = {
  lead: Lead
  selected: boolean
  onToggleSelect: (id: string) => void
  onOpen: (id: string) => void
}

function toneClasses(tone: ReturnType<typeof getUrgencyTone>, selected: boolean) {
  return cn(
    'border-transparent bg-white/[0.018] hover:border-blue-300/14 hover:bg-white/[0.04]',
    tone === 'new' && 'bg-blue-500/[0.018]',
    tone === 'waiting' && 'bg-sky-500/[0.014]',
    tone === 'ready' && 'border-amber-300/18 bg-amber-500/[0.035] shadow-[0_0_14px_rgba(245,158,11,0.055)]',
    tone === 'overdue' && 'border-red-300/22 bg-red-500/[0.025] shadow-[0_0_14px_rgba(248,113,113,0.07)]',
    tone === 'final' && 'bg-violet-500/[0.018] opacity-85',
    tone === 'closed' && 'border-emerald-300/10 bg-white/[0.018] opacity-70',
    selected && 'border-blue-300/36 bg-blue-500/[0.065] shadow-[0_0_0_1px_rgba(96,165,250,0.14)]'
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

function CompactLeadCardComponent({ lead, selected, onToggleSelect, onOpen }: CompactLeadCardProps) {
  const stage = getPipelineLifecycleStatus(lead)
  const tone = getUrgencyTone(lead)
  const days = getDaysSince(lead.first_contact_at)
  const canSelect = stage !== 'closed'
  const location = lead.city || 'Location unavailable'
  const indicator = stage === 'ready_followup' ? getNextActionLabel(lead) : days === null ? getNextActionLabel(lead) : `Day ${days}`
  const hoverMeta = [
    lead.last_contact_at ? `Last ${formatDate(lead.last_contact_at)}` : 'Not contacted',
    stage === 'ready_followup' ? 'Follow-up ready' : lead.followup_due_at ? `Due ${formatDate(lead.followup_due_at)}` : null,
    lead.email ? 'Email ready' : 'No email',
  ].filter(Boolean).join(' · ')

  return (
    <article
      className={cn('group grid grid-cols-[auto_minmax(0,1fr)] items-center rounded-xl border transition duration-150', toneClasses(tone, selected))}
      data-lead-id={lead.id}
    >
      <div className="flex min-h-[60px] items-center pl-2.5">
        {canSelect ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleSelect(lead.id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onToggleSelect(lead.id)
              }
            }}
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition',
              selected ? 'border-blue-300 bg-blue-500/75' : 'border-white/14 bg-black/10 group-hover:border-blue-300/45'
            )}
            aria-label={`Select ${lead.company_name}`}
            aria-pressed={selected}
          >
            {selected ? <span className="h-2 w-2 rounded-sm bg-white" /> : null}
          </button>
        ) : (
          <span className={cn('h-2.5 w-2.5 rounded-full', dotClass(tone))} />
        )}
      </div>

      <button
        type="button"
        onClick={() => onOpen(lead.id)}
        className="grid min-h-[60px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1.5 pl-2 pr-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium leading-5 text-white">{lead.company_name}</span>
          <span className="mt-0.5 block truncate text-xs leading-4 text-slate-500">{location}</span>
          <span className="mt-0.5 hidden max-h-0 truncate text-[11px] leading-4 text-slate-500 opacity-0 transition-all duration-150 group-hover:max-h-4 group-hover:opacity-100 lg:block">
            {hoverMeta}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
          <span className={cn('h-2 w-2 rounded-full', dotClass(tone))} />
          <span className={cn('max-w-[88px] truncate', tone === 'ready' && 'text-amber-100', tone === 'overdue' && 'text-red-100')}>
            {indicator}
          </span>
          <Mail className={cn('h-4 w-4', lead.email ? 'text-blue-200/80' : 'text-white/20')} />
        </span>
      </button>
    </article>
  )
}

export default memo(CompactLeadCardComponent)
