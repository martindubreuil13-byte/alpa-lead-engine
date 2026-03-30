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
  const leads = Array.isArray(payload.leads) ? payload.leads.slice(0, 10) : []
  const listHtml = leads
    .map(
      (lead) => `
        <div style="padding:16px 0;border-bottom:1px solid rgba(148,163,184,0.16);">
          <div style="font-size:16px;font-weight:700;color:#0f172a;">${lead.company_name}</div>
          <div style="margin-top:6px;color:#334155;">${lead.email || lead.phone || 'No direct contact found'}</div>
          <div style="margin-top:4px;color:#64748b;">${lead.city || 'Unknown city'}</div>
        </div>
      `
    )
    .join('')

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:32px 16px;color:#0f172a;">
      <div style="max-width:640px;margin:0 auto;background:white;border-radius:24px;padding:32px;border:1px solid rgba(15,23,42,0.08);">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#06b6d4;">ALPA</div>
        <h1 style="margin:18px 0 0;font-size:30px;line-height:1.05;">Your ALPA results are ready</h1>
        <p style="margin:16px 0 0;font-size:16px;line-height:1.7;color:#334155;">${payload.summaryLine || 'Your latest results are attached.'}</p>
        ${
          payload.detailLine
            ? `<p style="margin:10px 0 0;font-size:15px;line-height:1.7;color:#475569;">${payload.detailLine}</p>`
            : ''
        }
        ${
          payload.limitMessage
            ? `<p style="margin:10px 0 0;font-size:15px;line-height:1.7;color:#92400e;">${payload.limitMessage}</p>`
            : ''
        }
        <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#64748b;">A CSV of the leads saved in this session is attached.</p>
        <div style="margin-top:24px;">${listHtml}</div>
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
      from: 'ALPA <onboarding@resend.dev>',
      to: [payload.toEmail],
      subject: 'Your ALPA lead results',
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
