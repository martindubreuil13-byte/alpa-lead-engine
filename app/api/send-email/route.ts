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

function getWebsiteUrl(website: string | undefined) {
  const trimmed = website?.trim()

  if (!trimmed) {
    return undefined
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    return /^https?:$/i.test(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function getSafeText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? escapeHtml(trimmed) : ''
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
  const contentHtml = html
    .split('\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('')

  const signature = buildSignature(senderProfile)

  return `
  <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;padding:20px;max-width:520px;">
    <p>Hello,</p>
    ${contentHtml}
    <p>
      You can try it here:<br/>
      <a href="https://alpa.mindrasolutions.com/" target="_blank">
        https://alpa.mindrasolutions.com/
      </a>
    </p>
    <br/>
    ${signature}
    <p style="font-size:11px;color:#888;margin-top:15px;">
      Sent via ALPA
    </p>
  </div>
  `
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

    const to = parsed.data.to.toLowerCase()
    const userEmail = parsed.data.userEmail.toLowerCase()
    const subject = parsed.data.subject
    const senderProfile = parsed.data.senderProfile
    const userName = parsed.data.userName?.trim()
    const isTest = parsed.data.isTest === true
    const html = parsed.data.html
    const safeUserName =
      userName ||
      senderProfile?.name?.trim() ||
      userEmail.split('@')[0] ||
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
        },
        { status: 200 }
      )
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('❌ Missing RESEND_API_KEY')
      return new Response('Missing API key', { status: 500 })
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

    const rateLimit = reserveRateLimit(userEmail)

    if (!rateLimit.ok) {
      return NextResponse.json({ error: rateLimit.message }, { status: 429 })
    }

    const finalHtml = buildFinalHtml(html, {
      ...senderProfile,
      name: senderProfile?.name?.trim() || safeUserName,
      email: senderProfile?.email?.trim() || userEmail,
    })

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

    let resendResponse: Awaited<ReturnType<typeof resend.emails.send>>

    try {
      resendResponse = await resend.emails.send(payload)
      console.log('📨 Resend response:', resendResponse)
    } catch (err) {
      releaseRateLimit(userEmail)
      console.error('❌ Resend error:', err)
      return new Response('Send failed', { status: 500 })
    }

    const { data, error } = resendResponse

    if (error) {
      releaseRateLimit(userEmail)
      console.error('❌ Email error:', error)

      return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 })
    }

    console.log('✅ Email sent:', data?.id)

    if (subject === 'Test Email from ALPA') {
      console.log('🧪 Test email sent to:', finalRecipient)
    }

    return NextResponse.json(
      {
        success: true,
        data,
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
