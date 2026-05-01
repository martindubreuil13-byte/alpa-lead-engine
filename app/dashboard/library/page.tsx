'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useCallback } from 'react'

import LeadCard from '@/components/leads/LeadCard'
import { canAccessFeature, isAdmin } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getGuestLeads } from '@/lib/guest-session'
import {
  getLibraryLifecycleLabel,
  getPipelineLifecycleStatus,
  getUrgencyTone,
  type Lead as LifecycleLead,
  type PipelineStage,
} from '@/lib/pipeline/lifecycle'
import { supabase } from '@/lib/supabase'
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
  const [isGuest, setIsGuest] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)
  const isAdminUser = !profileLoading && isAdmin(profile)

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

  if (loading) {
    return <div className="text-slate-400">Loading leads...</div>
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white">Lead Library</h1>
        <p className="mt-2 text-slate-400">A clean view of the leads in your workspace.</p>
      </div>

      {pipelineLocked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          <span>Pipeline actions unlock on Starter.</span>
          <Link href="/plans" className="font-medium text-blue-200 transition hover:text-white">
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
