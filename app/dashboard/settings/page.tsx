'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Page() {
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')

  const [senderName, setSenderName] = useState('')
  const [replyToEmail, setReplyToEmail] = useState('')
  const [dailyLimit, setDailyLimit] = useState('15')
  const [delaySeconds, setDelaySeconds] = useState('90')
  const [followupDays, setFollowupDays] = useState('7')
  const [signature, setSignature] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    setMessage('')

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setMessage('You must be logged in to load settings.')
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!error && data) {
      setSmtpHost(data.smtp_host ?? '')
      setSmtpPort(data.smtp_port ? String(data.smtp_port) : '587')
      setSmtpUser(data.smtp_user ?? '')
      setSmtpPass(data.smtp_pass ?? '')
      setSenderName(data.sender_name ?? '')
      setReplyToEmail(data.reply_to_email ?? '')
      setDailyLimit(data.daily_send_limit ? String(data.daily_send_limit) : '15')
      setDelaySeconds(data.min_delay_seconds ? String(data.min_delay_seconds) : '90')
      setFollowupDays(data.followup_delay_days ? String(data.followup_delay_days) : '7')
      setSignature(data.email_signature ?? '')
    }

    setLoading(false)
  }

  async function saveSettings() {
    setSaving(true)
    setMessage('')

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setMessage('You must be logged in to save settings.')
      setSaving(false)
      return
    }

    const payload = {
      user_id: user.id,
      smtp_host: smtpHost,
      smtp_port: Number(smtpPort),
      smtp_user: smtpUser,
      smtp_pass: smtpPass,
      sender_name: senderName,
      reply_to_email: replyToEmail,
      daily_send_limit: Number(dailyLimit),
      min_delay_seconds: Number(delaySeconds),
      followup_delay_days: Number(followupDays),
      email_signature: signature,
    }

    const { error } = await supabase
      .from('app_settings')
      .upsert(payload, { onConflict: 'user_id' })

    if (error) {
      setMessage(`Save failed: ${error.message}`)
    } else {
      setMessage('Settings saved successfully.')
    }

    setSaving(false)
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Settings
        </h1>
        <p className="text-slate-400 mt-2">
          Configure sending email, outreach safety, and account preferences
        </p>
      </div>

      {loading && (
        <div className="glass p-6 text-slate-300">Loading settings...</div>
      )}

      {!loading && (
        <>
          <Section
            title="SMTP Email Configuration"
            desc="Connect your business email provider to send outreach emails manually."
          >
            <div className="grid md:grid-cols-2 gap-6">
              <Input label="SMTP Host" value={smtpHost} onChange={setSmtpHost} placeholder="smtp.yourprovider.com" />
              <Input label="SMTP Port" value={smtpPort} onChange={setSmtpPort} placeholder="587" />
              <Input label="SMTP Username" value={smtpUser} onChange={setSmtpUser} placeholder="your@email.com" />
              <Input label="SMTP Password" value={smtpPass} onChange={setSmtpPass} placeholder="••••••••••" type="password" />
            </div>
          </Section>

          <Section title="Sender Identity" desc="Define how recipients see you.">
            <div className="grid md:grid-cols-2 gap-6">
              <Input label="Sender Name" value={senderName} onChange={setSenderName} placeholder="Martin L." />
              <Input label="Reply-To Email" value={replyToEmail} onChange={setReplyToEmail} placeholder="contact@yourdomain.com" />
            </div>
          </Section>

          <Section title="Outreach Safety Controls" desc="Protect your email reputation and avoid spam patterns.">
            <div className="grid md:grid-cols-3 gap-6">
              <Input label="Daily Send Limit" value={dailyLimit} onChange={setDailyLimit} placeholder="15" />
              <Input label="Minimum Delay Between Emails (sec)" value={delaySeconds} onChange={setDelaySeconds} placeholder="90" />
              <Input label="Follow-up Delay (days)" value={followupDays} onChange={setFollowupDays} placeholder="7" />
            </div>
          </Section>

          <Section title="Email Signature" desc="This signature will appear under your messages.">
            <textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={`Martin L.\nBusiness Growth Consultant\n+1 (514) 000-0000`}
              className="w-full h-40 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
            />
          </Section>

          <div className="flex items-center gap-4">
            <button
              onClick={saveSettings}
              disabled={saving}
              className="btn-primary disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>

            {message && (
              <div className="text-sm text-slate-300">{message}</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <div className="glass p-8 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <p className="text-sm text-slate-400 mt-1">{desc}</p>
      </div>
      {children}
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-400">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-900/60 border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
      />
    </div>
  )
}