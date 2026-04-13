import { NextResponse } from 'next/server'
import { Resend } from 'resend'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = 'ALPA by MINDRA <info@mindrasolutions.com>'

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const base = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } as Record<string, unknown>
    const errorRecord = error as unknown as Record<string, unknown>

    for (const key of Object.keys(errorRecord)) {
      base[key] = errorRecord[key]
    }

    return base
  }

  if (typeof error === 'object' && error !== null) {
    return error
  }

  return { message: String(error) }
}

function hasQuotaHint(value: unknown) {
  return /daily_quota_exceeded|rate_limit_exceeded/i.test(JSON.stringify(value))
}

export async function GET() {
  console.log('📥 /api/debug-email HIT')
  console.log('RESEND KEY LOADED:', !!process.env.RESEND_API_KEY)

  const destination = process.env.TEST_EMAIL?.trim().toLowerCase() || ''

  if (!destination) {
    return NextResponse.json(
      {
        success: false,
        error: 'DEBUG_EMAIL_NOT_CONFIGURED',
        message: 'TEST_EMAIL is not configured.',
      },
      { status: 500 }
    )
  }

  const payload: Parameters<typeof resend.emails.send>[0] = {
    from: FROM_EMAIL,
    to: [destination],
    subject: 'ALPA debug email',
    html: '<p>This is a debug email from ALPA.</p>',
  }

  console.log('EMAIL PAYLOAD:', {
    from: FROM_EMAIL,
    to: destination,
    subject: payload.subject,
  })

  try {
    const response = await resend.emails.send(payload)
    console.log('RESEND SUCCESS:', response)

    return NextResponse.json(
      {
        success: true,
        result: response,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('RESEND ERROR FULL:', error)
    console.error('RESEND ERROR FLAGS:', {
      quotaExceeded: hasQuotaHint(error),
      senderDomain: 'mindrasolutions.com',
    })

    return NextResponse.json(
      {
        success: false,
        error: 'SEND_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: serializeError(error),
      },
      { status: 500 }
    )
  }
}
