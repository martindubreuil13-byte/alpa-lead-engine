'use client'

import CompactLeadCard from '@/components/pipeline/CompactLeadCard'
import { getDaysSince, getPipelineLifecycleStatus, type Lead, type PipelineStage } from '@/lib/pipeline/lifecycle'
import { cn } from '@/lib/utils'

type PipelineColumnProps = {
  stage: {
    key: PipelineStage
    title: string
    description: string
  }
  leads: Lead[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectAll: (leads: Lead[], checked: boolean) => void
  onOpenLead: (id: string) => void
}

export default function PipelineColumn({
  stage,
  leads,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onOpenLead,
}: PipelineColumnProps) {
  const selectableLeads = leads.filter((lead) => getPipelineLifecycleStatus(lead) !== 'closed')
  const allSelected = selectableLeads.length > 0 && selectableLeads.every((lead) => selectedIds.has(lead.id))
  const meta = getColumnMeta(stage.key, leads)

  return (
    <section
      id={`pipeline-stage-${stage.key}`}
      className={cn(
        'flex min-h-[420px] flex-col overflow-hidden rounded-[18px] border border-white/[0.055] bg-white/[0.025] shadow-[0_10px_30px_rgba(2,8,23,0.22)] backdrop-blur-xl',
        stage.key === 'ready_followup' && 'border-amber-300/18 bg-amber-500/[0.025] shadow-[0_0_28px_rgba(245,158,11,0.06)]',
        stage.key === 'final_attempt' && 'opacity-80'
      )}
    >
      <div className={cn('border-b border-white/[0.045] px-3 py-3', stage.key === 'ready_followup' && 'bg-amber-500/[0.035]')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-white">{stage.title}</h2>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-slate-300">
                {leads.length}
              </span>
            </div>
            <p className={cn('mt-1 truncate text-xs text-slate-500', stage.key === 'ready_followup' && 'text-amber-100/60')}>
              {meta}
            </p>
          </div>

          {selectableLeads.length > 0 ? (
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onSelectAll(selectableLeads, event.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-transparent text-blue-400"
              />
              All
            </label>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
        {leads.length === 0 ? (
          <EmptyState stage={stage.key} />
        ) : leads.map((lead) => (
          <CompactLeadCard
            key={lead.id}
            lead={lead}
            selected={selectedIds.has(lead.id)}
            onToggleSelect={onToggleSelect}
            onOpen={onOpenLead}
          />
        ))}
      </div>
    </section>
  )
}

function getColumnMeta(stage: PipelineStage, leads: Lead[]) {
  if (stage === 'contacted') {
    const dueSoon = leads.filter((lead) => {
      const days = getDaysSince(lead.first_contact_at)
      return days !== null && days >= 3
    }).length
    return `${leads.length} leads · ${dueSoon} due soon`
  }

  if (stage === 'ready_followup') {
    const overdue = leads.filter((lead) => (getDaysSince(lead.first_contact_at) ?? 0) >= 8).length
    return `${leads.length} ready · ${overdue} overdue`
  }

  if (stage === 'ready') return `${leads.length} ready to contact`
  if (stage === 'final_attempt') return `${leads.length} final attempts sent`
  return `${leads.length} closed`
}

function EmptyState({ stage }: { stage: PipelineStage }) {
  const copy: Record<PipelineStage, string> = {
    ready: 'New leads land here.',
    contacted: 'Recently contacted leads wait here.',
    ready_followup: 'Day-five leads appear here.',
    final_attempt: 'Follow-up sends move here.',
    closed: 'Closed leads collect here.',
  }

  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-6 text-center text-xs leading-5 text-slate-500">
      {copy[stage]}
    </div>
  )
}
