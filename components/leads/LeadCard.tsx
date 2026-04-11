'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Columns3, ExternalLink, Globe, Mail, Phone } from 'lucide-react'

import { cn } from '@/lib/utils'

type LeadCardContext = 'prospector' | 'library' | 'pipeline' | 'inbox'

type LeadCardProps = {
  id: string
  name: string
  location?: string
  email?: string | null
  phone?: string | null
  inPipeline?: boolean
  contacted?: boolean
  isNew?: boolean
  context?: LeadCardContext
  onView?: () => void
  onAddToPipeline?: () => void
  onContact?: () => void
  sourceUrl?: string | null
  sourceLabel?: string | null
  selected?: boolean
  onToggleSelect?: () => void
  expandedFooter?: ReactNode
  className?: string
}

function normalizeUrl(url: string | null | undefined) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return null

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }

  return `https://${trimmed}`
}

function getSourceHost(url: string | null | undefined) {
  const normalized = normalizeUrl(url)
  if (!normalized) return null

  try {
    return new URL(normalized).hostname.replace(/^www\./, '')
  } catch {
    return normalized.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null
  }
}

function StatusPill({
  children,
}: {
  children: ReactNode
}) {
  return (
    <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80">
      {children}
    </span>
  )
}

function ActionButton({
  label,
  disabled = false,
  active = false,
  href,
  openInNewTab = false,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  active?: boolean
  href?: string
  openInNewTab?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const className = cn(
    'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150',
    disabled
      ? 'cursor-not-allowed text-white/80 opacity-40'
      : active
        ? 'bg-blue-500/12 text-blue-200 shadow-[0_0_16px_rgba(59,130,246,0.14)] hover:text-blue-100'
        : 'text-white/80 hover:bg-blue-500/10 hover:text-blue-300'
  )

  if (href && !disabled) {
    return (
      <a
        href={href}
        aria-label={label}
        title={label}
        className={className}
        target={openInNewTab ? '_blank' : undefined}
        rel={openInNewTab ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={className}
    >
      {children}
    </button>
  )
}

export default function LeadCard({
  id,
  name,
  location,
  email,
  phone,
  inPipeline = false,
  contacted = false,
  isNew = false,
  context = 'inbox',
  onView,
  onAddToPipeline,
  onContact,
  sourceUrl,
  sourceLabel,
  selected = false,
  onToggleSelect,
  expandedFooter,
  className,
}: LeadCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const statusPill = useMemo(() => {
    if (contacted) {
      return { label: 'Contacted' }
    }

    if (inPipeline) {
      return { label: 'In pipeline' }
    }

    if (isNew) {
      return { label: 'New' }
    }

    return null
  }, [contacted, inPipeline, isNew])

  const mailHref = email ? `mailto:${email}` : undefined
  const phoneHref = phone ? `tel:${phone}` : undefined
  const normalizedSourceUrl = normalizeUrl(sourceUrl)
  const sourceHost = sourceLabel || getSourceHost(sourceUrl)
  const pipelineLabel =
    context === 'pipeline'
      ? 'Update pipeline stage'
      : inPipeline
        ? 'Update pipeline'
        : 'Add to pipeline'

  return (
    <article
      data-lead-id={id}
      className={cn(
        'rounded-xl border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,29,0.96),rgba(8,14,28,0.92))] p-4 shadow-[0_12px_40px_rgba(2,8,23,0.26)] backdrop-blur-sm transition',
        selected && 'border-blue-400/28 bg-[linear-gradient(180deg,rgba(12,24,44,0.98),rgba(8,14,28,0.94))] shadow-[0_0_0_1px_rgba(59,130,246,0.14)]',
        className
      )}
    >
      <div className="flex items-start gap-3">
        {onToggleSelect ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-blue-400"
            aria-label={`Select ${name}`}
          />
        ) : null}

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {onView ? (
                <button type="button" onClick={onView} className="max-w-full text-left transition hover:text-blue-200">
                  <h3 className="truncate text-base font-semibold text-white">{name}</h3>
                </button>
              ) : (
                <h3 className="truncate text-base font-semibold text-white">{name}</h3>
              )}
              {location ? (
                <p className="mt-1 truncate text-sm text-white/60">{location}</p>
              ) : null}
            </div>

            {statusPill ? (
              <div className="flex shrink-0 justify-end">
                <StatusPill>{statusPill.label}</StatusPill>
              </div>
            ) : null}
          </div>

          <div>
            <div className="flex w-fit items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] p-2">
              <ActionButton
                label={email ? 'Contact lead' : 'Email unavailable'}
                disabled={!email}
                active={Boolean(email) && Boolean(onContact)}
                href={!onContact ? mailHref : undefined}
                onClick={onContact}
              >
                <Mail className="h-4 w-4" />
              </ActionButton>

              <ActionButton
                label={phone ? 'Call lead' : 'Phone unavailable'}
                disabled={!phone}
                href={phoneHref}
              >
                <Phone className="h-4 w-4" />
              </ActionButton>

              <ActionButton
                label={normalizedSourceUrl ? 'Open website' : 'Website unavailable'}
                disabled={!normalizedSourceUrl}
                href={normalizedSourceUrl || undefined}
                openInNewTab
              >
                <Globe className="h-4 w-4" />
              </ActionButton>

              <ActionButton
                label={pipelineLabel}
                disabled={!onAddToPipeline}
                active={inPipeline}
                onClick={onAddToPipeline}
              >
                <Columns3 className="h-4 w-4" />
              </ActionButton>

              <ActionButton
                label={detailsOpen ? 'Hide details' : 'Show details'}
                active={detailsOpen}
                onClick={() => setDetailsOpen((current) => !current)}
              >
                {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </ActionButton>
            </div>
          </div>

          {detailsOpen ? (
            <div className="border-t border-white/8 pt-3">
              <div className="space-y-2.5 bg-white/[0.05] px-3 py-3">
              {email ? (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500/90">
                    Email
                  </div>
                  <div className="mt-1 break-all text-sm text-slate-200">{email}</div>
                </div>
              ) : null}

              {phone ? (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500/90">
                    Phone
                  </div>
                  <div className="mt-1 text-sm text-slate-200">{phone}</div>
                </div>
              ) : null}

              {normalizedSourceUrl && sourceHost ? (
                <a
                  href={normalizedSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-200 transition hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span>{sourceHost}</span>
                </a>
              ) : null}

              {expandedFooter ? <div className="pt-1">{expandedFooter}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
