import { Download, Globe, Mail, MapPin, Phone, Search } from 'lucide-react'

const leads = [
  {
    name: 'Brickell Growth Studio',
    location: 'Miami, FL',
    industry: 'Marketing agency',
    email: 'hello@brickellgrowth.com',
    phone: '+1 (305) 555-0148',
    website: 'brickellgrowth.com',
    expanded: true,
  },
  {
    name: 'Sunset Local Media',
    location: 'Miami Beach, FL',
    industry: 'Local marketing',
    email: 'team@sunsetlocalmedia.com',
    phone: '+1 (305) 555-0192',
    website: 'sunsetlocalmedia.com',
  },
  {
    name: 'Palm Reach Creative',
    location: 'Coral Gables, FL',
    industry: 'Creative agency',
    email: 'growth@palmreachcreative.com',
    phone: '+1 (786) 555-0117',
    website: 'palmreachcreative.com',
  },
  {
    name: 'Biscayne Demand Co',
    location: 'Miami, FL',
    industry: 'Demand generation',
    email: 'contact@biscaynedemand.co',
    phone: '+1 (305) 555-0183',
    website: 'biscaynedemand.co',
  },
]

export default function OperationalLeadPreview({ variant = 'list' }: { variant?: 'list' | 'export' }) {
  if (variant === 'export') {
    return <ExportLeadPreview />
  }

  return (
    <div
      data-hero-leads-preview
      className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.96),rgba(5,12,24,0.94))] p-3 shadow-[0_22px_70px_rgba(2,8,23,0.5)] backdrop-blur-2xl sm:p-4"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.45),transparent)]" />
      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-blue-500/[0.06] blur-3xl" />

      <div className="relative rounded-[24px] border border-white/[0.07] bg-slate-950/42 p-3 sm:p-4">
        <div className="border-b border-white/[0.07] pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100/80">
              <Search className="h-3.5 w-3.5" />
              Marketing agencies · Miami
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-200">
              25 leads found
              {/* Desktop-only: live activity indicator */}
              <span className="lead-status-blink hidden h-1.5 w-1.5 rounded-full bg-blue-400 lg:inline-block" />
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2.5">
          {leads.map((lead, index) => (
            <LeadPreviewRow key={lead.name} lead={lead} className={index > 2 ? 'hidden sm:block' : ''} />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3 py-2.5">
          <div className="min-w-0 text-xs text-slate-400">
            <span className="font-medium text-slate-200">25 contact-ready leads</span>
          </div>
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_10px_22px_rgba(59,130,246,0.2)]">
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </div>
        </div>
      </div>
    </div>
  )
}

function ExportLeadPreview() {
  const lead = leads[0]

  return (
    <div
      data-export-leads-preview
      className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.96),rgba(5,12,24,0.94))] p-3 shadow-[0_22px_70px_rgba(2,8,23,0.5)] backdrop-blur-2xl sm:p-4"
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.45),transparent)]" />
      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-blue-500/[0.06] blur-3xl" />

      <div className="relative rounded-[24px] border border-white/[0.07] bg-slate-950/42 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100/80">
              <Download className="h-3.5 w-3.5" />
              Export preview
            </div>
            <div className="mt-2 text-sm font-medium text-slate-200">Contact data ready</div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100">
            <span className="lead-status-blink hidden h-1.5 w-1.5 rounded-full bg-emerald-400 lg:inline-block" />
            Ready
          </div>
        </div>

        <article className="mt-3 rounded-2xl border border-blue-300/14 bg-[linear-gradient(180deg,rgba(12,24,44,0.92),rgba(8,14,28,0.94))] p-3 shadow-[0_12px_32px_rgba(2,8,23,0.24)]">
          <LeadHeader lead={lead} />
          <div className="mt-3 grid gap-2 text-xs text-slate-300">
            <ContactLine icon={Mail} label="Email" value={lead.email} />
            <ContactLine icon={Phone} label="Phone" value={lead.phone} />
            <ContactLine icon={Globe} label="Website" value={lead.website} />
          </div>
        </article>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {['Website', 'Email', 'Phone'].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3 py-3"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {item}
              </div>
              <div className="mt-1 text-sm font-medium text-slate-200">Included</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3 py-2.5">
          <div className="min-w-0 text-xs text-slate-400">
            <span className="font-medium text-slate-200">Download your list</span>
          </div>
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_10px_22px_rgba(59,130,246,0.2)]">
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </div>
        </div>
      </div>
    </div>
  )
}

function LeadPreviewRow({
  lead,
  className = '',
}: {
  lead: (typeof leads)[number]
  className?: string
}) {
  if (lead.expanded) {
    return (
      <article
        className={`rounded-2xl border border-blue-300/14 bg-[linear-gradient(180deg,rgba(12,24,44,0.92),rgba(8,14,28,0.94))] p-3 shadow-[0_12px_32px_rgba(2,8,23,0.24)] transition-all duration-300 lg:hover:border-blue-300/22 lg:hover:shadow-[0_16px_40px_rgba(2,8,23,0.32)] ${className}`}
      >
        <LeadHeader lead={lead} />
        <div className="mt-3 grid gap-2 text-xs text-slate-300">
          <ContactLine icon={Mail} label="Email" value={lead.email} />
          <ContactLine icon={Phone} label="Phone" value={lead.phone} />
          <ContactLine icon={Globe} label="Website" value={lead.website} />
        </div>
      </article>
    )
  }

  return (
    <article className={`rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3 transition-all duration-300 lg:hover:border-white/[0.14] lg:hover:bg-white/[0.05] ${className}`}>
      <LeadHeader lead={lead} />
    </article>
  )
}

function LeadHeader({ lead }: { lead: (typeof leads)[number] }) {
  return (
    <div className="min-w-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">{lead.name}</div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{lead.location}</span>
          <span className="text-slate-700">·</span>
          <span className="truncate">{lead.industry}</span>
        </div>
      </div>
    </div>
  )
}

function ContactLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail
  label: string
  value: string
}) {
  return (
    <div className="flex min-h-9 items-center gap-2 rounded-xl border border-white/[0.06] bg-slate-950/28 px-3">
      <Icon className="h-3.5 w-3.5 shrink-0 text-blue-200/80" />
      <span className="w-14 shrink-0 text-[11px] uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-slate-200">{value}</span>
    </div>
  )
}
