'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  DAILY_EMAIL_LIMIT,
  DAILY_LIMIT_WARNING_THRESHOLD,
  getEmailLimitFeedback,
  type EmailUsageSnapshot,
} from '@/lib/email/send-limits'
import { canAccessFeature } from '@/lib/auth/access'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { supabase } from '@/lib/supabase'
import { getBrowserTimeZone } from '@/lib/timezone'

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

type SenderSettings = {
  sender_name: string | null
  sender_email: string | null
  company_name: string | null
  job_title: string | null
  phone: string | null
  website: string | null
  logo_url: string | null
  test_email: string | null
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
type SendStatus = {
  type: 'success' | 'error' | 'info'
  title: string
  message: string
}

const FIXED_SENDER_LABEL = 'ALPA by MINDRA <info@mindrasolutions.com>'
const DEFAULT_TEMPLATE: Template = {
  id: 'default-template',
  name: 'Default template',
  tag: null,
  subject: 'Test Email from ALPA',
  body: 'This is a test email from ALPA.',
  created_at: '',
}

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
  const email = profile.email ? escapeHtml(profile.email) : ''
  const logoUrl = getPublicLogoUrl(profile.logoUrl)
  const company = profile.company ? escapeHtml(profile.company) : ''
  const website = getWebsiteUrl(profile.website)

  if (!name && !title && !company && !email && !logoUrl && !website) {
    return ''
  }

  return `
  <div style="margin-top:20px;">
    <strong>${name || ''}</strong><br/>
    ${title || ''}${title && company ? ' at ' : ''}${company || ''}<br/>
    ${email ? `<a href="mailto:${email}">${email}</a><br/>` : ''}
    ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noreferrer">${escapeHtml(website)}</a><br/>` : ''}
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
    <p style="font-size:11px;color:#888;margin-top:15px;">
      Sent via ALPA
    </p>
  </div>
  `
}

function getUsageTone(usage: EmailUsageSnapshot | null) {
  if (!usage) {
    return {
      cardClass: 'border-white/10 bg-white/[0.04]',
      primaryTextClass: 'text-white',
    }
  }

  if (usage.remaining <= 5) {
    return {
      cardClass: 'border-red-300/18 bg-red-500/[0.045]',
      primaryTextClass: 'text-red-50',
    }
  }

  if (usage.remaining <= DAILY_LIMIT_WARNING_THRESHOLD) {
    return {
      cardClass: 'border-amber-300/18 bg-amber-500/[0.045]',
      primaryTextClass: 'text-amber-50',
    }
  }

  return {
    cardClass: 'border-blue-300/12 bg-blue-500/[0.035]',
    primaryTextClass: 'text-blue-50',
  }
}

function getClientUsageDate(timeZone = getBrowserTimeZone(), now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function normalizeUsageSnapshot(usage: EmailUsageSnapshot): EmailUsageSnapshot {
  const limit = Number.isFinite(usage.limit) ? usage.limit : DAILY_EMAIL_LIMIT
  const sent = Math.min(Math.max(Number.isFinite(usage.sent) ? usage.sent : 0, 0), limit)
  const timeZone = usage.timeZone || getBrowserTimeZone()
  const date = usage.date || getClientUsageDate(timeZone)

  return {
    sent,
    limit,
    remaining: Math.max(limit - sent, 0),
    date,
    timeZone,
  }
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
  onSent: (sentIds: string[]) => void | Promise<void>
}) {
  const router = useRouter()
  const { user, loading: userLoading } = useCurrentUser()
  const { profile, loading: profileLoading } = useClientUserProfile()

  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedLeads, setSelectedLeads] = useState<Lead[]>([])
  const [modalSelectedIds, setModalSelectedIds] = useState<string[]>([])

  const [senderSettings, setSenderSettings] = useState<SenderSettings | null>(null)
  const [currentUserIdentity, setCurrentUserIdentity] = useState<CurrentUserIdentity | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [testLoading, setTestLoading] = useState(false)

  const [sendAsTest, setSendAsTest] = useState(false)
  const [templateMessage, setTemplateMessage] = useState('')
  const [testStatusMessage, setTestStatusMessage] = useState('')
  const [sendStatus, setSendStatus] = useState<SendStatus | null>(null)
  const [emailUsage, setEmailUsage] = useState<EmailUsageSnapshot | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('details')
  const usageAuthorityRef = useRef<EmailUsageSnapshot | null>(null)

  useEffect(() => {
    if (isOpen) {
      setModalSelectedIds(selectedIds)
      setViewMode('details')
      setTestStatusMessage('')
    }
  }, [isOpen, selectedIds])

  useEffect(() => {
    if (!isOpen) return
    if (userLoading) return

    const selectionReady =
      selectedIds.length === 0 || modalSelectedIds.length === selectedIds.length

    if (!selectionReady) return

    void fetchEmailSetup()
  }, [isOpen, selectedIds, modalSelectedIds, user, userLoading])

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
  const safeTemplate = selectedTemplate || DEFAULT_TEMPLATE
  const previewLead = selectedLeads[0] || null
  const emailLocked = !profileLoading && !canAccessFeature('email', profile)
  const senderProfile = useMemo(
    () => buildSenderProfile(currentUserIdentity, senderSettings),
    [currentUserIdentity, senderSettings]
  )
  const testEmail = senderSettings?.test_email?.trim() || currentUserIdentity?.email || ''
  const isNearDailyLimit =
    emailUsage !== null &&
    emailUsage.remaining > 0 &&
    emailUsage.remaining <= DAILY_LIMIT_WARNING_THRESHOLD
  const dailyLimitReached = Boolean(emailUsage && emailUsage.remaining <= 0)
  const usageTone = getUsageTone(emailUsage)

  function commitEmailUsage(usage: EmailUsageSnapshot, source: string) {
    const incoming = normalizeUsageSnapshot(usage)
    const authoritative = usageAuthorityRef.current
    let reconciled = incoming

    if (authoritative && authoritative.date === incoming.date) {
      const limit = incoming.limit || authoritative.limit
      const sent = Math.min(Math.max(authoritative.sent, incoming.sent), limit)

      reconciled = {
        sent,
        limit,
        remaining: Math.max(limit - sent, 0),
        date: incoming.date,
        timeZone: incoming.timeZone,
      }
    }

    usageAuthorityRef.current = reconciled
    setEmailUsage(reconciled)

    if (process.env.NODE_ENV === 'development') {
      console.debug('[email-usage] reconciled usage snapshot', {
        source,
        timeZone: reconciled.timeZone,
        date: reconciled.date,
        fetchedSent: incoming.sent,
        localOptimisticSent: authoritative?.sent ?? null,
        reconciledSent: reconciled.sent,
        remaining: reconciled.remaining,
      })
    }

    return reconciled
  }

  function applySuccessfulSendUsage(usage: EmailUsageSnapshot | undefined, sentDelta: number) {
    if (sentDelta <= 0) return usageAuthorityRef.current ?? emailUsage

    const baseUsage = usageAuthorityRef.current ?? emailUsage ?? usage
    const normalizedBase = baseUsage ? normalizeUsageSnapshot(baseUsage) : null
    const normalizedServer = usage ? normalizeUsageSnapshot(usage) : null
    const limit = normalizedServer?.limit ?? normalizedBase?.limit ?? DAILY_EMAIL_LIMIT
    const timeZone = normalizedServer?.timeZone ?? normalizedBase?.timeZone ?? getBrowserTimeZone()
    const date =
      normalizedServer?.date ?? normalizedBase?.date ?? getClientUsageDate(timeZone)
    const previousSent = normalizedBase?.sent ?? 0
    const serverSent = normalizedServer?.sent ?? 0
    const nextSent = Math.min(Math.max(serverSent, previousSent + sentDelta), limit)

    return commitEmailUsage(
      {
        sent: nextSent,
        limit,
        remaining: Math.max(limit - nextSent, 0),
        date,
        timeZone,
      },
      'successful-send'
    )
  }

  const previewContent = useMemo(() => {
    const subject = safeTemplate.subject?.trim() || 'Test Email from ALPA'
    const replyTo = currentUserIdentity?.email || 'No reply-to email'
    const renderedBody = renderTemplate(safeTemplate.body || 'This is a test email from ALPA.', {
      business: previewLead?.company_name,
      name: previewLead?.contact_name,
      location: previewLead?.city,
    })
    const emailHtml = renderedBody ? buildFinalHtml(renderedBody, senderProfile) : ''

    console.log('DEBUG STATE:', {
      user: currentUserIdentity,
      settings: senderSettings,
      testEmail,
      template: safeTemplate,
      modalSelectedIds,
    })

    return {
      subject,
      from: FIXED_SENDER_LABEL,
      replyTo,
      emailHtml,
      hasContent: Boolean(emailHtml),
    }
  }, [currentUserIdentity, previewLead, safeTemplate, senderProfile, senderSettings, testEmail, modalSelectedIds])

  async function fetchEmailUsage(options: { preserveOptimistic?: boolean } = {}) {
    try {
      const timeZone = getBrowserTimeZone()
      const response = await fetch(`/api/send-email?timeZone=${encodeURIComponent(timeZone)}`, {
        cache: 'no-store',
        headers: {
          'x-alpa-time-zone': timeZone,
        },
      })
      const result = await response.json().catch(() => null)

      if (response.ok && result?.usage) {
        const nextUsage = result.usage as EmailUsageSnapshot
        commitEmailUsage(nextUsage, options.preserveOptimistic ? 'fetch-preserve' : 'fetch')
      }
    } catch (error) {
      console.error('Email usage fetch failed:', error)
    }
  }

  async function fetchEmailSetup() {
    setLoadingPreview(true)
    setTemplateMessage('')
    setTestStatusMessage('')

    if (!user?.id) {
      setTemplates([])
      setSelectedLeads([])
      setSenderSettings(null)
      setCurrentUserIdentity(null)
      setTemplateMessage('Please log in to load your email setup.')
      setLoadingPreview(false)
      return
    }

    setCurrentUserIdentity({
      email: user.email?.trim().toLowerCase() || '',
      name: getCurrentUserName(user),
    })
    await fetchEmailUsage({ preserveOptimistic: true })

    const templateRequest = supabase
      .from('templates')
      .select('id, name, tag, subject, body, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const senderSettingsRequest = supabase
      .from('sender_settings')
      .select('sender_name, sender_email, company_name, job_title, phone, website, logo_url, test_email')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

  const leadsRequest =
  selectedIds.length === 0
    ? Promise.resolve({ data: [] as Lead[], error: null })
    : supabase
        .from('leads')
        .select('id, company_name, contact_name, email, city')
        .eq('user_id', user.id)
        .in('id', selectedIds)

    const [
      { data: templateData, error: templateError },
      { data: senderSettingsData, error: senderSettingsError },
      { data: leadData, error: leadError },
    ] = await Promise.all([templateRequest, senderSettingsRequest, leadsRequest])

    if (templateError) {
      console.error('FULL ERROR:', JSON.stringify(templateError, null, 2))
    }

    if (senderSettingsError) {
      console.error('FULL ERROR:', JSON.stringify(senderSettingsError, null, 2))
    }

    if (leadError) {
      console.error('FULL ERROR:', JSON.stringify(leadError, null, 2))
    }

    let nextSenderSettings = (senderSettingsData as SenderSettings | null) || null

    if (!nextSenderSettings) {
      const { data: createdSettings, error: createSettingsError } = await supabase
        .from('sender_settings')
        .upsert(
          {
            user_id: user.id,
            test_email: user.email?.trim().toLowerCase() || null,
          },
          { onConflict: 'user_id' }
        )
        .select('sender_name, sender_email, company_name, job_title, phone, website, logo_url, test_email')
        .maybeSingle()

      if (createSettingsError) {
        console.error('FULL ERROR:', JSON.stringify(createSettingsError, null, 2))
      }

      nextSenderSettings = (createdSettings as SenderSettings | null) || {
        sender_name: null,
        sender_email: null,
        company_name: null,
        job_title: null,
        phone: null,
        website: null,
        logo_url: null,
        test_email: user.email?.trim().toLowerCase() || null,
      }
    }

    const nextTemplates = (templateData as Template[]) || []
  const nextLeads = ((leadData as Lead[]) || []).sort((left, right) => {
  const leftIndex = selectedIds.indexOf(left.id)
  const rightIndex = selectedIds.indexOf(right.id)

  // Safety fallback (in case something slips through)
  if (leftIndex === -1 && rightIndex === -1) return 0
  if (leftIndex === -1) return 1
  if (rightIndex === -1) return -1

  return leftIndex - rightIndex
})

    console.log('MODAL IDS:', modalSelectedIds)
    console.log('FETCHED LEADS FROM QUERY:', nextLeads)

    setTemplates(nextTemplates)
    setSelectedLeads(nextLeads)
    setSenderSettings(nextSenderSettings)

    if (nextTemplates.length === 0) {
      setTemplateMessage('No saved templates found. Using the default email template.')
    } else if (nextLeads.length === 0 && modalSelectedIds.length > 0) {
      setTemplateMessage('No selected leads were found.')
    }

    setLoadingPreview(false)
  }

  async function sendLeadEmail(
    lead: Lead,
    template: Template | null,
    currentUser: CurrentUserIdentity,
    options?: { isTest?: boolean }
  ) {
    const isTestSend = options?.isTest === true
    const leadEmail = lead.email?.trim().toLowerCase()
    const fallbackTestEmail = senderSettings?.test_email?.trim().toLowerCase() || currentUser.email
    const finalTo = isTestSend ? fallbackTestEmail : leadEmail

    if (!finalTo) {
      return { ok: false as const, skipped: true as const }
    }

    const activeTemplate = template || DEFAULT_TEMPLATE
    const subject = activeTemplate.subject?.trim() || 'Test Email from ALPA'
    const html = renderTemplate(activeTemplate.body || 'This is a test email from ALPA.', {
      business: lead.company_name,
      name: lead.contact_name,
      location: lead.city,
    })

    console.log('📤 Sending email:', {
      to: finalTo,
      subject,
      userEmail: currentUser.email,
      isTest: isTestSend,
    })
    console.log('🚀 Sending email request')

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: finalTo,
        subject,
        html,
        userEmail: currentUser.email,
        userName: currentUser.name,
        senderProfile,
        isTest: isTestSend,
        timeZone: getBrowserTimeZone(),
      }),
    })

    console.log('📬 Response status:', response.status)

    const result = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        ok: false as const,
        skipped: false as const,
        result: result?.result || 'failed',
        error: result?.error || 'Failed to send email',
        message: result?.message || 'Email failed to send. Check configuration.',
        usage: (result?.usage as EmailUsageSnapshot | undefined) ?? undefined,
      }
    }

    return {
      ok: true as const,
      skipped: false as const,
      result: result?.result || 'sent',
      usage: (result?.usage as EmailUsageSnapshot | undefined) ?? undefined,
    }
  }

  async function sendCampaign() {
    if (!sendAsTest && dailyLimitReached) {
      setSendStatus({
        type: 'error',
        title: 'Daily outreach limit reached',
        message: 'You can keep reviewing leads and planning outreach. Real sends resume tomorrow.',
      })
      return
    }

    if (!sendAsTest && selectedIds.length === 0) {
      setSendStatus({
        type: 'error',
        title: 'No Leads Selected',
        message: 'Select at least one lead before starting a campaign send.',
      })
      return
    }

    if (!currentUserIdentity?.email) {
      setSendStatus({
        type: 'error',
        title: 'Reply-To Email Missing',
        message: 'Add your account email before sending so replies can route back to your inbox.',
      })
      return
    }

    if (!selectedTemplateId) {
      setSendStatus({
        type: 'error',
        title: 'Template Required',
        message: 'Choose a template before sending emails.',
      })
      return
    }

    setLoading(true)
    setTestStatusMessage('')
    setSendStatus({
      type: 'info',
      title: 'Sending emails...',
      message: 'Please wait while we process your campaign.',
    })

    let sent = 0,
      failed = 0,
      skipped = 0,
      lastError = ''
    const sentLeadIds: string[] = []
    let remainingBudget = sendAsTest ? Number.POSITIVE_INFINITY : emailUsage?.remaining ?? Number.POSITIVE_INFINITY

    try {
      console.log('MODAL IDS:', modalSelectedIds)
      console.log('FETCHED LEADS:', selectedLeads)

      let leadsToSend: Lead[] = []

      if (sendAsTest) {
        leadsToSend = [
          previewLead || {
            id: 'preview',
            company_name: '',
            contact_name: '',
            email: testEmail,
            city: '',
          },
        ]
      } else {
        if (selectedLeads.length === 0) {
          setSendStatus({
            type: 'error',
            title: 'Leads Unavailable',
            message: 'The selected leads could not be loaded. Close this window and try again.',
          })
          return
        }

        leadsToSend = selectedLeads
      }

      for (const lead of leadsToSend) {
        if (!sendAsTest && remainingBudget <= 0) {
          lastError = 'Daily outreach limit reached'
          break
        }

        setSendStatus({
          type: 'info',
          title: 'Sending emails...',
          message: `Processed ${sent + failed + skipped} of ${leadsToSend.length}. Sent ${sent}, skipped ${skipped}, failed ${failed}.${Number.isFinite(remainingBudget) ? ` ${remainingBudget} left today.` : ''}`,
        })

        if (!sendAsTest && !lead.email?.trim()) {
          skipped += 1
          continue
        }

        const result = await sendLeadEmail(
          lead,
          selectedTemplate || DEFAULT_TEMPLATE,
          currentUserIdentity,
          {
            isTest: sendAsTest,
          }
        )

        if (result.ok) {
          if (!sendAsTest) {
            const committedUsage = applySuccessfulSendUsage(result.usage, 1)
            remainingBudget = Math.max(
              committedUsage?.remaining ?? remainingBudget - 1,
              0
            )
          } else if (result.usage) {
            commitEmailUsage(result.usage, 'test-send')
          }
          sent += 1
          sentLeadIds.push(lead.id)
          continue
        }

        if (result.skipped) {
          skipped += 1
          continue
        }

        if (result.usage) {
          commitEmailUsage(result.usage, 'send-error')
          if (!sendAsTest) {
            remainingBudget = result.usage.remaining
          }
        }

        if (result.error === 'DAILY_LIMIT_REACHED') {
          lastError = 'Daily outreach limit reached'
          break
        }

        console.error('Campaign email failed:', result.error, {
          leadId: lead.id,
          to: lead.email,
          message: result.message,
        })
        failed += 1
        lastError = result.message || lastError
      }

      if (!sendAsTest && sentLeadIds.length > 0) {
        await onSent(sentLeadIds)
      }

      await fetchEmailUsage({ preserveOptimistic: true })

      setSendStatus({
        type: failed > 0 ? 'error' : 'success',
        title: remainingBudget <= 0 && !sendAsTest ? 'Daily outreach limit reached' : 'Campaign Complete',
        message: `Sent ${sent} email(s). Skipped ${skipped}. Failed ${failed}.${remainingBudget <= 0 && !sendAsTest ? ' Daily outreach limit reached.' : ''}${failed > 0 ? ' You can retry failed leads.' : ''}${failed > 0 && lastError ? ` Last error: ${lastError}` : ''}`,
      })
    } catch (error) {
      console.error('Campaign email failed:', error)
      setSendStatus({
        type: 'error',
        title: 'Campaign Send Failed',
        message: 'ALPA could not send these emails right now. Please try again in a moment.',
      })
    } finally {
      setLoading(false)
    }
  }

  async function sendTestEmail() {
    if (!currentUserIdentity?.email) {
      setTestStatusMessage('Your account email is missing')
      return
    }

    if (!selectedTemplateId) {
      setTestStatusMessage('Please select a template before sending a test email')
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
          email: testEmail,
        },
        selectedTemplate || DEFAULT_TEMPLATE,
        currentUserIdentity,
        { isTest: true }
      )

      if (!result.ok && !result.skipped) {
        console.error('Test email failed:', result.error)
        if (result.usage) {
          commitEmailUsage(result.usage, 'test-error')
        }
        if (result.error === 'DAILY_LIMIT_REACHED') {
          const feedback = getEmailLimitFeedback(result.error)
          setSendStatus({
            type: 'error',
            title: feedback.title,
            message: feedback.message,
          })
          setTestStatusMessage(feedback.title)
          return
        }
        setTestStatusMessage(result.message || 'Email failed to send. Check configuration.')
        return
      }

      if (result.ok && result.usage) {
        commitEmailUsage(result.usage, 'test-success')
      }
      setTestStatusMessage('Test email sent')
    } catch (error) {
      console.error('Test email failed:', error)
      setTestStatusMessage('Email failed to send. Check configuration.')
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
                disabled={!currentUserIdentity?.email || !selectedTemplateId || testLoading}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-2xl px-4 text-sm font-medium transition ${
                  !currentUserIdentity?.email || !selectedTemplateId || testLoading
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
          ) : currentUserIdentity ? (
            <div className="space-y-4">
              {emailUsage ? (
                <div className={`rounded-[24px] border p-4 ${usageTone.cardClass}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Daily sending
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${usageTone.primaryTextClass}`}>
                        {emailUsage.remaining} email{emailUsage.remaining === 1 ? '' : 's'} left today
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {emailUsage.sent} sent today
                      </div>
                    </div>

                    <div className="text-sm text-slate-400">
                      {emailUsage.limit} daily limit
                    </div>
                  </div>

                  {dailyLimitReached ? (
                    <div className="mt-3 rounded-2xl border border-red-300/18 bg-red-500/8 px-3 py-3 text-sm text-red-100">
                      Daily outreach limit reached
                    </div>
                  ) : null}

                  {isNearDailyLimit ? (
                    <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-3 text-sm text-amber-50">
                      You’re near your daily limit. This helps keep your emails landing in inboxes, not spam.
                    </div>
                  ) : null}
                </div>
              ) : null}

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

                  {safeTemplate ? (
                    <>
                      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          Subject
                        </div>
                        <div className="mt-3 text-base font-medium text-white">
                          {safeTemplate.subject?.trim() || 'Test Email from ALPA'}
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

                      <label className="flex items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={sendAsTest}
                          onChange={(event) => setSendAsTest(event.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent"
                        />
                        <div>
                          <div>Send as test email</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {testEmail
                              ? `Test sends go to ${testEmail}.`
                              : 'Test sends fall back to your account email.'}
                          </div>
                        </div>
                      </label>
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
          {sendStatus ? (
            <div
              className={`mb-4 rounded-[24px] border px-4 py-4 text-sm ${
                sendStatus.type === 'success'
                  ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-50'
                  : sendStatus.type === 'info'
                    ? 'border-blue-300/20 bg-blue-400/10 text-blue-50'
                    : 'border-rose-300/20 bg-rose-400/10 text-rose-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{sendStatus.title}</div>
                  <div className="mt-1 leading-6">{sendStatus.message}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSendStatus(null)}
                  className="shrink-0 text-xs font-medium text-current/80 transition hover:text-current"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-300 transition hover:bg-white/[0.08]"
            >
              Cancel
            </button>

            {(() => {
              const canSend =
                !!currentUserIdentity?.email &&
                !!selectedTemplateId &&
                (sendAsTest || modalSelectedIds.length > 0) &&
                (sendAsTest || !dailyLimitReached)

              return (
                <button
                  type="button"
                  disabled={!canSend || loading}
                  onClick={sendCampaign}
                  className={`inline-flex min-h-[48px] items-center justify-center rounded-2xl px-5 text-sm font-semibold transition ${
                    !canSend || loading
                      ? 'cursor-not-allowed bg-blue-950/40 text-slate-400'
                      : 'btn-primary'
                  }`}
                >
                  {loading ? 'Sending emails...' : dailyLimitReached && !sendAsTest ? 'Daily limit reached' : 'Send emails'}
                </button>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
