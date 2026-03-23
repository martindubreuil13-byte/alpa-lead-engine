'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import SendCampaignModal from '@/components/email/SendCampaignModal'

type Lead = {
  id: string
  company_name: string
  city: string
  industry: string | null
  status: string
  pipeline_stage?: string | null
  close_reason?: string | null
  contacted_at?: string | null
}

type CloseReason = 'no_answer' | 'not_interested' | 'wrong_contact' | 'bounce' | 'other'
type PipelineStage = 'ready' | 'followup' | 'final_attempt' | 'closed'

const STAGES: Array<{ key: PipelineStage; title: string }> = [
  { key: 'ready', title: 'Ready' },
  { key: 'followup', title: 'Follow-up' },
  { key: 'final_attempt', title: 'Final Attempt' },
  { key: 'closed', title: 'Closed' },
]
const OPEN_STAGES = STAGES.filter((stage) => stage.key !== 'closed')

const STATUS_META: Record<string, { label: string; badge: string }> = {
  pipeline: {
    label: 'Pipeline',
    badge: 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/30',
  },
  contacted: {
    label: 'Contacted',
    badge: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-400/30',
  },
  followup_due: {
    label: 'Follow-up Due',
    badge: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30',
  },
  interested: {
    label: 'Interested',
    badge: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30',
  },
  no_response: {
    label: 'No Response',
    badge: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-400/30',
  },
  rejected: {
    label: 'Rejected',
    badge: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/30',
  },
  invalid: {
    label: 'Invalid',
    badge: 'bg-slate-500/20 text-slate-300 ring-1 ring-slate-400/30',
  },
}

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
  const [leads, setLeads] = useState<Lead[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [isSendModalOpen, setIsSendModalOpen] = useState(false)
  const [closeLead, setCloseLead] = useState<Lead | null>(null)
  const [closeReason, setCloseReason] = useState<CloseReason>('no_answer')
  const [closing, setClosing] = useState(false)
  const sendableSelectedIds = selected.filter((id) => {
    const lead = leads.find((item) => item.id === id)
    return lead ? normalizePipelineStage(lead) !== 'closed' : false
  })

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    setLoading(true)

    const { data, error } = await supabase
      .from('leads')
      .select('id, company_name, city, industry, status, pipeline_stage, close_reason, contacted_at')
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
    const payload: any = {
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

    // optimistic update
    setLeads(prev =>
      prev
        .map(l => (l.id === id ? { ...l, ...payload } : l))
        .filter(l => PIPELINE_RELEVANT_STATUSES.includes(l.status))
    )
  }

  async function batchMarkContacted(ids: string[]) {
    if (ids.length === 0) {
      setSelected([])
      return
    }

    const now = new Date().toISOString()

    // optimistic update
    setLeads(prev =>
      prev.map(l =>
        ids.includes(l.id)
          ? { ...l, status: 'contacted', contacted_at: now, pipeline_stage: 'followup' }
          : l
      )
    )

    setSelected(prev => prev.filter(id => !ids.includes(id)))
  }

  function toggleSelect(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function clearSelection() {
    setSelected([])
  }

  function toggleColumn(leadsInColumn: Lead[], checked: boolean) {
    const ids = leadsInColumn.map(l => l.id)

    if (checked) {
      setSelected(prev => Array.from(new Set([...prev, ...ids])))
    } else {
      setSelected(prev => prev.filter(id => !ids.includes(id)))
    }
  }

  function openCloseModal(lead: Lead) {
    setCloseLead(lead)
    setCloseReason('no_answer')
  }

  function closeModal() {
    if (closing) return
    setCloseLead(null)
    setCloseReason('no_answer')
  }

  async function confirmCloseLead() {
    if (!closeLead) return

    const leadId = closeLead.id
    const selectedReason = closeReason
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const statusMap: Record<string, string> = {
      no_answer: 'no_response',
      not_interested: 'rejected',
      wrong_contact: 'invalid',
      bounce: 'invalid',
      other: 'rejected',
    }
    const mappedStatus = statusMap[selectedReason]

    if (!leadId) {
      console.error('Missing leadId')
      return
    }

    if (!selectedReason) {
      console.error('Missing close reason')
      return
    }

    if (!user?.id) {
      console.error('Missing authenticated user')
      return
    }

    if (!mappedStatus) {
      console.error('Invalid status mapping')
      return
    }

    console.log('Closing lead payload:', {
      leadId,
      userId: user.id,
      selectedReason,
      mappedStatus,
    })

    setClosing(true)

    const payload = {
      pipeline_stage: 'closed',
      close_reason: selectedReason,
      status: mappedStatus,
      status_updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', leadId)
      .eq('user_id', user.id)
      .select()

    console.log('Close result:', data)
    console.log('Close error FULL:', JSON.stringify(error, null, 2))

    if (error) {
      console.error('Error closing lead:', error)
      setClosing(false)
      return
    }

    if (!data || data.length === 0) {
      console.error('Close failed: no rows updated')
      setClosing(false)
      return
    }

    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, ...payload }
          : lead
      )
    )

    setClosing(false)
    closeModal()
  }

  return (
    <>
      <div className="space-y-10">

        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-white">Pipeline</h1>
          <p className="text-slate-400 mt-2">
            Execute prospecting and manage active leads
          </p>
        </div>

        {/* Batch Toolbar */}
        <div className="glass p-4 flex items-center justify-between">
          <div className="text-sm text-white">
            {selected.length} selected
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsSendModalOpen(true)}
              disabled={sendableSelectedIds.length === 0}
              className={`px-4 py-2 rounded-lg transition ${
                sendableSelectedIds.length === 0
                  ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
              }`}
            >
              📧 Send Email
            </button>

            <button
              onClick={clearSelection}
              disabled={selected.length === 0}
              className={`px-4 py-2 rounded-lg transition ${
                selected.length === 0
                  ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-slate-400">Loading pipeline...</div>
        )}

        {/* Columns */}
        {!loading && (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {STAGES.map(stage => {
              const stageLeads = leads.filter(
                (lead) => normalizePipelineStage(lead) === stage.key
              )

              const allSelected =
                stageLeads.length > 0 &&
                stageLeads.every(l => selected.includes(l.id))

              return (
                <div key={stage.key} className="glass p-5 space-y-4">

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) =>
                          toggleColumn(stageLeads, e.target.checked)
                        }
                      />
                      <h2 className="font-semibold text-white">
                        {stage.title}
                      </h2>
                    </div>

                    <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-slate-300">
                      {stageLeads.length}
                    </span>
                  </div>

                  <div className="space-y-4">
                    {stageLeads.length === 0 && (
                      <div className="text-xs text-slate-500 italic">
                        No leads
                      </div>
                    )}

                    {stageLeads.map(lead => (
                      <Card
                        key={lead.id}
                        lead={lead}
                        moveLeadStage={moveLeadStage}
                        openCloseModal={openCloseModal}
                        selected={selected.includes(lead.id)}
                        toggleSelect={toggleSelect}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Email Modal */}
      <SendCampaignModal
        isOpen={isSendModalOpen}
        onClose={() => setIsSendModalOpen(false)}
        selectedIds={sendableSelectedIds}
        onSent={batchMarkContacted}
      />

      {closeLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="glass w-full max-w-md space-y-5 rounded-2xl p-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Close Lead</h2>
              <p className="mt-2 text-sm text-slate-400">
                Choose a close reason for {closeLead.company_name}.
              </p>
            </div>

            <div className="space-y-3">
              {CLOSE_REASON_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200"
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

            <div className="flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="rounded-lg bg-white/10 px-4 py-2 text-slate-300 transition hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={confirmCloseLead}
                disabled={closing}
                className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${
                  closing
                    ? 'cursor-not-allowed bg-red-900/40 text-red-200'
                    : 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                }`}
              >
                {closing ? 'Closing...' : 'Confirm Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Card({
  lead,
  moveLeadStage,
  openCloseModal,
  selected,
  toggleSelect,
}: {
  lead: Lead
  moveLeadStage: (id: string, stage: PipelineStage) => void
  openCloseModal: (lead: Lead) => void
  selected: boolean
  toggleSelect: (id: string) => void
}) {
  return (
    <div className={`glass p-4 space-y-4 border ${
      selected ? 'border-blue-400/40' : 'border-white/5'
    }`}>

      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggleSelect(lead.id)}
          className="mt-1"
        />

        <div>
          <div className="font-semibold text-white text-sm">
            {lead.company_name}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {lead.industry || 'Business'} • {lead.city}
          </div>
          <div className="mt-3">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_META[lead.status]?.badge || STATUS_META.pipeline.badge}`}
            >
              {STATUS_META[lead.status]?.label || lead.status}
            </span>
          </div>
          {lead.close_reason && (
            <div className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">
              Close Reason: {lead.close_reason.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Pipeline Stage
        </label>
        <select
          value={normalizePipelineStage(lead)}
          onChange={(event) => moveLeadStage(lead.id, event.target.value as PipelineStage)}
          disabled={normalizePipelineStage(lead) === 'closed'}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40"
        >
          {normalizePipelineStage(lead) === 'closed' && (
            <option value="closed">Closed</option>
          )}
          {OPEN_STAGES.map((stage) => (
            <option key={stage.key} value={stage.key}>
              {stage.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => openCloseModal(lead)}
          className="w-full rounded-lg bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/25"
        >
          Close
        </button>
      </div>
    </div>
  )
}
