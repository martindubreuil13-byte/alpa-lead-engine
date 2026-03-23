'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

import { buildFinalEmailHtml } from '@/lib/email/signature'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  email: string
  industry: string
  city: string
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

export default function Page() {
  const params = useParams()
  const leadId = params.id as string

  const [lead, setLead] = useState<Lead | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [senderSettings, setSenderSettings] = useState<SenderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupLoading, setSetupLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetchLead()
    fetchEmailSetup()
  }, [])

  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) || null

  async function fetchLead() {
    const { data, error } = await supabase
      .from('leads')
      .select('id, company_name, email, industry, city, status')
      .eq('id', leadId)
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

    if (senderError) {
      console.error('FULL ERROR:', JSON.stringify(senderError, null, 2))
    }

    const nextTemplates = (templateData as Template[]) || []
    setTemplates(nextTemplates)
    setSenderSettings((senderData as SenderSettings | null) || null)

    if (nextTemplates.length > 0) {
      setSelectedTemplateId(nextTemplates[0].id)
    }

    setSetupLoading(false)
  }

  async function sendEmail() {
    if (!lead || !selectedTemplateId || !senderSettings) return

    try {
      setSending(true)

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: [lead.id],
          templateId: selectedTemplateId,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
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

  if (!lead) {
    return <div className="text-red-400">Lead not found.</div>
  }

  const previewHtml =
    selectedTemplate && senderSettings
      ? buildFinalEmailHtml(selectedTemplate.body, senderSettings)
      : ''

  return (
    <div className="max-w-5xl space-y-10">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Email Composer
        </h1>
        <p className="mt-2 text-slate-400">
          Choose the template you want to send and review the final HTML email before it goes out.
        </p>
      </div>

      <div className="glass flex items-center justify-between p-6">
        <div>
          <div className="text-lg font-semibold text-white">
            {lead.company_name}
          </div>
          <div className="mt-1 text-sm text-slate-400">
            {lead.industry} • {lead.city}
          </div>
          <div className="mt-2 text-sm text-cyan-300">{lead.email}</div>
        </div>

        <div className="rounded-full bg-slate-400/10 px-4 py-2 text-xs font-medium text-slate-300">
          {lead.status}
        </div>
      </div>

      {setupLoading ? (
        <div className="glass p-6 text-slate-400">
          Loading your saved templates and sender settings...
        </div>
      ) : templates.length === 0 || !senderSettings ? (
        <div className="glass space-y-4 p-6 text-slate-300">
          <div>
            {templates.length === 0 && !senderSettings
              ? 'Save templates and sender settings before sending.'
              : templates.length === 0
              ? 'Save a template before sending.'
              : 'Save sender settings before sending.'}
          </div>

          <div className="flex flex-wrap gap-3">
            {templates.length === 0 && (
              <Link
                href="/dashboard/templates"
                className="rounded-lg bg-blue-500/20 px-4 py-2 font-medium text-blue-300 transition hover:bg-blue-500/30"
              >
                Open Templates
              </Link>
            )}

            {!senderSettings && (
              <Link
                href="/dashboard/settings"
                className="rounded-lg bg-emerald-500/20 px-4 py-2 font-medium text-emerald-300 transition hover:bg-emerald-500/30"
              >
                Open Sender Settings
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="glass space-y-6 p-8">
          <div className="space-y-2">
            <div className="text-sm text-slate-400">Template</div>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="input"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.tag ? ` • ${template.tag}` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedTemplate && (
            <>
              <div className="space-y-2">
                <div className="text-sm text-slate-400">Subject</div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white">
                  {selectedTemplate.subject}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm text-slate-400">HTML Preview</div>
                <div
                  className="rounded-xl border border-white/10 bg-white px-6 py-5 text-sm leading-7 text-slate-800"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={sendEmail}
          disabled={sending || !selectedTemplateId || !senderSettings}
          className="btn-primary px-8 py-3 text-lg disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send Email'}
        </button>
      </div>
    </div>
  )
}
