'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, CheckCircle2, RotateCcw, Send } from 'lucide-react'

import FeatureLockNotice from '@/components/access/FeatureLockNotice'
import SendCampaignModal from '@/components/email/SendCampaignModal'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import LeadDetailDrawer from '@/components/pipeline/LeadDetailDrawer'
import PipelineColumn from '@/components/pipeline/PipelineColumn'
import { canAccessFeature } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getGuestLeads } from '@/lib/guest-session'
import {
  ACTIVE_PIPELINE_STAGES,
  addDaysIso,
  getLegacyStatusForPipelineStage,
  getPipelineLifecycleStatus,
  type Lead,
  type PipelineStage,
  type SendMode,
} from '@/lib/pipeline/lifecycle'
import { supabase } from '@/lib/supabase'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'
import { cn } from '@/lib/utils'

type CloseReason = 'no_answer' | 'not_interested' | 'wrong_contact' | 'bounce' | 'other'
const FOLLOWUP_WAIT_DAYS = 5

const PIPELINE_ACTIVE_STATUS_FILTER =
  'status.in.(pipeline,contacted,followup_due,followup_sent,interested),pipeline_stage.in.(ready,contacted,followup,final_attempt)'

const CLOSE_REASON_OPTIONS: Array<{ value: CloseReason; label: string }> = [
  { value: 'no_answer', label: 'No Answer' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'wrong_contact', label: 'Wrong Contact' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'other', label: 'Other' },
]

export default function PipelinePage() {
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [isGuest, setIsGuest] = useState(false)
  const [showFeatureLock, setShowFeatureLock] = useState(false)
  const [isSendModalOpen, setIsSendModalOpen] = useState(false)
  const [sendMode, setSendMode] = useState<SendMode>('initial')
  const [closeLead, setCloseLead] = useState<Lead | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [activeMobileStage, setActiveMobileStage] = useState<PipelineStage>('ready')
  const [closeReason, setCloseReason] = useState<CloseReason>('no_answer')
  const [closing, setClosing] = useState(false)
  const [bulkClosing, setBulkClosing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)

  useEffect(() => {
    if (userLoading) return
    void fetchLeads()

    const syncGuestLeads = () => {
      const guestLeads = getGuestLeads().map((lead) => ({
        ...lead,
        status: 'pipeline',
        pipeline_stage: 'ready',
      }))
      setLeads(guestLeads as Lead[])
      setLoading(false)
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    return () => window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
  }, [user, userLoading])

  useEffect(() => {
    const visibleIds = new Set(leads.map((lead) => lead.id))
    setSelected((prev) => prev.filter((id) => visibleIds.has(id)))
  }, [leads])

  const activeStages = ACTIVE_PIPELINE_STAGES
  const stageMap = useMemo(() => {
    return activeStages.reduce<Record<PipelineStage, Lead[]>>(
      (accumulator, stage) => {
        accumulator[stage.key] = leads.filter((lead) => getPipelineLifecycleStatus(lead) === stage.key)
        return accumulator
      },
      { ready: [], contacted: [], ready_followup: [], final_attempt: [], closed: [] }
    )
  }, [activeStages, leads])

  const leadsById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])
  const selectedIdSet = useMemo(() => new Set(selected), [selected])
  const selectedDetailLead = selectedLeadId ? leadsById.get(selectedLeadId) || null : null
  const selectedLeads = useMemo(
    () => selected.map((id) => leadsById.get(id)).filter(Boolean) as Lead[],
    [selected, leadsById]
  )
  const initialSendable = selectedLeads.filter((lead) => getPipelineLifecycleStatus(lead) === 'ready' && Boolean(lead.email))
  const followupSendable = selectedLeads.filter((lead) => getPipelineLifecycleStatus(lead) === 'ready_followup' && Boolean(lead.email))
  const closableSelected = selectedLeads.filter((lead) => getPipelineLifecycleStatus(lead) !== 'closed')

  const summary = {
    total: leads.length,
    ready: stageMap.ready.length,
    waiting: stageMap.contacted.length,
    readyFollowup: stageMap.ready_followup.length,
    final: stageMap.final_attempt.length,
  }
  const heartbeat = {
    needsFollowup: stageMap.ready_followup.length,
    overdue: stageMap.ready_followup.filter((lead) => {
      const firstContact = lead.first_contact_at ? new Date(lead.first_contact_at).getTime() : Number.NaN
      if (Number.isNaN(firstContact)) return false
      return Math.floor((Date.now() - firstContact) / 86_400_000) >= 8
    }).length,
    waiting: stageMap.contacted.length,
  }

  async function fetchLeads() {
    setLoading(true)

    if (!user) {
      setIsGuest(true)
      setLeads(
        getGuestLeads().map((lead) => ({
          ...lead,
          status: 'pipeline',
          pipeline_stage: 'ready',
        })) as Lead[]
      )
      setLoading(false)
      return
    }

    setIsGuest(false)

    const { data, error } = await supabase
      .from('leads')
      .select(
        'id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at'
      )
      .eq('user_id', user.id)
      .or(PIPELINE_ACTIVE_STATUS_FILTER)

    if (error) {
      console.error('Error fetching leads:', error)
      setStatusMessage('Could not load lifecycle fields. Check that the latest Supabase migration has run.')
      setLoading(false)
      return
    }

    setLeads(((data || []) as Lead[]).filter((lead) => getPipelineLifecycleStatus(lead) !== 'closed'))
    setLoading(false)
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((current) => current !== id) : [...prev, id]))
  }, [])

  const clearSelection = useCallback(() => {
    setSelected([])
    setStatusMessage('')
  }, [])

  const toggleColumn = useCallback((leadsInColumn: Lead[], checked: boolean) => {
    const ids = leadsInColumn.filter((lead) => getPipelineLifecycleStatus(lead) !== 'closed').map((lead) => lead.id)
    setSelected((prev) => checked ? Array.from(new Set([...prev, ...ids])) : prev.filter((id) => !ids.includes(id)))
  }, [])

  const openSend = useCallback((mode: SendMode) => {
    if (isGuest) {
      setShowFeatureLock(true)
      return
    }

    setSendMode(mode)
    setIsSendModalOpen(true)
  }, [isGuest])

  const openLeadDetails = useCallback((id: string) => {
    setSelectedLeadId(id)
  }, [])

  const closeLeadDetails = useCallback(() => {
    setSelectedLeadId(null)
  }, [])

  const openSendForLead = useCallback((mode: SendMode, lead: Lead) => {
    setSelected([lead.id])
    openSend(mode)
  }, [openSend])

  const focusStage = useCallback((stage: PipelineStage) => {
    setActiveMobileStage(stage)
    document.getElementById(`pipeline-stage-${stage}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [])

  async function applyLifecycleAfterSend(sentIds: string[]) {
    if (!user?.id || sentIds.length === 0) return

    const sentSet = new Set(sentIds)
    const sentLeads = leads.filter((lead) => sentSet.has(lead.id))
    const nowDate = new Date()
    const now = nowDate.toISOString()
    const dueAt = addDaysIso(nowDate, FOLLOWUP_WAIT_DAYS)

    const updates = sentLeads.map(async (lead) => {
      const payload =
        sendMode === 'initial'
          ? {
              status: getLegacyStatusForPipelineStage('contacted'),
              pipeline_stage: 'contacted',
              first_contact_at: lead.first_contact_at || now,
              last_contact_at: now,
              followup_due_at: dueAt,
              outreach_attempts: (lead.outreach_attempts || 0) + 1,
              next_action_status: 'waiting_followup',
              status_updated_at: now,
            }
          : {
              status: getLegacyStatusForPipelineStage('final_attempt'),
              pipeline_stage: 'final_attempt',
              followup_sent_at: now,
              last_contact_at: now,
              followup_due_at: null,
              outreach_attempts: (lead.outreach_attempts || 0) + 1,
              next_action_status: 'final_attempt_sent',
              status_updated_at: now,
            }

      const { error } = await supabase.from('leads').update(payload).eq('id', lead.id).eq('user_id', user.id)
      if (error) throw error
      return { id: lead.id, payload }
    })

    const results = await Promise.allSettled(updates)
    const successful = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)

    if (successful.length > 0) {
      const payloadById = new Map(successful.map((result) => [result.id, result.payload]))
      setLeads((prev) => prev.map((lead) => payloadById.has(lead.id) ? { ...lead, ...payloadById.get(lead.id) } : lead))
      setSelected((prev) => prev.filter((id) => !payloadById.has(id)))
    }

    const failed = results.length - successful.length
    setStatusMessage(
      failed > 0
        ? `${successful.length} lead${successful.length === 1 ? '' : 's'} updated after send. ${failed} lifecycle update${failed === 1 ? '' : 's'} failed.`
        : `${successful.length} lead${successful.length === 1 ? '' : 's'} moved to ${sendMode === 'initial' ? 'Contacted / Waiting' : 'Final Attempt'}.`
    )
  }

  async function closeLeads(ids: string[], reason: CloseReason) {
    if (!user?.id || ids.length === 0) return

    const now = new Date().toISOString()
    const payload = {
      pipeline_stage: 'closed',
      close_reason: reason,
      status: getLegacyStatusForPipelineStage('closed'),
      closed_at: now,
      next_action_status: 'closed',
      status_updated_at: now,
    }

    const { error } = await supabase.from('leads').update(payload).in('id', ids).eq('user_id', user.id)
    if (error) throw error

    setLeads((prev) => prev.filter((lead) => !ids.includes(lead.id)))
    setSelected((prev) => prev.filter((id) => !ids.includes(id)))
    setSelectedLeadId((prev) => (prev && ids.includes(prev) ? null : prev))
  }

  async function closeSelectedLeads() {
    if (isGuest) {
      setShowFeatureLock(true)
      return
    }

    const ids = closableSelected.map((lead) => lead.id)
    if (ids.length === 0) return

    setBulkClosing(true)
    try {
      await closeLeads(ids, 'no_answer')
      setStatusMessage(`${ids.length} lead${ids.length === 1 ? '' : 's'} moved to Closed.`)
    } catch (error) {
      console.error('Bulk close failed:', error)
      setStatusMessage('Could not close the selected leads.')
    } finally {
      setBulkClosing(false)
    }
  }

  function openCloseModal(lead: Lead) {
    if (isGuest) {
      setShowFeatureLock(true)
      return
    }

    setCloseLead(lead)
    setCloseReason('no_answer')
  }

  async function confirmCloseLead() {
    if (!closeLead) return
    setClosing(true)
    try {
      await closeLeads([closeLead.id], closeReason)
      setCloseLead(null)
      setStatusMessage(`${closeLead.company_name} moved to Closed.`)
    } catch (error) {
      console.error('Error closing lead:', error)
      setStatusMessage('Could not close that lead.')
    } finally {
      setClosing(false)
    }
  }

  if (profileLoading) {
    return <div className="text-slate-400">Loading pipeline...</div>
  }

  if (pipelineLocked) {
    return (
      <FeatureLockNotice
        title="Pipeline is available on Starter"
        description="Manage stages, follow-ups, and outreach actions once you upgrade to the Starter plan."
      />
    )
  }

  return (
    <>
      <div className="space-y-6 pb-24 lg:pb-6">
        <header className="glass overflow-hidden p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/70">
                Outbound lifecycle
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Pipeline</h1>
                <p className="max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  Select, send, follow up, and close leads from one operational workspace.
                </p>
              </div>
            </div>
            {statusMessage ? (
              <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
                {statusMessage}
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Total Leads" value={summary.total} tone="blue" />
            <MetricCard label="New / Ready" value={summary.ready} tone="blue" />
            <MetricCard label="Contacted / Waiting" value={summary.waiting} tone="slate" />
            <MetricCard label="Ready Follow-up" value={summary.readyFollowup} tone="amber" />
            <MetricCard label="Final Attempt" value={summary.final} tone="purple" />
          </div>
        </header>

        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 backdrop-blur-xl">
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Operational heartbeat
            </div>
            <div className="flex flex-wrap gap-2">
              <HeartbeatButton tone="amber" onClick={() => focusStage('ready_followup')}>
                {heartbeat.needsFollowup} need follow-up
              </HeartbeatButton>
              <HeartbeatButton tone="red" onClick={() => focusStage('ready_followup')}>
                {heartbeat.overdue} overdue
              </HeartbeatButton>
              <HeartbeatButton tone="blue" onClick={() => focusStage('contacted')}>
                {heartbeat.waiting} waiting
              </HeartbeatButton>
            </div>
          </div>
        </section>

        <section className="glass sticky top-3 z-20 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium text-white">{selected.length} selected</div>
              <div className="mt-1 text-xs text-slate-400">
                {initialSendable.length} initial-ready · {followupSendable.length} follow-up-ready · {closableSelected.length} closable
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-4 lg:flex">
              <CommandButton icon={Send} disabled={initialSendable.length === 0} onClick={() => openSend('initial')}>
                Send Initial Outreach
              </CommandButton>
              <CommandButton icon={RotateCcw} disabled={followupSendable.length === 0} onClick={() => openSend('followup')}>
                Send Follow-up
              </CommandButton>
              <CommandButton icon={Archive} disabled={closableSelected.length === 0 || bulkClosing} onClick={() => void closeSelectedLeads()}>
                {bulkClosing ? 'Closing...' : 'Move to Closed'}
              </CommandButton>
              <CommandButton icon={CheckCircle2} disabled={selected.length === 0} onClick={clearSelection} variant="secondary">
                Clear Selection
              </CommandButton>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-5 text-sm text-slate-300">
            Loading pipeline...
          </div>
        ) : (
          <>
            <div className="lg:hidden">
              <div className="sticky top-[96px] z-10 -mx-1 mb-3 overflow-x-auto px-1">
                <div className="flex min-w-max gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-1 backdrop-blur-xl">
                  {activeStages.map((stage) => (
                    <button
                      key={stage.key}
                      type="button"
                      onClick={() => setActiveMobileStage(stage.key)}
                      className={cn(
                        'min-h-[38px] rounded-xl px-3 text-xs font-medium transition',
                        activeMobileStage === stage.key
                          ? 'bg-blue-500/18 text-white shadow-[0_0_18px_rgba(59,130,246,0.12)]'
                          : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                      )}
                    >
                      {stage.shortTitle}
                      <span className="ml-1 text-slate-500">{stageMap[stage.key].length}</span>
                    </button>
                  ))}
                </div>
              </div>

              {activeStages.filter((stage) => stage.key === activeMobileStage).map((stage) => (
                <PipelineColumn
                  key={stage.key}
                  stage={stage}
                  leads={stageMap[stage.key]}
                  selectedIds={selectedIdSet}
                  onToggleSelect={toggleSelect}
                  onSelectAll={toggleColumn}
                  onOpenLead={openLeadDetails}
                />
              ))}
            </div>

            <div className="hidden gap-3 lg:grid lg:grid-cols-4">
              {activeStages.map((stage) => (
                <PipelineColumn
                  key={stage.key}
                  stage={stage}
                  leads={stageMap[stage.key]}
                  selectedIds={selectedIdSet}
                  onToggleSelect={toggleSelect}
                  onSelectAll={toggleColumn}
                  onOpenLead={openLeadDetails}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {selected.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/92 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
          <div className="mx-auto grid max-w-xl grid-cols-4 gap-2">
            <MobileAction icon={Send} label="Initial" disabled={initialSendable.length === 0} onClick={() => openSend('initial')} />
            <MobileAction icon={RotateCcw} label="Follow-up" disabled={followupSendable.length === 0} onClick={() => openSend('followup')} />
            <MobileAction icon={Archive} label="Closed" disabled={closableSelected.length === 0 || bulkClosing} onClick={() => void closeSelectedLeads()} />
            <MobileAction icon={CheckCircle2} label="Clear" disabled={selected.length === 0} onClick={clearSelection} />
          </div>
        </div>
      ) : null}

      <SendCampaignModal
        isOpen={isSendModalOpen}
        onClose={() => setIsSendModalOpen(false)}
        selectedIds={(sendMode === 'initial' ? initialSendable : followupSendable).map((lead) => lead.id)}
        onSent={applyLifecycleAfterSend}
      />

      <LeadDetailDrawer
        lead={selectedDetailLead}
        isClosing={closing}
        onClose={closeLeadDetails}
        onSendInitial={(lead) => openSendForLead('initial', lead)}
        onSendFollowup={(lead) => openSendForLead('followup', lead)}
        onMoveClosed={(lead) => openCloseModal(lead)}
      />

      {closeLead ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-0 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="glass w-full rounded-t-[32px] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-[32px]">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">Close lead</h2>
              <p className="text-sm leading-6 text-slate-300">
                Record why {closeLead.company_name} is leaving the active pipeline.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {CLOSE_REASON_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    'flex min-h-[52px] items-center gap-3 rounded-2xl border px-4 text-sm transition',
                    closeReason === option.value
                      ? 'border-blue-400/24 bg-blue-500/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-200'
                  )}
                >
                  <input
                    type="radio"
                    name="close_reason"
                    value={option.value}
                    checked={closeReason === option.value}
                    onChange={() => setCloseReason(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => !closing && setCloseLead(null)}
                className="btn-secondary min-h-[48px] rounded-2xl px-4 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmCloseLead()}
                disabled={closing}
                className="btn-primary min-h-[48px] rounded-2xl px-5"
              >
                {closing ? 'Closing...' : 'Confirm close'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <FeatureLockModal
        isOpen={showFeatureLock}
        onClose={() => setShowFeatureLock(false)}
        title="Pipeline"
        description="Track follow-ups, manage outreach stages, and keep active leads moving after discovery."
        benefit="Pipeline turns one good search into a real operating system for outbound work."
        showUpgradeCta={!profileLoading && (profile?.plan || 'free') === 'free'}
      />
    </>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'slate' | 'amber' | 'purple' | 'green' }) {
  const toneClass = {
    blue: 'border-blue-400/20 bg-blue-500/8 text-blue-100',
    slate: 'border-slate-400/10 bg-white/[0.035] text-slate-100',
    amber: 'border-amber-400/24 bg-amber-500/10 text-amber-100',
    purple: 'border-violet-400/18 bg-violet-500/8 text-violet-100',
    green: 'border-emerald-400/16 bg-emerald-500/8 text-emerald-100',
  }[tone]

  return (
    <div className={cn('rounded-[20px] border p-4', toneClass)}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  )
}

function CommandButton({
  children,
  disabled,
  icon: Icon,
  onClick,
  variant = 'primary',
}: {
  children: ReactNode
  disabled?: boolean
  icon: typeof Send
  onClick: () => void
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition',
        disabled
          ? 'cursor-not-allowed border border-white/8 bg-white/[0.03] text-slate-600'
          : variant === 'secondary'
            ? 'border border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.08]'
            : 'border border-blue-300/20 bg-blue-500 text-white shadow-[0_10px_30px_rgba(59,130,246,0.18)] hover:bg-blue-400'
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="truncate">{children}</span>
    </button>
  )
}

function HeartbeatButton({
  children,
  tone,
  onClick,
}: {
  children: ReactNode
  tone: 'amber' | 'red' | 'blue'
  onClick: () => void
}) {
  const toneClass = {
    amber: 'border-amber-300/16 bg-amber-500/[0.055] text-amber-100 hover:bg-amber-500/[0.09]',
    red: 'border-red-300/14 bg-red-500/[0.045] text-red-100 hover:bg-red-500/[0.075]',
    blue: 'border-blue-300/14 bg-blue-500/[0.05] text-blue-100 hover:bg-blue-500/[0.08]',
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition', toneClass)}
    >
      {children}
    </button>
  )
}

function MobileAction({ icon: Icon, label, disabled, onClick }: { icon: typeof Send; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-medium',
        disabled ? 'border-white/8 bg-white/[0.03] text-slate-600' : 'border-blue-300/20 bg-blue-500/14 text-blue-100'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}
