'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

import FeatureLockNotice from '@/components/access/FeatureLockNotice'
import FeatureLockModal from '@/components/modals/FeatureLockModal'
import { getEmailLimitFeedback } from '@/lib/email/send-limits'
import { canAccessFeature } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { getGuestLeads } from '@/lib/guest-session'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  contact_name: string | null
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
  sender_name: string | null
  sender_email: string | null
  company_name: string | null
  job_title: string | null
  phone: string | null
  website: string | null
  logo_url: string | null
}

type CurrentUserIdentity = {
  email: string
  name: string
}

type SenderProfile = {
  name?: string
  title?: string
  company?: string
  email?: string
  phone?: string
  website?: string
  logoUrl?: string
}

type ViewMode = 'details' | 'preview'
type SendFeedback = {
  tone: 'success' | 'warning' | 'error'
  title: string
  message: string
  subtext?: string
}

const FIXED_SENDER_LABEL = 'ALPA by MINDRA <info@mindrasolutions.com>'

function getCurrentUserName(user: { user_metadata?: Record<string, unknown> | null }) {
  const firstName =
    typeof user.user_metadata?.first_name === 'string' ? user.user_metadata.first_name.trim() : ''
  const lastName =
    typeof user.user_metadata?.last_name === 'string' ? user.user_metadata.last_name.trim() : ''
  const joinedName = [firstName, lastName].filter(Boolean).join(' ').trim()

  if (joinedName) return joinedName

  const fullName =
    typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : ''

  if (fullName) return fullName

  return typeof user.user_metadata?.name === 'string' ? user.user_metadata.name.trim() : ''
}

function renderTemplate(
  template: string,
  lead: { business?: string | null; name?: string | null; location?: string | null }
) {
  return template
    .replace(/{{business_name}}/g, lead.business || '')
    .replace(/{{contact_name}}/g, lead.name || '')
    .replace(/{{location}}/g, lead.location || '')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getTrimmed(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function getPublicLogoUrl(logoUrl: string | undefined) {
  if (!logoUrl || !logoUrl.startsWith('https://')) {
    return undefined
  }

  try {
    const url = new URL(logoUrl)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function getWebsiteUrl(website: string | undefined) {
  if (!website) return undefined

  const candidate = /^https?:\/\//i.test(website) ? website : `https://${website}`

  try {
    const url = new URL(candidate)
    return /^https?:$/i.test(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function formatTemplateContent(content: string) {
  const trimmed = content.trim()

  if (!trimmed) {
    return ''
  }

  return /<[^>]+>/.test(trimmed) ? trimmed : trimmed.replace(/\n/g, '<br/>')
}

function buildSenderProfile(
  currentUserIdentity: CurrentUserIdentity | null,
  senderSettings: SenderSettings | null
): SenderProfile | undefined {
  const profile: SenderProfile = {
    name: getTrimmed(senderSettings?.sender_name) || getTrimmed(currentUserIdentity?.name),
    title: getTrimmed(senderSettings?.job_title),
    company: getTrimmed(senderSettings?.company_name),
    email: getTrimmed(senderSettings?.sender_email) || getTrimmed(currentUserIdentity?.email),
    phone: getTrimmed(senderSettings?.phone),
    website: getTrimmed(senderSettings?.website),
    logoUrl: getTrimmed(senderSettings?.logo_url),
  }

  return Object.values(profile).some(Boolean) ? profile : undefined
}

function buildSignature(profile: SenderProfile | undefined) {
  if (!profile) return ''

  const name = profile.name ? escapeHtml(profile.name) : ''
  const title = profile.title ? escapeHtml(profile.title) : ''
  const company = profile.company ? escapeHtml(profile.company) : ''
  const email = profile.email ? escapeHtml(profile.email) : ''
  const logoUrl = getPublicLogoUrl(profile.logoUrl)

  if (!name && !title && !company && !email && !logoUrl) {
    return ''
  }

  return `
  <div style="margin-top:20px;">
    <strong>${name || ''}</strong><br/>
    ${title || ''}${title && company ? ' at ' : ''}${company || ''}<br/>
    ${email ? `<a href="mailto:${email}">${email}</a><br/>` : ''}
    ${
      logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" style="max-width:120px;margin-top:12px;display:block;" />`
        : ''
    }
  </div>
  `
}

function buildFinalHtml(html: string, senderProfile: SenderProfile | undefined) {
  const contentHtml = formatTemplateContent(html)
  const signature = buildSignature(senderProfile)

  return `
  <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;padding:20px;max-width:520px;">
${contentHtml}
<br/>
${signature}
<p style="margin-top:15px;font-size:11px;color:#888;">
Sent via ALPA
</p>
  </div>
  `
}

export default function Page() {
  const params = useParams()
  const leadId = params.id as string
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [lead, setLead] = useState<Lead | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [senderSettings, setSenderSettings] = useState<SenderSettings | null>(null)
  const [currentUserIdentity, setCurrentUserIdentity] = useState<CurrentUserIdentity | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupLoading, setSetupLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showFeatureLock, setShowFeatureLock] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('details')
  const [sendFeedback, setSendFeedback] = useState<SendFeedback | null>(null)
  const plan = profile?.plan || 'free'
  const isFree = plan === 'free'
  const emailLocked = !profileLoading && !canAccessFeature('email', profile)

  useEffect(() => {
    if (userLoading) return
    void fetchLead()
    void fetchEmailSetup()
  }, [leadId, user, userLoading])

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null
  const senderProfile = useMemo(
    () => buildSenderProfile(currentUserIdentity, senderSettings),
    [currentUserIdentity, senderSettings]
  )

  const previewHtml = useMemo(() => {
    if (!lead || !selectedTemplate) return ''

    const body = renderTemplate(selectedTemplate.body || '', {
      business: lead.company_name,
      name: lead.contact_name,
      location: lead.city,
    })

    return buildFinalHtml(body, senderProfile)
  }, [lead, selectedTemplate, senderProfile])

  async function fetchLead() {
    if (!user) {
      const guestLead = getGuestLeads().find((item) => item.id === leadId)
      if (guestLead) {
        setLead({
          id: guestLead.id,
          company_name: guestLead.company_name,
          contact_name: null,
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
      .select('id, company_name, contact_name, email, phone, website, industry, city, status')
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

    if (!user?.id) {
      setTemplates([])
      setSenderSettings(null)
      setCurrentUserIdentity(null)
      setSetupLoading(false)
      return
    }

    setCurrentUserIdentity({
      email: user.email?.trim().toLowerCase() || '',
      name: getCurrentUserName(user),
    })

    const templateRequest = supabase
      .from('templates')
      .select('id, name, tag, subject, body, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const senderSettingsRequest = supabase
      .from('sender_settings')
      .select('sender_name, sender_email, company_name, job_title, phone, website, logo_url')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const [
      { data: templateData, error: templateError },
      { data: senderSettingsData, error: senderSettingsError },
    ] = await Promise.all([templateRequest, senderSettingsRequest])

    if (templateError) {
      console.error('FULL ERROR:', JSON.stringify(templateError, null, 2))
    }

    if (senderSettingsError) {
      console.error('FULL ERROR:', JSON.stringify(senderSettingsError, null, 2))
    }

    const nextTemplates = (templateData as Template[]) || []
    setTemplates(nextTemplates)
    setSenderSettings((senderSettingsData as SenderSettings | null) || null)

    if (nextTemplates.length > 0) {
      setSelectedTemplateId(nextTemplates[0].id)
    }

    setSetupLoading(false)
  }

  async function sendEmail() {
    if (!lead || !selectedTemplate) return

    if (emailLocked) {
      setShowFeatureLock(true)
      return
    }

    if (!lead.email?.trim()) {
      setSendFeedback({
        tone: 'error',
        title: 'Email Address Missing',
        message: 'This lead does not have an email address yet.',
      })
      return
    }

    if (!currentUserIdentity?.email) {
      setSendFeedback({
        tone: 'error',
        title: 'Reply-To Email Missing',
        message: 'Add your account email before sending so replies can route back to your inbox.',
      })
      return
    }

    try {
      setSending(true)
      setSendFeedback(null)

      const to = lead.email.trim().toLowerCase()
      const subject = selectedTemplate.subject?.trim() || 'Quick question'
      const html = renderTemplate(selectedTemplate.body || '', {
        business: lead.company_name,
        name: lead.contact_name,
        location: lead.city,
      })

      console.log('📤 Sending email:', {
        to,
        subject,
        userEmail: currentUserIdentity.email,
      })

      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          html,
          userEmail: currentUserIdentity.email,
          userName: currentUserIdentity.name,
          senderProfile,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        console.error('Single lead email failed:', data?.error || 'Unknown error')
        if (data?.error === 'DAILY_LIMIT_REACHED') {
          const feedback = getEmailLimitFeedback(data.error)
          setSendFeedback({
            tone: 'warning',
            title: feedback.title,
            message: feedback.message,
            subtext: feedback.subtext,
          })
          return
        }

        setSendFeedback({
          tone: 'error',
          title: 'Email Sending Unavailable',
          message: data?.message || 'Email failed to send. Check configuration.',
        })
        return
      }

      setSendFeedback({
        tone: 'success',
        title: 'Email Sent',
        message: 'Your email was sent successfully and replies will route back to your inbox.',
      })
    } catch (error) {
      console.error('Single lead email failed:', error)
      setSendFeedback({
        tone: 'error',
        title: 'Email Sending Unavailable',
        message: 'Email failed to send. Check configuration.',
      })
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
          Loading your saved templates...
        </div>
      ) : emailLocked ? (
        <FeatureLockNotice
          title="Email sending is available on Starter"
          description="You can review this lead now. Upgrade when you want ALPA to handle templates and outreach from inside the workspace."
        />
      ) : templates.length === 0 ? (
        <div className="glass space-y-4 p-6 text-slate-300">
          <div>Save a template before sending.</div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/dashboard/templates"
              className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 font-medium text-emerald-100 transition hover:bg-emerald-400/16"
            >
              Open templates
            </Link>
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
                  <>
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Subject
                      </div>
                      <div className="mt-3 text-base font-medium text-white">
                        {selectedTemplate.subject?.trim() || 'Quick question'}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Sending identity
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-slate-300">
                        <div>{FIXED_SENDER_LABEL}</div>
                        <div>{currentUserIdentity?.email || 'No reply-to email found'}</div>
                        <div>{currentUserIdentity?.name || 'No account name found'}</div>
                      </div>
                      <div className="mt-4 rounded-2xl border border-emerald-300/14 bg-emerald-400/8 px-3 py-3 text-sm text-emerald-50">
                        Emails are sent via ALPA. Replies go directly to your inbox.
                      </div>
                    </div>
                  </>
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

            {sendFeedback ? (
              <div
                className={`mt-6 rounded-[24px] border px-4 py-4 text-sm ${
                  sendFeedback.tone === 'success'
                    ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-50'
                    : sendFeedback.tone === 'warning'
                      ? 'border-amber-300/20 bg-amber-400/10 text-amber-50'
                      : 'border-rose-300/20 bg-rose-400/10 text-rose-50'
                }`}
              >
                <div className="font-medium">{sendFeedback.title}</div>
                <div className="mt-1 leading-6">{sendFeedback.message}</div>
                {sendFeedback.subtext ? (
                  <div className="mt-2 text-xs text-current/80">{sendFeedback.subtext}</div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 xl:hidden">
              <div className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm text-slate-300">
                  <div>Ready to send this template to {lead.company_name}.</div>
                  <div className="text-xs text-slate-500">
                    Emails are sent via ALPA. Replies go directly to your inbox.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={sendEmail}
                  disabled={sending || emailLocked || !selectedTemplateId || !lead.email}
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
                  disabled={sending || emailLocked || !selectedTemplateId || !lead.email}
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
