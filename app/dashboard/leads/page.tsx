'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { canAccessFeature, isAdmin, isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import LeadCard from '@/components/leads/LeadCard'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import SendLeadsModal from '@/components/modals/SendLeadsModal'
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

type LeadContactFilter = 'all' | 'email' | 'phone' | 'fully_enriched'

type FeatureLockContent = {
  title: string
  description: string
  benefit: string
  ctaLabel?: string
}

const PIPELINE_LOCK_CONTENT: FeatureLockContent = {
  title: 'Pipeline',
  description: 'Organize leads into working stages, track follow-ups, and keep execution moving after discovery.',
  benefit: 'Pipeline turns a one-time scrape into a repeatable outbound workflow your team can actually run.',
}

const CONTACT_LOCK_CONTENT: FeatureLockContent = {
  title: 'Contact your leads directly',
  description: 'Reach out to these businesses and start real conversations.',
  benefit: 'Send emails, follow up, and track replies all in one place.',
  ctaLabel: 'Unlock outreach',
}

function formatLocation(value: string | null) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return 'Unknown location'

  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function hasEmail(lead: Pick<Lead, 'email'>) {
  return Boolean(String(lead.email || '').trim())
}

function hasPhone(lead: Pick<Lead, 'phone'>) {
  return Boolean(String(lead.phone || '').trim())
}

function isFullyEnrichedLead(lead: Pick<Lead, 'email' | 'phone'>) {
  return hasEmail(lead) && hasPhone(lead)
}

export default function LeadsPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [filtered, setFiltered] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [isGuest, setIsGuest] = useState(false)
  const [showFeatureLock, setShowFeatureLock] = useState(false)
  const [featureLockContent, setFeatureLockContent] = useState<FeatureLockContent>(
    PIPELINE_LOCK_CONTENT
  )
  const [showSendLeadsModal, setShowSendLeadsModal] = useState(false)
  const [latestSessionLeads, setLatestSessionLeads] = useState<TrialLead[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [highlightActions, setHighlightActions] = useState(false)

  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('all')
  const [contactFilter, setContactFilter] = useState<LeadContactFilter>('all')
  const plan = profile?.plan || 'free'
  const isFree = isGuest || (!profileLoading && plan === 'free')
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)
  const emailLocked = isFree
  const limitedMode = isGuest || (!profileLoading && !isAdmin(profile) && !isPaid(profile))
  const actionBarRef = useRef<HTMLDivElement | null>(null)

  function getSessionActionLeads(nextIsGuest: boolean) {
    if (nextIsGuest) {
      return getGuestLeads()
    }

    const storedScrapeResult = readStoredScrapeResult()
    return storedScrapeResult?.latestSavedLeads ?? []
  }

  useEffect(() => {
    fetchLeads()
    setLatestSessionLeads(getSessionActionLeads(isGuest))

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
      setLatestSessionLeads(guestLeads)
      setLoading(false)
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    }
  }, [isGuest])

  useEffect(() => {
    applyFilters()
  }, [contactFilter, search, cityFilter, leads])

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
      const guestLeads = getGuestLeads()
      setLeads(guestLeads)
      setLatestSessionLeads(guestLeads)
      setLoading(false)
      return
    }

    setIsGuest(false)
    setLatestSessionLeads(getSessionActionLeads(false))

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

    if (contactFilter === 'email') {
      result = result.filter((lead) => hasEmail(lead))
    } else if (contactFilter === 'phone') {
      result = result.filter((lead) => hasPhone(lead))
    } else if (contactFilter === 'fully_enriched') {
      result = result.filter((lead) => isFullyEnrichedLead(lead))
    }

    setFiltered(result)
  }

  async function moveToPipeline(ids: string[]) {
    if (ids.length === 0) return

    if (pipelineLocked) {
      setFeatureLockContent(PIPELINE_LOCK_CONTENT)
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
    setFeatureLockContent(PIPELINE_LOCK_CONTENT)
    setShowFeatureLock(true)
  }

  function openContactLock() {
    setFeatureLockContent(CONTACT_LOCK_CONTENT)
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

  function openSendLeadsModal() {
    if (latestSessionLeads.length === 0) {
      setActionError('No saved leads from your latest session yet.')
      return
    }

    setActionError('')
    setShowSendLeadsModal(true)
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
            <p className="mt-2 text-slate-400">Start by contacting the ones that look promising.</p>
          </div>
        </div>

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
              <div className="text-sm font-medium text-white">
                {latestSessionLeads.length > 0
                  ? `${latestSessionLeads.length} leads ready to use`
                  : 'No saved leads yet'}
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
                onClick={openSendLeadsModal}
                disabled={latestSessionLeads.length === 0}
                className={`rounded-lg px-4 py-2 text-sm transition ${
                  latestSessionLeads.length === 0
                    ? 'cursor-not-allowed border border-white/10 bg-white/5 text-slate-500'
                    : 'border border-cyan-300/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'
                }`}
              >
                Save to my email
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

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Filter leads
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'all', label: 'All' },
              { value: 'email', label: 'Email' },
              { value: 'phone', label: 'Phone' },
              { value: 'fully_enriched', label: 'Fully Enriched', helper: 'Email + Phone' },
            ].map((option) => {
              const active = contactFilter === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setContactFilter(option.value as LeadContactFilter)}
                  className={`inline-flex min-h-[44px] flex-col items-start justify-center rounded-2xl border px-4 py-2 text-left transition ${
                    active
                      ? 'border-sky-400/40 bg-sky-500/12 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.12)]'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/15 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  {option.helper ? (
                    <span
                      className={`text-[11px] leading-4 ${
                        active ? 'text-sky-100/80' : 'text-slate-500'
                      }`}
                    >
                      {option.helper}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
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
              onClick={() => {
                setFeatureLockContent(PIPELINE_LOCK_CONTENT)
                setShowFeatureLock(true)
              }}
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
              context="inbox"
              sourceUrl={lead.website}
              sourceLabel={!limitedMode ? lead.email_source : null}
              selected={!limitedMode && selected.includes(lead.id)}
              onToggleSelect={!limitedMode ? () => toggleSelect(lead.id) : undefined}
              onView={() => router.push(`/dashboard/leads/${lead.id}`)}
              onAddToPipeline={() => void moveToPipeline([lead.id])}
              onContact={
                lead.email
                  ? () => {
                      if (emailLocked) {
                        openContactLock()
                        return
                      }

                      router.push(`/dashboard/leads/${lead.id}`)
                    }
                  : undefined
              }
              expandedFooter={
                limitedMode ? (
                  <button
                    type="button"
                    onClick={() => void deleteLeads([lead.id])}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 px-3 text-xs font-medium text-red-200 transition hover:bg-red-500/20"
                  >
                    Delete lead
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      </div>

      <FeatureLockModal
        isOpen={showFeatureLock}
        onClose={() => setShowFeatureLock(false)}
        title={featureLockContent.title}
        description={featureLockContent.description}
        benefit={featureLockContent.benefit}
        ctaLabel={featureLockContent.ctaLabel}
        showUpgradeCta={isFree}
      />

      <SendLeadsModal
        isOpen={showSendLeadsModal}
        onClose={() => setShowSendLeadsModal(false)}
        viewerEmail={profile?.email ?? ''}
        leads={latestSessionLeads}
        summaryLine={`${latestSessionLeads.length} leads ready from your ALPA session`}
        onSent={(message) => {
          setShowSendLeadsModal(false)
          setActionMessage(message)
          setActionError('')
        }}
      />
    </>
  )
}
