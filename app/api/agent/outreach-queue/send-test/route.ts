import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import {
  buildOutreachEmailHtml,
  buildOutreachSenderProfile,
  OUTREACH_FROM_EMAIL,
  type OutreachSenderSettings,
} from '@/lib/outreach/render-email'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)

const requestSchema = z.object({
  id: z.string().uuid(),
})

function fromSupabaseTable(supabase: Awaited<ReturnType<typeof createServerClient>>, table: string) {
  return supabase.from(table as never) as any
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
    const extra = error as Error & {
      status?: unknown
      statusCode?: unknown
      response?: unknown
      body?: unknown
      cause?: unknown
    }
    if (extra.status !== undefined) details.status = extra.status
    if (extra.statusCode !== undefined) details.statusCode = extra.statusCode
    if (extra.response !== undefined) details.response = extra.response
    if (extra.body !== undefined) details.body = extra.body
    if (extra.cause !== undefined) details.cause = extra.cause
    return details
  }

  if (error && typeof error === 'object') {
    return { ...(error as Record<string, unknown>) }
  }

  return { message: String(error) }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'Unknown send failure'
}

export async function POST(req: Request) {
  let diagnosticContext: {
    queueId: string | null
    leadId: string | null
    recipient: string | null
    subject: string | null
  } = {
    queueId: null,
    leadId: null,
    recipient: null,
    subject: null,
  }

  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { id } = parsed.data
    diagnosticContext = { ...diagnosticContext, queueId: id }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    // Get logged-in user's email — this is where the test email goes
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.email) {
      return NextResponse.json({ error: 'USER_EMAIL_NOT_FOUND' }, { status: 400 })
    }

    if (user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const { data: senderSettings, error: senderSettingsError } = await fromSupabaseTable(supabase, 'sender_settings')
      .select('sender_name, sender_email, company_name, job_title, phone, website, logo_url')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (senderSettingsError) {
      console.error('[send-test] sender settings fetch error:', senderSettingsError)
    }

    const senderProfile = buildOutreachSenderProfile(senderSettings as OutreachSenderSettings | null, {
      name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
      email: user.email,
    })

    // Fetch the outreach item (any review_status — test can be sent for drafts too)
    const { data: row, error: fetchError } = await supabase
      .from('outreach_queue')
      .select('id, subject, full_email, body, company_name, contact_email')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchError || !row) {
      return NextResponse.json({ error: 'ITEM_NOT_FOUND' }, { status: 404 })
    }

    const emailBody = row.full_email || row.body || ''
    if (!emailBody || !row.subject) {
      return NextResponse.json({ error: 'NO_CONTENT' }, { status: 400 })
    }

    const subjectPrefix = `[TEST] `
    const subjectLine = `${subjectPrefix}${row.subject}`
    diagnosticContext = {
      queueId: row.id,
      leadId: null,
      recipient: user.email,
      subject: subjectLine,
    }

    const payload = {
      from: OUTREACH_FROM_EMAIL,
      to: [user.email],
      subject: subjectLine,
      html: buildOutreachEmailHtml(emailBody, {
        senderProfile,
        footerHtml:
          '<p style="font-size:11px;color:#888;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">Test preview - not sent to the prospect.</p>',
      }),
    }

    console.log('[send-test] resend.emails.send START', {
      queueId: row.id,
      leadId: null,
      recipient: user.email,
      originalRecipient: row.contact_email,
      to: payload.to,
      from: payload.from,
      subject: payload.subject,
    })

    const resendResponse = await resend.emails.send(payload)
    const resendResponseError = (resendResponse as { error?: unknown } | null)?.error || null

    console.log('[send-test] resend.emails.send RESULT', {
      queueId: row.id,
      leadId: null,
      recipient: user.email,
      originalRecipient: row.contact_email,
      subject: payload.subject,
      resendResponse,
      resendError: resendResponseError,
      messageId:
        (resendResponse as { data?: { id?: string }; id?: string } | null)?.data?.id ||
        (resendResponse as { id?: string } | null)?.id ||
        null,
    })

    if (resendResponseError) {
      console.error('[send-test] resend.emails.send RESPONSE ERROR', {
        queueId: row.id,
        leadId: null,
        recipient: user.email,
        originalRecipient: row.contact_email,
        subject: payload.subject,
        resendResponse,
        resendError: resendResponseError,
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const resendError = serializeError(err)
    console.error('[send-test] resend.emails.send or route error', {
      ...diagnosticContext,
      resendError,
      stack: err instanceof Error ? err.stack : null,
    })
    return NextResponse.json(
      {
        error: 'SEND_FAILED',
        message: getErrorMessage(err),
        queueId: diagnosticContext.queueId,
        recipient: diagnosticContext.recipient,
      },
      { status: 500 }
    )
  }
}
