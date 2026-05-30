import { NextResponse } from 'next/server'

import {
  buildFollowUpHtml,
  isValidEmail,
  normalizeEmail,
  normalizeText,
  renderFollowUpTemplate,
} from '@/lib/admin/lead-follow-ups'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type TestEmailPayload = {
  coupon_code?: unknown
  discount_label?: unknown
  email_subject?: unknown
  email_body_template?: unknown
  admin_notification_email?: unknown
}

type ResendEmailResult = {
  id?: string
  message?: string
  error?: { message?: string } | string
}

function getResendErrorMessage(result: ResendEmailResult | null) {
  if (!result) return 'Failed to send test email.'
  if (typeof result.error === 'string') return result.error
  if (result.error?.message) return result.error.message
  if (result.message) return result.message
  return 'Failed to send test email.'
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    const { error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'RESEND_API_KEY is not configured.' }, { status: 500 })
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const body = (await req.json().catch(() => null)) as TestEmailPayload | null
    const toEmail =
      normalizeEmail(body?.admin_notification_email) ||
      normalizeEmail(user?.email) ||
      normalizeEmail(process.env.ADMIN_EMAIL)

    if (!toEmail || !isValidEmail(toEmail)) {
      return NextResponse.json({ error: 'A valid admin email is required.' }, { status: 400 })
    }

    const templateInput = {
      email: toEmail,
      searchQuery: 'web design agencies',
      location: 'Austin, TX',
      leadCount: 25,
      couponCode: normalizeText(body?.coupon_code) || 'ALPA10',
      discountLabel: normalizeText(body?.discount_label) || '10% off your first month',
    }
    const subject = renderFollowUpTemplate(
      normalizeText(body?.email_subject) || 'Still need fresh leads? Use {{coupon_code}}',
      templateInput
    )
    const emailBody = renderFollowUpTemplate(
      normalizeText(body?.email_body_template) || 'Hi,\n\nUse {{coupon_code}} for {{discount}}.',
      templateInput
    )
    const emailHtml = buildFollowUpHtml(emailBody, {
      couponCode: templateInput.couponCode,
      discountLabel: templateInput.discountLabel,
    })

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ALPA <info@mindrasolutions.com>',
        to: [toEmail],
        subject,
        text: emailBody,
        html: emailHtml,
      }),
    })
    const result = (await response.json().catch(() => null)) as ResendEmailResult | null

    if (!response.ok) {
      throw new Error(getResendErrorMessage(result))
    }

    return NextResponse.json({ sentTo: toEmail, id: result?.id ?? null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send test email.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
