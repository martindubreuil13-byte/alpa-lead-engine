import nodemailer from 'nodemailer'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import type { TrialLead } from '@/lib/trial'

export const runtime = 'nodejs'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type GuestCapturePayload = {
  email?: string
  guestSessionId?: string
  trigger?: 'export' | 'copy' | 'limit'
  leads?: TrialLead[]
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function buildPreviewRows(leads: TrialLead[]) {
  return leads
    .slice(0, 8)
    .map((lead) => ({
      company_name: lead.company_name,
      email: lead.email || 'No email',
      city: lead.city || 'Unknown city',
      website: lead.website || '',
    }))
}

function buildPreviewEmailHtml(previewRows: ReturnType<typeof buildPreviewRows>, appUrl: string) {
  const previewList = previewRows
    .map((lead) => {
      const websiteLine = lead.website
        ? `<div style="margin-top:4px;color:#64748b;">${lead.website}</div>`
        : ''

      return `
        <div style="padding:16px 0;border-bottom:1px solid rgba(148,163,184,0.16);">
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${lead.company_name}</div>
          <div style="margin-top:6px;color:#334155;">${lead.email}</div>
          <div style="margin-top:4px;color:#64748b;">${lead.city}</div>
          ${websiteLine}
        </div>
      `
    })
    .join('')

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:32px 16px;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:white;border-radius:24px;padding:32px;border:1px solid rgba(15,23,42,0.08);">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#06b6d4;">ALPA</div>
        <h1 style="margin:18px 0 0;font-size:30px;line-height:1.05;">Your leads are ready</h1>
        <p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#334155;">
          Here's a preview of the leads ALPA found for you.
        </p>

        <div style="margin-top:24px;">
          ${previewList}
        </div>

        <div style="margin-top:28px;">
          <a
            href="${appUrl}/login"
            style="display:inline-block;padding:14px 20px;border-radius:16px;background:linear-gradient(135deg,#22d3ee,#14b8a6);color:#020617;text-decoration:none;font-weight:700;"
          >
            Unlock full list and keep generating leads
          </a>
        </div>

        <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#64748b;">
          This email includes a preview only. Full exports stay locked until you upgrade.
        </p>
      </div>
    </div>
  `
}

export async function POST(req: Request) {
  try {
    const payload: GuestCapturePayload = await req.json()
    const email = String(payload.email || '').trim().toLowerCase()
    const guestSessionId = String(payload.guestSessionId || '').trim()
    const trigger = payload.trigger || 'export'
    const leads = Array.isArray(payload.leads) ? payload.leads : []

    if (!guestSessionId) {
      return NextResponse.json({ error: 'Missing guest session' }, { status: 400 })
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Please enter a valid email' }, { status: 400 })
    }

    if (leads.length === 0) {
      return NextResponse.json({ error: 'No leads available' }, { status: 400 })
    }

    const previewRows = buildPreviewRows(leads)
    const appUrl = new URL(req.url).origin

    await admin
      .from('guest_lead_captures')
      .upsert(
        {
          guest_session_id: guestSessionId,
          email,
          lead_count: leads.length,
          preview_count: previewRows.length,
          last_trigger: trigger,
          last_preview_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'guest_session_id' }
      )

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    await transporter.sendMail({
      from: `"ALPA" <${process.env.SMTP_USER!}>`,
      to: email,
      subject: 'Your leads are ready',
      html: buildPreviewEmailHtml(previewRows, appUrl),
    })

    return NextResponse.json({
      success: true,
      previewCount: previewRows.length,
    })
  } catch (error: any) {
    console.error('guest capture error:', error?.message || error)
    return NextResponse.json(
      { error: error?.message || 'Failed to send preview email' },
      { status: 500 }
    )
  }
}
