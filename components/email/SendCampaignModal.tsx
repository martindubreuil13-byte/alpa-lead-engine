'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { canAccessFeature } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { supabase } from '@/lib/supabase'

type Template = {
  id: string
  name: string
  tag: string | null
  subject: string | null
  body: string | null
  created_at: string
}

type Lead = {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  city: string | null
}

type CurrentUserIdentity = {
  email: string
  name: string
}

type ViewMode = 'details' | 'preview'

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

function withFooter(html: string, userName: string) {
  return `${html}
<p style="margin-top:20px;font-size:12px;color:#666;">
Sent via ALPA<br/>
on behalf of ${escapeHtml(userName)}
</p>`
}

export default function SendCampaignModal({
  isOpen,
  onClose,
  selectedIds,
  onSent,
}: {
  isOpen: boolean
  onClose: () => void
  selectedIds: string[]
  onSent: (sentIds: string[]) => void
}) {
  const router = useRouter()
  const { profile, loading: profileLoading } = useClientUserProfile()
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedLeads, setSelectedLeads] = useState<Lead[]>([])
  const [currentUserIdentity, setCurrentUserIdentity] = useState<CurrentUserIdentity | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [testLoading, setTestLoading] = useState(false)
  const [templateMessage, setTemplateMessage] = useState('')
  const [testStatusMessage, setTestStatusMessage] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('details')

  useEffect(() => {
    if (isOpen) {
      void fetchEmailSetup()
      setViewMode('details')
    }
  }, [isOpen, selectedIds])

  useEffect(() => {
    if (!templates || templates.length === 0) {
      setSelectedTemplateId(null)
      return
    }

    const hasCurrentSelection = templates.some((template) => template.id === selectedTemplateId)

    if (!hasCurrentSelection) {
      setSelectedTemplateId(templates[0].id)
    }
  }, [templates, selectedTemplateId])

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null
  const previewLead = selectedLeads[0] || null
  const emailLocked = !profileLoading && !canAccessFeature('email', profile)

  const previewContent = useMemo(() => {
    const subject = selectedTemplate?.subject?.trim() || 'Quick question'
    const replyTo = currentUserIdentity?.email || 'No reply-to email'
    const renderedBody = previewLead
      ? renderTemplate(selectedTemplate?.body || '', {
          business: previewLead.company_name,
          name: previewLead.contact_name,
          location: previewLead.city,
        })
      : ''
    const emailHtml = renderedBody
      ? withFooter(renderedBody, currentUserIdentity?.name || 'Your name')
      : ''

    return {
      subject,
      from: FIXED_SENDER_LABEL,
      replyTo,
      emailHtml,
      hasContent: Boolean(emailHtml),
    }
  }, [currentUserIdentity?.email, currentUserIdentity?.name, previewLead, selectedTemplate])

  async function fetchEmailSetup() {
    setLoadingPreview(true)
    setTemplateMessage('')
    setTestStatusMessage('')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      setTemplates([])
      setSelectedLeads([])
      setCurrentUserIdentity(null)
      setTemplateMessage('Please log in to load your email setup.')
      setLoadingPreview(false)
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

    const leadsRequest =
      selectedIds.length === 0
        ? Promise.resolve({ data: [] as Lead[], error: null })
        : supabase
            .from('leads')
            .select('id, company_name, contact_name, email, city')
            .eq('user_id', user.id)
            .in('id', selectedIds)

    const [{ data: templateData, error: templateError }, { data: leadData, error: leadError }] =
      await Promise.all([templateRequest, leadsRequest])

    if (templateError) {
      console.error('FULL ERROR:', JSON.stringify(templateError, null, 2))
    }

    if (leadError) {
      console.error('FULL ERROR:', JSON.stringify(leadError, null, 2))
    }

    const nextTemplates = (templateData as Template[]) || []
    const nextLeads = ((leadData as Lead[]) || []).sort(
      (left, right) => selectedIds.indexOf(left.id) - selectedIds.indexOf(right.id)
    )

    setTemplates(nextTemplates)
    setSelectedLeads(nextLeads)

    if (nextTemplates.length === 0) {
      setTemplateMessage('No saved templates found. Create one before sending.')
    } else if (nextLeads.length === 0) {
      setTemplateMessage('No selected leads were found.')
    }

    setLoadingPreview(false)
  }

  async function sendLeadEmail(lead: Lead, template: Template, currentUser: CurrentUserIdentity) {
    const to = lead.email?.trim().toLowerCase()

    if (!to) {
      return { ok: false as const, skipped: true as const }
    }

    const subject = template.subject?.trim() || 'Quick question'
    const html = renderTemplate(template.body || '', {
      business: lead.company_name,
      name: lead.contact_name,
      location: lead.city,
    })

    console.log('📤 Sending email:', {
      to,
      subject,
      userEmail: currentUser.email,
    })

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        subject,
        html,
        userEmail: currentUser.email,
        userName: currentUser.name,
      }),
    })

    const result = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        ok: false as const,
        skipped: false as const,
        error: result?.error || 'Failed to send email',
      }
    }

    return { ok: true as const, skipped: false as const }
  }

  async function sendCampaign() {
    if (selectedIds.length === 0 || !selectedTemplate) return

    if (!currentUserIdentity?.email || !currentUserIdentity.name) {
      alert('Your account email or name is missing. Please update your account before sending.')
      return
    }

    setLoading(true)
    setTestStatusMessage('')

    let sentCount = 0
    let skippedCount = 0
    const sentLeadIds: string[] = []
    const failed: string[] = []

    try {
      for (const lead of selectedLeads) {
        const result = await sendLeadEmail(lead, selectedTemplate, currentUserIdentity)

        if (result.ok) {
          sentCount += 1
          sentLeadIds.push(lead.id)
          continue
        }

        if (result.skipped) {
          skippedCount += 1
          continue
        }

        console.error('Campaign email failed:', result.error, {
          leadId: lead.id,
          to: lead.email,
        })
        failed.push(lead.company_name || lead.email || lead.id)
      }

      if (sentLeadIds.length > 0) {
        onSent(sentLeadIds)
      }

      if (failed.length > 0) {
        alert(
          `Sent ${sentCount} email(s). Skipped ${skippedCount}. Failed ${failed.length}.`
        )
        return
      }

      alert(`Sent ${sentCount} email(s). Skipped ${skippedCount}.`)

      if (sentLeadIds.length > 0) {
        onClose()
      }
    } catch (error) {
      console.error('Campaign email failed:', error)
      alert('Error sending emails')
    } finally {
      setLoading(false)
    }
  }

  async function sendTestEmail() {
    if (!selectedTemplate) {
      setTestStatusMessage('Please select a template first')
      return
    }

    if (!currentUserIdentity?.email || !currentUserIdentity.name) {
      setTestStatusMessage('Your account email or name is missing')
      return
    }

    setTestLoading(true)
    setTestStatusMessage('')

    try {
      const lead = previewLead || {
        id: 'preview',
        company_name: '',
        contact_name: '',
        email: currentUserIdentity.email,
        city: '',
      }

      const result = await sendLeadEmail(
        {
          ...lead,
          email: currentUserIdentity.email,
        },
        selectedTemplate,
        currentUserIdentity
      )

      if (!result.ok && !result.skipped) {
        console.error('Test email failed:', result.error)
        setTestStatusMessage(result.error || 'Failed to send test email')
        return
      }

      setTestStatusMessage('Test email sent')
    } catch (error) {
      console.error('Test email failed:', error)
      setTestStatusMessage('Failed to send test email')
    } finally {
      setTestLoading(false)
    }
  }

  if (!isOpen) return null

  if (emailLocked) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
        <div className="glass w-full rounded-t-[32px] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-xl sm:rounded-[32px] sm:p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">
            Available on Starter plan
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-white">Email sending is locked on Free</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Upgrade to Starter to open templates, send test emails, and launch outreach directly from ALPA.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/plans"
              onClick={onClose}
              className="btn-primary"
            >
              Upgrade
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.08]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="glass flex h-[min(92vh,860px)] w-full flex-col rounded-t-[32px] sm:max-w-3xl sm:rounded-[32px]">
        <div className="border-b border-white/8 px-5 pb-4 pt-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">Send Campaign</h2>
              <p className="mt-1 text-sm text-slate-400">
                {selectedIds.length} lead{selectedIds.length === 1 ? '' : 's'} selected
              </p>
              {testStatusMessage ? (
                <p className="mt-2 text-sm text-slate-300">{testStatusMessage}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:items-end">
              <button
                type="button"
                onClick={sendTestEmail}
                disabled={testLoading || loadingPreview || loading || !selectedTemplateId}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-2xl px-4 text-sm font-medium transition ${
                  testLoading || loadingPreview || loading || !selectedTemplateId
                    ? 'cursor-not-allowed border border-white/10 bg-white/5 text-slate-500'
                    : 'border border-emerald-300/18 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/16'
                }`}
              >
                {testLoading ? 'Sending test...' : 'Send test email'}
              </button>

              <div className="inline-flex rounded-2xl border border-white/10 bg-[#081120]/80 p-1">
                {(['details', 'preview'] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`min-h-[38px] rounded-xl px-4 text-sm font-medium transition ${
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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {loadingPreview ? (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
              Loading your saved templates and selected leads...
            </div>
          ) : templates.length > 0 ? (
            <div className="space-y-4">
              {viewMode === 'details' ? (
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Template
                    </div>
                    <select
                      value={selectedTemplateId || ''}
                      onChange={(event) => setSelectedTemplateId(event.target.value)}
                      className="input mt-3"
                    >
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name || 'Untitled'}
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

                      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          Recipients
                        </div>
                        <div className="mt-3 text-sm text-slate-300">
                          {selectedLeads.length} lead{selectedLeads.length === 1 ? '' : 's'} loaded
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Leads without email addresses are skipped automatically.
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4 bg-[#020617] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Preview
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#081120] p-4">
                    <div className="space-y-1 text-sm text-slate-300">
                      <div>
                        <span className="text-slate-500">From:</span>{' '}
                        <span className="text-white">{previewContent.from}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Reply-To:</span>{' '}
                        <span className="text-white">{previewContent.replyTo}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Subject:</span>{' '}
                        <span className="text-white">{previewContent.subject}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white p-4 text-black shadow-md">
                    {previewContent.hasContent ? (
                      <div
                        className="prose max-w-none text-black"
                        dangerouslySetInnerHTML={{ __html: previewContent.emailHtml }}
                      />
                    ) : (
                      <div className="text-sm text-slate-500">Preview unavailable</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
              <div>{templateMessage}</div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    router.push('/dashboard/templates')
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 font-medium text-emerald-100 transition hover:bg-emerald-400/16"
                >
                  Open templates
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/8 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-300 transition hover:bg-white/[0.08]"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={!selectedTemplateId || loading || selectedLeads.length === 0}
              onClick={sendCampaign}
              className={`inline-flex min-h-[48px] items-center justify-center rounded-2xl px-5 text-sm font-semibold transition ${
                !selectedTemplateId || loading || selectedLeads.length === 0
                  ? 'cursor-not-allowed bg-blue-950/40 text-slate-400'
                  : 'btn-primary'
              }`}
            >
              {loading ? 'Sending...' : 'Send emails'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
