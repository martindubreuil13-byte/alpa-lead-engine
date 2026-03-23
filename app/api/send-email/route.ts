import nodemailer from 'nodemailer'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

import { buildFinalEmailHtml, buildSignatureHtml, buildTemplateBodyHtml } from '@/lib/email/signature'

export const runtime = 'nodejs'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type RequestBody = {
  leadIds?: string[]
  templateId?: string
  testMode?: boolean
  testEmail?: string
}

type TemplateRow = {
  id: string
  user_id: string
  name: string
  tag: string | null
  subject: string | null
  body: string | null
  created_at: string
}

type SenderSettingsRow = {
  id: string
  user_id: string
  sender_name: string | null
  sender_email: string | null
  company_name: string | null
  job_title: string | null
  phone: string | null
  website: string | null
  logo_url: string | null
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options)
              })
            } catch {}
          },
        },
      }
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload: RequestBody = await req.json()
    const leadIds = payload.leadIds || []
    const templateId = payload.templateId || ''
    const testMode = payload.testMode === true
    const testEmail = payload.testEmail?.trim() || ''

    if (!testMode && leadIds.length === 0) {
      return NextResponse.json({ error: 'No leads provided' }, { status: 400 })
    }

    if (!templateId) {
      return NextResponse.json({ error: 'No template selected' }, { status: 400 })
    }

    const { data: templateData, error: templateError } = await admin
      .from('templates')
      .select('id, user_id, name, tag, subject, body, created_at')
      .eq('id', templateId)
      .eq('user_id', user.id)
      .single()

    if (templateError || !templateData) {
      console.error('FULL ERROR:', JSON.stringify(templateError, null, 2))
      return NextResponse.json({ error: 'Selected template not found' }, { status: 400 })
    }

    const { data: senderData, error: senderError } = await admin
      .from('sender_settings')
      .select('id, user_id, sender_name, sender_email, company_name, job_title, phone, website, logo_url')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (senderError || !senderData) {
      console.error('FULL ERROR:', JSON.stringify(senderError, null, 2))
      return NextResponse.json({ error: 'No sender settings found' }, { status: 400 })
    }

    const template = templateData as TemplateRow
    const senderSettings = senderData as SenderSettingsRow
    const finalBody = buildFinalEmailHtml(template.body, senderSettings)
    const subject = template.subject?.trim() || ''

    console.log('TEMPLATE:', template)
    console.log('SENDER:', senderSettings)
    console.log('FINAL EMAIL BODY:', finalBody)

    if (!subject || !finalBody) {
      return NextResponse.json(
        { error: 'Selected template is missing subject or body' },
        { status: 400 }
      )
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    const fromName = senderSettings.sender_name?.trim() || 'Prospecting Team'
    const fromEmail = senderSettings.sender_email?.trim() || process.env.SMTP_USER!

    if (testMode) {
      if (!testEmail) {
        return NextResponse.json({ error: 'No test email provided' }, { status: 400 })
      }

      const formattedBody = buildTemplateBodyHtml(template.body).replace(/\n/g, '')
      const signature = buildSignatureHtml(senderSettings)
      const testEmailBody =
        formattedBody && signature ? `${formattedBody}<br/><br/>${signature}` : formattedBody || signature

      console.log('FINAL EMAIL BODY:', testEmailBody)

      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        replyTo: senderSettings.sender_email?.trim() || undefined,
        to: testEmail,
        subject,
        html: `
          <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#111827;padding:20px;">
            ${testEmailBody}
          </div>
        `,
      })

      return NextResponse.json({
        success: true,
        testMode: true,
        sent: 1,
      })
    }

    const { data: leads, error: leadsError } = await admin
      .from('leads')
      .select('id, user_id, company_name, email')
      .eq('user_id', user.id)
      .in('id', leadIds)

    if (leadsError || !leads || leads.length === 0) {
      console.error('FULL ERROR:', JSON.stringify(leadsError, null, 2))
      return NextResponse.json({ error: 'No leads found' }, { status: 404 })
    }

    const validLeads = leads.filter((lead) => lead.email && lead.email.includes('@'))
    const skippedLeads = leads.length - validLeads.length

    if (validLeads.length === 0) {
      return NextResponse.json({ error: 'No valid emails found' }, { status: 400 })
    }

    let sentCount = 0
    const sentLeadIds: string[] = []
    const failed: string[] = []

    for (const lead of validLeads) {
      const recipient = lead.email!

      try {
        await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          replyTo: senderSettings.sender_email?.trim() || undefined,
          to: recipient,
          subject,
          html: `
            <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#111827;padding:20px;">
              ${finalBody}
            </div>
          `,
        })

        sentCount += 1
        sentLeadIds.push(lead.id)
      } catch (err: any) {
        console.error(`Failed sending to ${recipient}:`, err?.message || err)
        failed.push(recipient)
      }
    }

    if (sentLeadIds.length > 0) {
      await admin
        .from('leads')
        .update({
          status: 'contacted',
          contacted_at: new Date().toISOString(),
          status_updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .in('id', sentLeadIds)
    }

    return NextResponse.json({
      success: true,
      sent: sentCount,
      sentIds: sentLeadIds,
      skipped: skippedLeads,
      failed,
    })
  } catch (error: any) {
    console.error('send-email error:', error?.message || error)
    return NextResponse.json(
      { error: error?.message || 'Failed to send emails' },
      { status: 500 }
    )
  }
}
