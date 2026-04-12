'use client'

import { useState } from 'react'

import type { ICPData } from '@/lib/ai/icp'

type ICPPreviewProps = {
  data: ICPData
}

export type { ICPData as ICPPreviewData }

export default function ICPPreview({ data }: ICPPreviewProps) {
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Structured Preview
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Here&apos;s how I&apos;ll approach this
        </h2>
      </div>

      <div className="rounded-xl border border-green-400/20 bg-green-500/10 p-4 shadow-[0_0_28px_rgba(34,197,94,0.1)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-green-100/80">
          Agent decision
        </div>
        <div className="mt-2 text-sm leading-7 text-green-50">
          {data.summary}
        </div>
      </div>

      <div className="grid gap-3">
        <TargetBusinessesBlock items={data.industries} />
        <PreviewBlock
          title="📍 Location"
          items={data.location}
        />
        <PreviewBlock
          title="💥 Pain Points"
          items={data.pain_points}
        />
        <PreviewBlock
          title="⚡ Messaging Angle"
          items={data.angles}
        />
      </div>
    </section>
  )
}

function TargetBusinessesBlock({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const visibleItems = expanded ? items : items.slice(0, 6)
  const hiddenCount = Math.max(items.length - 6, 0)

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-sm font-semibold text-white">🎯 Target Businesses</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {visibleItems.map((item) => (
          <span
            key={item}
            className="rounded-full border border-white/10 bg-[#081120] px-3 py-1.5 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            {item}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-full border border-blue-400/18 bg-blue-500/10 px-3 py-1.5 text-sm text-blue-100 transition hover:bg-blue-500/16"
          >
            {expanded ? 'Show less' : `+ ${hiddenCount} more`}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function PreviewBlock({ title, items }: { title: string; items: string[] }) {
  const visibleItems = items.filter((item) => item.trim().length > 0)

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {visibleItems.map((item) => (
          <span
            key={item}
            className="rounded-full border border-white/10 bg-[#081120] px-3 py-1.5 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
