'use client'

type FloatingLeadCardProps = {
  company: string
  email: string
  city: string
  industry: string
  confidence: 'HIGH' | 'MEDIUM'
  website?: string
  style?: React.CSSProperties
  className?: string
}

export default function FloatingLeadCard({
  company,
  email,
  city,
  industry,
  confidence,
  website,
  style,
  className = '',
}: FloatingLeadCardProps) {
  const tone =
    confidence === 'HIGH'
      ? 'border-cyan-400/30 shadow-[0_0_40px_rgba(34,211,238,0.16)]'
      : 'border-teal-400/20 shadow-[0_0_30px_rgba(45,212,191,0.12)]'

  return (
    <div
      style={style}
      className={`landing-float absolute w-[200px] rounded-[24px] border bg-slate-950/82 p-4 backdrop-blur-xl sm:w-[220px] ${tone} ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
            confidence === 'HIGH'
              ? 'border-cyan-300/20 bg-cyan-400/12 text-cyan-200'
              : 'border-teal-300/20 bg-teal-400/12 text-teal-200'
          }`}
        >
          {confidence === 'HIGH' ? 'STRONG' : 'READY'}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Preview
        </div>
      </div>

      <div className="mt-4 text-[17px] font-semibold tracking-[-0.03em] text-white">
        {company}
      </div>
      <div className="mt-2 inline-flex rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {industry}
      </div>
      <div className="mt-3 space-y-1.5 text-sm text-slate-300">
        <div className="truncate">Email: {email}</div>
        {website ? <div className="truncate text-xs text-slate-400">Website: {website}</div> : null}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <span>{city}</span>
        <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-400">
          Export ready
        </span>
      </div>
    </div>
  )
}
