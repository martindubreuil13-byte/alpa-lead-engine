'use client'

import { useEffect, useRef, useState } from 'react'

import EmailConfidenceBadge, { matchesConfidenceFilter } from '@/components/leads/EmailConfidenceBadge'
import GuestLeadCaptureModal from '@/components/trial/GuestLeadCaptureModal'
import PaywallModal from '@/components/trial/PaywallModal'
import { getGuestCaptureEmail, getGuestLeads, removeGuestLead } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'
import { FREE_TRIAL_LEAD_LIMIT, GUEST_LEADS_UPDATED_EVENT, type TrialLead } from '@/lib/trial'

type Lead = TrialLead & {
  user_id?: string
}

function buildCsv(leads: Lead[]) {
  const headers = ['Company', 'Email', 'Phone', 'Website', 'City', 'Source', 'Confidence']
  const rows = leads.map((lead) => [
    lead.company_name,
    lead.email || '',
    lead.phone || '',
    lead.website || '',
    lead.city || '',
    lead.source || '',
    lead.email_confidence || '',
  ])

  return [headers, ...rows]
    .map((row) =>
      row
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n')
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [filtered, setFiltered] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [isGuest, setIsGuest] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)
  const [showCaptureModal, setShowCaptureModal] = useState(false)
  const [captureTrigger, setCaptureTrigger] = useState<'export' | 'copy' | 'limit'>('export')

  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('all')
  const [confidenceFilter, setConfidenceFilter] = useState<'recommended' | 'all' | 'high' | 'medium' | 'low'>('recommended')
  const hasAutoOpenedLimitCapture = useRef(false)

  useEffect(() => {
    fetchLeads()

    const syncGuestLeads = () => {
      if (!isGuest) return
      const guestLeads = getGuestLeads()
      setLeads(guestLeads)
      setLoading(false)
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    }
  }, [isGuest])

  useEffect(() => {
    applyFilters()
  }, [search, cityFilter, confidenceFilter, leads])

  useEffect(() => {
    const visibleIds = new Set(filtered.map((lead) => lead.id))
    setSelected((prev) => prev.filter((id) => visibleIds.has(id)))
  }, [filtered])

  useEffect(() => {
    if (
      !isGuest ||
      leads.length < FREE_TRIAL_LEAD_LIMIT ||
      hasAutoOpenedLimitCapture.current ||
      Boolean(getGuestCaptureEmail())
    ) {
      return
    }

    openCaptureModal('limit')
    hasAutoOpenedLimitCapture.current = true
  }, [isGuest, leads.length])

  async function fetchLeads() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsGuest(true)
      setLeads(getGuestLeads())
      setLoading(false)
      return
    }

    setIsGuest(false)

    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'inbox')
      .order('created_at', { ascending: false })

    if (data) setLeads(data as Lead[])
    setLoading(false)
  }

  function applyFilters() {
    let result = [...leads]

    if (search) {
      result = result.filter((lead) =>
        lead.company_name.toLowerCase().includes(search.toLowerCase())
      )
    }

    if (cityFilter !== 'all') {
      result = result.filter((lead) => lead.city === cityFilter)
    }

    result = result.filter((lead) =>
      matchesConfidenceFilter(lead.email_confidence, confidenceFilter)
    )

    setFiltered(result)
  }

  async function moveToPipeline(ids: string[]) {
    if (ids.length === 0) return

    if (isGuest) {
      setShowPaywall(true)
      return
    }

    const { error } = await supabase
      .from('leads')
      .update({ status: 'pipeline' })
      .in('id', ids)

    if (error) {
      console.error('Move failed:', error.message)
      return
    }

    setLeads((prev) => prev.filter((lead) => !ids.includes(lead.id)))
    setSelected((prev) => prev.filter((id) => !ids.includes(id)))
  }

  async function deleteLeads(ids: string[]) {
    if (!ids.length) return

    if (isGuest) {
      ids.forEach((id) => removeGuestLead(id))
      return
    }

    const { error } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)

    if (error) {
      console.error('Delete failed:', error.message)
      return
    }

    setLeads((prev) => prev.filter((lead) => !ids.includes(lead.id)))
    setSelected((prev) => prev.filter((id) => !ids.includes(id)))
  }

  function exportCsv() {
    if (isGuest) {
      openCaptureModal('export')
      return
    }

    const csv = buildCsv(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'alpa-leads.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function copySelectedLeads() {
    const selectedLeads = filtered.filter((lead) => selected.includes(lead.id))
    if (selectedLeads.length === 0) return

    if (isGuest && selectedLeads.length > 1) {
      openCaptureModal('copy')
      return
    }

    const content = selectedLeads
      .map((lead) =>
        [
          lead.company_name,
          lead.email || 'No email',
          lead.phone || 'No phone',
          lead.website || 'No website',
          lead.city || 'Unknown city',
        ].join(' | ')
      )
      .join('\n')

    await navigator.clipboard.writeText(content)
  }

  function openCaptureModal(trigger: 'export' | 'copy' | 'limit') {
    setCaptureTrigger(trigger)
    setShowCaptureModal(true)
  }

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelected(filtered.map((lead) => lead.id))
      return
    }

    setSelected([])
  }

  const cities = Array.from(new Set(leads.map((lead) => lead.city).filter(Boolean) as string[])).sort()
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((lead) => selected.includes(lead.id))

  if (loading) return <div className="text-slate-400">Loading leads...</div>

  return (
    <>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-white">Leads Inbox</h1>
          <p className="mt-2 text-slate-400">
            {isGuest ? 'Preview your free trial leads before unlocking pipeline actions.' : 'New leads waiting to be reviewed and assigned'}
          </p>
        </div>

        {isGuest && leads.length >= FREE_TRIAL_LEAD_LIMIT && (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-4 text-amber-200">
            You&apos;ve reached your free limit.
          </div>
        )}

        <div className="glass flex flex-wrap items-center gap-4 rounded-xl p-5">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={(event) => toggleSelectAll(event.target.checked)}
            />
            Select all
          </label>

          <input
            placeholder="Search company..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          />

          <select
            value={cityFilter}
            onChange={(event) => setCityFilter(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 focus:outline-none"
          >
            <option value="all">All Cities</option>
            {cities.map((city) => (
              <option key={city}>{city}</option>
            ))}
          </select>

          <select
            value={confidenceFilter}
            onChange={(event) => setConfidenceFilter(event.target.value as typeof confidenceFilter)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 focus:outline-none"
          >
            <option value="recommended">High + Medium</option>
            <option value="all">All Confidence</option>
            <option value="high">High Only</option>
            <option value="medium">Medium Only</option>
            <option value="low">Low Only</option>
          </select>

          <div className="ml-auto text-sm text-slate-400">
            {filtered.length} leads
          </div>
        </div>

        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
          <div className="text-sm text-slate-300">{selected.length} selected</div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={exportCsv}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/15"
            >
              Export CSV
            </button>

            <button
              onClick={() => void copySelectedLeads()}
              disabled={selected.length === 0}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                selected.length === 0
                  ? 'cursor-not-allowed bg-white/5 text-slate-500'
                  : 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
              }`}
            >
              Copy Selected
            </button>

            <button
              onClick={() => moveToPipeline(selected)}
              disabled={selected.length === 0}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                selected.length === 0
                  ? 'cursor-not-allowed bg-white/5 text-slate-500'
                  : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
              }`}
            >
              Move to Pipeline
            </button>

            <button
              onClick={() => deleteLeads(selected)}
              disabled={selected.length === 0}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                selected.length === 0
                  ? 'cursor-not-allowed bg-white/5 text-slate-500'
                  : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
              }`}
            >
              Delete
            </button>
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="glass rounded-xl p-12 text-center text-slate-400">
            Inbox clear 🎉 <br />
            <span className="text-sm">All leads have been processed</span>
          </div>
        )}

        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-5 py-4">
          <div className="text-sm font-medium text-slate-200">Understanding lead quality</div>
          <div className="mt-2 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
            <div>
              <span className="font-medium text-emerald-300">High</span>
              {' '}→ Email matches business domain and verified on site
            </div>
            <div>
              <span className="font-medium text-amber-300">Medium</span>
              {' '}→ Email found but may be generic (`info@`, `contact@`)
            </div>
            <div>
              <span className="font-medium text-rose-300">Low</span>
              {' '}→ Weak signal or indirect source
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {filtered.map((lead) => (
            <div key={lead.id} className="glass rounded-xl p-5">
              <label className="flex cursor-pointer items-center gap-4">
                <input
                  type="checkbox"
                  checked={selected.includes(lead.id)}
                  onChange={() => toggleSelect(lead.id)}
                />

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-white">{lead.company_name}</div>
                    <EmailConfidenceBadge confidence={lead.email_confidence} />
                    {lead.is_generic_email && (
                      <span className="inline-flex rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                        Generic
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-slate-400">
                    {lead.city}
                    {' • '}
                    {lead.email ? lead.email : 'No Email'}
                    {' • '}
                    {lead.phone ? lead.phone : 'No Phone'}
                  </div>

                  {lead.email_source && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Source: {lead.email_source}
                    </div>
                  )}
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>

      <GuestLeadCaptureModal
        isOpen={showCaptureModal}
        trigger={captureTrigger}
        onClose={() => setShowCaptureModal(false)}
      />
      <PaywallModal isOpen={showPaywall} onClose={() => setShowPaywall(false)} />
    </>
  )
}
