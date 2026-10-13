'use client'

import { Copy, Globe, Mail, Phone } from 'lucide-react'

import type { DossierModel } from '@/lib/my-leads/dossier-model'
import { hostOf } from '@/lib/my-leads/dossier-model'
import { cn } from '@/lib/utils'

export const HEADING = 'text-[10px] font-medium uppercase tracking-[0.2em] text-[#7a5f27]'
export const MUTED = 'text-[#5b6372]'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className={HEADING}>{title}</h3>
      {children}
    </section>
  )
}

const CONTACT_ROW = 'flex min-h-[44px] items-center gap-2 text-sm md:min-h-[36px]'
const CONTACT_LINK =
  'flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded text-[#0b1a33] underline-offset-4 outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7a5f27] md:min-h-[36px]'
const COPY_BUTTON =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded text-[#5b6372] outline-none transition hover:text-[#0b1a33] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7a5f27] md:h-9 md:w-9'

function ReachLine({ icon, label, value, href, onCopy }: { icon: React.ReactNode; label: string; value: string; href: string; onCopy: (text: string, label: string) => void }) {
  return (
    <div className={CONTACT_ROW}>
      <a href={href} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={CONTACT_LINK}>
        <span aria-hidden="true" className="text-[#7a5f27]">{icon}</span>
        <span className="min-w-0 truncate">{value}</span>
      </a>
      <button type="button" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => onCopy(value, label)} className={COPY_BUTTON}>
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// A business in the three things a reader wants first: WHO they are, WHAT they do, HOW to reach them. It shows only what the model
// holds (a section with nothing behind it says so plainly) and never fills a gap. The member dossier and the free-trial results
// both render through it; `children` is where a member's own extra sections (intelligence details, notes, actions) go.
export default function DossierView({
  model,
  onCopy,
  layout = 'inline',
  children,
}: {
  model: DossierModel
  onCopy: (text: string, label: string) => void
  /** "sheet" is the phone presentation: the three sections stack, and the business name is the sheet's own title. */
  layout?: 'inline' | 'sheet'
  children?: React.ReactNode
}) {
  const { what, contact } = model
  const hasWhat = Boolean(what.text || what.titleLine || what.offers.length || what.serves || what.topics.length)
  return (
    <div className="space-y-7">
      <div className={cn('grid gap-x-10 gap-y-7', layout === 'inline' && 'md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)_minmax(0,1fr)]')}>
        <Section title="Who they are">
          <div className="space-y-0.5">
            {layout === 'sheet' ? null : <p className="text-sm font-medium text-[#0b1a33]">{model.name}</p>}
            {model.who.map((line, index) => (
              <p key={line} className={cn('text-sm', index === 0 ? 'text-[#243049]' : MUTED)}>{line}</p>
            ))}
          </div>
        </Section>

        <Section title="What they do">
          {what.text ? (
            <>
              <p className="max-w-prose text-[0.95rem] leading-7 text-[#243049]">{what.text}</p>
              {what.attribution ? <p className={`text-xs ${MUTED}`}>{what.attribution}</p> : null}
            </>
          ) : what.titleLine ? (
            <p className="max-w-prose text-sm leading-6 text-[#243049]">Their website is titled “{what.titleLine}”.</p>
          ) : null}
          {what.offers.length ? <p className="text-sm text-[#243049]"><span className={MUTED}>Offers </span>{what.offers.join(' · ')}</p> : null}
          {what.serves ? <p className="text-sm text-[#243049]"><span className={MUTED}>Serves </span>{what.serves}</p> : null}
          {what.topics.length ? (
            <div className="space-y-1.5">
              <p className={`text-xs ${MUTED}`}>{what.topicsLabel}</p>
              <ul className="flex flex-wrap gap-1.5">
                {what.topics.map((topic) => (
                  <li key={topic} className="rounded-full border border-[#d9d3c4] px-2.5 py-0.5 text-xs text-[#3b4455]">{topic}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!hasWhat ? <p className={`text-sm ${MUTED}`}>{what.empty}</p> : null}
          {what.sources.length ? (
            <p className={`text-xs ${MUTED}`}>
              Source:{' '}
              {what.sources.map((source, index) => (
                <span key={source.url}>
                  {index > 0 ? ' · ' : ''}
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center underline underline-offset-4 md:min-h-[32px] hover:text-[#0b1a33]">{source.label}</a>
                </span>
              ))}
            </p>
          ) : null}
          {what.caveat ? <p className={`text-xs ${MUTED}`}>{what.caveat}</p> : null}
        </Section>

        <Section title="How to reach them">
          <div className="-my-0.5">
            {contact.name ? <p className="py-1 text-sm text-[#0b1a33]">{contact.name}</p> : null}
            {contact.email ? (
              <>
                <ReachLine icon={<Mail className="h-4 w-4" />} label="Email" value={contact.email} href={`mailto:${contact.email}`} onCopy={onCopy} />
                {contact.emailNote ? <p className={`pl-6 text-xs ${MUTED}`}>{contact.emailNote}</p> : null}
              </>
            ) : null}
            {contact.phone ? <ReachLine icon={<Phone className="h-4 w-4" />} label="Phone" value={contact.phone} href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} onCopy={onCopy} /> : null}
            {contact.website ? <ReachLine icon={<Globe className="h-4 w-4" />} label="Website" value={hostOf(contact.website) ?? contact.website} href={contact.website} onCopy={onCopy} /> : null}
          </div>
          {contact.missing.length ? (
            <ul className={`space-y-0.5 text-xs ${MUTED}`}>
              {contact.missing.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </Section>
      </div>
      {children}
    </div>
  )
}
