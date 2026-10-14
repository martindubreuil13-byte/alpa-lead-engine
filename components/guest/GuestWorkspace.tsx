'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download } from 'lucide-react'

import FeedbackPrompt from '@/components/guest/FeedbackPrompt'
import BottomSheet from '@/components/ui/BottomSheet'
import useMediaQuery from '@/components/ui/useMediaQuery'
import CommandBar from '@/components/my-leads/CommandBar'
import DossierView from '@/components/my-leads/DossierView'
import LeadRow from '@/components/my-leads/LeadRow'
import MetricStrip, { type Metric } from '@/components/my-leads/MetricStrip'
import { saveGuestLeads } from '@/lib/guest-session'
import { filterAndSortGuest, GUEST_SORT_KEYS, guestWebsiteState, hasGuestFilters, summarizeGuest, toGuestListItem, describeGuestRange } from '@/lib/guest/workspace'
import { useLightProfiles } from './useLightProfiles'
import { guestDossierModel } from '@/lib/my-leads/dossier-model'
import { DEFAULT_FILTERS, type FilterState } from '@/lib/my-leads/ui-state'
import type { ContactKey } from '@/lib/my-leads/params'
import { trackEvent } from '@/lib/track'
import type { TrialLead } from '@/lib/trial'

const CLEAR: Partial<FilterState> = { q: '', city: '', industry: '', contact: [], page: 1 }

// The free-trial results, in the same workspace the members use: the same rows, the same business profile and the same filters,
// working on the (at most 25) businesses already in the browser. No account, email or card is asked for, and nothing is invented.
export default function GuestWorkspace() {
  const [leads, setLeads] = useState<TrialLead[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [opened, setOpened] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const profiles = useLightProfiles(setLeads)
  const phone = useMediaQuery('(max-width: 767px)')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetch('/api/guest/session', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || 'Your results could not be loaded.')
        if (cancelled) return
        const saved = (data?.leads ?? []) as TrialLead[]
        setLeads(saved)
        saveGuestLeads(saved)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Your results could not be loaded.')
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [attempt])

  const change = useCallback((patch: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setExpandedId(null)
  }, [])

  const visible = useMemo(() => filterAndSortGuest(leads, { q: filters.q, city: filters.city, industry: filters.industry, contact: filters.contact, sort: filters.sort }), [leads, filters])
  const summary = useMemo(() => summarizeGuest(leads), [leads])
  const filtered = hasGuestFilters({ q: filters.q, city: filters.city, industry: filters.industry, contact: filters.contact, sort: filters.sort })
  const sheetLead = sheetId ? leads.find((lead) => lead.id === sheetId) ?? null : null

  function open(lead: TrialLead) {
    setOpened(true)
    void trackEvent('trial_business_opened', { metadata: { has_description: Boolean(lead.website_intelligence?.description) } })
    void profiles.request(lead)
    if (phone) setSheetId(lead.id)
    else setExpandedId((current) => (current === lead.id ? null : lead.id))
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setToast(`${label} copied.`)
    } catch {
      setToast(`Couldn't copy the ${label.toLowerCase()}.`)
    }
    window.setTimeout(() => setToast(null), 3000)
  }

  function onDownload() {
    // The browser follows the link and saves the file. The thank-you appears at once; nothing is asked for or stored.
    setDownloaded(true)
    void trackEvent('trial_csv_downloaded', { leads_count: leads.length })
  }

  const contactShortcut = (key: ContactKey): Pick<Metric, 'onSelect' | 'selected'> => {
    const on = filters.contact.includes(key)
    return { selected: on, onSelect: () => change({ contact: on ? filters.contact.filter((entry) => entry !== key) : [...filters.contact, key], page: 1 }) }
  }
  const metrics: Metric[] = [
    { key: 'total', label: 'Businesses', value: status === 'ready' ? summary.total : null, tone: 'plain' },
    { key: 'email', label: 'With email', value: status === 'ready' ? summary.withEmail : null, tone: 'gold', ...contactShortcut('email') },
    { key: 'phone', label: 'With phone', value: status === 'ready' ? summary.withPhone : null, tone: 'plain', ...contactShortcut('phone') },
    { key: 'website', label: 'With website', value: status === 'ready' ? summary.withWebsite : null, tone: 'plain', ...contactShortcut('website') },
  ]

  return (
    <div className="space-y-8 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <span aria-hidden="true" className="block h-px w-10 bg-[#d8c28a]" />
          <h1 className="mt-4 font-display text-4xl leading-none text-white sm:text-5xl">Your free businesses</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">
            Who each business is, what its website says it does, and how to reach it. Contact details can be missing or out of date; ALPA never fills a gap.
          </p>
        </div>
        {leads.length > 0 ? (
          <a href="/api/guest/export" onClick={onDownload} className="btn-primary-gold btn-quiet w-full uppercase tracking-[0.14em] sm:w-auto">
            <Download aria-hidden="true" className="mr-2 h-4 w-4" /> Download CSV
          </a>
        ) : null}
      </header>

      {downloaded ? (
        <section role="status" className="rounded-xl border border-[#d8c28a]/35 bg-[#d8c28a]/[0.07] p-5">
          <h2 className="font-display text-2xl text-white">Your businesses are ready.</h2>
          <p className="mt-2 text-white/80">Thanks for giving ALPA a try. Now go start some conversations.</p>
          <Link href="/plans" className="mt-3 inline-flex min-h-[44px] items-center text-[#d8c28a] underline-offset-4 hover:underline">Explore ALPA plans →</Link>
          <p className="text-sm text-white/55">Your results stay available here, so you can come back to them.</p>
        </section>
      ) : null}

      <MetricStrip metrics={metrics} className="hidden sm:grid" />
      {status === 'ready' && leads.length > 0 ? (
        <p className="text-sm text-white/65 sm:hidden">
          {summary.total} {summary.total === 1 ? 'business' : 'businesses'} · {summary.withEmail} with email · {summary.withPhone} with phone · {summary.withWebsite} with website
        </p>
      ) : null}

      <CommandBar
        filters={filters}
        archivedCount={null}
        onChange={change}
        onClear={() => change(CLEAR)}
        showViews={false}
        showIntelligence={false}
        sortKeys={GUEST_SORT_KEYS}
        searchPlaceholder="Search name, industry, city, website or what they do"
        collapseOnPhone
      />

      <section aria-label="Businesses" aria-busy={status === 'loading'} className="overflow-hidden rounded-sm bg-[#f7f5ef] text-[#0b1a33]">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 border-b border-[#d9d3c4] px-4 py-2.5 text-xs text-[#5b6372] sm:px-5 md:grid-cols-[minmax(0,1fr)_5.5rem_9.5rem_1.75rem]">
          <span aria-live="polite" className="tabular-nums">{status === 'loading' ? 'Loading…' : describeGuestRange(visible.length, leads.length)}</span>
          <span aria-hidden="true" className="hidden md:block">Contact</span>
          <span aria-hidden="true" className="hidden md:block">Website</span>
          <span aria-hidden="true" />
        </div>

        {status === 'error' ? (
          <div role="alert" className="px-5 py-14 text-sm text-[#5b6372]">
            {error}{' '}
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="min-h-[44px] text-[#7a5f27] underline underline-offset-4">Try again</button>
          </div>
        ) : status === 'ready' && leads.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="font-display text-2xl text-[#0b1a33]">No businesses yet</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[#5b6372]">Start a free search and the businesses ALPA finds appear here.</p>
            <Link href="/trial" className="mt-5 inline-flex min-h-[44px] items-center rounded-md border border-[#7a5f27]/50 px-4 text-sm text-[#7a5f27] transition hover:bg-white">Find businesses</Link>
          </div>
        ) : status === 'ready' && visible.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-[#0b1a33]">No businesses match these filters</p>
            <p className="mt-1 text-xs text-[#5b6372]">Try fewer or broader filters.</p>
            {filtered ? <button type="button" onClick={() => change(CLEAR)} className="mt-4 min-h-[44px] text-sm text-[#7a5f27] underline underline-offset-4">Clear filters</button> : null}
          </div>
        ) : (
          <ul role="list">
            {visible.map((lead) => (
              <LeadRow
                key={lead.id}
                item={toGuestListItem(lead)}
                selectable={false}
                showPreview
                chip={guestWebsiteState(lead)}
                hasPanel={!phone}
                expanded={!phone && expandedId === lead.id}
                onToggleExpand={() => open(lead)}
              >
                <DossierView model={guestDossierModel(lead)} onCopy={copy} profileState={profiles.states[lead.id] ?? null} />
              </LeadRow>
            ))}
          </ul>
        )}
      </section>

      {leads.length > 0 ? <FeedbackPrompt engaged={opened || downloaded || filtered} downloaded={downloaded} /> : null}

      {leads.length > 0 ? (
        <p className="text-sm leading-6 text-white/55">
          Results stay in this browser for 30 days.{' '}
          <Link href="/login?mode=signup" className="inline-flex min-h-[44px] items-center text-white/80 underline underline-offset-4 hover:text-[#d8c28a]">Create a free account</Link>{' '}
          to keep these businesses and come back to them from any device.{' '}
          <Link href="/plans" className="inline-flex min-h-[44px] items-center text-white/80 underline underline-offset-4 hover:text-[#d8c28a]">View plans</Link>
        </p>
      ) : null}

      <BottomSheet open={Boolean(sheetLead)} title={sheetLead?.company_name ?? ''} onClose={() => setSheetId(null)}>
        {sheetLead ? <DossierView model={guestDossierModel(sheetLead)} onCopy={copy} layout="sheet" profileState={profiles.states[sheetLead.id] ?? null} /> : null}
      </BottomSheet>

      {toast ? (
        <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
          <div className="rounded-lg border border-[#d8c28a]/40 bg-[#0b1a33] px-4 py-2.5 text-sm text-[#e9dcb6]">{toast}</div>
        </div>
      ) : null}
    </div>
  )
}
