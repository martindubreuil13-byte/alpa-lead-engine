'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { canAccessFeature } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { buildFinalEmailHtml } from '@/lib/email/signature'
import { supabase } from '@/lib/supabase'

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
  const [senderSettings, setSenderSettings] = useState<SenderSettings | null>(null)
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
  }, [isOpen])

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
  const emailLocked = !profileLoading && !canAccessFeature('email', profile)

  const previewHtml = useMemo(() => {
    if (!selectedTemplate || !senderSettings) return ''
    return buildFinalEmailHtml(selectedTemplate.body, senderSettings)
  }, [selectedTemplate, senderSettings])

  async function fetchEmailSetup() {
    setLoadingPreview(true)
    setTemplateMessage('')
    setTestStatusMessage('')

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      setTemplates([])
      setSenderSettings(null)
      setTemplateMessage('Please log in to load your email setup.')
      setLoadingPreview(false)
      return
    }

    const [{ data: templateData, error: templateError }, { data: senderData, error: senderError }] =
      await Promise.all([
        supabase
          .from('templates')
          .select('*')
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

    if (senderError) {
      console.error('FULL ERROR:', JSON.stringify(senderError, null, 2))
    }

    const nextTemplates = (templateData as Template[]) || []
    setTemplates(nextTemplates)
    setSenderSettings((senderData as SenderSettings | null) || null)

    if (nextTemplates.length === 0) {
      setTemplateMessage('No saved templates found. Create one before sending.')
    } else if (!senderData) {
      setTemplateMessage('No sender settings found. Save your sender identity before sending.')
    }

    setLoadingPreview(false)
  }

  async function sendCampaign() {
    if (selectedIds.length === 0 || !selectedTemplateId || !senderSettings) return
    setLoading(true)
    setTestStatusMessage('')

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadIds: selectedIds,
        templateId: selectedTemplateId,
      }),
    })

    const result = await response.json().catch(() => null)
    setLoading(false)

    if (response.ok) {
      onSent(result?.sentIds || [])
      alert(
        `Sent ${result?.sent || 0} email(s). ` +
          `Skipped ${result?.skipped || 0}. ` +
          `Failed ${result?.failed?.length || 0}.`
      )
      onClose()
    } else {
      alert(result?.error || 'Failed to send emails')
    }
  }

  async function sendTestEmail() {
    if (!selectedTemplateId) {
      setTestStatusMessage('Please select a template first')
      return
    }

    setTestLoading(true)
    setTestStatusMessage('')

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.email) {
      setTestLoading(false)
      setTestStatusMessage('Unable to resolve your account email')
      return
    }

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: selectedTemplateId,
        testMode: true,
        testEmail: user.email,
      }),
    })

    const result = await response.json().catch(() => null)
    setTestLoading(false)

    if (response.ok) {
      setTestStatusMessage('Test email sent')
    } else {
      setTestStatusMessage(result?.error || 'Failed to send test email')
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
                disabled={testLoading || loadingPreview || loading}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-2xl px-4 text-sm font-medium transition ${
                  testLoading || loadingPreview || loading
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
              Loading your saved templates and sender settings...
            </div>
          ) : templates.length > 0 && senderSettings ? (
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
                          {selectedTemplate.subject}
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          Sender profile
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-slate-300">
                          <div>{senderSettings.sender_name || 'Unnamed sender'}</div>
                          <div>{senderSettings.sender_email || 'No sender email saved'}</div>
                          <div>{senderSettings.company_name || 'No company name saved'}</div>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-[28px] border border-white/8 bg-[#081120]/80 p-4">
                  <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Mobile preview
                  </div>
                  <div
                    className="rounded-[24px] bg-white p-5 text-sm leading-7 text-slate-800 shadow-[0_24px_48px_rgba(15,23,42,0.2)]"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
              <div>{templateMessage}</div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                {templates.length === 0 ? (
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
                ) : null}

                {!senderSettings ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      router.push('/dashboard/settings')
                    }}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-emerald-300/18 bg-emerald-400/10 px-4 font-medium text-emerald-100 transition hover:bg-emerald-400/16"
                  >
                    Open sender settings
                  </button>
                ) : null}
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
              disabled={!selectedTemplateId || !senderSettings || loading}
              onClick={sendCampaign}
              className={`inline-flex min-h-[48px] items-center justify-center rounded-2xl px-5 text-sm font-semibold transition ${
                !selectedTemplateId || !senderSettings || loading
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
