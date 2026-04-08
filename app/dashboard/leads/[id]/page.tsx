'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

import FeatureLockNotice from '@/components/access/FeatureLockNotice'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import { canAccessFeature } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { buildFinalEmailHtml } from '@/lib/email/signature'
import { getGuestLeads } from '@/lib/guest-session'
import { isIgnorableEmptyResultError } from '@/lib/supabase/errors'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  email: string | null
  phone: string | null
  website: string | null
  industry: string | null
  city: string | null
  status: string
}

type Template = {
  id: string
  name: string
  tag: string | null
  subject: string | null
  body: string | null
  created_at: string
}

type SenderSettings = {
  id: string
  sender_name: string | null
  sender_email: string | null
  company_name: string | null
  job_title: string | null
  phone: string | null
  website: string | null
  logo_url: string | null
}

type ViewMode = 'details' | 'preview'

export default function Page() {
  const params = useParams()
  const leadId = params.id as string
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [lead, setLead] = useState<Lead | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [senderSettings, setSenderSettings] = useState<SenderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupLoading, setSetupLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showFeatureLock, setShowFeatureLock] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('details')
  const plan = profile?.plan || 'free'
  const isFree = plan === 'free'
  const emailLocked = !profileLoading && !canAccessFeature('email', profile)

  useEffect(() => {
    void fetchLead()
    void fetchEmailSetup()
  }, [leadId])

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null

  const previewHtml = useMemo(() => {
    if (!selectedTemplate || !senderSettings) return ''
    return buildFinalEmailHtml(selectedTemplate.body, senderSettings)
  }, [selectedTemplate, senderSettings])

  async function fetchLead() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const guestLead = getGuestLeads().find((item) => item.id === leadId)
      if (guestLead) {
        setLead({
          id: guestLead.id,
          company_name: guestLead.company_name,
          email: guestLead.email,
          phone: guestLead.phone,
          website: guestLead.website,
          industry: guestLead.industry,
          city: guestLead.city,
          status: guestLead.status,
        })
      }
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('leads')
      .select('id, company_name, email, phone, website, industry, city, status')
      .eq('id', leadId)
      .eq('user_id', user.id)
      .single()

    if (!error && data) {
      setLead(data)
    } else if (error) {
      console.error('Lead fetch failed:', error)
    }

    setLoading(false)
  }

  async function fetchEmailSetup() {
    setSetupLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      setTemplates([])
      setSenderSettings(null)
      setSetupLoading(false)
      return
    }

    const [{ data: templateData, error: templateError }, { data: senderData, error: senderError }] =
      await Promise.all([
        supabase
          .from('templates')
          .select('id, name, tag, subject, body, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('sender_settings')
          .select('id, sender_name, sender_email, company_name, job_title, phone, website, logo_url')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

    if (templateError) {
      console.error('FULL ERROR:', JSON.stringify(templateError, null, 2))
    }

    if (senderError && !isIgnorableEmptyResultError(senderError)) {
      console.error('FULL ERROR:', JSON.stringify(senderError, null, 2))
    }

    const nextTemplates = (templateData as Template[]) || []
    setTemplates(nextTemplates)
    setSenderSettings((senderData as SenderSettings | null) ?? null)

    if (nextTemplates.length > 0) {
      setSelectedTemplateId(nextTemplates[0].id)
    }

    setSetupLoading(false)
  }

  async function sendEmail() {
    if (!lead || !selectedTemplateId || !senderSettings) return

    if (emailLocked) {
      setShowFeatureLock(true)
      return
    }

    try {
      setSending(true)

      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: [lead.id],
          templateId: selectedTemplateId,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        alert('Failed to send email: ' + (data?.error || 'Unknown error'))
        return
      }

      alert('Email sent successfully')
    } catch (error) {
      console.error('Single lead email failed:', error)
      alert('Error sending email')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <div className="text-slate-400">Loading lead...</div>
  }

  if (profileLoading) {
    return <div className="text-slate-400">Loading email composer...</div>
  }

  if (!lead) {
    return <div className="text-red-400">Lead not found.</div>
  }

  return (
    <div className="space-y-6 pb-4">
      <header className="glass p-5 sm:p-6">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100/70">
            Lead composer
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Email Composer
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            Choose a saved template, review the final email, and send it from the same mobile-first composer.
          </p>
        </div>

        <div className="mt-5 rounded-[28px] border border-white/8 bg-white/[0.04] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="text-lg font-semibold text-white">{lead.company_name}</div>
              <div className="text-sm text-slate-400">
                {[lead.industry, lead.city].filter(Boolean).join(' • ') || 'Lead details'}
              </div>
              <div className="space-y-1 text-sm text-slate-300">
                <div>{lead.email || 'No email found'}</div>
                <div>{lead.phone || 'No phone found'}</div>
                {lead.website ? (
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-emerald-200 transition hover:text-white"
                  >
                    {lead.website}
                  </a>
                ) : null}
              </div>
            </div>

            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
              {lead.status}
            </div>
          </div>
        </div>
      </header>

      {setupLoading ? (
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-slate-400">
          Loading your saved templates and sender settings...
        </div>
      ) : emailLocked ? (
        <FeatureLockNotice
          title="Email sending is available on Starter"
          description="You can review this lead now. Upgrade when you want ALPA to handle templates, sender settings, and outreach from inside the workspace."
        />
      ) : templates.length === 0 || !senderSettings ? (
        <div className="glass space-y-4 p-6 text-slate-300">
          <div>
            {templates.length === 0 && !senderSettings
              ? 'Save templates and sender settings before sending.'
              : templates.length === 0
                ? 'Save a template before sending.'
                : 'Save sender settings before sending.'}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {templates.length === 0 ? (
              <Link
                href="/dashboard/templates"
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 font-medium text-emerald-100 transition hover:bg-emerald-400/16"
              >
                Open templates
              </Link>
            ) : null}

            {!senderSettings ? (
              <Link
                href="/dashboard/settings"
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-emerald-300/18 bg-emerald-400/10 px-4 font-medium text-emerald-100 transition hover:bg-emerald-400/16"
              >
                Open sender settings
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.95fr)]">
          <section className="glass p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Compose</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Switch between setup details and preview without leaving the page.
                </p>
              </div>

              <div className="inline-flex rounded-2xl border border-white/10 bg-[#081120]/80 p-1">
                {(['details', 'preview'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`min-h-[40px] rounded-xl px-4 text-sm font-medium transition ${
                      viewMode === mode
                        ? 'bg-emerald-400/12 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'details' ? 'Details' : 'Preview'}
                  </button>
                ))}
              </div>
            </div>

            {viewMode === 'details' ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Template
                  </div>
                  <select
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                    className="input mt-3"
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                        {template.tag ? ` • ${template.tag}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedTemplate ? (
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Subject
                    </div>
                    <div className="mt-3 text-base font-medium text-white">{selectedTemplate.subject}</div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-6 rounded-[28px] border border-white/8 bg-[#081120]/80 p-4">
                <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Final preview
                </div>
                <div
                  className="rounded-[24px] bg-white p-5 text-sm leading-7 text-slate-800 shadow-[0_24px_48px_rgba(15,23,42,0.2)]"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            )}

            <div className="mt-6 sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 xl:hidden">
              <div className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm text-slate-300">
                  <div>Ready to send this template to {lead.company_name}.</div>
                  <div className="text-xs text-slate-500">Emails are sent via ALPA. Replies go directly to your inbox.</div>
                </div>
                <button
                  type="button"
                  onClick={sendEmail}
                  disabled={sending || emailLocked || !selectedTemplateId || !senderSettings}
                  className="btn-primary w-full sm:w-auto"
                >
                  {emailLocked ? 'Email sending locked' : sending ? 'Sending...' : 'Send email'}
                </button>
              </div>
            </div>
          </section>

          <aside className="hidden xl:block">
            <div className="glass sticky top-6 p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Send action
              </div>
              <div className="space-y-3">
                <p className="text-sm text-slate-300">
                  Review the selected template and send it directly to {lead.company_name}.
                </p>
                <p className="text-xs text-slate-500">
                  Emails are sent via ALPA. Replies go directly to your inbox.
                </p>
                <button
                  type="button"
                  onClick={sendEmail}
                  disabled={sending || emailLocked || !selectedTemplateId || !senderSettings}
                  className="btn-primary w-full"
                >
                  {emailLocked ? 'Email sending locked' : sending ? 'Sending...' : 'Send email'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      <FeatureLockModal
        isOpen={showFeatureLock}
        onClose={() => setShowFeatureLock(false)}
        title="Email Sending"
        description="Reviewing lead details stays available on free access, but sending outreach from inside ALPA unlocks on Starter."
        benefit="Templates and built-in sending help you turn a good lead into a live conversation much faster."
        showUpgradeCta={isFree}
      />
    </div>
  )
}
