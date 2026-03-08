'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
  company_name: string
  email: string
  industry: string
  city: string
  status: string
}

const templates = {
  intro: {
    subject: "Quick question about your business",
    body: `Hi {{company}},

I came across your business and really liked what you're doing in {{industry}}.

I'd love to connect and explore ways we could collaborate.

Best regards,
Martin`
  },
  followup: {
    subject: "Following up on my previous message",
    body: `Hi {{company}},

Just wanted to follow up in case my previous message got buried.

Let me know if you'd be open to a quick chat.

Best,
Martin`
  },
  partnership: {
    subject: "Potential partnership opportunity",
    body: `Hello {{company}},

We help businesses in {{industry}} grow through strategic outreach and partnerships.

Would you be open to discussing potential collaboration?

Kind regards,
Martin`
  }
}

export default function Page() {
  const params = useParams()
  const leadId = params.id as string

  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetchLead()
  }, [])

  async function fetchLead() {
    const { data, error } = await supabase
      .from('leads')
      .select('id, company_name, email, industry, city, status')
      .eq('id', leadId)
      .single()

    if (!error && data) setLead(data)
    setLoading(false)
  }

  function applyTemplate(key: string) {
    if (!lead) return
    const t = templates[key as keyof typeof templates]
    if (!t) return

    const personalizedBody = t.body
      .replace(/{{company}}/g, lead.company_name)
      .replace(/{{industry}}/g, lead.industry)

    setSubject(t.subject)
    setBody(personalizedBody)
    setSelectedTemplate(key)
  }

  async function sendEmail() {
  if (!lead) return
  if (!subject || !body) {
    alert('Subject and message required')
    return
  }

  try {
    setSending(true)

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: lead.email,
        subject,
        html: body.replace(/\n/g, '<br/>'),
        leadId: lead.id
      })
    })

    const data = await res.json()

    if (!res.ok) {
      alert('❌ ' + (data.error || 'Failed to send email'))
      return
    }

    alert('✅ Email sent successfully!')
  } catch (err) {
    alert('❌ Error sending email')
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

  return (
    <div className="space-y-10 max-w-5xl">

      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Email Composer
        </h1>
        <p className="text-slate-400 mt-2">
          Prepare and review your outreach email
        </p>
      </div>

      <div className="glass p-6 flex justify-between items-center">
        <div>
          <div className="text-lg font-semibold text-white">
            {lead.company_name}
          </div>
          <div className="text-sm text-slate-400 mt-1">
            {lead.industry} • {lead.city}
          </div>
          <div className="text-sm text-cyan-300 mt-2">
            {lead.email}
          </div>
        </div>

        <div className="px-4 py-2 rounded-full text-xs font-medium bg-slate-400/10 text-slate-300">
          {lead.status}
        </div>
      </div>

      <div className="glass p-6 space-y-4">
        <div className="text-sm text-slate-400">Template</div>
        <select
          value={selectedTemplate}
          onChange={(e) => applyTemplate(e.target.value)}
          className="input"
        >
          <option value="">Select template…</option>
          <option value="intro">Intro Outreach</option>
          <option value="followup">Follow-up Reminder</option>
          <option value="partnership">Partnership Proposal</option>
        </select>
      </div>

      <div className="glass p-8 space-y-6">

        <div className="space-y-2">
          <div className="text-sm text-slate-400">Subject</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="input"
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-slate-400">Message</div>
          <textarea
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="input resize-none"
          />
        </div>

      </div>

      <div className="flex justify-end">
        <button
          onClick={sendEmail}
          disabled={sending}
          className="btn-primary text-lg px-8 py-3 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send Email'}
        </button>
      </div>

    </div>
  )
}