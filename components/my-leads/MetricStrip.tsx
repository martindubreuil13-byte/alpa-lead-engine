'use client'

import { cn } from '@/lib/utils'

export type Metric = {
  key: string
  label: string
  value: number | null
  tone: 'plain' | 'gold' | 'amber'
  /** Present when the figure is also a shortcut (it applies a filter). Without it the figure is plain information. */
  onSelect?: () => void
  selected?: boolean
}

const number = (value: number | null) => (value === null ? '–' : value.toLocaleString('en'))

// A row of compact figures, shared by the member overview and the free-trial overview. Each figure may also be a shortcut.
export default function MetricStrip({ metrics, label = 'Overview', className }: { metrics: Metric[]; label?: string; className?: string }) {
  return (
    <dl aria-label={label} className={cn('grid grid-cols-2 divide-white/10 border-y border-white/10 sm:divide-x', metrics.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4', className)}>
      {metrics.map((metric) => {
        const interactive = Boolean(metric.onSelect)
        return (
          <div key={metric.key} className="px-1 py-3 sm:px-5 sm:first:pl-0">
            <button
              type="button"
              onClick={metric.onSelect}
              aria-pressed={interactive ? Boolean(metric.selected) : undefined}
              className={cn(
                'group block w-full rounded text-left outline-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]',
                !interactive && 'cursor-default'
              )}
            >
              <dt className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/55">{metric.label}</dt>
              <dd
                className={cn(
                  'mt-1 font-display text-3xl leading-none tabular-nums transition-colors sm:text-4xl',
                  metric.tone === 'gold' ? 'text-[#d8c28a]' : metric.tone === 'amber' && (metric.value ?? 0) > 0 ? 'text-[#e8b98a]' : 'text-white',
                  metric.selected && 'underline decoration-[#d8c28a]/70 decoration-1 underline-offset-8'
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
