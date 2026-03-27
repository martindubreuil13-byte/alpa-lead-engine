type EmailConfidence = 'high' | 'medium' | 'low' | null | undefined

const BADGE_META: Record<'high' | 'medium' | 'low', { label: string; tone: string }> = {
  high: {
    label: 'High',
    tone: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30',
  },
  medium: {
    label: 'Medium',
    tone: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30',
  },
  low: {
    label: 'Low',
    tone: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/30',
  },
}

export function matchesConfidenceFilter(
  confidence: EmailConfidence,
  filter: 'recommended' | 'all' | 'high' | 'medium' | 'low'
) {
  if (filter === 'all') return true
  if (filter === 'recommended') {
    return confidence === 'high' || confidence === 'medium'
  }

  return confidence === filter
}

export default function EmailConfidenceBadge({
  confidence,
}: {
  confidence: EmailConfidence
}) {
  const resolvedConfidence = confidence || 'low'
  const meta = BADGE_META[resolvedConfidence]
  const icon =
    resolvedConfidence === 'high'
      ? '🟢'
      : resolvedConfidence === 'medium'
      ? '🟡'
      : '🔴'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{meta.label}</span>
    </span>
  )
}
