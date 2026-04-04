'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

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
  status: string | null
  created_at: string
}

type FilterValue = 'all' | 'inbox' | 'pipeline' | 'contacted'

function formatLocation(value: string | null) {
  return String(value || '').trim() || 'Unknown location'
}

function hasEmail(lead: Pick<Lead, 'email'>) {
  return Boolean(String(lead.email || '').trim())
}

function hasPhone(lead: Pick<Lead, 'phone'>) {
  return Boolean(String(lead.phone || '').trim())
}

export default function LeadLibraryPage() {
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
      .select('id, user_id, company_name, city, email, phone, status, created_at')
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

  async function updateStatus(id: string, status: 'pipeline' | 'contacted') {
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
          <Link href="/plans" className="font-medium text-cyan-200 transition hover:text-white">
            Upgrade
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-3">
          {(['all', 'inbox', 'pipeline', 'contacted'] as FilterValue[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg px-4 py-2 text-sm ${
                filter === value
                  ? 'bg-white/10 text-white'
                  : 'bg-white/5 text-slate-400 transition hover:bg-white/10'
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search company, location, email, or phone..."
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-400/40 lg:w-96"
        />
      </div>

      <div className="space-y-4">
        {filteredLeads.length === 0 ? (
          <div className="glass rounded-xl p-6 text-sm text-slate-400">No leads found.</div>
        ) : null}

        {filteredLeads.map((lead) => (
          <div
            key={lead.id}
            className="glass rounded-2xl border border-white/10 p-5"
          >
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-3">
                <div>
                  <div className="text-lg font-semibold text-white">{lead.company_name}</div>
                  <div className="mt-1 text-sm text-slate-400">{formatLocation(lead.city)}</div>
                </div>

                <div className="space-y-2 text-sm text-slate-300">
                  {hasEmail(lead) ? <div>{lead.email}</div> : null}
                  {hasPhone(lead) ? <div>{lead.phone}</div> : null}
                  {!hasEmail(lead) && !hasPhone(lead) ? (
                    <div className="text-slate-500">No contact details saved yet.</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {hasEmail(lead) ? (
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100">
                      Email available
                    </span>
                  ) : null}
                  {hasPhone(lead) ? (
                    <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
                      Phone available
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]"
                >
                  View
                </Link>
                <button
                  type="button"
                  onClick={() => void updateStatus(lead.id, 'pipeline')}
                  disabled={isGuest || pipelineLocked}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border px-4 text-sm font-medium transition ${
                    isGuest || pipelineLocked
                      ? 'cursor-not-allowed border-white/10 bg-white/5 text-slate-500'
                      : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'
                  }`}
                >
                  Move to Pipeline
                </button>
                <button
                  type="button"
                  onClick={() => void updateStatus(lead.id, 'contacted')}
                  disabled={isGuest}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border px-4 text-sm font-medium transition ${
                    isGuest
                      ? 'cursor-not-allowed border-white/10 bg-white/5 text-slate-500'
                      : 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15'
                  }`}
                >
                  Mark Contacted
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
