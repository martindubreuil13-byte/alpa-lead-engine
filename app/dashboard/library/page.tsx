'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Check, Download, Minus, X } from 'lucide-react'

import LeadCard from '@/components/leads/LeadCard'
import { canAccessFeature, isAdmin, isPaid } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getGuestLeads } from '@/lib/guest-session'
import { downloadLeadCsv, getLeadCsvFilename } from '@/lib/leads/csv'
import {
  getLibraryLifecycleLabel,
  getPipelineLifecycleStatus,
  getUrgencyTone,
  type Lead as LifecycleLead,
  type PipelineStage,
} from '@/lib/pipeline/lifecycle'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/track'
import { safeFetch } from '@/lib/utils/safeFetch'

type Lead = LifecycleLead & {
  id: string
  user_id?: string
  company_name: string
  city: string | null
  email: string | null
  phone: string | null
  website?: string | null
  status: string
  created_at: string
}

type FilterValue = 'all' | PipelineStage

function formatLocation(value: string | null) {
  return String(value || '').trim() || 'Unknown location'
}

export default function LeadLibraryPage() {
  const router = useRouter()
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterValue>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [isGuest, setIsGuest] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)
  const isAdminUser = !profileLoading && isAdmin(profile)
  const canExportLibrary = !profileLoading && !isGuest && Boolean(profile && (isAdmin(profile) || isPaid(profile)))
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (userLoading) return
    void fetchLeads()
  }, [user, userLoading])

  async function fetchLeads() {
    setLoading(true)

    if (!user?.id) {
      setIsGuest(true)
      setCurrentUserId(null)
      setLeads(getGuestLeads())
      setSelected([])
      setLoading(false)
      return
    }

    setIsGuest(false)
    setCurrentUserId(user.id)

    const { data, error } = await supabase
      .from('leads')
      .select('id, user_id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Library fetch failed:', error)
      setLoading(false)
      return
    }

    setLeads((data || []) as Lead[])
    setSelected((prev) => prev.filter((id) => (data || []).some((lead) => lead.id === id)))
    setLoading(false)
  }

  const prepareOutreach = useCallback(async (id: string) => {
    if (!id) return
    try {
      const url = '/api/agent/prepare-outreach'
      console.log('[FETCH CALL]', { url, leadIds: [id] })
      await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: [id], source: 'manual' }),
      })
      router.push('/dashboard/outreach')
    } catch (err) {
      console.error('[agent] fetch failed', { url: '/api/agent/prepare-outreach', leadIds: [id], err })
    }
  }, [router])

  async function updateStatus(id: string, status: 'inbox' | 'pipeline' | 'contacted') {
    if (!currentUserId || isGuest) return
    if (status === 'pipeline' && pipelineLocked) return

    const { error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', id)
      .eq('user_id', currentUserId)

    if (error) {
      console.error('Lead update failed:', error)
      return
    }

    setLeads((prev) => prev.map((lead) => (lead.id === id ? { ...lead, status } : lead)))
  }

  const filteredLeads = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return leads.filter((lead) => {
      const lifecycleStatus = getPipelineLifecycleStatus(lead)
      const matchesFilter = filter === 'all' ? true : lifecycleStatus === filter
      if (!matchesFilter) return false

      if (!normalizedSearch) return true

      return [lead.company_name, lead.city, lead.email, lead.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [filter, leads, search])

  const visibleIds = useMemo(() => filteredLeads.map((lead) => lead.id), [filteredLeads])
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds])
  const selectedIdSet = useMemo(() => new Set(selected), [selected])
  const selectedLeads = useMemo(
    () => selected.map((id) => leads.find((lead) => lead.id === id)).filter(Boolean) as Lead[],
    [leads, selected]
  )
  const visibleSelectedCount = useMemo(
    () => visibleIds.filter((id) => selectedIdSet.has(id)).length,
    [selectedIdSet, visibleIds]
  )
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected
    }
  }, [someVisibleSelected])

  function toggleSelect(id: string) {
    if (!canExportLibrary) return
    setSelected((prev) => (prev.includes(id) ? prev.filter((current) => current !== id) : [...prev, id]))
    setStatusMessage('')
  }

  function toggleSelectAllVisible(checked: boolean) {
    if (!canExportLibrary) return

    if (checked) {
      setSelected((prev) => Array.from(new Set([...prev, ...visibleIds])))
      setStatusMessage('')
      return
    }

    setSelected((prev) => prev.filter((id) => !visibleIdSet.has(id)))
    setStatusMessage('')
  }

  function clearSelection() {
    setSelected([])
    setStatusMessage('')
  }

  async function exportSelectedCsv() {
    if (!canExportLibrary || selectedLeads.length === 0 || exporting) return

    setExporting(true)
    setStatusMessage('')

    try {
      downloadLeadCsv(selectedLeads, getLeadCsvFilename('alpa-leads'))
      setStatusMessage(`${selectedLeads.length} lead${selectedLeads.length === 1 ? '' : 's'} exported.`)
      void trackEvent('csv_downloaded', {
        leads_count: selectedLeads.length,
        source: 'lead_library',
      })
    } catch (error) {
      console.error('Library CSV export failed:', error)
      setStatusMessage('Could not export the selected leads.')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return <div className="text-slate-400">Loading leads...</div>
  }

  return (
    <div className={`space-y-8 ${selected.length > 0 ? 'pb-28' : ''}`}>
      <div>
        <h1 className="text-4xl font-bold text-white">Lead Library</h1>
        <p className="mt-2 text-slate-400">A clean view of the leads in your workspace.</p>
      </div>

      {pipelineLocked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          <span>Pipeline actions unlock on Starter.</span>
          <Link href="/plans" className="btn-primary-gold">
            Upgrade
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-3">
          {([
            { value: 'all', label: 'All' },
            { value: 'ready', label: 'New' },
            { value: 'contacted', label: 'Contacted' },
            { value: 'ready_followup', label: 'Ready for Follow-up' },
            { value: 'final_attempt', label: 'Final Attempt' },
            { value: 'closed', label: 'Closed' },
          ] as Array<{ value: FilterValue; label: string }>).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`btn-secondary ${
                filter === option.value
                  ? 'bg-white/10 text-white'
                  : 'text-white/60'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search company, location, email, or phone..."
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400/40 lg:w-96"
        />
      </div>

      {canExportLibrary ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_14px_34px_rgba(2,8,23,0.18)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="inline-flex w-fit items-center gap-3 text-sm text-slate-300">
              <span className="relative inline-flex h-5 w-5 items-center justify-center">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={filteredLeads.length === 0}
                  onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                  className="peer h-5 w-5 appearance-none rounded-md border border-white/15 bg-slate-950/60 transition checked:border-blue-300/60 checked:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Select all visible leads"
                />
                <Check className="pointer-events-none absolute h-3.5 w-3.5 text-blue-100 opacity-0 peer-checked:opacity-100" />
                {someVisibleSelected ? (
                  <Minus className="pointer-events-none absolute h-3.5 w-3.5 text-blue-100" />
                ) : null}
              </span>
              <span>Select all visible</span>
              <span className="text-xs text-slate-500">({filteredLeads.length})</span>
            </label>

            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>{selected.length} selected</span>
              <button
                type="button"
                onClick={() => void exportSelectedCsv()}
                disabled={selected.length === 0 || exporting}
                className="btn-primary-gold"
              >
                <Download className="h-4 w-4" />
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
              {selected.length > 0 ? (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 font-medium text-slate-200 transition hover:bg-white/[0.08]"
                >
                  <X className="h-4 w-4" />
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {statusMessage ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
              {statusMessage}
            </div>
          ) : null}
        </section>
      ) : null}

      {canExportLibrary && selected.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#060c18]/92 px-4 py-3 shadow-[0_-16px_40px_rgba(2,8,23,0.34)] backdrop-blur-xl lg:left-[280px]">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium text-white">
              {selected.length} selected
              {visibleSelectedCount > 0 ? (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {visibleSelectedCount} visible
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void exportSelectedCsv()}
                disabled={exporting}
                className="btn-primary-gold"
              >
                <Download className="h-4 w-4" />
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
              >
                <X className="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {filteredLeads.length === 0 ? (
          <div className="glass rounded-xl p-6 text-sm text-slate-400">No leads found.</div>
        ) : null}

        {filteredLeads.map((lead) => {
          const lifecycleStatus = getPipelineLifecycleStatus(lead)
          const tone = getLibraryTone(lead)

          return (
            <LeadCard
              key={lead.id}
              id={lead.id}
              name={lead.company_name}
              location={formatLocation(lead.city)}
              email={lead.email}
              phone={lead.phone}
              inPipeline={lifecycleStatus !== 'closed' && lifecycleStatus !== 'ready'}
              contacted={lifecycleStatus === 'contacted' || lifecycleStatus === 'ready_followup' || lifecycleStatus === 'final_attempt'}
              isNew={lifecycleStatus === 'ready'}
              context="library"
              sourceUrl={lead.website}
              lifecycleLabel={getLibraryLifecycleLabel(lead)}
              lifecycleTone={tone}
              selected={selectedIdSet.has(lead.id)}
              onToggleSelect={canExportLibrary ? () => toggleSelect(lead.id) : undefined}
              onView={() => router.push(`/dashboard/leads/${lead.id}`)}
              onAddToPipeline={() =>
                void updateStatus(lead.id, lifecycleStatus === 'ready' ? 'pipeline' : 'inbox')
              }
              onPrepareOutreach={isAdminUser ? () => void prepareOutreach(lead.id) : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

function getLibraryTone(lead: Lead) {
  const tone = getUrgencyTone(lead)
  if (tone === 'overdue') return 'ready'
  if (tone === 'waiting') return 'waiting'
  if (tone === 'final') return 'final'
  if (tone === 'closed') return 'closed'
  if (tone === 'ready') return 'ready'
  return 'new'
}
