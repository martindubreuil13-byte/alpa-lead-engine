import { NextResponse } from 'next/server'

import {
  buildFollowUpHtml,
  getEffectiveFollowUpSettings,
  isExcludedEmail,
  isValidEmail,
  normalizeEmail,
  normalizeText,
  renderFollowUpTemplate,
} from '@/lib/admin/lead-follow-ups'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

export const runtime = 'nodejs'

type ActivityLogRow = Database['public']['Tables']['activity_logs']['Row']
type LeadFollowUpRow = Database['public']['Tables']['lead_follow_ups']['Row']
type UserRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'email' | 'plan'>
type ResendEmailResult = { id?: string; message?: string; error?: { message?: string } | string }

function getResendErrorMessage(result: ResendEmailResult | null) {
  if (!result) return 'Failed to send follow-up email.'
  if (typeof result.error === 'string') return result.error
  if (result.error?.message) return result.error.message
  if (result.message) return result.message
  return 'Failed to send follow-up email.'
}

async function sendEmail(payload: {
  toEmail: string
  subject: string
  body: string
  html: string
  ccEmail: string | null
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ALPA <info@mindrasolutions.com>',
      to: [payload.toEmail],
      ...(payload.ccEmail ? { cc: [payload.ccEmail] } : {}),
      subject: payload.subject,
      text: payload.body,
      html: payload.html,
    }),
  })

  const result = (await response.json().catch(() => null)) as ResendEmailResult | null

  if (!response.ok) {
    throw new Error(getResendErrorMessage(result))
  }

  return result
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'RESEND_API_KEY is not configured.' }, { status: 500 })
    }

    const admin = createAdminClient()
    const settingsTable = admin.from('follow_up_settings' as never) as any
    const followUpsTable = admin.from('lead_follow_ups' as never) as any

    const { data: settingsRow } = await settingsTable
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const settings = getEffectiveFollowUpSettings(settingsRow)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - settings.follow_up_delay_days)

    const [{ data: logsData }, { data: existingData }] = await Promise.all([
      admin
        .from('activity_logs')
        .select('id, session_id, user_id, email, event, query, location, leads_count, metadata, created_at')
        .eq('event', 'email_export_sent')
        .lte('created_at', cutoff.toISOString())
        .order('created_at', { ascending: true })
        .limit(10000),
      followUpsTable.select('*').limit(10000),
    ])

    const logs = (logsData || []) as ActivityLogRow[]
    const existingFollowUps = (existingData || []) as LeadFollowUpRow[]
    const userIds = [...new Set(logs.map((log) => log.user_id).filter(Boolean))] as string[]
    const { data: usersData } = userIds.length
      ? await admin.from('users').select('id, email, plan').in('id', userIds)
      : { data: [] }
    const usersById = new Map(((usersData || []) as UserRow[]).map((user) => [user.id, user]))

    const existingByEmail = new Map(existingFollowUps.map((followUp) => [followUp.email.toLowerCase(), followUp]))
    const latestCaptureByEmail = new Map<string, ActivityLogRow>()

    for (const log of logs) {
      const user = log.user_id ? usersById.get(log.user_id) : null
      if (user?.plan === 'admin') continue
      const email = normalizeEmail(log.email) || normalizeEmail(user?.email)
      if (!email || !isValidEmail(email)) continue
      if (isExcludedEmail(email, settings.exclusion_patterns)) continue

      const existing = existingByEmail.get(email)
      if (existing?.followup_sent || existing?.follow_up_sent_at || existing?.status === 'sent') continue

      if (!latestCaptureByEmail.has(email)) {
        latestCaptureByEmail.set(email, log)
      }
    }

    const summary = {
      eligible: latestCaptureByEmail.size,
      sent: 0,
      failed: 0,
    }
    const updatedFollowUps: LeadFollowUpRow[] = []
    const adminCopyEmail =
      settings.send_copy_to_admin && settings.admin_notification_email
        ? settings.admin_notification_email
        : null

    for (const [email, log] of latestCaptureByEmail.entries()) {
      const existing = existingByEmail.get(email) || null
      const templateInput = {
        email,
        searchQuery: null,
        location: null,
        leadCount: log.leads_count || 0,
        couponCode: settings.coupon_code,
        discountLabel: settings.discount_label,
      }
      const subject = renderFollowUpTemplate(settings.email_subject, templateInput)
      const emailBody = renderFollowUpTemplate(settings.email_body_template, templateInput)
      const emailHtml = buildFollowUpHtml(emailBody, {
        couponCode: settings.coupon_code,
        discountLabel: settings.discount_label,
      })
      const now = new Date().toISOString()

      try {
        const result = await sendEmail({
          toEmail: email,
          subject,
          body: emailBody,
          html: emailHtml,
          ccEmail: adminCopyEmail,
        })

        const payload: Database['public']['Tables']['lead_follow_ups']['Insert'] = {
          source_activity_id: log.id,
          session_id: normalizeText(log.session_id),
          user_id: normalizeText(log.user_id),
          email,
          lead_count: log.leads_count || 0,
          followup_sent: true,
          status: 'sent',
          converted: false,
          email_subject: subject,
          email_body: emailBody,
          email_html: emailHtml,
          provider_message_id: result?.id ?? null,
          last_error: null,
          created_at: log.created_at,
          follow_up_sent_at: now,
          updated_at: now,
        }
        const request = existing?.id
          ? followUpsTable.update(payload).eq('id', existing.id).select('*').single()
          : followUpsTable.insert(payload).select('*').single()
        const { data, error } = await request

        if (error) throw new Error(error.message)
        if (data) updatedFollowUps.push(data as LeadFollowUpRow)
        summary.sent += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send follow-up email.'
        const payload: Database['public']['Tables']['lead_follow_ups']['Insert'] = {
          source_activity_id: log.id,
          session_id: normalizeText(log.session_id),
          user_id: normalizeText(log.user_id),
          email,
          lead_count: log.leads_count || 0,
          followup_sent: false,
          status: 'failed',
          converted: false,
          email_subject: subject,
          email_body: emailBody,
          email_html: emailHtml,
          last_error: message,
          created_at: log.created_at,
          follow_up_sent_at: null,
          updated_at: now,
        }
        const request = existing?.id
          ? followUpsTable.update(payload).eq('id', existing.id).select('*').single()
          : followUpsTable.insert(payload).select('*').single()
        const { data } = await request
        if (data) updatedFollowUps.push(data as LeadFollowUpRow)
        summary.failed += 1
      }
    }

    return NextResponse.json({ summary, followUps: updatedFollowUps })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to run follow-up job.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
