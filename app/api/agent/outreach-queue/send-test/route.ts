import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = 'ALPA by MINDRA <info@mindrasolutions.com>'

const requestSchema = z.object({
  id: z.string().uuid(),
})

function buildHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const withBreaks = escaped.replace(/\n/g, '<br/>')
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;padding:20px;max-width:520px;">${withBreaks}<p style="font-size:11px;color:#888;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">⚠ This is a test preview — not sent to the prospect.</p></div>`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { id } = parsed.data

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

    await resend.emails.send({
      from: FROM_EMAIL,
      to: [user.email],
      subject: subjectLine,
      html: buildHtml(emailBody),
    })

    console.log('[send-test] sent preview to', user.email, { id: row.id, company: row.company_name })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[send-test] error:', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
