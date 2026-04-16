import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = 'ALPA by MINDRA <info@mindrasolutions.com>'

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
})

function buildHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const withBreaks = escaped.replace(/\n/g, '<br/>')
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;padding:20px;max-width:520px;">${withBreaks}<p style="font-size:11px;color:#888;margin-top:20px;">Sent via ALPA</p></div>`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { ids } = parsed.data

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    // Fetch approved rows belonging to this user
    const { data: rows, error: fetchError } = await supabase
      .from('outreach_queue')
      .select('id, contact_email, subject, full_email, body')
      .in('id', ids)
      .eq('user_id', userId)
      .eq('review_status', 'approved')

    if (fetchError) {
      console.error('[outreach-queue/send] fetch error:', fetchError)
      return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 500 })
    }

    if (!rows?.length) {
      return NextResponse.json({ error: 'NO_APPROVED_ROWS', sent: 0, failed: 0 }, { status: 200 })
    }

    let sent = 0
    let failed = 0
    const sentIds: string[] = []
    const failedIds: string[] = []

    for (const row of rows) {
      if (!row.contact_email) {
        console.log('[outreach-queue/send] SKIP (no email):', row.id)
        failedIds.push(row.id)
        failed++
        continue
      }

      const emailBody = row.full_email || row.body || ''
      if (!emailBody || !row.subject) {
        console.log('[outreach-queue/send] SKIP (no content):', row.id)
        failedIds.push(row.id)
        failed++
        continue
      }

      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: [row.contact_email],
          subject: row.subject,
          html: buildHtml(emailBody),
        })

        sentIds.push(row.id)
        sent++
        console.log('[outreach-queue/send] SENT:', { id: row.id, to: row.contact_email })
      } catch (err) {
        console.error('[outreach-queue/send] SEND FAILED:', { id: row.id, err })
        failedIds.push(row.id)
        failed++
      }
    }

    const now = new Date().toISOString()

    // Mark sent rows
    if (sentIds.length > 0) {
      const { error: updateError } = await supabase
        .from('outreach_queue')
        .update({ review_status: 'sent', updated_at: now })
        .in('id', sentIds)
        .eq('user_id', userId)

      if (updateError) {
        console.error('[outreach-queue/send] update sent error (non-fatal):', updateError)
      }
    }

    return NextResponse.json({ sent, failed })
  } catch (err) {
    console.error('[outreach-queue/send] error:', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
