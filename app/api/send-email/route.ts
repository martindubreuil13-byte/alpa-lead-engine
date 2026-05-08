import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

import { DAILY_EMAIL_LIMIT, type EmailUsageSnapshot } from '@/lib/email/send-limits'
import { createAdminClient } from '@/lib/supabase/admin'
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
  timeZone: z.string().trim().min(1).max(80).optional(),
})

type SenderProfile = z.infer<NonNullable<typeof senderProfileSchema>>

function isValidTimeZone(timeZone: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function getSafeTimeZone(timeZone: string | null | undefined) {
  const candidate = timeZone?.trim()
  return candidate && isValidTimeZone(candidate) ? candidate : 'UTC'
}

function getUsageDateForTimeZone(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function buildUsageSnapshot(
  sent: number,
  date: string,
  timeZone: string
): EmailUsageSnapshot {
  return {
    sent,
    limit: DAILY_EMAIL_LIMIT,
    remaining: Math.max(DAILY_EMAIL_LIMIT - sent, 0),
    date,
    timeZone,
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

function getValidEmail(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : undefined
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
  </div>
  `
}

function getRequestTimeZone(req: Request, bodyTimeZone?: string) {
  const url = new URL(req.url)
  return getSafeTimeZone(
    bodyTimeZone ||
      req.headers.get('x-alpa-time-zone') ||
      url.searchParams.get('timeZone')
  )
}

async function getAuthenticatedUsage(timeZone: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const date = getUsageDateForTimeZone(timeZone)

  if (!user?.id) {
    return { userId: null, sent: 0, date, timeZone }
  }

  const { data, error } = await supabase
    .from('email_usage')
    .select('emails_sent')
    .eq('user_id', user.id)
    .eq('date', date)
    .maybeSingle()

  if (error) {
    console.error('EMAIL USAGE GET ERROR:', error)
    throw error
  }

  if (process.env.NODE_ENV === 'development') {
    console.debug('[email-usage] fetched usage', {
      timeZone,
      date,
      sent: data?.emails_sent ?? 0,
    })
  }

  return { userId: user.id, sent: data?.emails_sent ?? 0, date, timeZone }
}

async function incrementAuthenticatedUsage(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  timeZone: string,
  incrementBy = 1
) {
  const date = getUsageDateForTimeZone(timeZone)

  const { data, error } = await supabase
    .rpc('increment_email_usage', {
      target_user_id: userId,
      target_date: date,
      increment_by: incrementBy,
    })

  if (error) {
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    sent: typeof row?.emails_sent === 'number' ? row.emails_sent : null,
    date,
    timeZone,
  }
}

async function incrementUsageWithAdminFallback(
  userId: string,
  date: string,
  timeZone: string,
  currentSent: number,
  incrementBy = 1
) {
  const supabaseAdmin = createAdminClient() as any
  const nextSent = currentSent + incrementBy

  const { data: existingUsage, error: readError } = await supabaseAdmin
    .from('email_usage')
    .select('emails_sent')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()

  if (readError) {
    throw readError
  }

  const existingSent =
    typeof (existingUsage as any)?.emails_sent === 'number'
      ? (existingUsage as any).emails_sent
      : currentSent
  const sent = existingSent + incrementBy

  const { data, error } = await supabaseAdmin
    .from('email_usage')
    .upsert(
      {
        user_id: userId,
        date: date,
        emails_sent: Math.max(sent, nextSent),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date' }
    )
    .select('emails_sent')
    .maybeSingle()

  if (error) {
    throw error
  }

  return {
    sent: (data as any)?.emails_sent ?? Math.max(sent, nextSent),
    date,
    timeZone,
  }
}

export async function GET(req: Request) {
  try {
    const timeZone = getRequestTimeZone(req)
    const { userId, sent, date } = await getAuthenticatedUsage(timeZone)

    if (!userId) {
      return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
    }

    return NextResponse.json(
      {
        success: true,
        usage: buildUsageSnapshot(sent, date, timeZone),
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

    const timeZone = getRequestTimeZone(req, parsed.data.timeZone)
    const currentUsage = await getAuthenticatedUsage(timeZone)

    if (!isTest && currentUsage.userId && currentUsage.sent >= DAILY_EMAIL_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          result: 'failed',
          error: 'DAILY_LIMIT_REACHED',
          message: 'Daily sending limit reached',
          usage: buildUsageSnapshot(currentUsage.sent, currentUsage.date, timeZone),
        },
        { status: 429 }
      )
    }

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
    const replyToEmail =
      getValidEmail(senderProfile?.email) ||
      getValidEmail(authenticatedEmail) ||
      undefined
    const html = buildFinalHtml(parsed.data.html, {
      ...senderProfile,
      name: senderProfile?.name?.trim() || safeUserName,
      email: senderProfile?.email?.trim() || authenticatedEmail,
    })

    try {
      console.log("=== FINAL EMAIL PAYLOAD ===", {
        from,
        to: [finalRecipient],
        subject,
        replyTo: replyToEmail,
      })

      const resendResponse = await resend.emails.send({
        from,
        to: [finalRecipient],
        subject,
        html,
        replyTo: replyToEmail,
      })

      console.log('=== RESEND SUCCESS ===')
      console.log(resendResponse)

      let newCount = currentUsage.sent
      let date = currentUsage.date

      try {
        if (!isTest && userId) {
          let incrementedUsage

          try {
            incrementedUsage = await incrementAuthenticatedUsage(supabase, userId, timeZone)
          } catch (rpcError) {
            console.error('SUPABASE USAGE RPC ERROR:', rpcError)
            incrementedUsage = await incrementUsageWithAdminFallback(
              userId,
              currentUsage.date,
              timeZone,
              currentUsage.sent
            )
          }

          if (typeof incrementedUsage.sent === 'number') {
            newCount = incrementedUsage.sent
          } else {
            throw new Error('Email usage increment did not return a persisted count')
          }

          date = incrementedUsage.date

          if (process.env.NODE_ENV === 'development') {
            console.debug('[email-usage] incremented after successful send', {
              userId,
              timeZone,
              date: incrementedUsage.date,
              previousSent: currentUsage.sent,
              nextSent: newCount,
              remaining: buildUsageSnapshot(newCount, incrementedUsage.date, timeZone).remaining,
            })
          }
        }
      } catch (dbError) {
        console.error('SUPABASE USAGE INCREMENT ERROR:', dbError)
        return NextResponse.json(
          {
            success: false,
            result: 'failed',
            error: 'USAGE_TRACKING_FAILED',
            message: 'Email sent, but ALPA could not persist daily sending usage. Please refresh before sending more.',
            usage: buildUsageSnapshot(currentUsage.sent, currentUsage.date, timeZone),
          },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        result: 'sent',
        usage: buildUsageSnapshot(newCount, date, timeZone),
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
