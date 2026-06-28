'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { canAccessFeature, isAdmin, isPaid } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import LeadCard from '@/components/leads/LeadCard'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import SendLeadsModal from '@/components/modals/SendLeadsModal'
import { getGuestLeads, removeGuestLead } from '@/lib/guest-session'
import { downloadLeadCsv, getLeadCsvFilename } from '@/lib/leads/csv'
import type { MissionInboxLead } from '@/lib/leads/mission-leads'
import { consumeInboxFocusRequest } from '@/lib/session/scrape-result'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/track'
import { GUEST_LEADS_UPDATED_EVENT, type TrialLead } from '@/lib/trial'
import { safeFetch } from '@/lib/utils/safeFetch'

type Lead = TrialLead & {
  user_id?: string
  mission_id?: string | null
  queue_source?: 'inbox' | 'agent_mission'
  qualification_status?: string | null
}

type LeadContactFilter = 'all' | 'email' | 'phone' | 'fully_enriched'

type FeatureLockContent = {
  title: string
  description: string
  benefit: string
  ctaLabel?: string
}

type LeadsPageClientProps = {
  missionIdFilter: string | null
  initialMissionLeads: MissionInboxLead[]
  missionQueryError: string | null
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

export default function LeadsPageClient({
  missionIdFilter,
  initialMissionLeads,
  missionQueryError,
}: LeadsPageClientProps) {
  const router = useRouter()
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const missionScopedView = Boolean(missionIdFilter)
  const { initialLoading, initialLeads } = missionScopedView
    ? { initialLoading: false, initialLeads: initialMissionLeads as Lead[] }
    : { initialLoading: true, initialLeads: [] as Lead[] }

  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [filtered, setFiltered] = useState<Lead[]>(initialLeads)
  const [loading, setLoading] = useState(initialLoading)
  const [selected, setSelected] = useState<string[]>([])
  const [isGuest, setIsGuest] = useState(false)
  const [showFeatureLock, setShowFeatureLock] = useState(false)
  const [featureLockContent, setFeatureLockContent] = useState<FeatureLockContent>(
    PIPELINE_LOCK_CONTENT
  )
  const [showSendLeadsModal, setShowSendLeadsModal] = useState(false)
  const [preparingOutreach, setPreparingOutreach] = useState(false)

  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('all')
  const [contactFilter, setContactFilter] = useState<LeadContactFilter>('all')

  const plan = profile?.plan || 'free'
  const isFree = isGuest || (!profileLoading && plan === 'free')
  const pipelineLocked = !profileLoading && !canAccessFeature('pipeline', profile)
  const emailLocked = isFree
  const limitedMode = isGuest || (!profileLoading && !isAdmin(profile) && !isPaid(profile))
  const isAdminUser = !profileLoading && isAdmin(profile)
  const visitorType = isPaid(profile) ? 'paid' : user?.id ? 'logged_in' : 'anonymous'

  useEffect(() => {
    if (userLoading) return

    if (missionScopedView) {
      setIsGuest(false)
      setLeads(initialMissionLeads)
      setLoading(false)
      return
    }

    void fetchLeads()

    if (consumeInboxFocusRequest()) {
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }, 120)
    }
  }, [initialMissionLeads, missionScopedView, user, userLoading])

  useEffect(() => {
    if (!isGuest || missionScopedView) return

    const syncGuestLeads = () => {
      const guestLeads = getGuestLeads()
      setLeads(guestLeads)
      setLoading(false)
    }

    window.addEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    return () => {
      window.removeEventListener(GUEST_LEADS_UPDATED_EVENT, syncGuestLeads)
    }
  }, [isGuest, missionScopedView])

  useEffect(() => {
    applyFilters()
  }, [contactFilter, search, cityFilter, leads, limitedMode, missionScopedView])

  useEffect(() => {
    const visibleIds = new Set(filtered.map((lead) => lead.id))
    setSelected((prev) => prev.filter((id) => visibleIds.has(id)))
  }, [filtered])

  async function fetchLeads() {
    setLoading(true)

    if (!user) {
      setIsGuest(true)
      const guestLeads = getGuestLeads()
      setLeads(guestLeads)
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

    setLeads((data as Lead[]) || [])
    setLoading(false)
  }

  function applyFilters() {
    let result = [...leads]

    if (search) {
      result = result.filter((lead) =>
        lead.company_name.toLowerCase().includes(search.toLowerCase())
      )
    }

    if (!limitedMode && !missionScopedView && cityFilter !== 'all') {
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

  async function prepareOutreach(ids: string[]) {
    if (ids.length === 0) return
    if (limitedMode) {
      openRestrictedAction()
      return
    }

    setPreparingOutreach(true)
    try {
      const url = '/api/agent/prepare-outreach'
      console.log('[FETCH CALL]', { url, leadIds: ids })
      await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: ids, source: 'manual' }),
      })
      router.push('/dashboard/outreach')
    } catch (err) {
      console.error('[agent] fetch failed', { url: '/api/agent/prepare-outreach', leadIds: ids, err })
    } finally {
      setPreparingOutreach(false)
    }
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

  function exportGuestTrialCsv() {
    if (!isGuest || leads.length === 0) return

    downloadLeadCsv(leads, getLeadCsvFilename('alpa-trial-leads'))
    void trackEvent('csv_downloaded', { leads_count: leads.length })
    trackGaEvent('csv_downloaded', {
      leads_exported: leads.length,
      visitor_type: visitorType,
    })
  }

  function exportCsv() {
    if (limitedMode) {
      openRestrictedAction()
      return
    }

    const exportLeads = selected.length > 0
      ? filtered.filter((lead) => selected.includes(lead.id))
      : filtered
    downloadLeadCsv(exportLeads, getLeadCsvFilename('alpa-leads'))
    void trackEvent('csv_downloaded', { leads_count: exportLeads.length })
    trackGaEvent('csv_downloaded', {
      leads_exported: exportLeads.length,
      visitor_type: visitorType,
    })
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
  const hasLeads = leads.length > 0

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

        {missionScopedView && hasLeads ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/18 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100">
              Showing leads from this mission
            </div>
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300">
              {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
            </div>
          </div>
        ) : null}

        {missionScopedView && missionQueryError ? (
          <div className="glass rounded-xl p-12 text-center">
            <h2 className="text-2xl font-semibold text-white">Unable to load leads for this mission</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {missionQueryError}
            </p>
            <div className="mt-6">
              <Link href="/dashboard/leads" className="btn-secondary">
                View all leads
              </Link>
            </div>
          </div>
        ) : !hasLeads ? (
          <div className="glass rounded-xl p-12 text-center text-slate-400">
            {missionScopedView ? (
              <>
                <h2 className="text-2xl font-semibold text-white">No leads found for this mission</h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  This mission has not produced visible leads yet, or the current filter returned none.
                </p>
                <div className="mt-6">
                  <Link href="/dashboard/leads" className="btn-secondary">
                    View all leads
                  </Link>
                </div>
              </>
            ) : (
              <>
                No leads in this view yet. <br />
                <span className="text-sm">Run Discover to add new session results.</span>
              </>
            )}
          </div>
        ) : (
          <>
            {isGuest ? (
              <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
                <div>
                  <div className="text-sm font-medium text-white">{leads.length} trial leads ready</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Download your results or send a copy to your email.
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={exportGuestTrialCsv}
                    className="btn-primary-gold"
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSendLeadsModal(true)}
                    className="btn-primary-gold"
                  >
                    Send to my email
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Filter leads
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'email', label: 'Email' },
                  { value: 'phone', label: 'Phone' },
                  { value: 'fully_enriched', label: 'Fully Enriched' },
                ].map((option) => {
                  const active = contactFilter === option.value

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setContactFilter(option.value as LeadContactFilter)}
                      className={`inline-flex h-10 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm transition ${
                        active
                          ? 'border-blue-400/30 bg-blue-500/10 text-white'
                          : 'text-white/60 hover:border-white/15 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
              {!limitedMode && !missionScopedView ? (
                <label className="flex h-10 items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                  />
                  Select all
                </label>
              ) : null}

              {!limitedMode && !missionScopedView ? (
                <select
                  value={cityFilter}
                  onChange={(event) => setCityFilter(event.target.value)}
                  className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-200 focus:outline-none"
                >
                  <option value="all">All Cities</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>{formatLocation(city)}</option>
                  ))}
                </select>
              ) : null}

              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search company..."
                className="h-10 min-w-[220px] flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400/40"
              />

              <div className="text-sm text-slate-400">
                {filtered.length} leads
              </div>
            </div>

            {limitedMode ? (
              <div className="text-xs italic text-slate-500">
                Pick the most promising opportunity and start the first conversation.
              </div>
            ) : selected.length > 0 && !missionScopedView ? (
              <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
                <div className="text-sm text-slate-300">{selected.length} selected</div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => moveToPipeline(selected)}
                    disabled={selected.length === 0}
                    className={`btn-secondary ${
                      selected.length === 0
                        ? 'cursor-not-allowed bg-white/5 text-slate-500 hover:bg-white/5'
                        : 'text-slate-200'
                    }`}
                  >
                    Move to Pipeline
                  </button>

                  {isAdminUser ? (
                    <button
                      onClick={() => void prepareOutreach(selected)}
                      disabled={selected.length === 0 || preparingOutreach}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        selected.length === 0
                          ? 'cursor-not-allowed border-white/6 bg-white/[0.03] text-slate-600'
                          : preparingOutreach
                            ? 'border-violet-400/20 bg-violet-500/10 text-violet-300 opacity-70'
                            : 'border-violet-400/25 bg-violet-500/10 text-violet-200 shadow-[0_0_18px_rgba(139,92,246,0.12)] hover:bg-violet-500/18 hover:text-white'
                      }`}
                    >
                      {preparingOutreach ? 'Preparing...' : '⚡ Prepare Outreach'}
                    </button>
                  ) : null}

                  <button
                    onClick={() => void copySelectedLeads()}
                    disabled={selected.length === 0}
                    className={`btn-secondary ${
                      selected.length === 0
                        ? 'cursor-not-allowed bg-white/5 text-slate-500 hover:bg-white/5'
                        : ''
                    }`}
                  >
                    Copy Selected
                  </button>

                  <button onClick={exportCsv} className="btn-primary-gold">
                    Export CSV
                  </button>

                  <button
                    onClick={() => deleteLeads(selected)}
                    disabled={selected.length === 0}
                    className={`btn-ghost ${
                      selected.length === 0
                        ? 'cursor-not-allowed text-slate-500 hover:text-slate-500'
                        : ''
                    }`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : null}

            {!limitedMode && pipelineLocked ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                <span>Pipeline stays locked on free access, but your session leads remain fully reviewable and exportable.</span>
                <button
                  type="button"
                  onClick={() => {
                    setFeatureLockContent(PIPELINE_LOCK_CONTENT)
                    setShowFeatureLock(true)
                  }}
                  className="font-medium text-blue-200 transition hover:text-white"
                >
                  Learn more
                </button>
              </div>
            ) : null}

            {filtered.length === 0 ? (
              <div className="glass rounded-xl p-12 text-center text-slate-400">
                No leads match the current filters.
              </div>
            ) : (
              <div className="space-y-4">
                {filtered.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    id={lead.id}
                    name={lead.company_name}
                    location={
                      missionScopedView
                        ? lead.city
                          ? formatLocation(lead.city)
                          : undefined
                        : formatLocation(lead.city)
                    }
                    email={lead.email}
                    phone={lead.phone}
                    inPipeline={lead.status === 'pipeline'}
                    contacted={lead.status === 'contacted'}
                    isNew={lead.status === 'inbox'}
                    context="inbox"
                    sourceUrl={lead.website}
                    sourceLabel={missionScopedView ? 'Agent mission' : !limitedMode ? lead.email_source : null}
                    selected={!limitedMode && !missionScopedView && selected.includes(lead.id)}
                    onToggleSelect={!limitedMode && !missionScopedView ? () => toggleSelect(lead.id) : undefined}
                    onView={!missionScopedView ? () => router.push(`/dashboard/leads/${lead.id}`) : undefined}
                    onAddToPipeline={!missionScopedView ? () => void moveToPipeline([lead.id]) : undefined}
                    onPrepareOutreach={!missionScopedView && isAdminUser ? () => void prepareOutreach([lead.id]) : undefined}
                    onContact={
                      !missionScopedView && lead.email
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
                          className="btn-ghost min-h-[40px] justify-start px-0 py-0 text-xs"
                        >
                          Delete lead
                        </button>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
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
        viewerEmail=""
        leads={leads}
        summaryLine={`${leads.length} leads ready from your ALPA trial`}
        visitorType={visitorType}
      />
    </>
  )
}
