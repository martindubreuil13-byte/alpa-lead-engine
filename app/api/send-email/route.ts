import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = 'ALPA by MINDRA <info@mindrasolutions.com>'
const MAX_EMAILS_PER_USER_PER_DAY = 20
const MAX_EMAILS_TOTAL_PER_DAY = 200

type RateLimitBucket = {
  day: string
  count: number
}

const userDailyCounts = new Map<string, RateLimitBucket>()
let totalDailyCount: RateLimitBucket = {
  day: '',
  count: 0,
}

const sendEmailSchema = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().min(4).max(200),
  html: z.string().trim().min(1).max(100_000),
  userEmail: z.string().trim().email(),
  userName: z.string().trim().min(1).max(120),
})

function getDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

function resetDailyBuckets(day: string) {
  if (totalDailyCount.day !== day) {
    totalDailyCount = { day, count: 0 }
  }

  for (const [key, bucket] of userDailyCounts.entries()) {
    if (bucket.day !== day) {
      userDailyCounts.delete(key)
    }
  }
}

function getUserBucket(userEmail: string, day: string) {
  const existing = userDailyCounts.get(userEmail)

  if (!existing || existing.day !== day) {
    const nextBucket = { day, count: 0 }
    userDailyCounts.set(userEmail, nextBucket)
    return nextBucket
  }

  return existing
}

function reserveRateLimit(userEmail: string) {
  const day = getDayKey()
  resetDailyBuckets(day)

  const userBucket = getUserBucket(userEmail, day)

  if (userBucket.count >= MAX_EMAILS_PER_USER_PER_DAY) {
    return {
      ok: false as const,
      message: `Daily user email limit reached (${MAX_EMAILS_PER_USER_PER_DAY})`,
    }
  }

  if (totalDailyCount.count >= MAX_EMAILS_TOTAL_PER_DAY) {
    return {
      ok: false as const,
      message: `Daily workspace email limit reached (${MAX_EMAILS_TOTAL_PER_DAY})`,
    }
  }

  userBucket.count += 1
  totalDailyCount.count += 1

  return { ok: true as const }
}

function releaseRateLimit(userEmail: string) {
  const day = getDayKey()
  const userBucket = userDailyCounts.get(userEmail)

  if (userBucket && userBucket.day === day && userBucket.count > 0) {
    userBucket.count -= 1
  }

  if (totalDailyCount.day === day && totalDailyCount.count > 0) {
    totalDailyCount.count -= 1
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

function countLinks(html: string) {
  const anchorLinks = html.match(/<a\b[^>]*href\s*=\s*["'][^"']+["'][^>]*>/gi) ?? []
  const withoutAnchors = html.replace(/<a\b[^>]*>.*?<\/a>/gis, ' ')
  const plainUrls = withoutAnchors.match(/https?:\/\/[^\s<>"']+/gi) ?? []

  return anchorLinks.length + plainUrls.length
}

function containsUnsafeMarkup(html: string) {
  return /<(script|iframe)\b/i.test(html)
}

function withFooter(html: string, userName: string) {
  const footer = `
<p style="margin-top:20px;font-size:12px;color:#666;">
Sent via ALPA<br/>
on behalf of ${escapeHtml(userName)}
</p>`

  return `${html.trim()}\n${footer}`
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null)

    if (!json || typeof json !== 'object') {
      return NextResponse.json({ error: 'Invalid email payload' }, { status: 400 })
    }

    const parsed = sendEmailSchema.safeParse(json)

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
    const userEmail = parsed.data.userEmail.toLowerCase()
    const subject = parsed.data.subject
    const userName = parsed.data.userName
    const html = parsed.data.html

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
        },
        { status: 200 }
      )
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 500 })
    }

    const isTestMode = process.env.EMAIL_TEST_MODE === 'true'
    const testEmail = process.env.TEST_EMAIL?.trim().toLowerCase() || ''
    const finalRecipient = isTestMode ? testEmail : to

    if (isTestMode && !testEmail) {
      return NextResponse.json({ error: 'TEST_EMAIL is not configured' }, { status: 500 })
    }

    if (isTestMode && !z.string().email().safeParse(testEmail).success) {
      return NextResponse.json({ error: 'TEST_EMAIL is invalid' }, { status: 500 })
    }

    const rateLimit = reserveRateLimit(userEmail)

    if (!rateLimit.ok) {
      return NextResponse.json({ error: rateLimit.message }, { status: 429 })
    }

    const finalHtml = withFooter(html, userName)

    console.log('📨 Email request:', {
      to: finalRecipient,
      subject,
      userEmail,
      testMode: process.env.EMAIL_TEST_MODE,
    })

    const payload: Parameters<typeof resend.emails.send>[0] & { reply_to: string } = {
      from: FROM_EMAIL,
      to: [finalRecipient],
      subject,
      html: finalHtml,
      replyTo: userEmail,
      reply_to: userEmail,
    }

    const { data, error } = await resend.emails.send(payload)

    if (error) {
      releaseRateLimit(userEmail)
      console.error('❌ Email error:', error)

      return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 })
    }

    console.log('✅ Email sent:', data?.id)

    return NextResponse.json(
      {
        success: true,
        id: data?.id ?? null,
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
