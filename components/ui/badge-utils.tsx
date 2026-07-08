import { CheckCircle2, Clock, Send, XCircle, Zap } from 'lucide-react'

type AutomationStepValue = 'first_outreach' | 'follow_up' | 'final_attempt'
type StepFilter = 'all' | AutomationStepValue

export function statusBadge(status: 'draft' | 'approved' | 'sent' | 'rejected') {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    )
  }
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-300">
        <Send className="h-3 w-3" />
        Sent
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300">
        <XCircle className="h-3 w-3" />
        Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-400">
      <Clock className="h-3 w-3" />
      Draft
    </span>
  )
}

export function contextBadge(status: string) {
  if (status === 'enriched') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
        <Zap className="h-2.5 w-2.5" />
        Enriched
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-500">
      Basic
    </span>
  )
}

export function sourceBadge(source: string) {
  if (source === 'pipeline_automation') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-400/18 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        Pipeline Automation
      </span>
    )
  }
  if (source === 'agent') {
    return (
      <span className="inline-flex items-center rounded-full border border-blue-400/18 bg-blue-500/8 px-2 py-0.5 text-[10px] font-medium text-blue-300">
        Agent
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-500">
      Manual
    </span>
  )
}

function stepLabel(step: StepFilter | null) {
  if (step === 'first_outreach') return 'First Outreach'
  if (step === 'follow_up') return 'Follow-Up'
  if (step === 'final_attempt') return 'Final Attempt'
  return 'Unknown Step'
}

export function stepBadge(step: StepFilter | null) {
  if (!step || step === 'all') return null
  return (
    <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium text-amber-200">
      {stepLabel(step)}
    </span>
  )
}

export function ctaBadge(label: string | null, type: string | null) {
  if (!label) return null
  return (
    <span className="inline-flex items-center rounded-full border border-cyan-400/18 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
      {type ? `${label} · ${type}` : label}
    </span>
  )
}

export function matchBadge(personalizationScore: number | null) {
  if (personalizationScore == null) return null
  if (personalizationScore >= 4) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        High match
      </span>
    )
  }
  if (personalizationScore >= 2) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-400/20 bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium text-amber-300/80">
        Medium match
      </span>
    )
  }
  return null
}
