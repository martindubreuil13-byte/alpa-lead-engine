import { NextResponse } from 'next/server'

import { buildLeadCsv } from '@/lib/leads/csv'
import type { TrialLead } from '@/lib/trial'

export const runtime = 'nodejs'

type ResultsEmailPayload = {
  toEmail?: string
  email?: string
  leads?: TrialLead[]
  summaryLine?: string
  detailLine?: string | null
  limitMessage?: string | null
  elapsedSeconds?: number | null
}

type ResendEmailResult = {
  id?: string
  message?: string
  error?: {
    message?: string
    name?: string
  } | string
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function getResendErrorMessage(result: ResendEmailResult | null) {
  if (!result) return 'Failed to send your results'
  if (typeof result.error === 'string') return result.error
  if (result.error?.message) return result.error.message
  if (result.message) return result.message
  return 'Failed to send your results'
}

function buildResultsEmailHtml(payload: ResultsEmailPayload) {
  const leads = Array.isArray(payload.leads) ? payload.leads.slice(0, 5) : []
  const leadCount = Array.isArray(payload.leads) ? payload.leads.length : leads.length
  const elapsed = payload.elapsedSeconds ?? null

  const statsLine =
    leadCount > 0 && elapsed !== null
      ? `You generated ${leadCount} lead${leadCount !== 1 ? 's' : ''} in ${elapsed} second${elapsed !== 1 ? 's' : ''}.`
      : leadCount > 0
        ? `You generated ${leadCount} lead${leadCount !== 1 ? 's' : ''}.`
        : (payload.summaryLine ?? 'Your latest results are attached.')

  const listHtml = leads
    .map((lead) => {
      const contact = lead.email || lead.phone || 'No direct contact found'
      const location = lead.city || ''
      return `
        <div style="padding:14px 0;border-top:1px solid rgba(148,163,184,0.12);">
          <div style="font-size:15px;font-weight:600;color:#0f172a;">${lead.company_name}</div>
          <div style="margin-top:4px;font-size:14px;line-height:1.6;color:#334155;">${contact}</div>
          ${location ? `<div style="margin-top:2px;font-size:13px;color:#64748b;">${location}</div>` : ''}
        </div>
      `
    })
    .join('')

  return `
    <div style="margin:0;background:#f8fafc;padding:32px 16px;color:#0f172a;font-family:Arial,sans-serif;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid rgba(15,23,42,0.08);border-radius:20px;padding:40px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#3b82f6;">ALPA</div>
        <h1 style="margin:20px 0 0;font-size:28px;line-height:1.1;font-weight:700;color:#0f172a;">Your ALPA leads are ready</h1>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.75;color:#334155;">Thanks for trying ALPA.</p>
        <p style="margin:12px 0 0;font-size:15px;line-height:1.75;color:#334155;">${statsLine} I hope these leads help you start a few useful conversations and open new business opportunities.</p>
        <p style="margin:12px 0 0;font-size:15px;line-height:1.75;color:#334155;">ALPA was built to remove the unpaid manual work of lead hunting — so you can spend more time selling, serving, and building.</p>
        <p style="margin:20px 0 0;font-size:15px;line-height:1.75;color:#334155;">If you want to keep prospecting, plans start at $9.99/month: <a href="https://alpa.mindrasolutions.com/plans" style="color:#3b82f6;text-decoration:none;">alpa.mindrasolutions.com/plans</a></p>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#64748b;">Your leads are attached as a CSV below.</p>
        ${listHtml ? `<div style="margin-top:24px;">${listHtml}</div>` : ''}
        <div style="margin-top:36px;padding-top:24px;border-top:1px solid rgba(148,163,184,0.14);">
          <p style="margin:0;font-size:15px;line-height:1.75;color:#334155;">Good luck with the outreach,</p>
          <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#0f172a;">Martin</p>
          <p style="margin:2px 0 0;font-size:13px;color:#64748b;">ALPA by MINDRA</p>
        </div>
      </div>
    </div>
  `
}

async function sendWithResend(payload: ResultsEmailPayload & { toEmail: string; leads: TrialLead[] }) {
  const csv = buildLeadCsv(payload.leads)

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ALPA <info@mindrasolutions.com>',
      to: [payload.toEmail],
      subject: 'Your ALPA leads are ready (CSV attached)',
      text: 'Your ALPA leads are attached.',
      html: buildResultsEmailHtml(payload),
      attachments: [
        {
          filename: 'alpa-leads.csv',
          content: Buffer.from(csv, 'utf8').toString('base64'),
        },
      ],
    }),
  })

  const result = (await response.json().catch(() => null)) as ResendEmailResult | null

  if (!response.ok) {
    throw new Error(getResendErrorMessage(result))
  }

  if (!result) {
    throw new Error('Empty response from email provider')
  }

  return result
}

export async function POST(req: Request) {
  try {
    const payload: ResultsEmailPayload = await req.json()
    const toEmail = String(payload.toEmail || payload.email || '').trim().toLowerCase()
    const leads = Array.isArray(payload.leads) ? payload.leads : []

    if (!toEmail) {
      return NextResponse.json({ error: 'Email failed: Missing recipient email' }, { status: 400 })
    }

    if (!isValidEmail(toEmail)) {
      return NextResponse.json({ error: 'Email failed: Please enter a valid email' }, { status: 400 })
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email failed: RESEND_API_KEY is not configured' }, { status: 500 })
    }

    if (leads.length === 0) {
      return NextResponse.json({ error: 'Email failed: No results available to send' }, { status: 400 })
    }

    const result = await sendWithResend({
      ...payload,
      toEmail,
      leads,
    })

    console.log('EMAIL SUCCESS:', result)

    return NextResponse.json(
      {
        message: 'Email sent successfully',
        id: result.id ?? null,
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('EMAIL ERROR:', error)

    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Failed to send your results'

    return NextResponse.json(
      {
        error: `Email failed: ${message}`,
      },
      { status: 500 }
    )
  }
}
