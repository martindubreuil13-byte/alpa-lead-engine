'use client'

import { ChevronDown, Globe, Mail, Phone } from 'lucide-react'

import type { LeadListItem } from '@/lib/my-leads/list'
import { relativeTime, STATUS_CHIP, type ChipTone } from '@/lib/my-leads/ui-state'
import { cn } from '@/lib/utils'

const TONE: Record<ChipTone, string> = {
  ready: 'border-[#b89a5a]/70 bg-[#b89a5a]/12 text-[#6b5320]',
  working: 'border-[#0b1a33]/25 bg-[#0b1a33]/[0.05] text-[#0b1a33]',
  waiting: 'border-[#d9d3c4] text-[#5b6372]',
  attention: 'border-[#c8895a]/60 bg-[#c8895a]/10 text-[#8a4b1f]',
  quiet: 'border-transparent text-[#7b8190]',
}

// One compact row: name with industry and city, which contact details exist, the profile status and the last activity. The row
// itself is the expand control; the checkbox selects it for bulk actions.
export default function LeadRow({
  item,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  selectable = true,
  chip: chipOverride,
  hasPanel = true,
  showPreview = false,
  children,
}: {
  item: LeadListItem
  expanded: boolean
  selected?: boolean
  onToggleExpand: () => void
  onToggleSelect?: () => void
  /** The free-trial results have no selection and no activity column; everything else is the member row. */
  selectable?: boolean
  /** A status other than the saved-profile one (the free trial reports what was read from the website). */
  chip?: { label: string; tone: ChipTone }
  /** False when the details open somewhere else (a phone's bottom sheet), so the row only announces that it can open. */
  hasPanel?: boolean
  /** A two-line preview of what the business does, under its name. */
  showPreview?: boolean
  children?: React.ReactNode
}) {
  const chip = chipOverride ?? STATUS_CHIP[item.intelligence.state]
  const meta = [item.industry, item.city].filter(Boolean).join(' · ')
  const panelId = `dossier-${item.id}`
  return (
    <li className={cn('border-t border-[#d9d3c4] first:border-t-0', expanded && 'bg-[#f1ede2]')}>
      <div className={cn('grid items-center gap-x-3 px-4 py-2.5 sm:px-5', selectable ? 'grid-cols-[auto_minmax(0,1fr)_1.75rem] md:grid-cols-[auto_minmax(0,1fr)_5.5rem_9.5rem_6.5rem_1.75rem]' : 'grid-cols-[minmax(0,1fr)_1.75rem] md:grid-cols-[minmax(0,1fr)_5.5rem_9.5rem_1.75rem]')}>
        {selectable ? (
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={onToggleSelect}
            aria-label={`Select ${item.company_name}`}
            className="h-4 w-4 cursor-pointer accent-[#7a5f27]"
          />
        ) : null}
        <button
          type="button"
          aria-expanded={hasPanel ? expanded : undefined}
          aria-haspopup={hasPanel ? undefined : 'dialog'}
          aria-controls={hasPanel ? panelId : undefined}
          onClick={onToggleExpand}
          className="min-h-[44px] min-w-0 rounded text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27]"
        >
          <span className="block truncate text-[0.95rem] font-semibold leading-snug text-[#0b1a33]">{item.company_name}</span>
          <span className="block truncate text-xs text-[#5b6372]">{meta || 'Industry and location not provided'}</span>
          {showPreview && item.intelligence.preview ? <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-[#3b4455]">{item.intelligence.preview}</span> : null}
        </button>
        <span className="hidden items-center gap-2 text-[#7a5f27] md:flex" aria-label="Contact details available">
          <Globe aria-label={item.has.website ? 'Website' : 'No website'} className={cn('h-3.5 w-3.5', !item.has.website && 'opacity-20')} />
          <Mail aria-label={item.has.email ? 'Email' : 'No email'} className={cn('h-3.5 w-3.5', !item.has.email && 'opacity-20')} />
          <Phone aria-label={item.has.phone ? 'Phone' : 'No phone'} className={cn('h-3.5 w-3.5', !item.has.phone && 'opacity-20')} />
        </span>
        <span className={cn('hidden w-fit items-center rounded-full border px-2.5 py-0.5 text-xs md:inline-flex', TONE[chip.tone])} title={item.intelligence.label}>
          {chip.tone === 'working' ? <span aria-hidden="true" className="mr-1.5 h-1.5 w-1.5 rounded-full bg-[#7a5f27] motion-safe:animate-pulse" /> : null}
          {chip.label}
        </span>
        {selectable ? <span className="hidden text-xs tabular-nums text-[#5b6372] md:block" title={item.last_activity_at ?? undefined}>{relativeTime(item.last_activity_at)}</span> : null}
        <button
          type="button"
          aria-label={hasPanel ? (expanded ? `Collapse ${item.company_name}` : `Expand ${item.company_name}`) : `Open ${item.company_name}`}
          aria-expanded={hasPanel ? expanded : undefined}
          aria-haspopup={hasPanel ? undefined : 'dialog'}
          aria-controls={hasPanel ? panelId : undefined}
          onClick={onToggleExpand}
          className="flex h-7 w-7 items-center justify-center rounded text-[#5b6372] outline-none transition hover:bg-[#0b1a33]/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7a5f27]"
        >
          <ChevronDown aria-hidden="true" className={cn('h-4 w-4 transition-transform motion-safe:duration-200', expanded && 'rotate-180')} />
        </button>
        {/* On a phone the status and age sit under the name instead of in their own columns. */}
        <div className={cn('mt-1 flex items-center gap-3 text-xs text-[#5b6372] md:hidden', selectable ? 'col-start-2 col-end-4' : 'col-start-1 col-end-3')}>
          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5', TONE[chip.tone])}>{chip.label}</span>
          {selectable ? <span className="tabular-nums">{relativeTime(item.last_activity_at)}</span> : null}
          <span className="ml-auto flex items-center gap-1.5 text-[#7a5f27]" aria-label="Contact details available">
            {item.has.website ? <Globe aria-label="Website" className="h-3.5 w-3.5" /> : null}
            {item.has.email ? <Mail aria-label="Email" className="h-3.5 w-3.5" /> : null}
            {item.has.phone ? <Phone aria-label="Phone" className="h-3.5 w-3.5" /> : null}
          </span>
        </div>
      </div>
      {expanded ? (
        <div id={panelId} role="region" aria-label={`${item.company_name} details`} className="border-t border-[#d9d3c4]/70 px-4 pb-6 pt-5 sm:px-5 md:pl-12">
          {children}
        </div>
      ) : null}
    </li>
  )
}
