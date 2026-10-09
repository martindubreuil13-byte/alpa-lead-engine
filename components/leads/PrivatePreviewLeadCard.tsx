import { Globe, Mail, MapPin, Phone } from 'lucide-react'

import { getPrivatePreviewResearchStatus } from '@/lib/commercial-intelligence/private-preview-research'
import type { TrialLead } from '@/lib/trial'

export default function PrivatePreviewLeadCard({ lead }: { lead: TrialLead }) {
  const researchStatus = getPrivatePreviewResearchStatus(lead)
  const statusStyles = {
    researching: 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100',
    ready: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100',
    unavailable: 'border-slate-300/15 bg-white/5 text-slate-300',
  }
  const statusLabels = {
    researching: 'Researching',
    ready: 'Ready',
    unavailable: 'Unavailable',
  }

  return (
    <article className="rounded-2xl border border-white/8 bg-white/[0.025] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-white">{lead.company_name}</h4>
          {lead.city ? (
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span>{lead.city}</span>
            </div>
          ) : null}
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusStyles[researchStatus]}`}>
          {statusLabels[researchStatus]}
        </span>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
        {lead.website ? (
          <a className="flex min-w-0 items-center gap-2 hover:text-cyan-100" href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer">
            <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{lead.website}</span>
          </a>
        ) : null}
        {lead.email ? (
          <a className="flex min-w-0 items-center gap-2 hover:text-cyan-100" href={`mailto:${lead.email}`}>
            <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{lead.email}</span>
          </a>
        ) : null}
        {lead.phone ? (
          <a className="flex items-center gap-2 hover:text-cyan-100" href={`tel:${lead.phone}`}>
            <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{lead.phone}</span>
          </a>
        ) : null}
      </div>

      <div className="mt-4 border-t border-white/8 pt-4 text-sm leading-6 text-slate-300">
        {researchStatus === 'ready' ? lead.commercial_profile?.summary : null}
        {researchStatus === 'researching' ? 'Business profile is being generated.' : null}
        {researchStatus === 'unavailable' ? 'Website research could not produce a reliable synopsis.' : null}
      </div>
    </article>
  )
}
