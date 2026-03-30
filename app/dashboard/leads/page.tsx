'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { canAccessFeature } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import { getGuestLeads, removeGuestLead } from '@/lib/guest-session'
import { buildLeadCsv } from '@/lib/leads/csv'
import {
  consumeInboxFocusRequest,
  readStoredScrapeResult,
} from '@/lib/session/scrape-result'
import { supabase } from '@/lib/supabase'
import { GUEST_LEADS_UPDATED_EVENT, type TrialLead } from '@/lib/trial'

type Lead = TrialLead & {
  user_id?: string
}

function formatLocation(value: string | null) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return 'Unknown location'

  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export default function LeadsPage() {
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [filtered, setFiltered] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [isGuest, setIsGuest] = useState(false)
  const [showFeatureLock, setShowFeatureLock] = useState(false)
  const [latestSessionLeads, setLatestSessionLeads] = useState<TrialLead[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [highlightActions, setHighlightActions] = useState(false)

  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('all')
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)
  const limitedMode = isGuest || (!profileLoading && (profile?.plan ?? 'free') === 'free')
  const actionBarRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fetchLeads()
    const storedScrapeResult = readStoredScrapeResult()
    setLatestSessionLeads(storedScrapeResult?.latestSavedLeads ?? [])

    if (consumeInboxFocusRequest()) {
      window.setTimeout(() => {
        actionBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setHighlightActions(true)
      }, 120)

      window.setTimeout(() => {
        setHighlightActions(false)
      }, 2200)
    }

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
  }, [search, cityFilter, leads])

  useEffect(() => {
    if (!actionMessage && !actionError) return

    const timeout = window.setTimeout(() => {
      setActionMessage('')
      setActionError('')
    }, 3200)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [actionError, actionMessage])

  useEffect(() => {
    const visibleIds = new Set(filtered.map((lead) => lead.id))
    setSelected((prev) => prev.filter((id) => visibleIds.has(id)))
  }, [filtered])

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

    if (!limitedMode && cityFilter !== 'all') {
      result = result.filter((lead) => lead.city === cityFilter)
    }

    setFiltered(result)
  }

  async function moveToPipeline(ids: string[]) {
    if (ids.length === 0) return

    if (pipelineLocked) {
      setShowFeatureLock(true)
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

  function openRestrictedAction() {
    setShowFeatureLock(true)
  }

  function exportLatestSessionCsv() {
    if (latestSessionLeads.length === 0) {
      setActionError('No saved leads from your latest session yet.')
      return
    }

    setActionError('')
    setActionMessage('CSV download started.')
    const csv = buildLeadCsv(latestSessionLeads)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'alpa-latest-session-leads.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function emailLatestSessionLeads() {
    if (latestSessionLeads.length === 0) {
      setActionError('No saved leads from your latest session yet.')
      return
    }

    const targetEmail =
      profile?.email?.trim() ||
      window.prompt('Enter your email to receive your latest saved leads:')?.trim() ||
      ''

    if (!targetEmail) {
      return
    }

    setSendingEmail(true)
    setActionError('')
    setActionMessage('')

    try {
      const res = await fetch('/api/results-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: targetEmail,
          leads: latestSessionLeads,
          summaryLine: `${latestSessionLeads.length} leads ready from your latest ALPA session`,
          detailLine: null,
          limitMessage: null,
        }),
      })

      const data = await res.json().catch(() => null)

      if (res.status !== 200) {
        setActionError(data?.error || 'Something went wrong. Please try again.')
        return
      }

      setActionMessage("Email sent successfully. If you don't see it, check your spam folder.")
    } catch {
      setActionError('Something went wrong. Please try again.')
    } finally {
      setSendingEmail(false)
    }
  }

  function exportCsv() {
    if (limitedMode) {
      openRestrictedAction()
      return
    }

    const csv = buildLeadCsv(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'alpa-leads.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function copySelectedLeads() {
    if (limitedMode) {
      openRestrictedAction()
      return
    }

    const selectedLeads = filtered.filter((lead) => selected.includes(lead.id))
    if (selectedLeads.length === 0) return

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

  function toggleSelect(id: string) {
    if (limitedMode) {
      openRestrictedAction()
      return
    }

    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  function toggleSelectAll(checked: boolean) {
    if (limitedMode) {
      openRestrictedAction()
      return
    }

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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-white">These could be your next clients.</h1>
            <p className="mt-2 text-slate-400">Start reaching out and turn these into conversations.</p>
          </div>
          {limitedMode ? (
            <Link
              href="/plans"
              className="inline-flex min-h-[46px] items-center justify-center rounded-xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(20,184,166,0.92))] px-4 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5"
            >
              Unlock pipeline
            </Link>
          ) : null}
        </div>

        {limitedMode ? (
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-5 py-4 text-sm text-cyan-100">
            You’ve found leads. Now turn them into clients.
          </div>
        ) : null}

        <div
          ref={actionBarRef}
          className={`rounded-xl border px-5 py-4 transition-all duration-500 ${
            highlightActions
              ? 'border-cyan-300/40 bg-cyan-400/12 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]'
              : 'border-white/8 bg-white/[0.03]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-white">Latest saved leads from this session</div>
              <div className="mt-1 text-sm text-slate-400">
                {latestSessionLeads.length > 0
                  ? `${latestSessionLeads.length} leads ready whenever you want to save or share them.`
                  : 'Run Prospector to unlock download and email actions for this session.'}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={exportLatestSessionCsv}
                disabled={latestSessionLeads.length === 0}
                className={`rounded-lg px-4 py-2 text-sm transition ${
                  latestSessionLeads.length === 0
                    ? 'cursor-not-allowed border border-white/10 bg-white/5 text-slate-500'
                    : 'border border-white/10 bg-white/5 text-slate-100 hover:bg-white/[0.08]'
                }`}
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => void emailLatestSessionLeads()}
                disabled={latestSessionLeads.length === 0 || sendingEmail}
                className={`rounded-lg px-4 py-2 text-sm transition ${
                  latestSessionLeads.length === 0 || sendingEmail
                    ? 'cursor-not-allowed border border-white/10 bg-white/5 text-slate-500'
                    : 'border border-cyan-300/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'
                }`}
              >
                {sendingEmail ? 'Sending...' : 'Send to my email'}
              </button>
            </div>
          </div>

          {actionMessage ? (
            <div className="mt-3 text-sm text-emerald-300">{actionMessage}</div>
          ) : null}
          {actionError ? (
            <div className="mt-3 text-sm text-rose-300">{actionError}</div>
          ) : null}
        </div>

        <div className="glass flex flex-wrap items-center gap-4 rounded-xl p-5">
          {!limitedMode ? (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={(event) => toggleSelectAll(event.target.checked)}
              />
              Select all
            </label>
          ) : null}

          <input
            placeholder="Search company..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          />

          {!limitedMode ? (
            <>
              <select
                value={cityFilter}
                onChange={(event) => setCityFilter(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 focus:outline-none"
              >
                <option value="all">All Cities</option>
                {cities.map((city) => (
                  <option key={city} value={city}>{formatLocation(city)}</option>
                ))}
              </select>
            </>
          ) : null}

          <div className="ml-auto text-sm text-slate-400">
            {filtered.length} leads
          </div>
        </div>

        {limitedMode ? (
          <div className="text-xs italic text-slate-500">
            Pick the most promising opportunity and start the first conversation.
          </div>
        ) : (
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
                    : pipelineLocked
                      ? 'bg-white/10 text-slate-200 hover:bg-white/15'
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
        )}

        {!limitedMode && pipelineLocked ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
            <span>Pipeline stays locked on free access, but your session leads remain fully reviewable and exportable.</span>
            <button
              type="button"
              onClick={() => setShowFeatureLock(true)}
              className="font-medium text-cyan-200 transition hover:text-white"
            >
              Learn more
            </button>
          </div>
        ) : null}

        {filtered.length === 0 && (
          <div className="glass rounded-xl p-12 text-center text-slate-400">
            No leads in this view yet. <br />
            <span className="text-sm">Run Prospector to add new session results.</span>
          </div>
        )}

        <div className="space-y-4">
          {filtered.map((lead) => (
            <div key={lead.id} className="glass rounded-xl p-5">
              <div className="flex items-start gap-4">
                {!limitedMode ? (
                  <input
                    type="checkbox"
                    checked={selected.includes(lead.id)}
                    onChange={() => toggleSelect(lead.id)}
                    className="mt-1"
                  />
                ) : null}

                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-white">{lead.company_name}</div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {lead.email ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-200">
                        Email available
                      </span>
                    ) : null}
                    {lead.phone ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-200">
                        Phone available
                      </span>
                    ) : null}
                    {!lead.email && !lead.phone ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-400">
                        Contact details pending
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-2 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <span className="min-w-20 text-slate-500">Location</span>
                      <span className="text-slate-200">{formatLocation(lead.city)}</span>
                    </div>
                    {lead.email ? (
                      <div className="flex flex-wrap gap-2">
                        <span className="min-w-20 text-slate-500">Email</span>
                        <span className="break-all text-slate-200">{lead.email}</span>
                      </div>
                    ) : null}
                    {lead.phone ? (
                      <div className="flex flex-wrap gap-2">
                        <span className="min-w-20 text-slate-500">Phone</span>
                        <span className="text-slate-200">{lead.phone}</span>
                      </div>
                    ) : null}
                  </div>

                  {!limitedMode && lead.email_source ? (
                    <div className="mt-3 text-[11px] text-slate-500">
                      Source: {lead.email_source}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="rounded-lg bg-white/10 px-4 py-2 text-sm text-slate-100 transition hover:bg-white/15"
                    >
                      View opportunity
                    </Link>
                    {limitedMode ? (
                      <button
                        type="button"
                        onClick={() => void deleteLeads([lead.id])}
                        className="rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FeatureLockModal
        isOpen={showFeatureLock}
        onClose={() => setShowFeatureLock(false)}
        title="Pipeline"
        description="Organize leads into working stages, track follow-ups, and keep execution moving after discovery."
        benefit="Pipeline turns a one-time scrape into a repeatable outbound workflow your team can actually run."
      />
    </>
  )
}
