'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Copy, Download, Globe, Mail, Phone, Search, Trash2, Check, X, Loader2, Sparkles } from 'lucide-react'

import { downloadLeadCsv, getLeadCsvFilename } from '@/lib/leads/csv'
import { type Lead as LifecycleLead } from '@/lib/pipeline/lifecycle'
import { cn } from '@/lib/utils'
import { archiveLeads, restoreLeads, deleteLead, deleteLeads } from './actions'

// PHASE 0.1: MyLeadsLead represents a Business in the permanent repository (ADR-001)
// All discovered businesses are stored here.
// ALPA keeps this as the user's saved business library.
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

type Priority = 'ready' | 'review' | 'archived'
type ViewMode = 'active' | 'archived'

interface LeadMetadata {
  priority: Priority
  priorityLabel: string
  activitySummary: string
  contactInfo: { website: boolean; email: boolean; phone: boolean }
  isUrgent: boolean
}

function getLeadMetadata(lead: MyLeadsLead): LeadMetadata {
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

  const quality = getLeadQuality(lead)
  const hasCommercialProfile = lead.ci_enrichment_status === 'completed' || Boolean(lead.commercial_profile)

  if (hasCommercialProfile) {
    return {
      priority: 'ready',
      priorityLabel: 'Commercial profile ready',
      activitySummary: `Analyzed ${getDiscoveryTime({
        ...lead,
        created_at: lead.ci_completed_at || lead.created_at,
      })}`,
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: false,
    }
  }

  if (quality !== 'incomplete') {
    return {
      priority: 'review',
      priorityLabel: 'Ready for analysis',
      activitySummary: `Discovered ${getDiscoveryTime(lead)}`,
      contactInfo: { website: !!lead.website, email: !!lead.email, phone: !!lead.phone },
      isUrgent: false,
    }
  }

  return {
    priority: 'review',
    priorityLabel: 'Needs contact details',
    activitySummary: getMissingContactInfo(lead),
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

// PHASE 0.1: Archive is a status change, not removal. (ADR-001)
// Archived businesses remain in the repository; they're just hidden from active view.
function isArchivedLead(lead: MyLeadsLead): boolean {
  const status = String(lead.status || '').trim().toLowerCase()
  return (
    lead.pipeline_stage === 'closed' ||
    ['closed_no_response', 'no_response', 'rejected', 'invalid', 'archived'].includes(status)
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

  stages.push({ name: 'Discovered', completed: true })

  const hasAnyContact = !!lead.email || !!lead.phone || !!lead.website
  stages.push({ name: 'Contact details', completed: hasAnyContact })

  const hasCommercialProfile = lead.ci_enrichment_status === 'completed' || Boolean(lead.commercial_profile)
  stages.push({ name: 'Commercial Intelligence', completed: hasCommercialProfile })

  return stages.filter(s => s.completed)
}

function getStatusAccentColor(metadata: LeadMetadata): string {
  switch (metadata.priority) {
    case 'ready':
      return 'from-emerald-500/50 to-emerald-600/30'
    case 'review':
      return 'from-blue-500/50 to-blue-600/30'
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
  const hasCommercialProfile = lead.ci_enrichment_status === 'completed' || Boolean(lead.commercial_profile)

  if (quality === 'incomplete') {
    const missing = []
    if (!lead.email) missing.push('email')
    if (!lead.phone) missing.push('phone')
    if (!lead.website) missing.push('website')
    return {
      title: 'Missing contact information.',
      action: `Add ${missing.join(', ')} to make this business easier to evaluate.`,
    }
  }

  if (quality === 'partial') {
    const missing = []
    if (!lead.email) missing.push('email')
    if (!lead.phone) missing.push('phone')
    if (!lead.website) missing.push('website')
    return {
      title: 'Profile incomplete.',
      action: `Add ${missing.join(', ')} when available.`,
    }
  }

  if (!hasCommercialProfile && lead.website) {
    return {
      title: 'Ready for Commercial Intelligence.',
      action: 'Analyze this business to understand fit, signals, and context.',
    }
  }

  if (hasCommercialProfile) {
    return {
      title: 'Commercial profile ready.',
      action: 'Review the business signals and decide whether to keep, export, or contact.',
    }
  }

  return null
}

export default function MyLeadsWorkspaceClient({
  totalCount,
  loadedCount,
  initialLeads,
}: {
  totalCount: number
  loadedCount: number
  initialLeads: MyLeadsLead[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('active')
  const [showCompletedOnly, setShowCompletedOnly] = useState(false)
  const [deleteConfirmingId, setDeleteConfirmingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [archivedLeadIds, setArchivedLeadIds] = useState<Set<string>>(new Set())
  const [deletedLeadIds, setDeletedLeadIds] = useState<Set<string>>(new Set())
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  useEffect(() => {
    const ciSummary = initialLeads.reduce((acc: Record<string, number>, lead) => {
      const status = lead.ci_enrichment_status || 'not_generated'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})

    console.log(
      '[CI-TRACE] STEP 10 AFTER MyLeadsWorkspaceClient.mount',
      {
        loadedCount,
        totalCount,
        ciSummary,
        sample: initialLeads.slice(0, 5).map((lead) => ({
          lead_id: lead.id,
          status: lead.ci_enrichment_status || 'not_generated',
          has_profile: Boolean(lead.commercial_profile),
          completed_at: lead.ci_completed_at || null,
        })),
      }
    )

    // Guard against duplicate workers (React strict mode mounts components twice)
    const workerKey = `ci-worker-${Math.random()}`
    const existingWorker = (window as any).__ciWorkerRunning
    if (existingWorker) {
      console.log('[CI-WORKER] already running, skipping duplicate')
      return
    }
    ;(window as any).__ciWorkerRunning = true

    // Self-driving queue worker: runs while page is active and items remain
    let isActive = true
    let refreshInterval: NodeJS.Timeout | null = null

    const runWorker = async () => {
      console.log('[CI-WORKER] Started')

      try {
        while (isActive && !document.hidden) {
          try {
            const batchStartedAt = Date.now()
            const response = await fetch('/api/leads/process-ci-queue-batch', {
              method: 'POST',
            })

            // Auth lost or server error
            if (response.status === 401) {
              console.log('[CI-WORKER] Authentication lost, stopping worker')
              isActive = false
              break
            }

            if (!response.ok) {
              console.error('[CI-WORKER] Batch processing failed with status:', response.status)
              break
            }

            const result = await response.json()
            const batchElapsedMs = Date.now() - batchStartedAt

            console.log(
              `[CI-WORKER] Batch complete: processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} batch_size=${result.batchSize} elapsed_ms=${batchElapsedMs}`
            )

            // Stop if no items were processed (queue is empty)
            if (result.processed === 0) {
              console.log('[CI-WORKER] Commercial Intelligence is up to date')
              isActive = false
              break
            }
          } catch (err) {
            console.error('[CI-WORKER] Error processing batch:', err)
            break
          }
        }
      } finally {
        if (refreshInterval) clearInterval(refreshInterval)
        console.log('[CI-WORKER] Stopped')
      }
    }

    // Start worker (fire and forget, no await)
    runWorker()

    // Lightweight stats refresh: only update dashboard widget, not entire page
    refreshInterval = setInterval(() => {
      if (!isActive || document.hidden) return

      fetch('/api/leads/ci-stats')
        .then((res) => {
          if (!res.ok) return
          return res.json()
        })
        .then((data) => {
          if (data?.ok && data?.data) {
            // Dispatch event so CommercialIntelligenceStatus can pick up new stats
            // This avoids a full page refresh and only updates the widget
            window.dispatchEvent(
              new CustomEvent('ci-stats-updated', {
                detail: data.data,
              })
            )
          }
        })
        .catch((err) => {
          // Silently fail - don't break the worker if stats fetch fails
        })
    }, 3000) // Refresh stats every 3 seconds

    // Handle page visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('[CI-WORKER] Page hidden, stopping worker')
        isActive = false
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isActive = false
      if (refreshInterval) clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      ;(window as any).__ciWorkerRunning = false
      console.log('[CI-WORKER] Stopped')
    }
  }, [router])

  const leadsWithMetadata = useMemo(
    () => initialLeads.map((lead) => ({ ...lead, metadata: getLeadMetadata(lead) })),
    [initialLeads]
  )

  const priorities = useMemo(() => {
    const visibleLeads = leadsWithMetadata.filter((l) => !deletedLeadIds.has(l.id))
    const active = visibleLeads.filter((l) => {
      const isCurrentlyArchived = archivedLeadIds.has(l.id) || l.metadata.priority === 'archived'
      return !isCurrentlyArchived
    })
    return {
      ready: active.filter((l) => l.metadata.priority === 'ready').length,
      review: active.filter((l) => l.metadata.priority === 'review').length,
      archived: visibleLeads.filter((l) => archivedLeadIds.has(l.id) || l.metadata.priority === 'archived').length,
    }
  }, [leadsWithMetadata, archivedLeadIds, deletedLeadIds])

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

    // Apply CI filter
    const withCiFilter = showCompletedOnly
      ? byView.filter((lead) => lead.ci_enrichment_status === 'completed')
      : byView

    if (!normalizedSearch) return withCiFilter

    return withCiFilter.filter((lead) =>
      [lead.company_name, lead.city, lead.industry, lead.email, lead.phone, lead.website]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    )
  }, [search, leadsWithMetadata, viewMode, archivedLeadIds, deletedLeadIds, showCompletedOnly])

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
    setRefreshingId(leadId)
    try {
      const response = await fetch(`/api/leads/${leadId}/enrich-commercial-intelligence`, {
        method: 'POST',
      })

      const result = await response.json()

      if (!response.ok) {
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

      if (result.ok) {
        showToast('Commercial Intelligence analysis started', 'success')
        // Revalidate server cache and refresh client
        await fetch('/api/revalidate?path=/dashboard/my-leads', { method: 'POST' })
        router.refresh()
      } else {
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
      setRefreshingId(null)
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
      {/* HEADER - SIMPLIFIED */}
      <div className="space-y-4">
        {viewMode === 'active' && (
          <p className="text-sm text-slate-400">{totalCount.toLocaleString()} leads</p>
        )}

        {viewMode === 'archived' && (
          <p className="text-sm text-slate-400">{priorities.archived} archived leads</p>
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
          {viewMode === 'active' && (
            <button
              onClick={() => setShowCompletedOnly(!showCompletedOnly)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition ml-2 pl-2 border-l border-white/10',
                showCompletedOnly
                  ? 'text-emerald-400 border-b-2 border-emerald-400 -mb-px'
                  : 'text-slate-400 hover:text-slate-300'
              )}
            >
              ✓ Analyzed
            </button>
          )}
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
                              Business record
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

                        {/* COMMERCIAL INTELLIGENCE SECTION - EXECUTIVE BRIEFING */}
                        {(() => {
                          const ciStatus = lead.ci_enrichment_status || 'not_generated'
                          const profile = lead.commercial_profile
                          const snapshot = lead.website_snapshot
                          const signals = lead.business_signals
                          const isRefreshing = refreshingId === lead.id
                          const hasWebsite = !!lead.website?.trim()

                          return (
                            <div className="space-y-6">
                              {/* HEADER */}
                              <div>
                                <h4 className="text-sm font-semibold text-white mb-1">Commercial Intelligence</h4>
                                <p className="text-xs text-slate-500">AI-powered business research</p>
                              </div>

                              {ciStatus === 'completed' && profile ? (
                                <div className="space-y-6">
                                  {/* COMPLETION STATUS - Verification chips */}
                                  <div className="flex gap-2 flex-wrap">
                                    {snapshot && <span className="px-2.5 py-1 text-xs bg-emerald-500/15 text-emerald-300 rounded-full font-medium">✓ Website Analyzed</span>}
                                    {signals && <span className="px-2.5 py-1 text-xs bg-emerald-500/15 text-emerald-300 rounded-full font-medium">✓ Business Classified</span>}
                                    {profile && <span className="px-2.5 py-1 text-xs bg-emerald-500/15 text-emerald-300 rounded-full font-medium">✓ Commercial Profile Ready</span>}
                                  </div>

                                  {/* EXECUTIVE SUMMARY - Hero element */}
                                  {profile.summary && (
                                    <div className="space-y-2">
                                      <p className="text-sm leading-relaxed text-slate-300">{profile.summary}</p>
                                    </div>
                                  )}

                                  {/* BUSINESS OVERVIEW */}
                                  {(profile.industry || profile.primary_service || profile.target_customer) && (
                                    <div className="space-y-3">
                                      <div className="grid grid-cols-1 gap-3">
                                        {profile.industry && (
                                          <div>
                                            <p className="text-xs text-slate-500 font-medium mb-1">Industry</p>
                                            <p className="text-sm text-slate-300">{profile.industry}</p>
                                          </div>
                                        )}
                                        {profile.primary_service && (
                                          <div>
                                            <p className="text-xs text-slate-500 font-medium mb-1">Primary Service</p>
                                            <p className="text-sm text-slate-300">{profile.primary_service}</p>
                                          </div>
                                        )}
                                        {profile.target_customer && (
                                          <div>
                                            <p className="text-xs text-slate-500 font-medium mb-1">Target Customer</p>
                                            <p className="text-sm text-slate-300">{profile.target_customer}</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* CAPABILITIES - Pills/Tags for semantic search readiness */}
                                  {profile.core_services && profile.core_services.length > 0 && (
                                    <div className="space-y-2">
                                      <p className="text-xs text-slate-500 font-medium">Capabilities</p>
                                      <div className="flex gap-2 flex-wrap">
                                        {profile.core_services.map((service: string, idx: number) => (
                                          <span key={idx} className="px-2.5 py-1.5 text-xs bg-blue-500/10 text-blue-300 rounded-lg font-medium">
                                            {service}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* TOPICS - Keywords as pills for future filtering */}
                                  {profile.keywords && profile.keywords.length > 0 && (
                                    <div className="space-y-2">
                                      <p className="text-xs text-slate-500 font-medium">Topics</p>
                                      <div className="flex gap-2 flex-wrap">
                                        {profile.keywords.slice(0, 8).map((keyword: string, idx: number) => (
                                          <span key={idx} className="px-2.5 py-1 text-xs bg-slate-500/10 text-slate-400 rounded-lg">
                                            {keyword}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* METADATA FOOTER - Subtle, secondary */}
                                  <div className="flex items-center justify-between pt-3 border-t border-white/5 text-xs text-slate-600">
                                    {lead.ci_completed_at && (
                                      <span>Updated {new Date(lead.ci_completed_at).toLocaleDateString()}</span>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEnrichCommercialIntelligence(lead.id)
                                      }}
                                      disabled={isRefreshing}
                                      className="text-blue-400 hover:text-blue-300 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                                    >
                                      {isRefreshing ? 'Re-analyzing...' : 'Re-analyze'}
                                    </button>
                                  </div>
                                </div>
                              ) : ciStatus === 'processing' ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Analyzing business data…
                                </div>
                              ) : ciStatus === 'pending' ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
                                  <Sparkles className="h-3 w-3" />
                                  Waiting to analyze
                                </div>
                              ) : ciStatus === 'failed' ? (
                                <div className="space-y-3">
                                  <div className="flex items-start gap-2 text-xs text-rose-500">
                                    <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <div>
                                      <p className="font-medium">{lead.ci_last_error || 'Analysis failed'}</p>
                                      <p className="text-slate-600 mt-1">Check that a website is present and valid.</p>
                                    </div>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleEnrichCommercialIntelligence(lead.id)
                                    }}
                                    disabled={isRefreshing}
                                    className="w-full px-3 py-2 text-xs font-medium text-blue-300 hover:text-blue-200 hover:bg-blue-500/[0.08] rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isRefreshing ? 'Retrying...' : 'Retry Analysis'}
                                  </button>
                                </div>
                              ) : hasWebsite ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleEnrichCommercialIntelligence(lead.id)
                                  }}
                                  disabled={isRefreshing}
                                  className="w-full px-3 py-2.5 text-xs font-medium text-blue-300 hover:text-blue-200 hover:bg-blue-500/[0.08] rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isRefreshing ? 'Analyzing...' : 'Start Analysis'}
                                </button>
                              ) : (
                                <div className="text-xs text-slate-500 py-2">Add website to enable Commercial Intelligence analysis.</div>
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
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/dashboard/leads/${lead.id}`)
                                }}
                                className="flex-1 px-3 py-2 text-xs font-medium text-blue-300 hover:text-blue-200 hover:bg-blue-500/[0.08] rounded-lg transition outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                Open profile
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
