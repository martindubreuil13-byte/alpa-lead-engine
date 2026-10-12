'use client'

import { useEffect, useState } from 'react'
import { ArchiveRestore, Archive, Copy, Globe, Mail, Phone, Trash2 } from 'lucide-react'

import type { LeadDossier as Dossier } from '@/lib/my-leads/list'
import { relativeTime } from '@/lib/my-leads/ui-state'

const REASON_TEXT: Record<string, string> = {
  budget: 'This search reached its research limit.',
  cancelled: 'Research was stopped for this search.',
  research_failed: 'The website could not be researched.',
  run_limit: "Not researched: this search's research limit was reached.",
  no_website: 'This business has no website to read.',
}
const STATE_TEXT: Record<string, string> = {
  queued: 'Queued for research. The profile will appear here when it is generated.',
  researching: 'Being researched now. The profile will appear here when it is generated.',
  retry_pending: 'Research will be retried.',
  failed: "The profile couldn't be completed.",
  partial: 'Only part of the profile could be built.',
  unavailable: 'No business profile was generated for this business.',
  cancelled: 'Research was stopped for this search.',
  not_started: 'No business profile has been generated for this business yet.',
}

const HEADING = 'text-[10px] font-medium uppercase tracking-[0.2em] text-[#7a5f27]'
const MUTED = 'text-[#5b6372]'
const ACTION =
  'inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#d9d3c4] px-3 text-xs font-medium text-[#0b1a33] outline-none transition hover:border-[#b89a5a] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27]'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className={HEADING}>{title}</h3>
      {children}
    </section>
  )
}

function ContactLine({ icon, label, value, href, onCopy }: { icon: React.ReactNode; label: string; value: string; href?: string; onCopy: (text: string, label: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span aria-hidden="true" className="text-[#7a5f27]">{icon}</span>
      {href ? (
        <a href={href} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="min-w-0 truncate text-[#0b1a33] underline-offset-4 hover:underline">{value}</a>
      ) : (
        <span className="min-w-0 truncate text-[#0b1a33]">{value}</span>
      )}
      <button type="button" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => onCopy(value, label)} className="ml-auto rounded p-1 text-[#5b6372] outline-none transition hover:text-[#0b1a33] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7a5f27]">
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// One business in full. It is fetched when the row is opened (never with the list) and shows only what the stored data supports;
// a section with nothing behind it is left out rather than filled in.
export default function LeadDossier({
  id,
  archived,
  onArchive,
  onRestore,
  onDelete,
  onCopy,
}: {
  id: string
  archived: boolean
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
  onCopy: (text: string, label: string) => void
}) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; lead: Dossier }>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetch(`/api/my-leads/${id}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (response.status === 404) return setState({ status: 'error', message: 'This business is no longer in your library.' })
        if (!response.ok || !data?.ok) throw new Error('unavailable')
        setState({ status: 'ready', lead: data.lead as Dossier })
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        setState({ status: 'error', message: "The business details couldn't be loaded." })
      })
    return () => controller.abort()
  }, [id, attempt])

  if (state.status === 'loading') return <p role="status" className={`px-1 py-6 text-sm ${MUTED}`}>Loading business details…</p>
  if (state.status === 'error') {
    return (
      <p role="alert" className={`px-1 py-6 text-sm ${MUTED}`}>
        {state.message}{' '}
        <button type="button" onClick={() => setAttempt((current) => current + 1)} className="text-[#7a5f27] underline underline-offset-4">Try again</button>
      </p>
    )
  }

  const { lead } = state
  const { intelligence, contact } = lead
  const card = intelligence.card
  const profile = intelligence.profile
  const reasonText = intelligence.reason ? REASON_TEXT[intelligence.reason] : null
  const hasOpportunities = Boolean(profile && (profile.core_services.length || profile.target_customer))

  return (
    <div className="grid gap-x-10 gap-y-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Section title="Business overview">
          {card ? <p className="max-w-prose text-sm leading-6 text-[#243049]">{card.summary}</p> : <p className={`text-sm ${MUTED}`}>{STATE_TEXT[intelligence.state] ?? 'No business profile is available.'}{reasonText ? ` ${reasonText}` : ''}</p>}
          <p className={`text-xs ${MUTED}`}>
            {[lead.industry ?? profile?.industry, profile?.business_category, lead.city].filter(Boolean).join(' · ') || 'Industry and location were not provided'}
            {lead.created_at ? ` · Saved ${relativeTime(lead.created_at)}` : ''}
          </p>
        </Section>

        <Section title="Business Intelligence">
          <p className="text-sm text-[#243049]">
            <span className="font-medium">{intelligence.label}</span>
            {intelligence.researched_at ? <span className={MUTED}> · generated {relativeTime(intelligence.researched_at)}</span> : null}
          </p>
          {profile?.keywords.length ? (
            <ul aria-label="Keywords" className="flex flex-wrap gap-1.5">
              {profile.keywords.map((keyword) => (
                <li key={keyword} className="rounded-full border border-[#d9d3c4] px-2.5 py-0.5 text-xs text-[#3b4455]">{keyword}</li>
              ))}
            </ul>
          ) : null}
          {card?.facts.pagesRead.length ? <p className={`text-xs ${MUTED}`}>Read: {card.facts.pagesRead.join(', ')}</p> : null}
          {card?.facts.sources.length ? (
            <p className={`text-xs ${MUTED}`}>
              Sources:{' '}
              {card.facts.sources.map((source, index) => (
                <span key={source.url}>
                  {index > 0 ? ' · ' : ''}
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[#0b1a33]">{source.label}</a>
                </span>
              ))}
            </p>
          ) : null}
          {card ? (
            <ul className={`space-y-0.5 text-xs ${MUTED}`}>
              {card.limitations.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          ) : null}
        </Section>

        {hasOpportunities && profile ? (
          <Section title="Commercial opportunities">
            {profile.core_services.length ? <p className="text-sm text-[#243049]"><span className={MUTED}>Offers </span>{profile.core_services.join(' · ')}</p> : null}
            {profile.target_customer ? <p className="text-sm text-[#243049]"><span className={MUTED}>Serves </span>{profile.target_customer}</p> : null}
            <p className={`text-xs ${MUTED}`}>From what the business&apos;s own website says.</p>
          </Section>
        ) : null}
      </div>

      <div className="space-y-6">
        <Section title="Contact information">
          <div className="space-y-1.5">
            {contact.name ? <p className="text-sm text-[#0b1a33]">{contact.name}</p> : null}
            {contact.email ? (
              <>
                <ContactLine icon={<Mail className="h-4 w-4" />} label="Email" value={contact.email} href={`mailto:${contact.email}`} onCopy={onCopy} />
                {contact.email_confidence === 'low' || contact.is_generic_email ? (
                  <p className={`pl-6 text-xs ${MUTED}`}>{contact.email_confidence === 'low' ? 'Lower-confidence address.' : 'Shared business inbox.'}</p>
                ) : null}
              </>
            ) : null}
            {contact.phone ? <ContactLine icon={<Phone className="h-4 w-4" />} label="Phone" value={contact.phone} href={`tel:${contact.phone}`} onCopy={onCopy} /> : null}
            {contact.website ? <ContactLine icon={<Globe className="h-4 w-4" />} label="Website" value={contact.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} href={contact.website} onCopy={onCopy} /> : null}
            {!contact.email && !contact.phone && !contact.website ? <p className={`text-sm ${MUTED}`}>No contact details were found for this business.</p> : null}
          </div>
        </Section>

        {card?.facts.signals.length ? (
          <Section title="Business signals">
            <ul className="space-y-0.5 text-sm text-[#243049]">
              {card.facts.signals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
            <p className={`text-xs ${MUTED}`}>Detected on the website by rules, not written by AI.</p>
          </Section>
        ) : null}

        <Section title="Notes and actions">
          {lead.notes ? <p className="whitespace-pre-wrap text-sm text-[#243049]">{lead.notes}</p> : <p className={`text-sm ${MUTED}`}>No notes yet.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {archived ? (
              <>
                <button type="button" onClick={onRestore} className={ACTION}>
                  <ArchiveRestore aria-hidden="true" className="h-3.5 w-3.5" /> Restore
                </button>
                <button type="button" onClick={onDelete} className={`${ACTION} text-rose-700 hover:border-rose-300`}>
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" /> Delete permanently
                </button>
              </>
            ) : (
              <button type="button" onClick={onArchive} className={ACTION}>
                <Archive aria-hidden="true" className="h-3.5 w-3.5" /> Archive
              </button>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}
