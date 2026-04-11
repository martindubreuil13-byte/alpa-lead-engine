'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import LeadCard from '@/components/leads/LeadCard'
import { canAccessFeature } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getGuestLeads } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  user_id?: string
  company_name: string
  city: string | null
  email: string | null
  phone: string | null
  website?: string | null
  status: string | null
  created_at: string
}

type FilterValue = 'all' | 'inbox' | 'pipeline' | 'contacted'

function formatLocation(value: string | null) {
  return String(value || '').trim() || 'Unknown location'
}

export default function LeadLibraryPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterValue>('all')
  const [search, setSearch] = useState('')
  const [isGuest, setIsGuest] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)

  useEffect(() => {
    void fetchLeads()
  }, [])

  async function fetchLeads() {
    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

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
      .select('id, user_id, company_name, city, email, phone, website, status, created_at')
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
      const matchesFilter = filter === 'all' ? true : lead.status === filter
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
            { value: 'inbox', label: 'New' },
            { value: 'pipeline', label: 'In pipeline' },
            { value: 'contacted', label: 'Contacted' },
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

        {filteredLeads.map((lead) => (
          <LeadCard
            key={lead.id}
            id={lead.id}
            name={lead.company_name}
            location={formatLocation(lead.city)}
            email={lead.email}
            phone={lead.phone}
            inPipeline={lead.status === 'pipeline'}
            contacted={lead.status === 'contacted'}
            isNew={lead.status === 'inbox'}
            context="library"
            sourceUrl={lead.website}
            onView={() => router.push(`/dashboard/leads/${lead.id}`)}
            onAddToPipeline={() =>
              void updateStatus(lead.id, lead.status === 'pipeline' ? 'inbox' : 'pipeline')
            }
          />
        ))}
      </div>
    </div>
  )
}
