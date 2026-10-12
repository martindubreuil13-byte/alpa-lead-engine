'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import { BI_FILTERS, CONTACT_KEYS, SORT_KEYS, type ContactKey } from '@/lib/my-leads/params'
import { BI_FILTER_LABEL, hasActiveFilters, SORT_LABEL, type FilterState } from '@/lib/my-leads/ui-state'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 300
const FIELD = 'h-9 rounded-lg border border-white/12 bg-white/[0.04] px-3 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-[#d8c28a]/70 focus-visible:outline-none'
const CONTACT_LABEL: Record<ContactKey, string> = { email: 'Email', phone: 'Phone', website: 'Website' }

// Search and filters. Typing is debounced; every filter resets to the first page; all of them combine on the server.
export default function CommandBar({
  filters,
  archivedCount,
  onChange,
  onClear,
}: {
  filters: FilterState
  archivedCount: number | null
  onChange: (patch: Partial<FilterState>) => void
  onClear: () => void
}) {
  const [text, setText] = useState({ q: filters.q, city: filters.city, industry: filters.industry })
  const latest = useRef(onChange)
  latest.current = onChange

  // The URL (or "clear") can change the committed filters from outside: follow it.
  useEffect(() => {
    setText({ q: filters.q, city: filters.city, industry: filters.industry })
  }, [filters.q, filters.city, filters.industry])

  // Typed text becomes a filter after a short pause.
  useEffect(() => {
    if (text.q === filters.q && text.city === filters.city && text.industry === filters.industry) return
    const timer = setTimeout(() => latest.current({ ...text, page: 1 }), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, filters.q, filters.city, filters.industry])

  const toggleContact = (key: ContactKey) =>
    onChange({ contact: filters.contact.includes(key) ? filters.contact.filter((entry) => entry !== key) : [...filters.contact, key], page: 1 })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div role="tablist" aria-label="Business view" className="flex gap-5 text-sm">
          {(['active', 'archived'] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={filters.view === view}
              onClick={() => onChange({ view, page: 1 })}
              className={cn(
                'border-b pb-1.5 outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]',
                filters.view === view ? 'border-[#d8c28a] text-white' : 'border-transparent text-white/55 hover:text-white/85'
              )}
            >
              {view === 'active' ? 'Active' : `Archived${archivedCount ? ` (${archivedCount.toLocaleString('en')})` : ''}`}
            </button>
          ))}
        </div>
        {hasActiveFilters(filters) ? (
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1 rounded text-xs text-white/60 transition hover:text-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a]">
            <X aria-hidden="true" className="h-3 w-3" /> Clear filters
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="relative sm:col-span-2 lg:col-span-1">
          <span className="sr-only">Search businesses</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="search"
            value={text.q}
            onChange={(event) => setText((current) => ({ ...current, q: event.target.value }))}
            placeholder="Search name, industry, city, website or profile keywords"
            maxLength={100}
            className={cn(FIELD, 'w-full pl-9')}
          />
        </label>
        <label>
          <span className="sr-only">City</span>
          <input value={text.city} onChange={(event) => setText((current) => ({ ...current, city: event.target.value }))} placeholder="City" maxLength={80} className={cn(FIELD, 'w-full')} />
        </label>
        <label>
          <span className="sr-only">Industry</span>
          <input value={text.industry} onChange={(event) => setText((current) => ({ ...current, industry: event.target.value }))} placeholder="Industry" maxLength={80} className={cn(FIELD, 'w-full')} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div role="group" aria-label="Contact details available" className="flex items-center gap-1.5">
          <span className="mr-1 text-[10px] uppercase tracking-[0.16em] text-white/45">Has</span>
          {CONTACT_KEYS.map((key) => {
            const on = filters.contact.includes(key)
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => toggleContact(key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d8c28a]',
                  on ? 'border-[#d8c28a]/70 bg-[#d8c28a]/10 text-[#d8c28a]' : 'border-white/12 text-white/65 hover:border-white/30 hover:text-white'
                )}
              >
                {CONTACT_LABEL[key]}
              </button>
            )
          })}
        </div>
        <label className="flex items-center gap-2 text-xs text-white/55">
          <span className="uppercase tracking-[0.16em] text-[10px] text-white/45">Intelligence</span>
          <select value={filters.bi} onChange={(event) => onChange({ bi: event.target.value as FilterState['bi'], page: 1 })} className={cn(FIELD, 'h-8 py-0 text-xs')}>
            <option value="">{BI_FILTER_LABEL['']}</option>
            {BI_FILTERS.map((value) => (
              <option key={value} value={value}>{BI_FILTER_LABEL[value]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-white/55 sm:ml-auto">
          <span className="uppercase tracking-[0.16em] text-[10px] text-white/45">Sort</span>
          <select value={filters.sort} onChange={(event) => onChange({ sort: event.target.value as FilterState['sort'], page: 1 })} className={cn(FIELD, 'h-8 py-0 text-xs')}>
            {SORT_KEYS.map((value) => (
              <option key={value} value={value}>{SORT_LABEL[value]}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
