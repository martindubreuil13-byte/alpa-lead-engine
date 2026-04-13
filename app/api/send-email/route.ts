import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

import { DAILY_EMAIL_LIMIT, type EmailUsageSnapshot } from '@/lib/email/send-limits'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = 'ALPA by MINDRA <info@mindrasolutions.com>'

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
  subject: z.string().trim().min(1).max(200),
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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

async function getAuthenticatedUsage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) {
    return { userId: null, sent: 0 }
  }

  const today = getDayKey()
  const { data, error } = await supabase
    .from('email_usage')
    .select('emails_sent')
    .eq('user_id', user.id)
    .eq('usage_date', today)
    .maybeSingle()

  if (error) {
    console.error('EMAIL USAGE GET ERROR:', error)
    return { userId: user.id, sent: 0 }
  }

  return { userId: user.id, sent: data?.emails_sent ?? 0 }
}

export async function GET() {
  try {
    const { userId, sent } = await getAuthenticatedUsage()

    if (!userId) {
      return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
    }

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
  const supabase = await createServerClient()
  let userId: string | null = null

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    userId = user?.id ?? null
  } catch (authError) {
    console.error('SUPABASE AUTH ERROR:', authError)
  }

  console.log('RESEND KEY LOADED:', !!process.env.RESEND_API_KEY)
  console.log('USER ID:', userId)

  try {
    const body = await req.json().catch(() => null)

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

    const to = parsed.data.to.toLowerCase()
    const subject = parsed.data.subject.trim()
    const senderProfile = parsed.data.senderProfile
    const userName = parsed.data.userName?.trim()
    const isTest = parsed.data.isTest === true
    const authenticatedEmail = parsed.data.userEmail.toLowerCase()
    const safeUserName =
      userName ||
      senderProfile?.name?.trim() ||
      authenticatedEmail.split('@')[0] ||
      'User'

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: 'SEND_FAILED',
          message: 'RESEND_API_KEY is missing',
          name: 'ConfigurationError',
          stack: 'No stack',
          full: JSON.stringify({ message: 'RESEND_API_KEY is missing' }),
        },
        { status: 500 }
      )
    }

    const isTestMode = process.env.EMAIL_TEST_MODE === 'true'
    const testEmail = process.env.TEST_EMAIL?.trim().toLowerCase() || ''
    const finalRecipient = isTestMode && isTest ? testEmail : to
    const from = FROM_EMAIL
    const html = buildFinalHtml(parsed.data.html, {
      ...senderProfile,
      name: senderProfile?.name?.trim() || safeUserName,
      email: senderProfile?.email?.trim() || authenticatedEmail,
    })

    try {
      console.log('=== BEFORE SEND ===')
      console.log({ from, to: [finalRecipient], subject })

      const resendResponse = await resend.emails.send({
        from,
        to: [finalRecipient],
        subject,
        html,
      })

      console.log('=== RESEND SUCCESS ===')
      console.log(resendResponse)

      let newCount = 1

      try {
        if (userId) {
          const today = new Date().toISOString().slice(0, 10)
          const { data: existingUsage } = await supabase
            .from('email_usage')
            .select('emails_sent')
            .eq('user_id', userId)
            .eq('usage_date', today)
            .maybeSingle()

          newCount = (existingUsage?.emails_sent || 0) + 1

          const { error: usageError } = await supabase
            .from('email_usage')
            .upsert(
              {
                user_id: userId,
                usage_date: today,
                emails_sent: newCount,
              },
              {
                onConflict: 'user_id,usage_date',
              }
            )

          if (usageError) {
            console.error('SUPABASE USAGE ERROR:', usageError)
          }
        }
      } catch (dbError) {
        console.error('SUPABASE CRASH:', dbError)
      }

      return NextResponse.json({
        success: true,
        result: 'sent',
        usage: buildUsageSnapshot(newCount),
      })
    } catch (error: any) {
      console.error('=== FULL ERROR OBJECT ===')
      console.error(error)
      console.error('=== STRINGIFIED ERROR ===')
      console.error(JSON.stringify(error, Object.getOwnPropertyNames(error)))

      return NextResponse.json(
        {
          success: false,
          result: 'failed',
          error: 'SEND_FAILED',
          message: error?.message || 'No message',
          name: error?.name || 'No name',
          stack: error?.stack || 'No stack',
          full: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error('=== FULL ERROR OBJECT ===')
    console.error(error)
    console.error('=== STRINGIFIED ERROR ===')
    console.error(JSON.stringify(error, Object.getOwnPropertyNames(error)))

    return NextResponse.json(
      {
        success: false,
        result: 'failed',
        error: 'SEND_FAILED',
        message: error?.message || 'No message',
        name: error?.name || 'No name',
        stack: error?.stack || 'No stack',
        full: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      },
      { status: 500 }
    )
  }
}
