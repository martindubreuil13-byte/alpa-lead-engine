export type SenderSettings = {
  sender_name?: string | null
  job_title?: string | null
  company_name?: string | null
  sender_email?: string | null
  phone?: string | null
  website?: string | null
  logo_url?: string | null
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeUrl(value: string) {
  if (!value) return value
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function formatWebsite(value: string | null | undefined) {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const href = normalizeUrl(trimmed)
  return {
    href,
    label: trimmed.replace(/^https?:\/\//i, ''),
  }
}

export function buildTemplateBodyHtml(body: string | null | undefined) {
  const trimmed = body?.trim() || ''
  if (!trimmed) return ''
  return escapeHtml(trimmed).replace(/\n/g, '<br/>')
}

export function buildSignatureHtml(settings: SenderSettings) {
  const name = settings.sender_name?.trim()
  const title = settings.job_title?.trim()
  const company = settings.company_name?.trim()
  const email = settings.sender_email?.trim()
  const phone = settings.phone?.trim()
  const website = formatWebsite(settings.website)
  const logoUrl = settings.logo_url?.trim()

  const lines: string[] = []

  if (name) {
    lines.push(`<strong>${escapeHtml(name)}</strong>`)
  }

  if (title) {
    lines.push(escapeHtml(title))
  }

  if (company) {
    lines.push(escapeHtml(company))
  }

  if (email) {
    lines.push(`Email: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`)
  }

  if (phone) {
    lines.push(`Phone: ${escapeHtml(phone)}`)
  }

  if (website) {
    lines.push(
      `Website: <a href="${escapeHtml(website.href)}" target="_blank" rel="noreferrer">${escapeHtml(website.label)}</a>`
    )
  }

  let html = lines.join('<br/>')

  if (logoUrl) {
    const logoMarkup =
      `<img src="${escapeHtml(logoUrl)}" width="120" alt="Company logo" ` +
      'style="display:block;max-width:120px;height:auto;margin-top:12px;" />'

    html = html ? `${html}<br/><br/>${logoMarkup}` : logoMarkup
  }

  return html
}

export function buildFinalEmailHtml(body: string | null | undefined, settings: SenderSettings) {
  const bodyHtml = buildTemplateBodyHtml(body)
  const signatureHtml = buildSignatureHtml(settings)

  if (bodyHtml && signatureHtml) {
    return `${bodyHtml}<br/><br/>${signatureHtml}`
  }

  return bodyHtml || signatureHtml
}
