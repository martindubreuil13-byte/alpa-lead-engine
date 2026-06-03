export const OUTREACH_FROM_EMAIL = 'ALPA by MINDRA <info@mindrasolutions.com>'

const OUTREACH_UNSUBSCRIBE_EMAIL = 'info@mindrasolutions.com'
const OUTREACH_SENDER_LABEL = 'ALPA by MINDRA'

export type OutreachSenderSettings = {
  sender_name?: string | null
  sender_email?: string | null
  company_name?: string | null
  job_title?: string | null
  phone?: string | null
  website?: string | null
  logo_url?: string | null
}

export type OutreachSenderProfile = {
  name?: string
  title?: string
  company?: string
  email?: string
  phone?: string
  website?: string
  logoUrl?: string
}

function getTrimmed(value: string | null | undefined) {
  return value?.trim() || ''
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isValidPublicUrl(value: string | null | undefined) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function getWebsiteUrl(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return /^https?:$/i.test(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export function buildOutreachSenderProfile(
  settings: OutreachSenderSettings | null | undefined,
  fallback?: { name?: string | null; email?: string | null }
): OutreachSenderProfile | undefined {
  const profile: OutreachSenderProfile = {
    name: getTrimmed(settings?.sender_name) || getTrimmed(fallback?.name),
    title: getTrimmed(settings?.job_title),
    company: getTrimmed(settings?.company_name),
    email: getTrimmed(settings?.sender_email) || getTrimmed(fallback?.email),
    phone: getTrimmed(settings?.phone),
    website: getTrimmed(settings?.website),
    logoUrl: getTrimmed(settings?.logo_url),
  }

  return Object.values(profile).some(Boolean) ? profile : undefined
}

function buildSenderSignatureHtml(profile: OutreachSenderProfile | undefined) {
  if (!profile) return ''

  const name = profile.name ? escapeHtml(profile.name) : ''
  const title = profile.title ? escapeHtml(profile.title) : ''
  const company = profile.company ? escapeHtml(profile.company) : ''
  const email = profile.email ? escapeHtml(profile.email) : ''
  const phone = profile.phone ? escapeHtml(profile.phone) : ''
  const website = getWebsiteUrl(profile.website)
  const logoUrl = isValidPublicUrl(profile.logoUrl) ? escapeHtml(profile.logoUrl || '') : ''

  if (!name && !title && !company && !email && !phone && !website && !logoUrl) {
    return ''
  }

  return `
<div style="margin-top:20px;">
  ${name ? `<strong>${name}</strong><br/>` : ''}
  ${title || company ? `${title}${title && company ? ' at ' : ''}${company}<br/>` : ''}
  ${email ? `<a href="mailto:${email}">${email}</a><br/>` : ''}
  ${phone ? `${phone}<br/>` : ''}
  ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noreferrer">${escapeHtml(website)}</a><br/>` : ''}
  ${logoUrl ? `<img src="${logoUrl}" style="max-width:120px;margin-top:12px;display:block;" />` : ''}
</div>`
}

function buildStandardFooterHtml() {
  return `
<div style="margin-top:28px;border-top:1px solid #e5e7eb;padding-top:14px;color:#6b7280;font-size:12px;line-height:1.5;">
  <p style="margin:0 0 8px;">Sent by ${OUTREACH_SENDER_LABEL} (${OUTREACH_UNSUBSCRIBE_EMAIL})</p>
  <p style="margin:0;">If this is not relevant, you can unsubscribe by replying to this email or emailing <a href="mailto:${OUTREACH_UNSUBSCRIBE_EMAIL}?subject=Unsubscribe" style="color:#4b5563;">${OUTREACH_UNSUBSCRIBE_EMAIL}</a> with "unsubscribe".</p>
</div>`
}

export function buildOutreachEmailHtml(
  text: string,
  options?: {
    footerHtml?: string
    includeStandardFooter?: boolean
    senderProfile?: OutreachSenderProfile
  }
): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const withBreaks = escaped.replace(/\n/g, '<br/>')
  const signature = buildSenderSignatureHtml(options?.senderProfile)
  const standardFooter = options?.includeStandardFooter === false ? '' : buildStandardFooterHtml()
  const footer = `${standardFooter}${options?.footerHtml || ''}`

  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;padding:20px;max-width:520px;">${withBreaks}${signature}${footer}</div>`
}
