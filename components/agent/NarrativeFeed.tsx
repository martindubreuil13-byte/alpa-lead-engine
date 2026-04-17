'use client'

export type NarrativeLine = {
  id: string
  text: string
  kind: 'lead' | 'email' | 'system' | 'round'
  ts?: number
}

function kindDot(kind: NarrativeLine['kind']): string {
  if (kind === 'lead') return 'bg-emerald-400'
  if (kind === 'email') return 'bg-violet-400'
  if (kind === 'round') return 'bg-blue-400'
  return 'bg-slate-600'
}

function kindLabel(kind: NarrativeLine['kind']): string {
  if (kind === 'lead') return 'Lead'
  if (kind === 'email') return 'Email'
  if (kind === 'round') return 'Round'
  return ''
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

type Props = {
  items: NarrativeLine[]
  label?: string
  empty?: string
}

export function NarrativeFeed({ items, label = 'Live Activity', empty = 'Waiting for the agent to run…' }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">
          {label}
        </span>
      </div>

      {/* Feed */}
      <div className="relative">
        {/* Fade mask at bottom */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-16 bg-[linear-gradient(to_top,rgba(9,9,18,1),transparent)]" />

        <div className="max-h-[420px] overflow-y-auto space-y-0 [&::-webkit-scrollbar]:hidden">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-700">{empty}</p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 border-b border-white/[0.03] py-2.5 first:pt-0 last:border-none"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${kindDot(item.kind)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-slate-300">{item.text}</p>
                  {item.ts && (
                    <p className="mt-0.5 text-[10px] tabular-nums text-slate-700">{relTime(item.ts)}</p>
                  )}
                </div>
                {item.kind !== 'system' && item.kind !== 'round' && (
                  <span className="shrink-0 rounded-full border border-white/[0.05] bg-white/[0.02] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                    {kindLabel(item.kind)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
