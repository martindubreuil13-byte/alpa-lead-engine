type SignatureInput = {
  senderName?: string | null
  jobTitle?: string | null
  companyName?: string | null
  phone?: string | null
  website?: string | null
  logoUrl?: string | null
  senderEmail?: string | null
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeWebsite(urlOrDomain?: string | null): {
  href: string
  label: string
} | null {
  if (!urlOrDomain) return null
  const trimmed = urlOrDomain.trim()
  if (!trimmed) return null

  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const label = trimmed.replace(/^https?:\/\//i, '')
  return { href, label }
}

export function buildSignatureHtml({
  senderName,
  jobTitle,
  companyName,
  phone,
  website,
  logoUrl,
  senderEmail,
}: SignatureInput): string {
  const safeName = senderName?.trim() || ''
  const safeTitle = jobTitle?.trim() || ''
  const safeCompany = companyName?.trim() || ''
  const safePhone = phone?.trim() || ''
  const safeEmail = senderEmail?.trim() || ''
  const safeLogo = logoUrl?.trim() || ''
  const websiteObj = normalizeWebsite(website)

  const hasAnyField =
    safeName ||
    safeTitle ||
    safeCompany ||
    safePhone ||
    safeEmail ||
    websiteObj ||
    safeLogo

  if (!hasAnyField) return ''

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;width:100%;font-family:Arial,Helvetica,sans-serif;">
      <tr>
        <td valign="top" style="font-size:14px;line-height:1.5;color:#111827;">
          ${
            safeName
              ? `<div style="font-weight:700;color:#111827;">${escapeHtml(safeName)}</div>`
              : ''
          }
          ${
            safeTitle
              ? `<div style="color:#374151;">${escapeHtml(safeTitle)}</div>`
              : ''
          }
          ${
            safeCompany
              ? `<div style="color:#374151;">${escapeHtml(safeCompany)}</div>`
              : ''
          }
          ${
            safePhone || safeEmail || websiteObj
              ? `<div style="margin-top:10px;color:#4b5563;">
                  ${safePhone ? `<div>${escapeHtml(safePhone)}</div>` : ''}
                  ${safeEmail ? `<div>${escapeHtml(safeEmail)}</div>` : ''}
                  ${
                    websiteObj
                      ? `<div><a href="${escapeHtml(
                          websiteObj.href
                        )}" style="color:#2563eb;text-decoration:none;">${escapeHtml(
                          websiteObj.label
                        )}</a></div>`
                      : ''
                  }
                </div>`
              : ''
          }
        </td>
        ${
          safeLogo
            ? `<td valign="top" align="right" style="padding-left:16px;width:140px;">
                 <img src="${escapeHtml(
                   safeLogo
                 )}" alt="Logo" style="max-width:140px;max-height:70px;height:auto;display:block;border:0;outline:none;text-decoration:none;" />
               </td>`
            : ''
        }
      </tr>
    </table>
  `
}