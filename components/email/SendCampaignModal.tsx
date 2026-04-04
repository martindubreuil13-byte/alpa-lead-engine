'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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

  useEffect(() => {
    if (isOpen) fetchEmailSetup()
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

  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) || null
  const emailLocked = !profileLoading && !canAccessFeature('email', profile)

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

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadIds: selectedIds,
        templateId: selectedTemplateId,
      }),
    })

    const result = await res.json().catch(() => null)
    setLoading(false)

    if (res.ok) {
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

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: selectedTemplateId,
        testMode: true,
        testEmail: user.email,
      }),
    })

    const result = await res.json().catch(() => null)
    setTestLoading(false)

    if (res.ok) {
      setTestStatusMessage('Test email sent')
    } else {
      setTestStatusMessage(result?.error || 'Failed to send test email')
    }
  }

  if (!isOpen) return null

  if (emailLocked) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="glass w-full max-w-xl space-y-5 p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
            Available on Starter plan
          </div>
          <h2 className="text-2xl font-semibold text-white">Email sending is locked on Free</h2>
          <p className="text-sm leading-6 text-slate-300">
            Upgrade to Starter to open templates, send test emails, and launch outreach directly from ALPA.
          </p>
          <div className="flex gap-3">
            <Link
              href="/plans"
              onClick={onClose}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-sky-300/30 bg-[linear-gradient(to_right,#3B82F6,#06B6D4)] px-5 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:brightness-110"
            >
              Upgrade
            </Link>
            <button
              onClick={onClose}
              className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/20"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  const previewHtml =
    selectedTemplate && senderSettings
      ? buildFinalEmailHtml(selectedTemplate.body, senderSettings)
      : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass w-full max-w-2xl space-y-6 p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              Send Campaign
            </h2>
            {testStatusMessage && (
              <p className="mt-2 text-sm text-slate-300">{testStatusMessage}</p>
            )}
          </div>

          <button
            onClick={sendTestEmail}
            disabled={testLoading || loadingPreview || loading}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              testLoading || loadingPreview || loading
                ? 'cursor-not-allowed bg-white/10 text-slate-500'
                : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
            }`}
          >
            {testLoading ? 'Sending Test...' : 'Send Test Email'}
          </button>
        </div>

        <div className="text-sm text-slate-400">
          {selectedIds.length} lead{selectedIds.length > 1 && 's'} selected
        </div>

        {loadingPreview ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
            Loading your saved templates and sender settings...
          </div>
        ) : templates.length > 0 && senderSettings ? (
          <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Template
              </div>
              <select
                value={selectedTemplateId || ''}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="input"
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name || 'Untitled'}
                    {template.tag ? ` • ${template.tag}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedTemplate && (
              <>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Subject
                  </div>
                  <div className="mt-1 text-white">
                    {selectedTemplate.subject}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    HTML Preview
                  </div>
                  <div
                    className="mt-2 max-h-72 overflow-y-auto rounded-lg bg-black/30 p-4 text-sm text-slate-200"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5 text-sm text-slate-300">
            <div>{templateMessage}</div>

            <div className="mt-4 flex flex-wrap gap-3">
              {templates.length === 0 && (
                <button
                  onClick={() => {
                    onClose()
                    router.push('/dashboard/templates')
                  }}
                  className="rounded-lg bg-blue-500/20 px-4 py-2 font-medium text-blue-300 transition hover:bg-blue-500/30"
                >
                  Open Templates
                </button>
              )}

              {!senderSettings && (
                <button
                  onClick={() => {
                    onClose()
                    router.push('/dashboard/settings')
                  }}
                  className="rounded-lg bg-emerald-500/20 px-4 py-2 font-medium text-emerald-300 transition hover:bg-emerald-500/30"
                >
                  Open Sender Settings
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-white/10 px-4 py-2 text-slate-300 transition hover:bg-white/20"
          >
            Cancel
          </button>

          <button
            disabled={!selectedTemplateId || !senderSettings || loading}
            onClick={sendCampaign}
            className={`rounded-lg px-6 py-2 text-white transition ${
              !selectedTemplateId || !senderSettings || loading
                ? 'cursor-not-allowed bg-blue-900/40'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? 'Sending...' : 'Send Emails'}
          </button>
        </div>
      </div>
    </div>
  )
}
