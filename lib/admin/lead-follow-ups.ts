import type { Database } from '@/lib/supabase/types'

export type FollowUpSettingsRow = Database['public']['Tables']['follow_up_settings']['Row']
export type LeadFollowUpRow = Database['public']['Tables']['lead_follow_ups']['Row']

export const DEFAULT_FOLLOW_UP_SETTINGS: Omit<
  FollowUpSettingsRow,
  'id' | 'created_at' | 'updated_at'
> = {
  follow_up_delay_days: 3,
  coupon_code: 'ALPA10',
  discount_label: '10% off your first month',
  email_subject: 'Still need fresh leads? Use {{coupon_code}}',
  email_body_template: [
    'Hi,',
    '',
    'Thanks for using ALPA to download leads.',
    '',
    'If you want to keep prospecting, use coupon code {{coupon_code}} for {{discount}}.',
    '',
    'Best,',
    'Martin',
  ].join('\n'),
  send_copy_to_admin: true,
  admin_notification_email: null,
  exclusion_patterns: ['martin@', 'test@', 'admin@', '@mindrasolutions.com'],
}

export type FollowUpTemplateInput = {
  email: string
  searchQuery: string | null
  location: string | null
  leadCount: number
  couponCode: string | null
  discountLabel: string | null
}

export function normalizeText(value: unknown) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

export function normalizeEmail(value: unknown) {
  return normalizeText(value)?.toLowerCase() ?? null
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function getEffectiveFollowUpSettings(settings: FollowUpSettingsRow | null) {
  return {
    ...DEFAULT_FOLLOW_UP_SETTINGS,
    ...settings,
    coupon_code: settings?.coupon_code ?? DEFAULT_FOLLOW_UP_SETTINGS.coupon_code,
    discount_label: settings?.discount_label ?? DEFAULT_FOLLOW_UP_SETTINGS.discount_label,
    admin_notification_email:
      settings?.admin_notification_email ?? DEFAULT_FOLLOW_UP_SETTINGS.admin_notification_email,
    exclusion_patterns:
      settings?.exclusion_patterns ?? DEFAULT_FOLLOW_UP_SETTINGS.exclusion_patterns,
  }
}

export function normalizeExclusionPatterns(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean) as string[]
  }

  return String(value || '')
    .split(/\r?\n|,/)
    .map(normalizeText)
    .filter(Boolean) as string[]
}

export function isExcludedEmail(email: string, patterns: string[]) {
  const normalizedEmail = email.toLowerCase()

  return patterns.some((pattern) => {
    const normalizedPattern = pattern.trim().toLowerCase()
    if (!normalizedPattern) return false
    return normalizedEmail.includes(normalizedPattern)
  })
}

export function renderFollowUpTemplate(template: string, input: FollowUpTemplateInput) {
  const replacements: Record<string, string> = {
    email: input.email,
    search_query: input.searchQuery || 'your search',
    location: input.location || 'your market',
    lead_count: String(input.leadCount || 0),
    lead_count_plural: input.leadCount === 1 ? '' : 's',
    coupon_code: input.couponCode || '',
    discount_label: input.discountLabel || '',
    discount: input.discountLabel || '',
  }

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    return replacements[key] ?? ''
  })
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildFollowUpHtml(
  body: string,
  options?: {
    couponCode?: string | null
    discountLabel?: string | null
    ctaUrl?: string | null
  }
) {
  const lines = escapeHtml(body)
    .split('\n')
    .map((line) => (line.trim() ? line : '&nbsp;'))
    .join('<br/>')
  const couponCode = escapeHtml(options?.couponCode || 'ALPA30')
  const discountLabel = escapeHtml(options?.discountLabel || DEFAULT_FOLLOW_UP_SETTINGS.discount_label || '10% off')
  const ctaUrl = escapeHtml(options?.ctaUrl || 'https://alpa.mindrasolutions.com/plans')

  return `
    <div style="margin:0;background:#f8fafc;padding:34px 16px;color:#0f172a;font-family:Arial,sans-serif;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid rgba(15,23,42,0.08);border-radius:22px;overflow:hidden;">
        <div style="padding:30px 34px 18px;">
          <div style="font-size:20px;font-weight:800;letter-spacing:0.04em;color:#0f172a;">ALPA</div>
          <h1 style="margin:24px 0 0;font-size:26px;line-height:1.2;font-weight:750;color:#0f172a;">Keep fresh leads flowing</h1>
          <div style="margin-top:18px;font-size:15px;line-height:1.75;color:#334155;">${lines}</div>
          <div style="margin-top:26px;border:1px solid rgba(37,99,235,0.16);background:#eff6ff;border-radius:18px;padding:20px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#2563eb;">${discountLabel}</div>
            <div style="margin-top:8px;font-size:28px;line-height:1;font-weight:800;color:#0f172a;">${couponCode}</div>
          </div>
          <div style="margin-top:26px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:14px;padding:14px 20px;font-size:14px;font-weight:700;">Use coupon in ALPA</a>
          </div>
        </div>
        <div style="border-top:1px solid rgba(15,23,42,0.08);padding:18px 34px 28px;font-size:12px;line-height:1.6;color:#64748b;">
          ALPA by MINDRA<br/>
          You are receiving this because you requested lead delivery from ALPA.
        </div>
      </div>
    </div>
  `
}
