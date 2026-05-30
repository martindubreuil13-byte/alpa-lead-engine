'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, Eye, Play, Save, Search, Send } from 'lucide-react'

import {
  buildFollowUpHtml,
  isExcludedEmail,
  renderFollowUpTemplate,
  type FollowUpSettingsRow,
  type LeadFollowUpRow,
} from '@/lib/admin/lead-follow-ups'

export type LeadCaptureStatus = 'Downloaded' | 'Pending Follow-Up' | 'Follow-Up Sent'

export type LeadCaptureRow = {
  rowKey: string
  followUpId: string | null
  sourceActivityId: string | null
  email: string
  captureDate: string
  status: LeadCaptureStatus
  followupSent: boolean
  followupSentAt: string | null
  emailSubject: string | null
  emailBody: string | null
  converted: boolean
}

type CaptureFilter = 'all' | 'pending' | 'sent' | 'converted'

type SettingsDraft = Pick<
  FollowUpSettingsRow,
  | 'follow_up_delay_days'
  | 'coupon_code'
  | 'discount_label'
  | 'email_subject'
  | 'email_body_template'
  | 'send_copy_to_admin'
  | 'admin_notification_email'
  | 'exclusion_patterns'
>

function formatDate(value: string | null) {
  if (!value) return '-'

  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function statusTone(status: LeadCaptureStatus) {
  if (status === 'Follow-Up Sent') return 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
  if (status === 'Pending Follow-Up') return 'border-amber-300/20 bg-amber-400/10 text-amber-100'
  return 'border-blue-300/20 bg-blue-400/10 text-blue-100'
}

export default function LeadFollowUpsAdmin({
  initialRows,
  initialSettings,
}: {
  initialRows: LeadCaptureRow[]
  initialSettings: SettingsDraft
}) {
  const [rows, setRows] = useState(initialRows)
  const [settings, setSettings] = useState<SettingsDraft>(initialSettings)
  const [savedSettings, setSavedSettings] = useState<SettingsDraft>(initialSettings)
  const [searchEmail, setSearchEmail] = useState('')
  const [filter, setFilter] = useState<CaptureFilter>('all')
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [runningJob, setRunningJob] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirmRunOpen, setConfirmRunOpen] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [bannerType, setBannerType] = useState<'success' | 'error' | 'info'>('info')
  const [settingsSaveState, setSettingsSaveState] = useState<'clean' | 'dirty' | 'saved' | 'failed'>('clean')
  const [runSummary, setRunSummary] = useState<{
    eligible: number
    sent: number
    failed: number
  } | null>(null)

  const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings)

  const settingsBadgeText = settingsSaveState === 'dirty' ? '● Unsaved Changes' :
                            settingsSaveState === 'saved' ? '✓ Settings Saved' :
                            settingsSaveState === 'failed' ? '✕ Save Failed' : null
  const settingsBadgeColor = settingsSaveState === 'dirty' ? 'border-amber-300/20 bg-amber-400/10 text-amber-100' :
                             settingsSaveState === 'saved' ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100' :
                             settingsSaveState === 'failed' ? 'border-red-300/20 bg-red-400/10 text-red-100' : ''

  useEffect(() => {
    if (hasUnsavedChanges && settingsSaveState !== 'saved' && settingsSaveState !== 'failed') {
      setSettingsSaveState('dirty')
    }
  }, [hasUnsavedChanges, settingsSaveState])

  const visibleRows = useMemo(() => {
    const query = searchEmail.trim().toLowerCase()

    return rows.filter((row) => {
      if (isExcludedEmail(row.email, settings.exclusion_patterns || [])) return false
      if (query && !row.email.toLowerCase().includes(query)) return false
      if (filter === 'pending') return row.status === 'Pending Follow-Up'
      if (filter === 'sent') return row.status === 'Follow-Up Sent'
      if (filter === 'converted') return row.converted
      return true
    })
  }, [filter, rows, searchEmail, settings.exclusion_patterns])

  const summary = useMemo(() => {
    const included = rows.filter((row) => !isExcludedEmail(row.email, settings.exclusion_patterns || []))

    return {
      captured: included.length,
      pending: included.filter((row) => row.status === 'Pending Follow-Up').length,
      sent: included.filter((row) => row.status === 'Follow-Up Sent').length,
      converted: included.filter((row) => row.converted).length,
    }
  }, [rows, settings.exclusion_patterns])

  const previewEmail = useMemo(() => {
    const sample = {
      email: 'test@example.com',
      searchQuery: null,
      location: null,
      leadCount: 25,
      couponCode: settings.coupon_code ?? 'ALPA30',
      discountLabel: settings.discount_label ?? '10% off your first month',
    }
    const subject = renderFollowUpTemplate(settings.email_subject, sample)
    const body = renderFollowUpTemplate(settings.email_body_template, sample)

    return {
      subject,
      body,
      html: buildFollowUpHtml(body, {
        couponCode: sample.couponCode,
        discountLabel: sample.discountLabel,
      }),
    }
  }, [settings])

  async function saveSettings() {
    setSavingSettings(true)
    setBanner(null)

    try {
      const response = await fetch('/api/admin/follow-up-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(result?.error || 'Unable to save follow-up settings.')
      }

      setSettings(result.settings)
      setSavedSettings(result.settings)
      setSettingsSaveState('saved')
      setBannerType('success')
      setBanner('✓ Settings Saved')

      setTimeout(() => {
        setSettingsSaveState('clean')
        setBanner(null)
      }, 3000)
    } catch (error) {
      setSettingsSaveState('failed')
      setBannerType('error')
      setBanner(error instanceof Error ? error.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  async function runFollowUpJob() {
    setConfirmRunOpen(false)
    setRunningJob(true)
    setRunSummary(null)
    setBanner(null)

    try {
      const response = await fetch('/api/admin/lead-follow-ups/run', { method: 'POST' })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(result?.error || 'Unable to run follow-up job.')
      }

      const followUps = (result.followUps || []) as LeadFollowUpRow[]
      const followUpsBySource = new Map(
        followUps
          .filter((followUp) => followUp.source_activity_id)
          .map((followUp) => [followUp.source_activity_id, followUp])
      )
      const followUpsByEmail = new Map(followUps.map((followUp) => [followUp.email.toLowerCase(), followUp]))

      setRows((current) =>
        current.map((item) => {
          const followUp =
            (item.sourceActivityId ? followUpsBySource.get(item.sourceActivityId) : null) ||
            followUpsByEmail.get(item.email.toLowerCase())

          if (!followUp) return item

          return {
            ...item,
            followUpId: followUp.id,
            status: followUp.followup_sent ? 'Follow-Up Sent' : item.status,
            followupSent: followUp.followup_sent,
            followupSentAt: followUp.follow_up_sent_at,
            emailSubject: followUp.email_subject,
            emailBody: followUp.email_body,
            converted: followUp.converted,
          }
        })
      )

      setRunSummary(result.summary)
      setBanner('Follow-up run completed.')
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Unable to run follow-up job.')
    } finally {
      setRunningJob(false)
    }
  }

  async function sendTestEmail() {
    setSendingTest(true)
    setBanner(null)

    try {
      const response = await fetch('/api/admin/lead-follow-ups/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(result?.error || 'Unable to send test email.')
      }

      setBanner(`Test email sent to ${result.sentTo}.`)
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Unable to send test email.')
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] bg-white/[0.04] p-7 shadow-[0_24px_80px_rgba(2,8,23,0.22)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-200/80">
              Admin
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-white">Lead Capture</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Lightweight CRM for emails that received ALPA lead deliveries and coupon follow-ups.
            </p>
          </div>
        </div>
      </div>

      {runSummary ? (
        <div className="grid gap-3 rounded-[28px] border border-white/10 bg-white/[0.035] p-4 text-sm sm:grid-cols-3">
          <SummaryStat label="Eligible" value={runSummary.eligible} />
          <SummaryStat label="Sent" value={runSummary.sent} />
          <SummaryStat label="Failed" value={runSummary.failed} />
        </div>
      ) : null}

      {banner ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${
          bannerType === 'success'
            ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100'
            : bannerType === 'error'
              ? 'border-red-300/20 bg-red-400/10 text-red-100'
              : 'border-blue-300/15 bg-blue-500/10 text-blue-100'
        }`}>
          {banner}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Captured Emails" value={summary.captured} />
        <SummaryStat label="Pending Follow-Up" value={summary.pending} />
        <SummaryStat label="Follow-Up Sent" value={summary.sent} />
        <SummaryStat label="Converted Users" value={summary.converted} />
      </section>

      <section className="rounded-[28px] bg-white/[0.035] p-5 shadow-[0_22px_70px_rgba(2,8,23,0.18)]">
        <div className="flex w-full items-start justify-between gap-4">
          <button
            type="button"
            onClick={() => setCampaignOpen((value) => !value)}
            className="flex flex-1 items-start gap-4 text-left"
          >
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">Follow-Up Campaign</h2>
                {settingsBadgeText && (
                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${settingsBadgeColor}`}>
                    {settingsBadgeText}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-400">Email settings, preview, test send, and manual campaign run.</p>
            </div>
            <ChevronDown className={`h-5 w-5 text-slate-400 transition ${campaignOpen ? 'rotate-180' : ''}`} />
          </button>
          {campaignOpen && (
            <button
              type="button"
              onClick={saveSettings}
              disabled={savingSettings || !hasUnsavedChanges}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-blue-500 px-5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-500"
            >
              <Save className="h-4 w-4" />
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          )}
        </div>

        {campaignOpen ? (
          <div className="mt-5">
            <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-4 text-sm font-medium text-slate-200 transition hover:bg-white/[0.1]"
            >
              <Eye className="h-4 w-4" />
              Preview Email
            </button>
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-4 text-sm font-medium text-slate-200 transition hover:bg-white/[0.1]"
            >
              <Eye className="h-4 w-4" />
              Preview Email
            </button>
            <button
              type="button"
              onClick={sendTestEmail}
              disabled={sendingTest}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-emerald-500/14 px-4 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {sendingTest ? 'Sending...' : 'Send Test Email'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRunOpen(true)}
              disabled={runningJob}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-blue-500/14 px-4 text-sm font-medium text-blue-100 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-4 w-4" />
              {runningJob ? 'Running...' : 'Run Follow-Up Now'}
            </button>
            </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <TextField
            label="Coupon Code"
            value={settings.coupon_code || ''}
            onChange={(value) => setSettings((current) => ({ ...current, coupon_code: value }))}
          />
          <TextField
            label="Discount Label"
            value={settings.discount_label || ''}
            onChange={(value) => setSettings((current) => ({ ...current, discount_label: value }))}
          />
          <TextField
            label="Delay Days"
            type="number"
            value={String(settings.follow_up_delay_days)}
            onChange={(value) =>
              setSettings((current) => ({ ...current, follow_up_delay_days: Number(value) }))
            }
          />
          <TextField
            label="Admin Email"
            type="email"
            value={settings.admin_notification_email || ''}
            onChange={(value) =>
              setSettings((current) => ({ ...current, admin_notification_email: value }))
            }
          />
          <label className="block lg:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Subject Line
            </span>
            <input
              value={settings.email_subject}
              onChange={(event) => setSettings((current) => ({ ...current, email_subject: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-300/30"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Email Body Template
            </span>
            <textarea
              rows={7}
              value={settings.email_body_template}
              onChange={(event) =>
                setSettings((current) => ({ ...current, email_body_template: event.target.value }))
              }
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-blue-300/30"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Exclusion Emails
            </span>
            <textarea
              rows={4}
              value={(settings.exclusion_patterns || []).join('\n')}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  exclusion_patterns: event.target.value
                    .split(/\r?\n|,/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                }))
              }
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-blue-300/30"
            />
          </label>
        </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-[28px] bg-white/[0.035] p-5 shadow-[0_22px_70px_rgba(2,8,23,0.18)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">Search Email</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={searchEmail}
              onChange={(event) => setSearchEmail(event.target.value)}
              placeholder="Search Email"
              className="h-11 w-full rounded-2xl border-0 bg-slate-950/35 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:bg-slate-950/55"
            />
          </label>

          <div className="flex gap-2">
            {[
              ['all', 'All'],
              ['pending', 'Pending'],
              ['sent', 'Sent'],
              ['converted', 'Converted'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value as CaptureFilter)}
                className={`min-h-[40px] rounded-2xl px-4 text-sm font-medium transition ${
                  filter === value
                    ? 'bg-white text-slate-950'
                    : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="mt-5 min-w-[680px] w-full border-collapse text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-4 py-4 font-semibold">Email</th>
                <th className="px-4 py-4 font-semibold">Capture Date</th>
                <th className="px-4 py-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.045]">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-slate-400">
                    No captured lead delivery emails yet.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.rowKey} className="text-slate-300">
                    <td className="px-4 py-4 font-medium text-white">{row.email}</td>
                    <td className="px-4 py-4">{formatDate(row.captureDate)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusTone(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {previewOpen ? (
        <Modal title="Preview Email" onClose={() => setPreviewOpen(false)}>
          <div className="space-y-4">
            <div className="rounded-2xl bg-slate-950/45 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Subject</div>
              <div className="mt-2 text-sm text-white">{previewEmail.subject}</div>
            </div>
            <iframe
              title="Follow-up email preview"
              srcDoc={previewEmail.html}
              className="h-[420px] w-full rounded-2xl border border-white/10 bg-white"
            />
          </div>
        </Modal>
      ) : null}

      {confirmRunOpen ? (
        <Modal title="Send Follow-Up Emails" onClose={() => setConfirmRunOpen(false)}>
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-300">
              This will send follow-up emails to all eligible captured leads. Continue?
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmRunOpen(false)}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runFollowUpJob}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-500/14 px-4 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20"
              >
                <Send className="h-4 w-4" />
                Send Emails
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-300/30"
      />
    </label>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-h-[126px] rounded-[24px] bg-white/[0.045] p-5 shadow-[0_18px_60px_rgba(2,8,23,0.16)]">
      <div className="text-sm font-medium text-slate-400">{label}</div>
      <div className="mt-5 text-3xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  )
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-[#07111f] p-5 shadow-[0_25px_90px_rgba(2,8,23,0.65)]">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.08]"
          >
            Close
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}
