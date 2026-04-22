'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import FeatureLockNotice from '@/components/access/FeatureLockNotice'
import SendCampaignModal from '@/components/email/SendCampaignModal'
import LeadCard from '@/components/leads/LeadCard'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import { canAccessFeature } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getGuestLeads } from '@/lib/guest-session'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  city: string
  industry: string | null
  email: string | null
  phone: string | null
  website?: string | null
  status: string
  pipeline_stage?: string | null
  close_reason?: string | null
  contacted_at?: string | null
}

type CloseReason = 'no_answer' | 'not_interested' | 'wrong_contact' | 'bounce' | 'other'
type PipelineStage = 'ready' | 'followup' | 'final_attempt' | 'closed'

const STAGES: Array<{ key: PipelineStage; title: string; description: string }> = [
  { key: 'ready', title: 'Ready', description: 'Fresh leads that are ready for first outreach.' },
  { key: 'followup', title: 'Follow-up', description: 'Leads that need the next nudge or reply.' },
  { key: 'final_attempt', title: 'Final Attempt', description: 'Last-touch leads before you close the loop.' },
  { key: 'closed', title: 'Closed', description: 'Finished opportunities with a recorded outcome.' },
]

const OPEN_STAGES = STAGES.filter((stage) => stage.key !== 'closed')

const PIPELINE_RELEVANT_STATUSES = [
  'pipeline',
  'contacted',
  'followup_due',
  'interested',
  'no_response',
  'rejected',
  'invalid',
]

const CLOSE_REASON_OPTIONS: Array<{ value: CloseReason; label: string }> = [
  { value: 'no_answer', label: 'No Answer' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'wrong_contact', label: 'Wrong Contact' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'other', label: 'Other' },
]

function normalizePipelineStage(lead: Lead): PipelineStage {
  if (lead.pipeline_stage === 'ready') return 'ready'
  if (lead.pipeline_stage === 'followup') return 'followup'
  if (lead.pipeline_stage === 'final_attempt') return 'final_attempt'
  if (lead.pipeline_stage === 'closed') return 'closed'

  if (lead.status === 'contacted') return 'followup'
  if (lead.status === 'followup_due') return 'final_attempt'
  if (['no_response', 'rejected', 'invalid'].includes(lead.status)) return 'closed'

  return 'ready'
}

export default function PipelinePage() {
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [isGuest, setIsGuest] = useState(false)
  const [showFeatureLock, setShowFeatureLock] = useState(false)
  const [isSendModalOpen, setIsSendModalOpen] = useState(false)
  const [closeLead, setCloseLead] = useState<Lead | null>(null)
  const [moveLead, setMoveLead] = useState<Lead | null>(null)
  const [moveTarget, setMoveTarget] = useState<PipelineStage>('ready')
  const [closeReason, setCloseReason] = useState<CloseReason>('no_answer')
  const [closing, setClosing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [expandedStages, setExpandedStages] = useState<Record<PipelineStage, boolean>>({
    ready: true,
    followup: true,
    final_attempt: true,
    closed: true,
  })
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
    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    }
  }, [user, userLoading])

  useEffect(() => {
    const visibleIds = new Set(leads.map((lead) => lead.id))
    setSelected((prev) => prev.filter((id) => visibleIds.has(id)))
  }, [leads])

  const stageMap = useMemo(() => {
    return STAGES.reduce<Record<PipelineStage, Lead[]>>(
      (accumulator, stage) => {
        accumulator[stage.key] = leads.filter((lead) => normalizePipelineStage(lead) === stage.key)
        return accumulator
      },
      { ready: [], followup: [], final_attempt: [], closed: [] }
    )
  }, [leads])

  const validSelectedIds = useMemo(() => {
    return selected.filter((id) => {
      const lead = leads.find((item) => item.id === id)

      if (!lead) return false
      if (normalizePipelineStage(lead) === 'closed') return false

      return true
    })
  }, [selected, leads])

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
      .select('id, company_name, city, industry, email, phone, website, status, pipeline_stage, close_reason, contacted_at')
      .eq('user_id', user.id)
      .in('status', PIPELINE_RELEVANT_STATUSES)

    if (error) {
      console.error('Error fetching leads:', error)
      setLoading(false)
      return
    }

    setLeads(
      (data || []).map((lead) => ({
        ...lead,
        pipeline_stage: normalizePipelineStage(lead),
      }))
    )
    setLoading(false)
  }

  async function moveLeadStage(id: string, newStage: PipelineStage) {
    if (isGuest) {
      setShowFeatureLock(true)
      return
    }

    const payload = {
      pipeline_stage: newStage,
      status_updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', id)

    if (error) {
      console.error('Error updating lead:', error)
      return
    }

    setLeads((prev) => prev.map((lead) => (lead.id === id ? { ...lead, ...payload } : lead)))
  }

async function batchMarkContacted(ids: string[]) {
  if (ids.length === 0) {
    setSelected([])
    return
  }

  if (isGuest) {
    setShowFeatureLock(true)
    return
  }

  // 🔥 Defensive filter (CRITICAL)
  const validIds = ids.filter((id) => {
    const lead = leads.find((l) => l.id === id)
    return lead && normalizePipelineStage(lead) !== 'closed'
  })

  if (validIds.length === 0) {
    setSelected([])
    return
  }

  const now = new Date().toISOString()
  const payload = {
    status: 'contacted',
    contacted_at: now,
    pipeline_stage: 'followup',
    status_updated_at: now,
  }

  const { error } = await supabase
    .from('leads')
    .update(payload)
    .in('id', validIds)

  if (error) {
    console.error('Error updating contacted leads:', error)
    return
  }

  setLeads((prev) =>
    prev.map((lead) =>
      validIds.includes(lead.id) ? { ...lead, ...payload } : lead
    )
  )

  setSelected((prev) => prev.filter((id) => !validIds.includes(id)))
}

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((current) => current !== id) : [...prev, id]))
  }

  function clearSelection() {
    setSelected([])
  }

  function toggleColumn(leadsInColumn: Lead[], checked: boolean) {
    const ids = leadsInColumn.map((lead) => lead.id)

    if (checked) {
      setSelected((prev) => Array.from(new Set([...prev, ...ids])))
      return
    }

    setSelected((prev) => prev.filter((id) => !ids.includes(id)))
  }

  function toggleStage(stage: PipelineStage) {
    setExpandedStages((prev) => ({
      ...prev,
      [stage]: !prev[stage],
    }))
  }

  function openCloseModal(lead: Lead) {
    if (isGuest) {
      setShowFeatureLock(true)
      return
    }

    setCloseLead(lead)
    setCloseReason('no_answer')
  }

  function closeCloseModal() {
    if (closing) return
    setCloseLead(null)
    setCloseReason('no_answer')
  }

  function openMoveStageModal(lead: Lead) {
    if (isGuest) {
      setShowFeatureLock(true)
      return
    }

    setMoveLead(lead)
    setMoveTarget(normalizePipelineStage(lead))
  }

  function closeMoveModal() {
    if (moving) return
    setMoveLead(null)
  }

  async function confirmMoveLead() {
    if (!moveLead) return

    setMoving(true)
    await moveLeadStage(moveLead.id, moveTarget)
    setMoving(false)
    setMoveLead(null)
  }

  async function confirmCloseLead() {
    if (!closeLead) return

    const leadId = closeLead.id
    const selectedReason = closeReason

    const statusMap: Record<CloseReason, string> = {
      no_answer: 'no_response',
      not_interested: 'rejected',
      wrong_contact: 'invalid',
      bounce: 'invalid',
      other: 'rejected',
    }

    if (!user?.id) {
      console.error('Missing authenticated user')
      return
    }

    setClosing(true)

    const payload = {
      pipeline_stage: 'closed',
      close_reason: selectedReason,
      status: statusMap[selectedReason],
      status_updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', leadId)
      .eq('user_id', user.id)
      .select()

    if (error || !data || data.length === 0) {
      console.error('Error closing lead:', error)
      setClosing(false)
      return
    }

    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, ...payload } : lead)))

    setClosing(false)
    closeCloseModal()
  }

  function openSendForLead(leadId: string) {
    if (isGuest) {
      setShowFeatureLock(true)
      return
    }

    setSelected([leadId])
    setIsSendModalOpen(true)
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

  const totalLeads = leads.length
  const activeLeads = totalLeads - stageMap.closed.length

  return (
    <>
      <div className="space-y-6 pb-4">
        <header className="glass overflow-hidden p-5 sm:p-6">
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">
              Mobile pipeline
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Pipeline
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Review every active lead, take action without zooming, and move prospects forward with tap-based stage management.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MetricCard label="Total leads" value={totalLeads} />
            <MetricCard label="Active pipeline" value={activeLeads} />
            <MetricCard label="Ready to send" value={validSelectedIds.length} />
          </div>
        </header>

        <section className="glass space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-white">{selected.length} selected</div>
              <div className="mt-1 text-xs text-slate-500">
                Select leads to send template emails in one batch.
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  if (isGuest) {
                    setShowFeatureLock(true)
                    return
                  }
                  setIsSendModalOpen(true)
                }}
                disabled={selected.length === 0}
                className={`btn-primary min-h-[48px] rounded-2xl px-4 ${
                  validSelectedIds.length === 0
                    ? 'cursor-not-allowed border-white/10 bg-white/5 text-slate-500 shadow-none hover:bg-white/5'
                    : ''
                }`}
              >
                Send template email
              </button>

              <button
                type="button"
                onClick={clearSelection}
                disabled={selected.length === 0}
                className={`btn-secondary min-h-[48px] rounded-2xl px-4 ${
                  selected.length === 0
                    ? 'cursor-not-allowed bg-white/5 text-slate-500 hover:bg-white/5'
                    : 'text-slate-200'
                }`}
              >
                Clear selection
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-5 text-sm text-slate-300">
            Loading pipeline...
          </div>
        ) : (
          <div className="space-y-4 xl:grid xl:grid-cols-3 xl:gap-4 xl:space-y-0 2xl:grid-cols-4">
            {STAGES.map((stage) => {
              const stageLeads = stageMap[stage.key]
              const allSelected = stageLeads.length > 0 && stageLeads.every((lead) => selected.includes(lead.id))
              const isExpanded = expandedStages[stage.key]
              const allowStageSelection = stage.key !== 'closed'

              return (
                <section key={stage.key} className="glass overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleStage(stage.key)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left sm:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-slate-200">
                          {stageLeads.length}
                        </div>
                        <h2 className="text-base font-semibold text-white">{stage.title}</h2>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{stage.description}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {allowStageSelection && stageLeads.length > 0 ? (
                        <label className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={(event) => {
                              event.stopPropagation()
                              toggleColumn(stageLeads, event.target.checked)
                            }}
                            onClick={(event) => event.stopPropagation()}
                          />
                          Select all
                        </label>
                      ) : null}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="space-y-3 border-t border-white/6 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
                      {stageLeads.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-slate-500">
                          No leads in this stage yet.
                        </div>
                      ) : null}

                      {stageLeads.map((lead) => {
                        const currentStage = normalizePipelineStage(lead)
                        const leadLocation = [lead.industry, lead.city].filter(Boolean).join(' • ')

                        return (
                          <LeadCard
                            key={lead.id}
                            id={lead.id}
                            name={lead.company_name}
                            location={leadLocation || lead.city}
                            email={lead.email}
                            phone={lead.phone}
                            inPipeline={currentStage !== 'closed'}
                            contacted={
                              Boolean(lead.contacted_at) ||
                              ['contacted', 'followup_due', 'interested'].includes(lead.status)
                            }
                            isNew={currentStage === 'ready' && !lead.contacted_at}
                            context="pipeline"
                            sourceUrl={lead.website}
                            selected={currentStage !== 'closed' && selected.includes(lead.id)}
                            onToggleSelect={
                              currentStage !== 'closed' ? () => toggleSelect(lead.id) : undefined
                            }
                            onAddToPipeline={() => openMoveStageModal(lead)}
                            onContact={lead.email ? () => openSendForLead(lead.id) : undefined}
                            expandedFooter={
                              currentStage !== 'closed' ? (
                                <button
                                  type="button"
                                  onClick={() => openCloseModal(lead)}
                                  className="btn-ghost min-h-[40px] justify-start px-0 py-0 text-xs text-white/60 hover:text-white"
                                >
                                  Close lead
                                </button>
                              ) : lead.close_reason ? (
                                <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
                                  Closed: {lead.close_reason.replace(/_/g, ' ')}
                                </div>
                              ) : null
                            }
                          />
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <SendCampaignModal
        isOpen={isSendModalOpen}
        onClose={() => setIsSendModalOpen(false)}
        selectedIds={selected}
        onSent={batchMarkContacted}
      />


      {moveLead ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-0 backdrop-blur-sm sm:items-center sm:px-4">
          <div className="glass w-full rounded-t-[32px] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-[32px]">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">Move lead</h2>
              <p className="text-sm leading-6 text-slate-300">
                Pick the next stage for {moveLead.company_name}.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {OPEN_STAGES.map((stage) => (
                <button
                  key={stage.key}
                  type="button"
                  onClick={() => setMoveTarget(stage.key)}
                  className={`flex min-h-[52px] w-full items-center justify-between rounded-2xl border px-4 text-left text-sm transition ${
                    moveTarget === stage.key
                      ? 'border-blue-400/28 bg-blue-500/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-200'
                  }`}
                >
                  <span>{stage.title}</span>
                  {moveTarget === stage.key ? <span className="h-2.5 w-2.5 rounded-full bg-blue-400" /> : null}
                </button>
              ))}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeMoveModal}
                className="btn-secondary min-h-[48px] rounded-2xl px-4 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMoveLead}
                disabled={moving}
                className="btn-primary"
              >
                {moving ? 'Moving...' : 'Move to stage'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                  className={`flex min-h-[52px] items-center gap-3 rounded-2xl border px-4 text-sm transition ${
                    closeReason === option.value
                      ? 'border-blue-400/24 bg-blue-500/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-200'
                  }`}
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
                onClick={closeCloseModal}
                className="btn-secondary min-h-[48px] rounded-2xl px-4 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCloseLead}
                disabled={closing}
                className={`btn-ghost min-h-[48px] rounded-2xl px-5 text-sm ${
                  closing
                    ? 'cursor-not-allowed text-white/30 hover:text-white/30'
                    : 'text-white/60 hover:text-white'
                }`}
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

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  )
}
