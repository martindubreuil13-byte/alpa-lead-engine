'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Copy, Download, Globe, Mail, Phone, Search, Trash2, Check, X, Loader2, Sparkles } from 'lucide-react'

import { downloadLeadCsv, getLeadCsvFilename } from '@/lib/leads/csv'
import { type Lead as LifecycleLead } from '@/lib/pipeline/lifecycle'
import { cn } from '@/lib/utils'
import { archiveLeads, restoreLeads, deleteLead, deleteLeads } from './actions'

export type MyLeadsLead = LifecycleLead & {
  id: string
  user_id: string
  company_name: string
  city: string | null
  industry: string | null
  email: string | null
  phone: string | null
  website: string | null
  status: string
  created_at?: string | null
  date_added?: string | null
  website_snapshot: any | null
  business_signals: any | null
  commercial_profile: any | null
  ci_enrichment_status: string | null
  ci_started_at: string | null
  ci_completed_at: string | null
  ci_last_error: string | null
  ci_retry_count: number | null
  ci_processing_duration_ms: number | null
  ci_cost_estimate: number | null
  ci_model_versions: any | null
}

export type MyLeadsCampaignSignal = {
  lead_id: string | null
  review_status: string | null
  status: string | null
}

type Priority = 'ready' | 'overdue' | 'reply' | 'review' | 'waitlist' | 'archived'
type ViewMode = 'active' | 'archived'

interface LeadMetadata {
  priority: Priority
  priorityLabel: string
  activitySummary: string
  contactInfo: { website: boolean; email: boolean; phone: boolean }
  isUrgent: boolean
}

function getLeadMetadata(lead: MyLeadsLead, campaignLeadIds: Set<string>): LeadMetadata {
  const isArchived = isArchivedLead(lead)
  if (isArchived) {
    return {
      priority: 'archived',
      priorityLabel: 'Archived',
      activitySummary: 'No further action',
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: false,
    }
  }

  const inCampaign = campaignLeadIds.has(lead.id)
  const hasActivity = hasContactActivity(lead)
  const quality = getLeadQuality(lead)

  if (lead.followup_due_at && new Date(lead.followup_due_at) < new Date()) {
    return {
      priority: 'overdue',
      priorityLabel: 'Follow-up overdue',
      activitySummary: getActivityTimeline(lead),
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: true,
    }
  }

  if (inCampaign) {
    return {
      priority: 'reply',
      priorityLabel: 'Waiting for reply',
      activitySummary: getActivityTimeline(lead),
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: false,
    }
  }

  if (quality === 'ready' && !hasActivity) {
    return {
      priority: 'ready',
      priorityLabel: 'Ready to contact',
      activitySummary: `Discovered ${getDiscoveryTime(lead)}`,
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: false,
    }
  }

  if (quality !== 'ready') {
    return {
      priority: 'review',
      priorityLabel: 'Needs review',
      activitySummary: getMissingContactInfo(lead),
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: false,
    }
  }

  if (hasActivity && lead.followup_due_at) {
    return {
      priority: 'waitlist',
      priorityLabel: 'Waiting for follow-up',
      activitySummary: `Due ${getFollowUpDueTime(lead)}`,
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: false,
    }
  }

  return {
    priority: 'waitlist',
    priorityLabel: 'In progress',
    activitySummary: getActivityTimeline(lead),
    contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
    isUrgent: false,
  }
}

function getLeadQuality(lead: MyLeadsLead): 'ready' | 'partial' | 'incomplete' {
  const hasEmail = !!lead.email?.trim()
  const hasPhone = !!lead.phone?.trim()
  const hasWebsite = !!lead.website?.trim()
  if (hasEmail && hasPhone && hasWebsite) return 'ready'
  if (hasEmail || hasPhone || hasWebsite) return 'partial'
  return 'incomplete'
}

function getMissingContactInfo(lead: MyLeadsLead): string {
  const missing = []
  if (!lead.email) missing.push('Email')
  if (!lead.phone) missing.push('Phone')
  if (!lead.website) missing.push('Website')
  return `Missing: ${missing.join(', ')}`
}

function getDiscoveryTime(lead: MyLeadsLead): string {
  if (!lead.created_at && !lead.date_added) return 'recently'
  const date = new Date(lead.created_at || lead.date_added || '')
  if (isNaN(date.getTime())) return 'recently'
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date)
}

function getFollowUpDueTime(lead: MyLeadsLead): string {
  if (!lead.followup_due_at) return 'soon'
  const due = new Date(lead.followup_due_at)
  const today = new Date()
  const daysUntil = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (daysUntil < 0) return 'today'
  if (daysUntil === 0) return 'today'
  if (daysUntil === 1) return 'tomorrow'
  return `in ${daysUntil}d`
}

function getActivityTimeline(lead: MyLeadsLead): string {
  if (lead.last_activity_at) {
    const date = new Date(lead.last_activity_at)
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Active today'
    if (days === 1) return 'Active yesterday'
    return `Active ${days}d ago`
  }
  return getDiscoveryTime(lead)
}

function isArchivedLead(lead: MyLeadsLead): boolean {
  const status = String(lead.status || '').trim().toLowerCase()
  return (
    lead.pipeline_stage === 'closed' ||
    ['closed_no_response', 'no_response', 'rejected', 'invalid', 'archived'].includes(status)
  )
}

function hasContactActivity(lead: MyLeadsLead): boolean {
  const status = String(lead.status || '').trim().toLowerCase()
  return Boolean(
    lead.first_contact_at ||
      lead.last_contact_at ||
      lead.followup_sent_at ||
      lead.final_attempt_sent_at ||
      (lead.outreach_attempts || 0) > 0 ||
      ['contacted', 'followup_due', 'followup_sent'].includes(status)
  )
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
}

interface RelationshipStage {
  name: string
  completed: boolean
}

function getRelationshipMemory(lead: MyLeadsLead): RelationshipStage[] {
  const stages: RelationshipStage[] = []

  // Discovered: always true if lead exists
  stages.push({ name: 'Discovered', completed: true })

  // Validated: has any contact info
  const hasAnyContact = !!lead.email || !!lead.phone || !!lead.website
  stages.push({ name: 'Validated', completed: hasAnyContact })

  // Ready: has all contact info
  const hasAllContact = !!lead.email && !!lead.phone && !!lead.website
  stages.push({ name: 'Ready', completed: hasAllContact })

  // First Contact: has made contact
  const hasContact = hasContactActivity(lead)
  stages.push({ name: 'First Contact', completed: hasContact })

  // Awaiting Response: in active campaign
  const hasOutreach = Boolean(lead.outreach_attempts && lead.outreach_attempts > 0)
  stages.push({ name: 'Awaiting Response', completed: hasOutreach })

  // Follow-up: has follow-up scheduled or sent
  const hasFollowUp = !!lead.followup_due_at || !!lead.followup_sent_at
  stages.push({ name: 'Follow-up', completed: hasFollowUp })

  // Filter to only show completed stages (we want to show progress, not future)
  return stages.filter(s => s.completed)
}

function getStatusAccentColor(metadata: LeadMetadata): string {
  switch (metadata.priority) {
    case 'ready':
      return 'from-amber-500/50 to-amber-600/30'
    case 'overdue':
      return 'from-rose-500/50 to-rose-600/30'
    case 'reply':
      return 'from-blue-500/50 to-blue-600/30'
    case 'review':
      return 'from-amber-500/50 to-amber-600/30'
    case 'archived':
      return 'from-slate-600/30 to-slate-700/20'
    default:
      return 'from-slate-500/30'
  }
}

interface NextRecommendation {
  title: string
  action: string
}

function getNextRecommendation(lead: MyLeadsLead, metadata: LeadMetadata): NextRecommendation | null {
  const isArchived = isArchivedLead(lead)
  if (isArchived) {
    return {
      title: 'This lead is archived.',
      action: "Restore it if you'd like to re-engage.",
    }
  }

  const quality = getLeadQuality(lead)
  const hasActivity = hasContactActivity(lead)

  // Overdue follow-up
  if (lead.followup_due_at && new Date(lead.followup_due_at) < new Date()) {
    const daysSince = Math.floor((Date.now() - new Date(lead.last_contact_at || lead.created_at || '').getTime()) / (1000 * 60 * 60 * 24))
    return {
      title: 'Follow-up overdue.',
      action: `Last contact ${daysSince}d ago. Send follow-up.`,
    }
  }

  // In campaign / waiting for reply
  if (lead.outreach_attempts && lead.outreach_attempts > 0 && !hasActivity) {
    const daysSince = Math.floor((Date.now() - new Date(lead.last_activity_at || lead.created_at || '').getTime()) / (1000 * 60 * 60 * 24))
    return {
      title: 'Awaiting response.',
      action: `Last contact ${daysSince}d ago. Check for replies.`,
    }
  }

  // Missing information
  if (quality === 'incomplete') {
    const missing = []
    if (!lead.email) missing.push('email')
    if (!lead.phone) missing.push('phone')
    if (!lead.website) missing.push('website')
    return {
      title: 'Missing contact information.',
      action: `Add ${missing.join(', ')} before starting outreach.`,
    }
  }

  if (quality === 'partial') {
    const missing = []
    if (!lead.email) missing.push('email')
    if (!lead.phone) missing.push('phone')
    if (!lead.website) missing.push('website')
    return {
      title: 'Profile incomplete.',
      action: `Add ${missing.join(', ')} to complete verification.`,
    }
  }

  // Ready and never contacted
  if (quality === 'ready' && !hasActivity) {
    return {
      title: 'Ready to contact.',
      action: 'All contact info verified. Start outreach.',
    }
  }

  // Recently contacted, waiting
  if (hasActivity && lead.followup_due_at) {
    const daysUntil = Math.floor((new Date(lead.followup_due_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return {
      title: 'Follow-up scheduled.',
      action: `Next follow-up in ${daysUntil}d. Check back soon.`,
    }
  }

  // In conversation
  if (hasActivity) {
    return {
      title: 'Conversation in progress.',
      action: 'Continue engagement strategy.',
    }
  }

  return null
}

export default function MyLeadsWorkspaceClient({
  totalCount,
  loadedCount,
  initialLeads,
  campaignSignals,
}: {
  totalCount: number
  loadedCount: number
  initialLeads: MyLeadsLead[]
  campaignSignals: MyLeadsCampaignSignal[]
}) {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('active')
  const [deleteConfirmingId, setDeleteConfirmingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [archivedLeadIds, setArchivedLeadIds] = useState<Set<string>>(new Set())
  const [deletedLeadIds, setDeletedLeadIds] = useState<Set<string>>(new Set())
  const [enrichingId, setEnrichingId] = useState<string | null>(null)
  const [enrichedLeads, setEnrichedLeads] = useState<Map<string, MyLeadsLead>>(new Map())

  const campaignLeadIds = useMemo(
    () => new Set(campaignSignals.map((signal) => signal.lead_id).filter(Boolean) as string[]),
    [campaignSignals]
  )

  const leadsWithMetadata = useMemo(
    () => initialLeads.map((lead) => ({ ...lead, metadata: getLeadMetadata(lead, campaignLeadIds) })),
    [initialLeads, campaignLeadIds]
  )

  const priorities = useMemo(() => {
    const visibleLeads = leadsWithMetadata.filter((l) => !deletedLeadIds.has(l.id))
    const active = visibleLeads.filter((l) => {
      const isCurrentlyArchived = archivedLeadIds.has(l.id) || l.metadata.priority === 'archived'
      return !isCurrentlyArchived
    })
    return {
      ready: active.filter((l) => l.metadata.priority === 'ready').length,
      overdue: active.filter((l) => l.metadata.priority === 'overdue').length,
      reply: active.filter((l) => l.metadata.priority === 'reply').length,
      review: active.filter((l) => l.metadata.priority === 'review').length,
      archived: visibleLeads.filter((l) => archivedLeadIds.has(l.id) || l.metadata.priority === 'archived').length,
    }
  }, [leadsWithMetadata, archivedLeadIds, deletedLeadIds])

  const totalPriority = priorities.ready + priorities.overdue + priorities.reply + priorities.review

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const byView = leadsWithMetadata.filter((lead) => {
      // Hide deleted leads
      if (deletedLeadIds.has(lead.id)) return false

      // Handle archived state with optimistic updates
      const isCurrentlyArchived =
        archivedLeadIds.has(lead.id) || lead.metadata.priority === 'archived'

      if (viewMode === 'active') {
        return !isCurrentlyArchived
      } else {
        return isCurrentlyArchived
      }
    })

    if (!normalizedSearch) return byView

    return byView.filter((lead) =>
      [lead.company_name, lead.city, lead.industry, lead.email, lead.phone, lead.website]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    )
  }, [search, leadsWithMetadata, viewMode, archivedLeadIds, deletedLeadIds])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedLeads = useMemo(
    () => selectedIds.map((id) => leadsWithMetadata.find((l) => l.id === id)).filter(Boolean) as typeof leadsWithMetadata,
    [selectedIds, leadsWithMetadata]
  )

  function toggleLead(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id)
  }

  function handleLeadKeydown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleExpand(id)
    }
  }

  function exportSelected() {
    if (selectedLeads.length > 0) {
      downloadLeadCsv(selectedLeads, getLeadCsvFilename('my-leads'))
    }
  }

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleArchive(leadId: string) {
    // Optimistic update
    setArchivedLeadIds((prev) => new Set([...prev, leadId]))

    const result = await archiveLeads([leadId])
    if (!result.success) {
      // Rollback on error
      setArchivedLeadIds((prev) => {
        const next = new Set(prev)
        next.delete(leadId)
        return next
      })
      showToast("Couldn't archive lead.", 'error')
    }
  }

  async function handleRestore(leadId: string) {
    // Optimistic update
    setArchivedLeadIds((prev) => {
      const next = new Set(prev)
      next.delete(leadId)
      return next
    })

    const result = await restoreLeads([leadId])
    if (!result.success) {
      // Rollback on error
      setArchivedLeadIds((prev) => new Set([...prev, leadId]))
      showToast("Couldn't restore lead.", 'error')
    }
  }

  async function handleDeletePermanently(leadId: string) {
    setDeleteConfirmingId(null)

    // Optimistic update
    setDeletedLeadIds((prev) => new Set([...prev, leadId]))

    const result = await deleteLead(leadId)
    if (!result.success) {
      // Rollback on error
      setDeletedLeadIds((prev) => {
        const next = new Set(prev)
        next.delete(leadId)
        return next
      })
      showToast("Couldn't delete lead.", 'error')
    }
  }

  async function handleBulkArchive() {
    const ids = selectedIds
    // Optimistic update
    setArchivedLeadIds((prev) => new Set([...prev, ...ids]))
    setSelectedIds([])

    const result = await archiveLeads(ids)
    if (!result.success) {
      // Rollback on error
      setArchivedLeadIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      showToast(`Couldn't archive ${ids.length} leads.`, 'error')
    }
  }

  async function handleBulkRestore() {
    const ids = selectedIds
    // Optimistic update
    setArchivedLeadIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
    setSelectedIds([])

    const result = await restoreLeads(ids)
    if (!result.success) {
      // Rollback on error
      setArchivedLeadIds((prev) => new Set([...prev, ...ids]))
      showToast(`Couldn't restore ${ids.length} leads.`, 'error')
    }
  }

  async function handleBulkDelete() {
    const ids = selectedIds
    // Optimistic update
    setDeletedLeadIds((prev) => new Set([...prev, ...ids]))
    setSelectedIds([])

    const result = await deleteLeads(ids)
    if (!result.success) {
      // Rollback on error
      setDeletedLeadIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      showToast(`Couldn't delete ${ids.length} leads.`, 'error')
    }
  }

  async function handleEnrichCommercialIntelligence(leadId: string) {
    setEnrichingId(leadId)
    try {
      const response = await fetch(`/api/leads/${leadId}/enrich-commercial-intelligence`, {
        method: 'POST',
      })

      const result = await response.json()

      if (!response.ok) {
        // Ensure error message is a string
        const errorMessage =
          typeof result?.error?.message === 'string'
            ? result.error.message
            : typeof result?.message === 'string'
              ? result.message
              : result?.error
                ? typeof result.error === 'string'
                  ? result.error
                  : 'Enrichment failed'
                : 'Failed to enrich lead'
        showToast(errorMessage, 'error')
        return
      }

      if (result.ok && result.data) {
        // Update the lead data with enrichment results
        const enrichedLead = leadsWithMetadata.find((l) => l.id === leadId)
        if (enrichedLead) {
          const updated = {
            ...enrichedLead,
            website_snapshot: result.data.website_snapshot,
            business_signals: result.data.business_signals,
            commercial_profile: result.data.commercial_profile,
            ci_enrichment_status: result.data.ci_enrichment_status,
            ci_started_at: result.data.ci_started_at,
            ci_completed_at: result.data.ci_completed_at,
            ci_last_error: result.data.ci_last_error,
            ci_retry_count: result.data.ci_retry_count,
            ci_processing_duration_ms: result.data.ci_processing_duration_ms,
            ci_cost_estimate: result.data.ci_cost_estimate,
            ci_model_versions: result.data.ci_model_versions,
          }
          setEnrichedLeads((prev) => new Map(prev).set(leadId, updated))
          showToast('Commercial Intelligence refreshed successfully', 'success')
        }
      } else {
        // Partial success or failure - extract message safely
        const errorMessage =
          typeof result?.error?.message === 'string'
            ? result.error.message
            : 'Enrichment completed with errors'
        showToast(errorMessage, 'error')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error enriching lead'
      showToast(errorMessage, 'error')
    } finally {
      setEnrichingId(null)
    }
  }

  const archivedLeads = leadsWithMetadata.filter((l) => l.metadata.priority === 'archived')

  if (initialLeads.length === 0) {
    return (
      <div className="py-24 space-y-3">
        <h2 className="text-lg font-semibold text-white">No leads yet</h2>
        <p className="text-sm text-slate-400">Start discovering leads to build your workspace.</p>
      </div>
    )
  }

  if (viewMode === 'archived' && archivedLeads.length === 0) {
    return (
      <div className="py-24 space-y-3">
        <h2 className="text-lg font-semibold text-white">No archived leads</h2>
        <p className="text-sm text-slate-400">Leads you archive will appear here for 30 days.</p>
      </div>
    )
  }

  return (
    <div className="space-y-12 pb-28">
      {/* HEADER */}
      <div className="space-y-6">
        {viewMode === 'active' && (
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Today's priorities</h1>
            <p className="mt-2 text-sm text-slate-400">{totalCount.toLocaleString()} leads</p>
          </div>
        )}

        {viewMode === 'archived' && (
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Archived</h1>
            <p className="mt-2 text-sm text-slate-400">{priorities.archived} leads</p>
          </div>
        )}

        {/* PRIORITY SUMMARY - ACTIVE VIEW ONLY */}
        {viewMode === 'active' && totalPriority > 0 && (
          <div className="flex flex-wrap gap-4">
            {priorities.ready > 0 && (
              <div className="text-sm">
                <p className="font-semibold text-white">{priorities.ready}</p>
                <p className="text-xs text-slate-400">Ready to contact</p>
              </div>
            )}
            {priorities.overdue > 0 && (
              <div className="text-sm">
                <p className="font-semibold text-rose-300">{priorities.overdue}</p>
                <p className="text-xs text-slate-400">Overdue follow-ups</p>
              </div>
            )}
            {priorities.reply > 0 && (
              <div className="text-sm">
                <p className="font-semibold text-blue-300">{priorities.reply}</p>
                <p className="text-xs text-slate-400">Waiting for reply</p>
              </div>
            )}
            {priorities.review > 0 && (
              <div className="text-sm">
                <p className="font-semibold text-amber-300">{priorities.review}</p>
                <p className="text-xs text-slate-400">Need review</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SEARCH & VIEW TOGGLE */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent border-b border-white/10 pl-6 pr-0 py-1.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-white/20"
          />
        </div>

        <div className="flex gap-2 border-b border-white/10">
          <button
            onClick={() => setViewMode('active')}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition',
              viewMode === 'active'
                ? 'text-white border-b-2 border-white -mb-px'
                : 'text-slate-400 hover:text-slate-300'
            )}
          >
            Active
          </button>
          <button
            onClick={() => setViewMode('archived')}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition',
              viewMode === 'archived'
                ? 'text-white border-b-2 border-white -mb-px'
                : 'text-slate-400 hover:text-slate-300'
            )}
          >
            Archived {priorities.archived > 0 && `(${priorities.archived})`}
          </button>
        </div>
      </div>

      {/* LEADS LIST - PREMIUM COMPOSITION */}
      <ul className="space-y-2.5 list-none p-0">
        {filteredLeads.length === 0 ? (
          <li className="py-12 text-center text-sm text-slate-500">
            {viewMode === 'active' ? 'No active leads' : 'No archived leads'}
          </li>
        ) : (
          filteredLeads.map((lead) => {
            const isExpanded = expandedId === lead.id
            const isSelected = selectedSet.has(lead.id)
            const relationshipMemory = getRelationshipMemory(lead)
            const accentColor = getStatusAccentColor(lead.metadata)

            return (
              <li key={lead.id} className="group">
                {/* COLLAPSED CARD - PREMIUM INTRODUCTION */}
                <article
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => handleLeadKeydown(e, lead.id)}
                  onClick={() => toggleExpand(lead.id)}
                  className={cn(
                    'relative cursor-pointer outline-none transition-all duration-150 rounded-lg',
                    isExpanded
                      ? 'bg-white/[0.02]'
                      : 'hover:bg-white/[0.02]',
                    'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950'
                  )}
                >
                  {/* ATMOSPHERIC LEFT ACCENT LINE */}
                  <div className={cn('absolute left-0 top-0 bottom-0 w-0.5 rounded-full bg-gradient-to-b', accentColor)} />

                  <div className="px-6 py-5 space-y-3 pl-5">
                    {/* HEADER ROW - COMPANY NAME DOMINATES */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 pointer-events-none">
                        {/* COMPANY NAME - LARGE, CONFIDENT, DOMINANT */}
                        <h2 className="text-2xl font-bold tracking-tight text-white truncate leading-none">
                          {lead.company_name}
                        </h2>
                      </div>

                      {/* CONTROLS - SUBTLE, RIGHT SIDE */}
                      <div className="flex items-center gap-1.5 shrink-0 pointer-events-auto opacity-50 group-hover:opacity-100 transition-opacity duration-150">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation()
                            toggleLead(lead.id)
                          }}
                          className="cursor-pointer accent-blue-500"
                          aria-label={`Select ${lead.company_name}`}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleExpand(lead.id)
                          }}
                          className="rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-500 p-1.5 hover:bg-white/[0.05] transition-all duration-150"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          aria-expanded={isExpanded}
                        >
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 text-slate-600 transition-transform duration-200',
                              isExpanded && 'rotate-180'
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    {/* LOCATION & CONTACT ICONS - RECESSED METADATA */}
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs text-slate-500 opacity-70">
                        {[lead.city, lead.industry].filter(Boolean).join(' • ') || 'Location unknown'}
                      </p>

                      {/* CONTACT CAPABILITY INDICATORS */}
                      <div className="flex items-center gap-1.5 text-slate-600 opacity-50">
                        {lead.metadata.contactInfo.website && (
                          <Globe className="h-3.5 w-3.5" />
                        )}
                        {lead.metadata.contactInfo.email && (
                          <Mail className="h-3.5 w-3.5" />
                        )}
                        {lead.metadata.contactInfo.phone && (
                          <Phone className="h-3.5 w-3.5" />
                        )}
                      </div>
                    </div>

                    {/* RELATIONSHIP MEMORY - LIGHTWEIGHT PROGRESSION */}
                    {relationshipMemory.length > 0 && (
                      <div className="text-xs text-slate-500">
                        {relationshipMemory.map((stage, idx) => (
                          <span key={stage.name}>
                            {stage.name}
                            {idx < relationshipMemory.length - 1 && ' • '}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </article>

                {/* EXPANDED CARD - PREMIUM FOLDER EMERGENCE */}
                {isExpanded && (
                  <div className="overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className={cn(
                      'relative mx-2 mt-2 rounded-xl backdrop-blur-xl transition-all duration-200',
                      'border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.01]',
                      'shadow-[0_20px_60px_rgba(0,0,0,0.3)]'
                    )}>
                      <div className="px-6 py-6 space-y-6">
                        {/* RELATIONSHIP MEMORY - EXPANDED VIEW */}
                        {relationshipMemory.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-slate-400 tracking-wide">
                              Relationship
                            </div>
                            <div className="text-sm text-slate-300">
                              {relationshipMemory.map((stage, idx) => (
                                <span key={stage.name}>
                                  <span className={idx === relationshipMemory.length - 1 ? 'text-blue-300 font-medium' : ''}>
                                    {stage.name}
                                  </span>
                                  {idx < relationshipMemory.length - 1 && <span className="mx-2 text-slate-600">•</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* BUSINESS INFORMATION - MINIMAL PRESENTATION */}
                        {(lead.industry || lead.city) && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-slate-400 tracking-wide">
                              Business
                            </div>
                            <div className="space-y-1 text-sm text-slate-300">
                              {lead.industry && (
                                <div>{lead.industry}</div>
                              )}
                              {lead.city && (
                                <div className="text-slate-500">{lead.city}</div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* CONTACT INFORMATION - PREMIUM TOOLS */}
                        {(lead.website || lead.email || lead.phone) && (
                          <div className="space-y-2.5">
                            <div className="text-xs font-medium text-slate-400 tracking-wide">
                              Contact
                            </div>
                            <div className="space-y-1.5">
                              {lead.website && (
                                <div className="flex items-center justify-between gap-2 group/item px-3 py-2.5 rounded-lg hover:bg-white/[0.05] transition-all duration-150">
                                  <a
                                    href={lead.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-2.5 text-sm text-blue-300 hover:text-blue-200 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded px-1 flex-1 min-w-0"
                                  >
                                    <Globe className="h-4 w-4 shrink-0 text-slate-600 group-hover/item:text-blue-400 transition-colors" />
                                    <span className="truncate font-medium">{new URL(lead.website).hostname}</span>
                                  </a>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (lead.website) copyToClipboard(lead.website)
                                    }}
                                    className="opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] rounded shrink-0"
                                    title="Copy website"
                                    aria-label="Copy website"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                              {lead.email && (
                                <div className="flex items-center justify-between gap-2 group/item px-3 py-2.5 rounded-lg hover:bg-white/[0.05] transition-all duration-150">
                                  <a
                                    href={`mailto:${lead.email}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-2.5 text-sm text-blue-300 hover:text-blue-200 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded px-1 flex-1 min-w-0"
                                  >
                                    <Mail className="h-4 w-4 shrink-0 text-slate-600 group-hover/item:text-blue-400 transition-colors" />
                                    <span className="truncate">{lead.email}</span>
                                  </a>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (lead.email) copyToClipboard(lead.email)
                                    }}
                                    className="opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] rounded shrink-0"
                                    title="Copy email"
                                    aria-label="Copy email"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                              {lead.phone && (
                                <div className="flex items-center justify-between gap-2 group/item px-3 py-2.5 rounded-lg hover:bg-white/[0.05] transition-all duration-150">
                                  <a
                                    href={`tel:${lead.phone}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-2.5 text-sm text-blue-300 hover:text-blue-200 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-blue-500 rounded px-1 flex-1 min-w-0"
                                  >
                                    <Phone className="h-4 w-4 shrink-0 text-slate-600 group-hover/item:text-blue-400 transition-colors" />
                                    <span className="truncate">{lead.phone}</span>
                                  </a>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (lead.phone) copyToClipboard(lead.phone)
                                    }}
                                    className="opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] rounded shrink-0"
                                    title="Copy phone"
                                    aria-label="Copy phone"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* NOTES - IF PRESENT */}
                        {lead.notes && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-slate-400 tracking-wide">
                              Notes
                            </div>
                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{lead.notes}</p>
                          </div>
                        )}

                        {/* BUSINESS PROFILE SECTION */}
                        {(() => {
                          const currentLead = enrichedLeads.get(lead.id) || lead
                          const ciStatus = currentLead.ci_enrichment_status || 'not_generated'
                          const profile = currentLead.commercial_profile
                          const isEnriching = enrichingId === lead.id

                          return (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-medium text-slate-400 tracking-wide">
                                  Business Profile
                                </div>
                              </div>

                              <p className="text-xs text-slate-500">Business Profiles help you understand each company before reaching out.</p>

                              {profile && ciStatus === 'completed' ? (
                                <div className="space-y-3">
                                  <div className="text-xs text-slate-500 font-medium">Business Profile Ready</div>
                                  <div className="space-y-2 text-sm text-slate-300">
                                    {profile.summary && (
                                      <div>
                                        <p className="text-xs text-slate-500 mb-1">Summary</p>
                                        <p className="text-slate-300">{profile.summary}</p>
                                      </div>
                                    )}
                                    {profile.industry && (
                                      <div>
                                        <p className="text-xs text-slate-500">Industry</p>
                                        <p className="text-slate-300">{profile.industry}</p>
                                      </div>
                                    )}
                                    {profile.primary_service && (
                                      <div>
                                        <p className="text-xs text-slate-500">Primary Service</p>
                                        <p className="text-slate-300">{profile.primary_service}</p>
                                      </div>
                                    )}
                                    {profile.target_customer && (
                                      <div>
                                        <p className="text-xs text-slate-500">Target Customer</p>
                                        <p className="text-slate-300">{profile.target_customer}</p>
                                      </div>
                                    )}
                                    {profile.core_services && profile.core_services.length > 0 && (
                                      <div>
                                        <p className="text-xs text-slate-500">Core Services</p>
                                        <p className="text-slate-300">{profile.core_services.join(', ')}</p>
                                      </div>
                                    )}
                                    {profile.keywords && profile.keywords.length > 0 && (
                                      <div>
                                        <p className="text-xs text-slate-500">Keywords</p>
                                        <p className="text-slate-300">{profile.keywords.slice(0, 5).join(', ')}</p>
                                      </div>
                                    )}
                                    {currentLead.ci_completed_at && (
                                      <div>
                                        <p className="text-xs text-slate-500">Last Updated</p>
                                        <p className="text-slate-400 text-xs">
                                          {new Date(currentLead.ci_completed_at).toLocaleDateString()}
                                        </p>
                                      </div>
                                    )}
                                  </div>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleEnrichCommercialIntelligence(lead.id)
                                    }}
                                    disabled={isEnriching}
                                    className="w-full px-3 py-2 text-xs font-medium text-slate-300 hover:text-slate-200 hover:bg-white/[0.05] rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                  >
                                    {isEnriching ? (
                                      <span className="flex items-center justify-center gap-2">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Refreshing...
                                      </span>
                                    ) : (
                                      <span className="flex items-center justify-center gap-2">
                                        <Sparkles className="h-3 w-3" />
                                        Refresh Business Profile
                                      </span>
                                    )}
                                  </button>
                                </div>
                              ) : ciStatus === 'pending' || ciStatus === 'processing' ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Building Business Profile...
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleEnrichCommercialIntelligence(lead.id)
                                  }}
                                  disabled={isEnriching}
                                  className="w-full px-3 py-2.5 text-xs font-medium text-blue-300 hover:text-blue-200 hover:bg-blue-500/[0.08] rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                >
                                  {isEnriching ? (
                                    <span className="flex items-center justify-center gap-2">
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Generating...
                                    </span>
                                  ) : (
                                    <span className="flex items-center justify-center gap-2">
                                      <Sparkles className="h-3 w-3" />
                                      Generate Business Profile
                                    </span>
                                  )}
                                </button>
                              )}
                            </div>
                          )
                        })()}

                        {/* NEXT RECOMMENDATION - MOST VALUABLE SECTION */}
                        {(() => {
                          const rec = getNextRecommendation(lead, lead.metadata)
                          return rec ? (
                            <div className="space-y-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.04] px-4 py-4 backdrop-blur-sm transition-all hover:bg-blue-500/[0.06]">
                              <div className="text-xs font-semibold text-blue-300 tracking-wide uppercase">
                                Next
                              </div>
                              <div className="space-y-1.5 text-sm">
                                <p className="text-slate-200 font-medium leading-snug">{rec.title}</p>
                                <p className="text-slate-400 leading-snug">{rec.action}</p>
                              </div>
                            </div>
                          ) : null
                        })()}

                        {/* ACTIONS - SUBTLE, BOTTOM OF CARD */}
                        <div className="flex gap-2 pt-4 -mx-6 -mb-6 px-6 py-4 border-t border-white/10">
                          {viewMode === 'active' && (
                            <>
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="flex-1 px-3 py-2 text-xs font-medium text-blue-300 hover:text-blue-200 hover:bg-blue-500/[0.08] rounded-lg transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                Start outreach
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleArchive(lead.id)
                                }}
                                className="flex-1 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-300 hover:bg-white/[0.05] rounded-lg transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                Archive
                              </button>
                            </>
                          )}
                          {viewMode === 'archived' && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRestore(lead.id)
                                }}
                                className="flex-1 px-3 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 hover:bg-white/[0.08] rounded-lg transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                Restore
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteConfirmingId(lead.id)
                                }}
                                className="flex-1 px-3 py-2 text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/[0.12] rounded-lg transition outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                              >
                                Delete permanently
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            )
          })
        )}
      </ul>

      {/* BULK ACTIONS - PREMIUM FLOATING TOOLBAR */}
      {selectedIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-5 z-40 mx-auto w-[min(540px,calc(100vw-1rem))] animate-in fade-in slide-in-from-bottom-4 duration-150">
          <div className="rounded-xl border border-white/12 bg-gradient-to-b from-white/[0.06] to-white/[0.02] px-5 py-4 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-white">{selectedIds.length} selected</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportSelected}
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-300 transition hover:text-white hover:bg-white/[0.1] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </button>
                {viewMode === 'active' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleBulkArchive()
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-300 transition hover:text-white hover:bg-white/[0.1] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    Archive all
                  </button>
                )}
                {viewMode === 'archived' && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleBulkRestore()
                      }}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-300 transition hover:text-white hover:bg-white/[0.1] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      Restore all
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleBulkDelete()
                      }}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-rose-300 transition hover:text-rose-200 hover:bg-rose-500/[0.15] outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete all
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirmingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="rounded-xl border border-white/12 bg-gradient-to-b from-white/[0.08] to-white/[0.02] shadow-[0_25px_80px_rgba(0,0,0,0.4)] backdrop-blur-lg p-6 max-w-sm">
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">Delete permanently?</h3>
                <p className="text-sm text-slate-400">
                  This lead will be permanently deleted and cannot be recovered.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setDeleteConfirmingId(null)}
                  className="flex-1 px-3 py-2.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.08] rounded-lg transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (deleteConfirmingId) {
                      handleDeletePermanently(deleteConfirmingId)
                    }
                  }}
                  className="flex-1 px-3 py-2.5 text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/[0.12] rounded-lg transition outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  Delete permanently
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-150">
          <div
            className={cn(
              'rounded-lg px-4 py-3 text-sm font-medium backdrop-blur-lg border',
              toast.type === 'error'
                ? 'bg-rose-500/[0.1] border-rose-500/20 text-rose-300'
                : 'bg-blue-500/[0.1] border-blue-500/20 text-blue-300'
            )}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  )
}
