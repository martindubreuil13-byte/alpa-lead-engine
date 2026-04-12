type ICPPreviewData = {
  industries: string[]
  excluded: string[]
  location: string[]
  company_size: string
  pain_points: string[]
  angles: string[]
}

type ICPPreviewProps = {
  data: ICPPreviewData
}

export type { ICPPreviewData }

export default function ICPPreview({ data }: ICPPreviewProps) {
  return (
    <section className="glass overflow-hidden p-4 sm:p-6">
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
          Structured Preview
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Here&apos;s who ALPA will target
        </h2>
      </div>

      <div className="mt-5 rounded-xl border border-blue-400/20 bg-blue-500/10 p-4 text-sm leading-7 text-blue-50 shadow-[0_0_24px_rgba(59,130,246,0.08)]">
        ALPA will focus on service-based businesses with recurring client needs and avoid enterprise or offline-heavy sectors where your offer has low relevance.
      </div>

      <div className="mt-5 grid gap-3">
        <PreviewBlock
          title="🎯 Industries"
          items={data.industries}
        />
        <PreviewBlock
          title="🚫 Excluded"
          items={data.excluded}
        />
        <PreviewBlock
          title="📍 Location"
          items={data.location}
        />
        <PreviewBlock
          title="📏 Company Size"
          items={[data.company_size]}
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

function PreviewBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
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
