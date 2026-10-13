'use client'

import type { LeadSummary } from '@/lib/my-leads/list'
import type { BiFilter } from '@/lib/my-leads/params'

import MetricStrip, { type Metric } from './MetricStrip'

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
  const shortcut = (bi: BiFilter): Pick<Metric, 'onSelect' | 'selected'> => ({ onSelect: () => onSelect(active === bi ? '' : bi), selected: active === bi })
  const metrics: Metric[] = [
    { key: 'total', label: 'Businesses', value: summary ? summary.total : null, tone: 'plain' },
    { key: 'ready', label: 'Profiles ready', value: summary ? summary.ready : null, tone: 'gold', ...shortcut('ready') },
    { key: 'awaiting', label: 'Awaiting intelligence', value: summary ? summary.awaiting : null, tone: 'plain', ...shortcut('awaiting') },
    { key: 'attention', label: 'Need attention', value: summary ? summary.attention : null, tone: 'amber', ...shortcut('attention') },
  ]
  return <MetricStrip metrics={metrics} />
}
