'use client'

import { useEffect, useId, useRef, useState } from 'react'

export type ActivityStripItem = {
  label: string
  detail?: string
  tone?: 'default' | 'success' | 'warning' | 'error'
}

const DOT: Record<NonNullable<ActivityStripItem['tone']>, string> = {
  default: 'bg-white/45',
  success: 'bg-[#d8c28a]',
  warning: 'bg-white/70',
  error: 'bg-white/70',
}

function describe(item: ActivityStripItem) {
  return item.detail ? `${item.label} — ${item.detail}` : item.label
}

// A single quiet line with the latest meaningful event and an optional history. It only
// ever shows events that arrived from the stream.
export default function ActivityStrip({
  items,
  idle = 'Starting…',
  footnote,
}: {
  items: ActivityStripItem[]
  idle?: string
  footnote?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const listRef = useRef<HTMLUListElement | null>(null)
  const latest = items.at(-1)

  useEffect(() => {
    if (!expanded || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [expanded, items.length])

  return (
    <div className="border-t border-white/10 pt-4">
      <div className="flex items-center justify-between gap-4">
        <p className="flex min-w-0 items-center gap-3 text-sm text-white/80">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${latest ? DOT[latest.tone ?? 'default'] : 'bg-white/30'}`}
            aria-hidden="true"
          />
          <span key={latest ? describe(latest) : 'idle'} className="dash-fade truncate">
            {latest ? describe(latest) : idle}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="shrink-0 rounded text-xs uppercase tracking-[0.16em] text-white/65 transition hover:text-[#d8c28a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8c28a]"
        >
          {expanded ? 'Hide activity' : 'View activity'}
        </button>
      </div>

      {expanded ? (
        <ul
          id={listId}
          ref={listRef}
          className="mt-4 max-h-56 divide-y divide-white/8 overflow-y-auto border-y border-white/10 pr-2"
        >
          {items.length === 0 ? <li className="py-3 text-sm text-white/60">{idle}</li> : null}
          {items.map((item, index) => (
            <li key={`${describe(item)}-${index}`} className="flex items-start gap-3 py-2.5 text-sm text-white/75">
              <span
                className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[item.tone ?? 'default']}`}
                aria-hidden="true"
              />
              <span className="min-w-0 break-words">{describe(item)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {expanded && footnote ? <p className="mt-3 text-xs text-white/55">{footnote}</p> : null}
    </div>
  )
}
