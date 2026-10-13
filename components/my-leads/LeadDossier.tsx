'use client'

import { useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'

import { memberDossierModel } from '@/lib/my-leads/dossier-model'
import type { LeadDossier as Dossier } from '@/lib/my-leads/list'
import { relativeTime } from '@/lib/my-leads/ui-state'

import DossierView, { MUTED, Section } from './DossierView'

const ACTION =
  'inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#d9d3c4] px-3 text-xs font-medium text-[#0b1a33] outline-none transition hover:border-[#b89a5a] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a5f27]'

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
  const { intelligence } = lead
  const card = intelligence.card
  const profile = intelligence.profile

  return (
    <DossierView model={memberDossierModel(lead)} onCopy={onCopy}>
      <div className="grid gap-x-10 gap-y-6 border-t border-[#d9d3c4]/70 pt-6 md:grid-cols-2">
        <div className="space-y-6">
          <Section title="Business Intelligence">
            <p className="text-sm text-[#243049]">
              <span className="font-medium">{intelligence.label}</span>
              {intelligence.researched_at ? <span className={MUTED}> · generated {relativeTime(intelligence.researched_at)}</span> : null}
              {lead.created_at ? <span className={MUTED}> · Saved {relativeTime(lead.created_at)}</span> : null}
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
        </div>

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
    </DossierView>
  )
}
