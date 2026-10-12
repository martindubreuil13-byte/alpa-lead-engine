'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Download, Trash2, X } from 'lucide-react'

import { archiveLeads, deleteLead, deleteLeads, restoreLeads } from '@/app/dashboard/my-leads/actions'
import { downloadLeadCsv, getLeadCsvFilename } from '@/lib/leads/csv'
import {
  allSelected,
  deselectIds,
  describeRange,
  filtersFromSearch,
  filtersToSearch,
  hasActiveFilters,
  PAGE_SIZES,
  sameFilters,
  selectIds,
  toggleId,
  type FilterState,
} from '@/lib/my-leads/ui-state'
import { cn } from '@/lib/utils'

import CommandBar from './CommandBar'
import ConnectTools from './ConnectTools'
import LeadDossier from './LeadDossier'
import LeadRow from './LeadRow'
import OverviewStrip from './OverviewStrip'
import { useLeadList, useLeadSummary } from './useLeadList'

type Toast = { message: string; tone: 'ok' | 'error' }

const BUTTON =
  'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a]'

// The My Leads workspace. Every list, count and dossier comes from the paginated, session-scoped endpoints: a page of lightweight
// rows at a time, the full business only when its row is opened. Nothing here loads the library, and nothing starts research.
export default function MyLeadsWorkspace() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<FilterState>(() => filtersFromSearch(searchParams.toString()))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)
  const clearHiddenOnNextPage = useRef(false)

  const list = useLeadList(filters)
  const { summary, refreshSummary } = useLeadSummary()

  // ---- the address bar mirrors the filters, and the filters follow back/forward ----
  useEffect(() => {
    const qs = filtersToSearch(filters).toString()
    if (qs !== searchParams.toString()) router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [filters, pathname, router, searchParams])
  useEffect(() => {
    const fromUrl = filtersFromSearch(searchParams.toString())
    setFilters((current) => (sameFilters(current, fromUrl) ? current : fromUrl))
  }, [searchParams])

  const change = useCallback((patch: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setExpandedId(null)
    if (patch.view) setSelected([])
  }, [])

  const showToast = useCallback((message: string, tone: Toast['tone']) => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 3200)
  }, [])

  // Rows removed by an action stay hidden until the refreshed page has actually arrived, so they never flicker back.
  useEffect(() => {
    if (clearHiddenOnNextPage.current) {
      clearHiddenOnNextPage.current = false
      setGone(new Set())
    }
  }, [list.items])

  const items = useMemo(() => list.items.filter((item) => !gone.has(item.id)), [list.items, gone])
  const pageIds = items.map((item) => item.id)
  const totalPages = Math.max(1, Math.ceil(list.total / filters.pageSize))
  const archivedView = filters.view === 'archived'
  const nothingSaved = !list.loading && !list.error && !hasActiveFilters(filters) && summary?.total === 0

  // ---- actions (the same server actions the page has always used, applied to the rows on screen first) ----
  async function applyChange(ids: string[], run: () => Promise<{ success: boolean }>, failure: string) {
    setGone((current) => new Set([...current, ...ids]))
    setSelected((current) => deselectIds(current, ids))
    setExpandedId(null)
    const result = await run()
    if (!result.success) {
      setGone((current) => new Set([...current].filter((id) => !ids.includes(id))))
      showToast(failure, 'error')
      return
    }
    clearHiddenOnNextPage.current = true
    list.refresh()
    refreshSummary()
  }
  const archive = (ids: string[]) => applyChange(ids, () => archiveLeads(ids), ids.length > 1 ? `Couldn't archive ${ids.length} leads.` : "Couldn't archive lead.")
  const restore = (ids: string[]) => applyChange(ids, () => restoreLeads(ids), ids.length > 1 ? `Couldn't restore ${ids.length} leads.` : "Couldn't restore lead.")
  const remove = (ids: string[]) => applyChange(ids, () => (ids.length === 1 ? deleteLead(ids[0]) : deleteLeads(ids)), ids.length > 1 ? `Couldn't delete ${ids.length} leads.` : "Couldn't delete lead.")

  async function exportSelected() {
    if (selected.length === 0) return
    try {
      const response = await fetch('/api/my-leads/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selected.slice(0, 500) }) })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error('export')
      downloadLeadCsv(data.leads, getLeadCsvFilename('my-leads'))
      if (selected.length > 500) showToast('Exported the first 500 selected businesses.', 'ok')
    } catch {
      showToast("Couldn't export. Try again.", 'error')
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${label} copied.`, 'ok')
    } catch {
      showToast(`Couldn't copy the ${label.toLowerCase()}.`, 'error')
    }
  }

  function goToPage(page: number) {
    change({ page })
    sheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-8 pb-28">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <span aria-hidden="true" className="block h-px w-10 bg-[#d8c28a]" />
          <h1 className="mt-4 font-display text-4xl leading-none text-white sm:text-5xl">My Leads</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">
            The businesses you have discovered, and what ALPA has learned about each one. Search them, understand them, and decide who to approach.
          </p>
        </div>
        <ConnectTools />
      </header>

      <OverviewStrip summary={summary} active={filters.bi} onSelect={(bi) => change({ bi, view: 'active', page: 1 })} />

      <CommandBar filters={filters} archivedCount={summary ? summary.archived : null} onChange={change} onClear={() => change({ q: '', city: '', industry: '', contact: [], bi: '', page: 1 })} />

      <section ref={sheetRef} aria-label="Businesses" aria-busy={list.loading} className="scroll-mt-6 overflow-hidden rounded-sm bg-[#f7f5ef] text-[#0b1a33] shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_1.75rem] items-center gap-x-3 border-b border-[#d9d3c4] px-4 py-2.5 text-xs text-[#5b6372] sm:px-5 md:grid-cols-[auto_minmax(0,1fr)_5.5rem_9.5rem_6.5rem_1.75rem]">
          <input
            type="checkbox"
            checked={allSelected(selected, pageIds)}
            onChange={() => setSelected((current) => (allSelected(current, pageIds) ? deselectIds(current, pageIds) : selectIds(current, pageIds)))}
            disabled={pageIds.length === 0}
            aria-label="Select all businesses on this page"
            className="h-4 w-4 cursor-pointer accent-[#7a5f27]"
          />
          <span aria-live="polite" className="tabular-nums">
            {list.loading && items.length === 0 ? 'Loading…' : describeRange({ page: filters.page, pageSize: filters.pageSize, count: items.length, total: list.total })}
          </span>
          <span aria-hidden="true" className="hidden md:block">Contact</span>
          <span aria-hidden="true" className="hidden md:block">Intelligence</span>
          <span aria-hidden="true" className="hidden md:block">Activity</span>
          <span aria-hidden="true" />
        </div>

        {list.error && items.length === 0 ? (
          <div role="alert" className="px-5 py-14 text-sm text-[#5b6372]">
            Your businesses couldn&apos;t be loaded.{' '}
            <button type="button" onClick={list.refresh} className="text-[#7a5f27] underline underline-offset-4">Try again</button>
          </div>
        ) : nothingSaved ? (
          <div className="px-5 py-16 text-center">
            <p className="font-display text-2xl text-[#0b1a33]">No businesses yet</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[#5b6372]">Businesses you discover appear here, with the intelligence ALPA gathers on each.</p>
            <Link href="/dashboard/scraper" className="mt-5 inline-flex min-h-[40px] items-center rounded-md border border-[#7a5f27]/50 px-4 text-sm text-[#7a5f27] transition hover:bg-white">Discover businesses</Link>
          </div>
        ) : items.length === 0 && !list.loading ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm text-[#0b1a33]">{archivedView ? 'No archived businesses' : hasActiveFilters(filters) ? 'No businesses match these filters' : 'No active businesses'}</p>
            <p className="mt-1 text-xs text-[#5b6372]">{archivedView ? 'Businesses you archive are kept here. You can restore them at any time.' : hasActiveFilters(filters) ? 'Try fewer or broader filters.' : ''}</p>
            {hasActiveFilters(filters) ? (
              <button type="button" onClick={() => change({ q: '', city: '', industry: '', contact: [], bi: '', page: 1 })} className="mt-4 text-xs text-[#7a5f27] underline underline-offset-4">Clear filters</button>
            ) : null}
          </div>
        ) : (
          <ul role="list" className={cn('transition-opacity duration-200', list.loading && 'opacity-60')}>
            {items.map((item) => (
              <LeadRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                selected={selected.includes(item.id)}
                onToggleExpand={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                onToggleSelect={() => setSelected((current) => toggleId(current, item.id))}
              >
                <LeadDossier
                  id={item.id}
                  archived={item.archived}
                  onArchive={() => archive([item.id])}
                  onRestore={() => restore([item.id])}
                  onDelete={() => setConfirmDelete([item.id])}
                  onCopy={copy}
                />
              </LeadRow>
            ))}
          </ul>
        )}

        {list.total > 0 ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d9d3c4] px-4 py-2.5 text-xs text-[#5b6372] sm:px-5">
            <label className="flex items-center gap-2">
              <span>Per page</span>
              <select value={filters.pageSize} onChange={(event) => change({ pageSize: Number(event.target.value), page: 1 })} className="h-8 rounded-md border border-[#d9d3c4] bg-transparent px-2 text-xs text-[#0b1a33]">
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => goToPage(filters.page - 1)} disabled={filters.page <= 1} aria-label="Previous page" className="rounded-md border border-[#d9d3c4] p-1.5 text-[#0b1a33] transition hover:bg-white disabled:opacity-35">
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
              <span className="tabular-nums">Page {filters.page} of {totalPages.toLocaleString('en')}</span>
              <button type="button" onClick={() => goToPage(filters.page + 1)} disabled={filters.page >= totalPages} aria-label="Next page" className="rounded-md border border-[#d9d3c4] p-1.5 text-[#0b1a33] transition hover:bg-white disabled:opacity-35">
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </nav>
        ) : null}
      </section>

      {selected.length > 0 ? (
        <div role="toolbar" aria-label="Actions for selected businesses" className="fixed inset-x-0 bottom-5 z-40 mx-auto w-[min(34rem,calc(100vw-1rem))] rounded-xl border border-white/12 bg-[#0b1a33]/95 px-4 py-3 shadow-[0_25px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-white tabular-nums">{selected.length.toLocaleString('en')} selected</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={exportSelected} className={cn(BUTTON, 'text-white/85 hover:bg-white/10 hover:text-white')}>
                <Download aria-hidden="true" className="h-3.5 w-3.5" /> Export CSV
              </button>
              {archivedView ? (
                <>
                  <button type="button" onClick={() => restore(selected)} className={cn(BUTTON, 'text-white/85 hover:bg-white/10 hover:text-white')}>
                    <ArchiveRestore aria-hidden="true" className="h-3.5 w-3.5" /> Restore
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(selected)} className={cn(BUTTON, 'text-rose-300 hover:bg-rose-500/15 hover:text-rose-200')}>
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" /> Delete
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => archive(selected)} className={cn(BUTTON, 'text-white/85 hover:bg-white/10 hover:text-white')}>
                  <Archive aria-hidden="true" className="h-3.5 w-3.5" /> Archive
                </button>
              )}
              <button type="button" onClick={() => setSelected([])} aria-label="Clear selection" className={cn(BUTTON, 'px-2 text-white/55 hover:text-white')}>
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#07111f]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-white/12 bg-[#0b1a33] p-6 shadow-[0_25px_80px_rgba(0,0,0,0.5)]">
            <h2 id="delete-title" className="text-lg font-semibold text-white">Delete permanently?</h2>
            <p className="mt-2 text-sm text-white/65">
              {confirmDelete.length === 1 ? 'This lead' : `These ${confirmDelete.length} leads`} will be permanently deleted and cannot be recovered.
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(null)} className={cn(BUTTON, 'flex-1 justify-center text-white/80 hover:bg-white/10')}>Cancel</button>
              <button
                type="button"
                onClick={() => {
                  const ids = confirmDelete
                  setConfirmDelete(null)
                  void remove(ids)
                }}
                className={cn(BUTTON, 'flex-1 justify-center text-rose-300 hover:bg-rose-500/15')}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <div className={cn('rounded-lg border px-4 py-2.5 text-sm backdrop-blur', toast.tone === 'error' ? 'border-rose-400/30 bg-rose-500/10 text-rose-200' : 'border-[#d8c28a]/40 bg-[#d8c28a]/10 text-[#e9dcb6]')}>{toast.message}</div>
        </div>
      ) : null}
    </div>
  )
}

