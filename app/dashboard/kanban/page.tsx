'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, ArrowDown, ArrowRight, CheckCircle2, Search, RotateCcw, Send, X } from 'lucide-react'

import FeatureLockNotice from '@/components/access/FeatureLockNotice'
import SendCampaignModal from '@/components/email/SendCampaignModal'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import LeadDetailDrawer from '@/components/pipeline/LeadDetailDrawer'
import PipelineColumn from '@/components/pipeline/PipelineColumn'
import { canAccessFeature, isAdmin } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getGuestLeads } from '@/lib/guest-session'
import {
  ACTIVE_PIPELINE_STAGES,
  addDaysIso,
  canSendFollowup,
  getLegacyStatusForPipelineStage,
  getPipelineLifecycleStatus,
  isReadyForFollowup,
  type Lead,
  type PipelineStage,
  type SendMode,
} from '@/lib/pipeline/lifecycle'
import {
  filterPipelineLeads,
  sortPipelineLeads,
  type PipelineSortMode,
} from '@/lib/pipeline/retrieval'
import { supabase } from '@/lib/supabase'
import { GUEST_LEADS_UPDATED_EVENT } from '@/lib/trial'
import { cn } from '@/lib/utils'

type CloseReason = 'no_answer' | 'not_interested' | 'wrong_contact' | 'bounce' | 'other'
type PipelineAutomationTemplate = {
  id: string
  name: string | null
  subject: string | null
}
type PipelineAutomationSettings = {
  enabled: boolean
  step1_template_id: string | null
  step2_template_id: string | null
  step2_delay_days: number
  step3_template_id: string | null
  step3_delay_days: number
}
type AutomationStatus = {
  type: 'success' | 'error'
  message: string
} | null
type DistributionRow = {
  key: string
  count: number
}
type PipelineDataCheck = {
  total: number
  status: DistributionRow[]
  pipeline_stage: DistributionRow[]
}
type DraftGenerationResult = {
  created: number
  skipped: number
  firstOutreach: number
  followUp: number
  finalAttempt: number
  lifecycleCounts: {
    ready: number
    readyFollowup: number
    finalAttempt: number
    skipped: number
    closed: number
  }
} | null

const FOLLOWUP_WAIT_DAYS = 5
const DEFAULT_AUTOMATION_SETTINGS: PipelineAutomationSettings = {
  enabled: false,
  step1_template_id: null,
  step2_template_id: null,
  step2_delay_days: 3,
  step3_template_id: null,
  step3_delay_days: 5,
}
const PIPELINE_SORT_OPTIONS: Array<{ value: PipelineSortMode; label: string }> = [
  { value: 'recent_activity', label: 'Recent Activity' },
  { value: 'recently_added', label: 'Recently added' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'oldest_waiting', label: 'Oldest waiting' },
  { value: 'az', label: 'A-Z' },
]

const PIPELINE_ACTIVE_STATUS_FILTER =
  'status.in.(pipeline,contacted,followup_due,followup_sent,interested),pipeline_stage.in.(ready,contacted,followup,ready_followup,final_attempt)'
const PIPELINE_LEAD_SELECT =
  'id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, date_added, status_updated_at, last_activity_at'
const LEGACY_PIPELINE_LEAD_SELECT =
  'id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, date_added'

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
  const [pipelineTotalCount, setPipelineTotalCount] = useState<number | null>(null)
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
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<PipelineSortMode>('recent_activity')
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)
  const isAdminUser = !profileLoading && isAdmin(profile)
  const [automationTemplates, setAutomationTemplates] = useState<PipelineAutomationTemplate[]>([])
  const [automationSettings, setAutomationSettings] = useState<PipelineAutomationSettings>(DEFAULT_AUTOMATION_SETTINGS)
  const [automationLoading, setAutomationLoading] = useState(false)
  const [automationSaving, setAutomationSaving] = useState(false)
  const [automationGenerating, setAutomationGenerating] = useState(false)
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus>(null)
  const [draftGenerationResult, setDraftGenerationResult] = useState<DraftGenerationResult>(null)
  const [dataCheck, setDataCheck] = useState<PipelineDataCheck | null>(null)
  const [dataCheckLoading, setDataCheckLoading] = useState(false)
  const [dataCheckError, setDataCheckError] = useState('')

  useEffect(() => {
    if (userLoading) return
    void fetchLeads()

    const syncGuestLeads = () => {
      const guestLeads = getGuestLeads().map((lead) => ({
        ...lead,
        status: 'pipeline',
        pipeline_stage: 'ready',
        last_activity_at: lead.last_activity_at || lead.status_updated_at || lead.created_at,
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

  useEffect(() => {
    if (!isAdminUser || !user?.id) return
    void fetchAutomationSettings()
    void fetchPipelineDataCheck()
  }, [isAdminUser, user?.id])

  const visibleLeads = useMemo(() => {
    return sortPipelineLeads(filterPipelineLeads(leads, searchQuery), sortMode)
  }, [leads, searchQuery, sortMode])
  const activeStages = ACTIVE_PIPELINE_STAGES
  const stageMap = useMemo(() => {
    return activeStages.reduce<Record<PipelineStage, Lead[]>>(
      (accumulator, stage) => {
        accumulator[stage.key] = visibleLeads.filter((lead) => getPipelineLifecycleStatus(lead) === stage.key)
        return accumulator
      },
      { ready: [], contacted: [], ready_followup: [], final_attempt: [], closed: [] }
    )
  }, [activeStages, visibleLeads])

  const leadsById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])
  const selectedIdSet = useMemo(() => new Set(selected), [selected])
  const selectedDetailLead = selectedLeadId ? leadsById.get(selectedLeadId) || null : null
  const selectedLeads = useMemo(
    () => selected.map((id) => leadsById.get(id)).filter(Boolean) as Lead[],
    [selected, leadsById]
  )
  const initialSendable = selectedLeads.filter((lead) => getPipelineLifecycleStatus(lead) === 'ready' && Boolean(lead.email))
  const followupSendable = selectedLeads.filter((lead) => canSendFollowup(lead) && Boolean(lead.email))
  const earlyFollowupSelectedCount = followupSendable.filter((lead) => !isReadyForFollowup(lead)).length
  const closableSelected = selectedLeads.filter((lead) => getPipelineLifecycleStatus(lead) !== 'closed')

  const summary = {
    total: searchQuery.trim() ? visibleLeads.length : pipelineTotalCount ?? visibleLeads.length,
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
      const guestPipelineLeads = getGuestLeads().map((lead) => ({
        ...lead,
        status: 'pipeline',
        pipeline_stage: 'ready',
        last_activity_at: lead.last_activity_at || lead.status_updated_at || lead.created_at,
      }))
      setIsGuest(true)
      setLeads(guestPipelineLeads as Lead[])
      setPipelineTotalCount(guestPipelineLeads.length)
      setLoading(false)
      return
    }

    setIsGuest(false)

    const query = supabase
      .from('leads')
      .select(PIPELINE_LEAD_SELECT)
      .eq('user_id', user.id)
      .or(PIPELINE_ACTIVE_STATUS_FILTER)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('date_added', { ascending: false, nullsFirst: false })

    const [result, countResult] = await Promise.all([
      query,
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .or(PIPELINE_ACTIVE_STATUS_FILTER),
    ])
    let data = result.data as Lead[] | null
    let error = result.error

    if (countResult.error) {
      console.error('Error counting pipeline leads:', formatSupabaseError(countResult.error))
    } else {
      setPipelineTotalCount(countResult.count ?? 0)
    }

    if (error && isMissingColumnError(error)) {
      console.warn('Retrying pipeline fetch without optional lifecycle activity fields:', formatSupabaseError(error))
      const fallback = await supabase
        .from('leads')
        .select(LEGACY_PIPELINE_LEAD_SELECT)
        .eq('user_id', user.id)
        .or(PIPELINE_ACTIVE_STATUS_FILTER)
        .order('date_added', { ascending: false, nullsFirst: false })

      data = fallback.data as Lead[] | null
      error = fallback.error
    }

    if (error) {
      console.error('Error fetching leads:', formatSupabaseError(error))
      setStatusMessage('Could not load lifecycle fields. Check that the latest Supabase migration has run.')
      setLoading(false)
      return
    }

    setLeads(((data || []) as Lead[]).filter((lead) => getPipelineLifecycleStatus(lead) !== 'closed'))
    setLoading(false)
  }

  function formatSupabaseError(error: any) {
    return {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      raw: error,
    }
  }

  function isMissingColumnError(error: any) {
    const message = String(error?.message || '').toLowerCase()
    return error?.code === '42703' || message.includes('last_activity_at') || message.includes('status_updated_at')
  }

  async function fetchAutomationSettings() {
    setAutomationLoading(true)
    setAutomationStatus(null)

    try {
      const response = await fetch('/api/pipeline-automation/settings', { cache: 'no-store' })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        console.error('Pipeline automation settings fetch API error:', result)
        throw new Error(result?.message || result?.error || 'Settings fetch failed')
      }

      setAutomationTemplates((result?.templates || []) as PipelineAutomationTemplate[])
      setAutomationSettings({
        ...DEFAULT_AUTOMATION_SETTINGS,
        ...(result?.settings || {}),
      })
      setDraftGenerationResult(null)
    } catch (error) {
      console.error('Pipeline automation settings fetch failed:', error)
      setAutomationStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not load automation settings.',
      })
    } finally {
      setAutomationLoading(false)
    }
  }

  async function saveAutomationSettings() {
    if (!isAdminUser) return

    setAutomationSaving(true)
    setAutomationStatus(null)

    try {
      const response = await fetch('/api/pipeline-automation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(automationSettings),
      })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        console.error('Pipeline automation settings save API error:', result)
        throw new Error(result?.message || result?.error || 'Settings save failed')
      }

      setAutomationStatus({
        type: 'success',
        message: 'Pipeline automation settings saved.',
      })
    } catch (error) {
      console.error('Pipeline automation settings save failed:', error)
      setAutomationStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not save automation settings.',
      })
    } finally {
      setAutomationSaving(false)
    }
  }

  async function generateAutomationDrafts() {
    if (!isAdminUser) return

    setAutomationGenerating(true)
    setAutomationStatus(null)
    setDraftGenerationResult(null)

    try {
      const response = await fetch('/api/pipeline-automation/generate-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        console.error('Pipeline automation draft generation API error:', result)
        throw new Error(result?.message || result?.error || 'Draft generation failed')
      }

      const generationResult = {
        created: Number(result?.created || 0),
        skipped: Number(result?.skipped || 0),
        firstOutreach: Number(result?.firstOutreach || 0),
        followUp: Number(result?.followUp || 0),
        finalAttempt: Number(result?.finalAttempt || 0),
        lifecycleCounts: {
          ready: Number(result?.lifecycleCounts?.ready || 0),
          readyFollowup: Number(result?.lifecycleCounts?.readyFollowup || 0),
          finalAttempt: Number(result?.lifecycleCounts?.finalAttempt || 0),
          skipped: Number(result?.lifecycleCounts?.skipped || 0),
          closed: Number(result?.lifecycleCounts?.closed || 0),
        },
      }

      setDraftGenerationResult(generationResult)
      setAutomationStatus({
        type: 'success',
        message: `${generationResult.created} draft${generationResult.created === 1 ? '' : 's'} generated.`,
      })
    } catch (error) {
      console.error('Pipeline automation draft generation failed:', error)
      setAutomationStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not generate drafts.',
      })
    } finally {
      setAutomationGenerating(false)
    }
  }

  async function fetchPipelineDataCheck() {
    setDataCheckLoading(true)
    setDataCheckError('')

    try {
      const response = await fetch('/api/pipeline-automation/data-check', { cache: 'no-store' })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(result?.error || 'Data check failed')
      }

      setDataCheck(result as PipelineDataCheck)
    } catch (error) {
      console.error('Pipeline data check failed:', error)
      setDataCheckError('Could not load pipeline distributions.')
    } finally {
      setDataCheckLoading(false)
    }
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
              last_activity_at: now,
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
              last_activity_at: now,
            }

      const { error } = await updateLeadLifecycle(lead.id, payload)
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
      last_activity_at: now,
    }

    const { error } = await updateLeadLifecycle(ids, payload)
    if (error) throw error

    setLeads((prev) => prev.filter((lead) => !ids.includes(lead.id)))
    setPipelineTotalCount((prev) => (prev === null ? prev : Math.max(prev - ids.length, 0)))
    setSelected((prev) => prev.filter((id) => !ids.includes(id)))
    setSelectedLeadId((prev) => (prev && ids.includes(prev) ? null : prev))
  }

  async function updateLeadLifecycle(ids: string | string[], payload: Record<string, unknown>) {
    if (!user?.id) return { error: new Error('Missing authenticated user') }

    const applyUpdate = (nextPayload: Record<string, unknown>) => {
      const query = supabase.from('leads').update(nextPayload)
      const scopedQuery = Array.isArray(ids) ? query.in('id', ids) : query.eq('id', ids)
      return scopedQuery.eq('user_id', user.id)
    }

    const result = await applyUpdate(payload)
    if (!result.error || !isMissingColumnError(result.error)) return result

    const fallbackPayload = { ...payload }
    delete fallbackPayload.last_activity_at
    delete fallbackPayload.status_updated_at
    console.warn('Retrying lifecycle update without optional activity fields:', formatSupabaseError(result.error))
    return applyUpdate(fallbackPayload)
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
      <div className={cn('space-y-6 lg:pb-6', selected.length > 0 ? 'pb-24' : 'pb-8')}>
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

        {isAdminUser ? (
          <>
            <PipelineAutomationCard
              templates={automationTemplates}
              settings={automationSettings}
              loading={automationLoading}
              saving={automationSaving}
              generating={automationGenerating}
              status={automationStatus}
              generationResult={draftGenerationResult}
              onChange={(settings) => {
                setAutomationSettings(settings)
                setDraftGenerationResult(null)
              }}
              onSave={() => void saveAutomationSettings()}
              onGenerateDrafts={() => void generateAutomationDrafts()}
            />
            <PipelineDataCheckPanel
              data={dataCheck}
              loading={dataCheckLoading}
              error={dataCheckError}
              onRefresh={() => void fetchPipelineDataCheck()}
            />
          </>
        ) : null}

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

        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.028] p-2.5 shadow-[0_16px_42px_rgba(2,8,23,0.18)] backdrop-blur-xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="group relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition group-focus-within:text-blue-200" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search leads..."
                className="h-11 w-full rounded-xl border border-white/[0.08] bg-slate-950/46 pl-9 pr-10 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-300/24 focus:bg-slate-950/62 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.08)]"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-200"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="relative sm:w-[190px]">
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as PipelineSortMode)}
                className="h-11 w-full appearance-none rounded-xl border border-white/[0.08] bg-slate-950/46 px-3 pr-9 text-sm font-medium text-slate-100 outline-none transition focus:border-blue-300/24 focus:bg-slate-950/62 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.08)]"
                aria-label="Sort pipeline"
              >
                {PIPELINE_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                ▼
              </span>
            </div>
          </div>
        </section>

        <section className="glass sticky top-3 z-20 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium text-white">{selected.length} selected</div>
              <div className="mt-1 text-xs text-slate-400">
                {initialSendable.length} initial-ready · {followupSendable.length} follow-up eligible · {closableSelected.length} closable
              </div>
              {earlyFollowupSelectedCount > 0 ? (
                <div className="mt-1 text-xs text-slate-500">
                  {earlyFollowupSelectedCount} selected earlier than recommended cadence.
                </div>
              ) : null}
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

function PipelineAutomationCard({
  templates,
  settings,
  loading,
  saving,
  generating,
  status,
  generationResult,
  onChange,
  onSave,
  onGenerateDrafts,
}: {
  templates: PipelineAutomationTemplate[]
  settings: PipelineAutomationSettings
  loading: boolean
  saving: boolean
  generating: boolean
  status: AutomationStatus
  generationResult: DraftGenerationResult
  onChange: (settings: PipelineAutomationSettings) => void
  onSave: () => void
  onGenerateDrafts: () => void
}) {
  const update = (patch: Partial<PipelineAutomationSettings>) => {
    onChange({ ...settings, ...patch })
  }
  const configuredTemplates = [
    settings.step1_template_id,
    settings.step2_template_id,
    settings.step3_template_id,
  ].filter(Boolean).length
  const canGenerateDrafts = settings.enabled && configuredTemplates > 0

  return (
    <section className="rounded-2xl border border-blue-300/14 bg-white/[0.032] p-4 shadow-[0_14px_34px_rgba(2,8,23,0.16)] backdrop-blur-xl sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Pipeline Automation</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Choose the templates and timing ALPA should use to prepare outreach drafts for review. Emails are not sent automatically.
          </p>
        </div>

        <label className="inline-flex w-fit shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm font-medium text-slate-200">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
            className="h-4 w-4 rounded border-white/20 bg-transparent text-blue-400"
          />
          Enabled
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
        <StatusChip label="Templates configured" value={`${configuredTemplates}/3`} />
        <StatusChip label="Automation" value={settings.enabled ? 'Enabled' : 'Disabled'} />
        <StatusChip label="Mode" value="Review before send" />
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_92px_minmax(0,1fr)_92px_minmax(0,1fr)] lg:items-center">
        <AutomationStepCard
          label="Step 1"
          title="First outreach"
          value={settings.step1_template_id}
          templates={templates}
          loading={loading}
          onChange={(value) => update({ step1_template_id: value })}
        />
        <AutomationWaitControl
          value={settings.step2_delay_days}
          target="follow-up"
          onChange={(value) => update({ step2_delay_days: value })}
        />
        <AutomationStepCard
          label="Step 2"
          title="Follow-up"
          value={settings.step2_template_id}
          templates={templates}
          loading={loading}
          onChange={(value) => update({ step2_template_id: value })}
        />
        <AutomationWaitControl
          value={settings.step3_delay_days}
          target="final attempt"
          onChange={(value) => update({ step3_delay_days: value })}
        />
        <AutomationStepCard
          label="Step 3"
          title="Final attempt"
          value={settings.step3_template_id}
          templates={templates}
          loading={loading}
          onChange={(value) => update({ step3_template_id: value })}
        />
      </div>

      {generationResult ? (
        <div className="mt-4 rounded-xl border border-emerald-300/18 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          <div className="font-semibold">
            {generationResult.created} draft{generationResult.created === 1 ? '' : 's'} generated
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-100/80">
            <span>First Outreach: {generationResult.firstOutreach}</span>
            <span>Follow-Up: {generationResult.followUp}</span>
            <span>Final Attempt: {generationResult.finalAttempt}</span>
            {generationResult.skipped > 0 ? <span>Skipped duplicates/unconfigured: {generationResult.skipped}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-emerald-100/12 pt-2 text-xs text-emerald-100/70">
            <span>Ready: {generationResult.lifecycleCounts.ready}</span>
            <span>Ready Follow-up: {generationResult.lifecycleCounts.readyFollowup}</span>
            <span>Final Attempt: {generationResult.lifecycleCounts.finalAttempt}</span>
            <span>Skipped: {generationResult.lifecycleCounts.skipped}</span>
            <span>Closed: {generationResult.lifecycleCounts.closed}</span>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {status && !generationResult ? (
          <div
            className={cn(
              'rounded-xl border px-3 py-2 text-sm',
              status.type === 'success'
                ? 'border-emerald-300/18 bg-emerald-500/10 text-emerald-100'
                : 'border-rose-300/18 bg-rose-500/10 text-rose-100'
            )}
          >
            {status.message}
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {generationResult?.created ? (
            <a
              href="/dashboard/outreach"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] hover:text-white"
            >
              Open Outreach Queue
            </a>
          ) : null}
          {canGenerateDrafts ? (
            <button
              type="button"
              onClick={onGenerateDrafts}
              disabled={loading || saving || generating}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-500/90 px-4 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(16,185,129,0.13)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.04] disabled:text-slate-500 sm:min-w-[150px]"
            >
              {generating ? 'Generating...' : 'Generate Drafts'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            disabled={loading || saving || generating}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-blue-300/20 bg-blue-500 px-4 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(59,130,246,0.16)] transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.04] disabled:text-slate-500 sm:min-w-[150px]"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </section>
  )
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-slate-950/34 px-2.5 py-1">
      <span className="text-slate-500">{label}:</span>
      <span className="font-medium text-slate-100">{value}</span>
    </span>
  )
}

function AutomationStepCard({
  label,
  title,
  value,
  templates,
  loading,
  onChange,
}: {
  label: string
  title: string
  value: string | null
  templates: PipelineAutomationTemplate[]
  loading: boolean
  onChange: (value: string | null) => void
}) {
  return (
    <div className="rounded-xl border border-blue-300/14 bg-slate-950/42 p-3 shadow-[0_10px_26px_rgba(2,8,23,0.14)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200/70">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{title}</div>
      <AutomationTemplateSelect
        value={value}
        templates={templates}
        loading={loading}
        onChange={onChange}
      />
    </div>
  )
}

function AutomationWaitControl({
  value,
  target,
  onChange,
}: {
  value: number
  target: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-center px-1 py-1 text-sm text-slate-300">
      <div className="hidden items-center gap-1 text-slate-500 lg:flex">
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
      <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.018] px-2 py-2 lg:w-auto lg:flex-col lg:gap-1 lg:border-transparent lg:bg-transparent lg:px-0">
        <ArrowDown className="h-3.5 w-3.5 text-slate-500 lg:hidden" />
        <span className="text-xs text-slate-500">Wait</span>
        <input
          type="number"
          min={0}
          max={365}
          value={value}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
          className="h-8 w-14 rounded-lg border border-white/[0.08] bg-slate-950/50 px-2 text-center text-sm font-semibold text-white outline-none transition focus:border-blue-300/24"
          aria-label={`Days before ${target}`}
        />
        <span className="text-xs text-slate-400">days</span>
      </div>
      <div className="hidden items-center gap-1 text-slate-500 lg:flex">
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </div>
  )
}

function AutomationTemplateSelect({
  value,
  templates,
  loading,
  onChange,
}: {
  value: string | null
  templates: PipelineAutomationTemplate[]
  loading: boolean
  onChange: (value: string | null) => void
}) {
  return (
    <select
      value={value || ''}
      onChange={(event) => onChange(event.target.value || null)}
      disabled={loading}
      className="mt-3 h-10 w-full rounded-xl border border-white/[0.08] bg-slate-950/46 px-3 text-sm text-slate-100 outline-none transition focus:border-blue-300/24 focus:bg-slate-950/62 disabled:cursor-not-allowed disabled:text-slate-500"
    >
      <option value="">{loading ? 'Loading templates...' : 'Select template'}</option>
      {templates.map((template) => (
        <option key={template.id} value={template.id}>
          {template.name || template.subject || 'Untitled template'}
        </option>
      ))}
    </select>
  )
}

function PipelineDataCheckPanel({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: PipelineDataCheck | null
  loading: boolean
  error: string
  onRefresh: () => void
}) {
  return (
    <details className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-sm text-slate-300 backdrop-blur-xl">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="font-semibold text-white">Pipeline Data Check</span>
          <span className="ml-2 text-xs text-slate-500">
            {loading ? 'Loading distributions...' : data ? `${data.total} total lead rows` : 'Status and stage distribution'}
          </span>
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            onRefresh()
          }}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
        >
          Refresh
        </button>
      </summary>

      <div className="mt-3">
        {error ? (
          <div className="rounded-xl border border-rose-300/18 bg-rose-500/10 px-3 py-2 text-rose-100">
            {error}
          </div>
        ) : null}

        {!error && !data && !loading ? (
          <div className="rounded-xl border border-white/[0.06] bg-slate-950/32 px-3 py-2 text-slate-500">
            No diagnostic data loaded yet.
          </div>
        ) : null}

        {data ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <DistributionList title="Status" prefix="status" rows={data.status} />
            <DistributionList title="Pipeline stage" prefix="pipeline_stage" rows={data.pipeline_stage} />
          </div>
        ) : null}
      </div>
    </details>
  )
}

function DistributionList({
  title,
  prefix,
  rows,
}: {
  title: string
  prefix: string
  rows: DistributionRow[]
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-slate-950/32 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-2 space-y-1">
        {rows.length === 0 ? (
          <div className="text-xs text-slate-500">No rows</div>
        ) : rows.map((row) => (
          <div key={`${prefix}-${row.key}`} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-slate-400">
              {prefix}: <span className="text-slate-200">{row.key}</span>
            </span>
            <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-medium text-white">
              {row.count}
            </span>
          </div>
        ))}
      </div>
    </div>
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
