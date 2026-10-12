'use client'

import type { LeadSummary } from '@/lib/my-leads/list'
import type { BiFilter } from '@/lib/my-leads/params'
import { cn } from '@/lib/utils'

type Metric = { key: string; label: string; value: number | null; bi: BiFilter | ''; tone: 'plain' | 'gold' | 'amber' }

const number = (value: number | null) => (value === null ? '–' : value.toLocaleString('en'))

// Four compact figures. Each one is also a shortcut: it applies the matching filter, so the overview is a way in, not decoration.
export default function OverviewStrip({
  summary,
  active,
  onSelect,
}: {
  summary: LeadSummary | null
  active: BiFilter | ''
  onSelect: (bi: BiFilter | '') => void
}) {
  const metrics: Metric[] = [
    { key: 'total', label: 'Businesses', value: summary ? summary.total : null, bi: '', tone: 'plain' },
    { key: 'ready', label: 'Profiles ready', value: summary ? summary.ready : null, bi: 'ready', tone: 'gold' },
    { key: 'awaiting', label: 'Awaiting intelligence', value: summary ? summary.awaiting : null, bi: 'awaiting', tone: 'plain' },
    { key: 'attention', label: 'Need attention', value: summary ? summary.attention : null, bi: 'attention', tone: 'amber' },
  ]

  return (
    <dl aria-label="Overview" className="grid grid-cols-2 divide-white/10 border-y border-white/10 sm:grid-cols-4 sm:divide-x">
      {metrics.map((metric) => {
        const selected = metric.bi !== '' && active === metric.bi
        return (
          <div key={metric.key} className="px-1 py-3 sm:px-5 sm:first:pl-0">
            <button
              type="button"
              onClick={() => onSelect(selected ? '' : metric.bi)}
              aria-pressed={metric.bi === '' ? undefined : selected}
              className={cn(
                'group block w-full rounded text-left outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]',
                metric.bi === '' && 'cursor-default'
              )}
            >
              <dt className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/55">{metric.label}</dt>
              <dd
                className={cn(
                  'mt-1 font-display text-3xl leading-none tabular-nums transition-colors sm:text-4xl',
                  metric.tone === 'gold' ? 'text-[#d8c28a]' : metric.tone === 'amber' && (metric.value ?? 0) > 0 ? 'text-[#e8b98a]' : 'text-white',
                  selected && 'underline decoration-[#d8c28a]/70 decoration-1 underline-offset-8'
                )}
              >
                {number(metric.value)}
              </dd>
            </button>
          </div>
        )
      })}
    </dl>
  )
}
