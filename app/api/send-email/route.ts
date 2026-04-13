import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

import {
  DAILY_EMAIL_LIMIT,
  type EmailUsageSnapshot,
} from '@/lib/email/send-limits'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = 'ALPA by MINDRA <info@mindrasolutions.com>'
const RESEND_THROTTLE_DELAY_MS = 300

const senderProfileSchema = z
  .object({
    name: z.string().trim().optional(),
    title: z.string().trim().optional(),
    company: z.string().trim().optional(),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    website: z.string().trim().optional(),
    logoUrl: z.string().trim().url().optional().catch(undefined),
  })
  .optional()

const sendEmailSchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().min(4).max(200),
  html: z.string().trim().min(1).max(100_000),
  userEmail: z.string().trim().email(),
  userName: z.string().trim().max(120).optional().catch(''),
  senderProfile: senderProfileSchema,
  isTest: z.boolean().optional(),
})

type SenderProfile = z.infer<NonNullable<typeof senderProfileSchema>>

function getDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

function buildUsageSnapshot(sent: number): EmailUsageSnapshot {
  return {
    sent,
    limit: DAILY_EMAIL_LIMIT,
    remaining: Math.max(DAILY_EMAIL_LIMIT - sent, 0),
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function countLinks(html: string) {
  const anchorLinks = html.match(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>/gi) ?? []
  const withoutAnchors = html.replace(/<a\b[^>]*>.*?<\/a>/gis, ' ')
  const plainUrls = withoutAnchors.match(/https?:\/\/[^\s<>"']+/gi) ?? []

  return anchorLinks.length + plainUrls.length
}

function containsUnsafeMarkup(html: string) {
  return /<(script|iframe)\b/i.test(html)
}

function isValidPublicUrl(url: string | undefined) {
  if (!url) {
    return false
  }

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function getSafeText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? escapeHtml(trimmed) : ''
}

function formatTemplateContent(content: string) {
  const trimmed = content.trim()

  if (!trimmed) {
    return ''
  }

  return /<[^>]+>/.test(trimmed) ? trimmed : trimmed.replace(/\n/g, '<br/>')
}

function buildSignature(profile: SenderProfile | undefined) {
  if (!profile) return ''

  const name = getSafeText(profile.name)
  const title = getSafeText(profile.title)
  const company = getSafeText(profile.company)
  const email = getSafeText(profile.email)
  const safeLogo =
    profile.logoUrl && isValidPublicUrl(profile.logoUrl) ? escapeHtml(profile.logoUrl) : null

  const hasContent = Boolean(name || title || company || email || safeLogo)

  if (!hasContent) return ''

  return `
  <div style="margin-top:20px;">
    <strong>${name || ''}</strong><br/>
    ${title || ''}${title && company ? ' at ' : ''}${company || ''}<br/>
    ${email ? `<a href="mailto:${email}">${email}</a><br/>` : ''}
    ${safeLogo ? `<img src="${safeLogo}" style="max-width:120px;margin-top:12px;display:block;" />` : ''}
  </div>
  `
}

function buildFinalHtml(html: string, senderProfile: SenderProfile | undefined) {
  const contentHtml = formatTemplateContent(html)
  const signature = buildSignature(senderProfile)

  return `
  <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;padding:20px;max-width:520px;">
    ${contentHtml}
    <br/>
    ${signature}
    <p style="font-size:11px;color:#888;margin-top:15px;">
      Sent via ALPA
    </p>
  </div>
  `
}

async function getAuthenticatedUser() {
  const supabase = await createServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user?.id) {
    return { supabase, user: null }
  }

  return { supabase, user }
}

async function getEmailsSentToday(userId: string, dayKey: string) {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('email_usage')
    .select('emails_sent')
    .eq('user_id', userId)
    .eq('usage_date', dayKey)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data?.emails_sent ?? 0
}

async function incrementEmailsSent(userId: string, dayKey: string) {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .rpc('increment_email_usage', {
      target_user_id: userId,
      target_date: dayKey,
      increment_by: 1,
    })
    .single()

  if (error) {
    throw error
  }

  const usageRow = data as { emails_sent: number } | null

  if (!usageRow) {
    throw new Error('Failed to increment email usage')
  }

  return usageRow.emails_sent
}

export async function GET() {
  try {
    const { user } = await getAuthenticatedUser()

    if (!user?.id) {
      return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const dayKey = getDayKey()
    const sent = await getEmailsSentToday(user.id, dayKey)

    return NextResponse.json(
      {
        success: true,
        usage: buildUsageSnapshot(sent),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('❌ Email usage error:', error)
    return NextResponse.json({ success: false, error: 'SERVER_ERROR' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  console.log('📥 /api/send-email HIT')

  try {
    const body = await req.json().catch(() => null)
    console.log('📦 Payload:', body)

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid email payload' }, { status: 400 })
    }

    const parsed = sendEmailSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid email payload',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { user } = await getAuthenticatedUser()

    if (!user?.id) {
      return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const dayKey = getDayKey()
    const sentToday = await getEmailsSentToday(user.id, dayKey)

    if (sentToday >= DAILY_EMAIL_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          error: 'DAILY_LIMIT_REACHED',
          usage: buildUsageSnapshot(sentToday),
        },
        { status: 429 }
      )
    }

    const to = parsed.data.to.toLowerCase()
    const authenticatedEmail =
      user.email?.trim().toLowerCase() || parsed.data.userEmail.toLowerCase()
    const subject = parsed.data.subject
    const senderProfile = parsed.data.senderProfile
    const userName = parsed.data.userName?.trim()
    const isTest = parsed.data.isTest === true
    const html = parsed.data.html
    const safeUserName =
      userName ||
      senderProfile?.name?.trim() ||
      authenticatedEmail.split('@')[0] ||
      'User'

    if (containsUnsafeMarkup(html)) {
      return NextResponse.json(
        { error: 'HTML contains unsupported markup' },
        { status: 400 }
      )
    }

    if (countLinks(html) > 3) {
      return NextResponse.json(
        { error: 'Email HTML can contain at most 3 links' },
        { status: 400 }
      )
    }

    if (process.env.EMAIL_SENDING_ENABLED !== 'true') {
      return NextResponse.json(
        {
          success: true,
          id: null,
          message: 'Email sending disabled',
          usage: buildUsageSnapshot(sentToday),
        },
        { status: 200 }
      )
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('❌ Missing RESEND_API_KEY')
      return NextResponse.json({ success: false, error: 'SERVER_ERROR' }, { status: 500 })
    }

    const isTestMode = process.env.EMAIL_TEST_MODE === 'true'
    const testEmail = process.env.TEST_EMAIL?.trim().toLowerCase() || ''
    const requestedRecipient = isTest && parsed.data.to ? parsed.data.to.toLowerCase() : to
    const finalRecipient = isTestMode ? testEmail : requestedRecipient

    if (isTestMode && !testEmail) {
      return NextResponse.json({ error: 'TEST_EMAIL is not configured' }, { status: 500 })
    }

    if (isTestMode && !z.string().email().safeParse(testEmail).success) {
      return NextResponse.json({ error: 'TEST_EMAIL is invalid' }, { status: 500 })
    }

    const finalHtml = buildFinalHtml(html, {
      ...senderProfile,
      name: senderProfile?.name?.trim() || safeUserName,
      email: senderProfile?.email?.trim() || authenticatedEmail,
    })

    console.log('📨 Email request:', {
      to: finalRecipient,
      subject,
      userId: user.id,
      testMode: process.env.EMAIL_TEST_MODE,
    })

    const payload: Parameters<typeof resend.emails.send>[0] & { reply_to: string } = {
      from: FROM_EMAIL,
      to: [finalRecipient],
      subject,
      html: finalHtml,
      replyTo: authenticatedEmail,
      reply_to: authenticatedEmail,
    }

    await delay(RESEND_THROTTLE_DELAY_MS)

    const resendResponse = await resend.emails.send(payload)
    console.log('📨 Resend response:', resendResponse)

    const { data, error } = resendResponse

    if (error) {
      console.error('❌ Email error:', error)
      return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 })
    }

    const updatedSent = await incrementEmailsSent(user.id, dayKey)

    console.log('✅ Email sent:', data?.id)

    if (subject === 'Test Email from ALPA') {
      console.log('🧪 Test email sent to:', finalRecipient)
    }

    return NextResponse.json(
      {
        success: true,
        data,
        id: data?.id ?? null,
        usage: buildUsageSnapshot(updatedSent),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('❌ Email error:', error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send email',
      },
      { status: 500 }
    )
  }
}
