import { NextResponse } from 'next/server'

import {
  DEFAULT_FOLLOW_UP_SETTINGS,
  getEffectiveFollowUpSettings,
  normalizeEmail,
  normalizeExclusionPatterns,
  normalizeText,
} from '@/lib/admin/lead-follow-ups'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type SettingsPayload = {
  follow_up_delay_days?: unknown
  coupon_code?: unknown
  discount_label?: unknown
  email_subject?: unknown
  email_body_template?: unknown
  send_copy_to_admin?: unknown
  admin_notification_email?: unknown
  exclusion_patterns?: unknown
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    const { error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const body = (await req.json().catch(() => null)) as SettingsPayload | null
    const delayDays = Number(body?.follow_up_delay_days)
    const emailSubject =
      normalizeText(body?.email_subject) || DEFAULT_FOLLOW_UP_SETTINGS.email_subject
    const emailBodyTemplate =
      normalizeText(body?.email_body_template) ||
      DEFAULT_FOLLOW_UP_SETTINGS.email_body_template
    const adminNotificationEmail = normalizeEmail(body?.admin_notification_email)

    if (!Number.isFinite(delayDays) || delayDays < 0 || delayDays > 90) {
      return NextResponse.json({ error: 'Follow-up delay must be between 0 and 90 days.' }, { status: 400 })
    }

    if (adminNotificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminNotificationEmail)) {
      return NextResponse.json({ error: 'Admin notification email is invalid.' }, { status: 400 })
    }

    const admin = createAdminClient()
    const settingsTable = admin.from('follow_up_settings' as never) as any
    const { data: existing } = await settingsTable
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const payload: Database['public']['Tables']['follow_up_settings']['Update'] = {
      follow_up_delay_days: Math.floor(delayDays),
      coupon_code: normalizeText(body?.coupon_code),
      discount_label: normalizeText(body?.discount_label),
      email_subject: emailSubject,
      email_body_template: emailBodyTemplate,
      send_copy_to_admin: body?.send_copy_to_admin === true,
      admin_notification_email: adminNotificationEmail,
      exclusion_patterns: normalizeExclusionPatterns(body?.exclusion_patterns),
      updated_at: new Date().toISOString(),
    }

    const request = existing?.id
      ? settingsTable.update(payload).eq('id', existing.id).select('*').single()
      : settingsTable
          .insert(payload as Database['public']['Tables']['follow_up_settings']['Insert'])
          .select('*')
          .single()

    const { data, error } = await request

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const effectiveSettings = getEffectiveFollowUpSettings(data as any)
    return NextResponse.json({ settings: effectiveSettings })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save settings.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
