import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import {
  getLegacyStatusForPipelineStage,
  getPipelineLifecycleStatus,
  type Lead,
  type PipelineStage,
} from '@/lib/pipeline/lifecycle'
import {
  buildOutreachEmailHtml,
  buildOutreachSenderProfile,
  OUTREACH_FROM_EMAIL,
  type OutreachSenderProfile,
  type OutreachSenderSettings,
} from '@/lib/outreach/render-email'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const resend = new Resend(process.env.RESEND_API_KEY)
const SEND_DELAY_MS = 500

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
})

type QueueRow = {
  id: string
  lead_id: string | null
  template_id: string | null
  automation_step: AutomationStepValue | null
  contact_email: string | null
  subject: string | null
  full_email: string | null
  body: string | null
}

type LeadRow = Lead & {
  user_id?: string | null
}

type AutomationStepValue = 'first_outreach' | 'follow_up' | 'final_attempt'
type SendFailure = {
  queueId: string
  leadId: string | null
  recipient: string | null
  subject: string | null
  message: string
  resendError: Record<string, unknown>
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fromAdminTable(admin: ReturnType<typeof createAdminClient>, table: string) {
  return admin.from(table as never) as any
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
    const extra = error as Error & {
      status?: unknown
      statusCode?: unknown
      response?: unknown
      body?: unknown
      cause?: unknown
    }
    if (extra.status !== undefined) details.status = extra.status
    if (extra.statusCode !== undefined) details.statusCode = extra.statusCode
    if (extra.response !== undefined) details.response = extra.response
    if (extra.body !== undefined) details.body = extra.body
    if (extra.cause !== undefined) details.cause = extra.cause
    return details
  }

  if (error && typeof error === 'object') {
    return { ...(error as Record<string, unknown>) }
  }

  return { message: String(error) }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'Unknown send failure'
}

async function fetchSenderProfile({
  userId,
  fallback,
}: {
  userId: string
  fallback?: { name?: string | null; email?: string | null }
}): Promise<OutreachSenderProfile | undefined> {
  const admin = createAdminClient()
  const { data, error } = await fromAdminTable(admin, 'sender_settings')
    .select('sender_name, sender_email, company_name, job_title, phone, website, logo_url')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[outreach-queue/send] sender settings fetch error:', error)
  }

  return buildOutreachSenderProfile(data as OutreachSenderSettings | null, fallback)
}

function getLifecycleUpdate(lead: LeadRow, now: string) {
  const lifecycleStatus = getPipelineLifecycleStatus(lead)
  const attempts = (lead.outreach_attempts || 0) + 1

  if (lifecycleStatus === 'ready') {
    return {
      lifecycleStatus,
      payload: {
        status: getLegacyStatusForPipelineStage('contacted'),
        pipeline_stage: 'contacted',
        first_contact_at: lead.first_contact_at || now,
        last_contact_at: now,
        last_activity_at: now,
        status_updated_at: now,
        outreach_attempts: attempts,
        next_action_status: 'waiting_followup',
      },
    }
  }

  if (lifecycleStatus === 'ready_followup') {
    return {
      lifecycleStatus,
      payload: {
        pipeline_stage: 'final_attempt',
        followup_sent_at: now,
        last_contact_at: now,
        last_activity_at: now,
        outreach_attempts: attempts,
      },
    }
  }

  if (lifecycleStatus === 'final_attempt') {
    return {
      lifecycleStatus,
      payload: {
        final_attempt_sent_at: now,
        last_contact_at: now,
        last_activity_at: now,
        outreach_attempts: attempts,
      },
    }
  }

  return { lifecycleStatus, payload: null }
}

async function advanceSentLeadLifecycles({
  userId,
  rows,
  sentIds,
  now,
}: {
  userId: string
  rows: QueueRow[]
  sentIds: string[]
  now: string
}) {
  const sentIdSet = new Set(sentIds)
  const sentRows = rows.filter((row) => sentIdSet.has(row.id) && row.lead_id)
  const leadIds = Array.from(new Set(sentRows.map((row) => row.lead_id).filter(Boolean) as string[]))

  if (leadIds.length === 0) {
    return { updated: 0, activityLogged: 0 }
  }

  const admin = createAdminClient()
  const { data: leads, error: leadsError } = await fromAdminTable(admin, 'leads')
    .select(
      'id, user_id, company_name, city, industry, email, phone, website, notes, status, pipeline_stage, close_reason, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, created_at, date_added, status_updated_at, last_activity_at'
    )
    .eq('user_id', userId)
    .in('id', leadIds)

  if (leadsError) {
    console.error('[outreach-queue/send] lead lifecycle fetch error:', leadsError)
    return { updated: 0, activityLogged: 0 }
  }

  const leadRows = (leads || []) as LeadRow[]
  const leadById = new Map<string, LeadRow>(leadRows.map((lead) => [lead.id, lead]))
  let updated = 0
  const activityRows: Array<{
    lead_id: string
    user_id: string
    event_type: string
    metadata: Record<string, unknown>
  }> = []

  for (const row of sentRows) {
    if (!row.lead_id) continue

    const lead = leadById.get(row.lead_id)
    if (!lead) continue

    const { lifecycleStatus, payload } = getLifecycleUpdate(lead, now)
    const automationStep = row.automation_step || getAutomationStepForLifecycle(lifecycleStatus)

    if (payload) {
      const { error: updateError } = await fromAdminTable(admin, 'leads')
        .update(payload)
        .eq('id', row.lead_id)
        .eq('user_id', userId)

      if (updateError) {
        console.error('[outreach-queue/send] lead lifecycle update error:', {
          queueId: row.id,
          leadId: row.lead_id,
          lifecycleStatus,
          updateError,
        })
      } else {
        updated += 1
      }
    }

    activityRows.push({
      lead_id: row.lead_id,
      user_id: userId,
      event_type: 'email_sent',
      metadata: {
        source: 'outreach_queue',
        queue_id: row.id,
        template_id: row.template_id,
        automation_step: automationStep,
        lifecycle_status: lifecycleStatus,
      },
    })
  }

  if (activityRows.length === 0) {
    return { updated, activityLogged: 0 }
  }

  const { error: activityError } = await fromAdminTable(admin, 'lead_activity_events').insert(activityRows)

  if (activityError) {
    console.error('[outreach-queue/send] email_sent activity insert error:', activityError)
    return { updated, activityLogged: 0 }
  }

  return { updated, activityLogged: activityRows.length }
}

function getAutomationStepForLifecycle(lifecycleStatus: PipelineStage) {
  if (lifecycleStatus === 'ready') return 'first_outreach'
  if (lifecycleStatus === 'ready_followup') return 'follow_up'
  if (lifecycleStatus === 'final_attempt') return 'final_attempt'
  return null
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { ids } = parsed.data

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const {
      data: { user },
    } = await supabase.auth.getUser()
    const senderProfile = await fetchSenderProfile({
      userId,
      fallback: {
        name: typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
        email: user?.email || null,
      },
    })

    // Fetch approved rows belonging to this user
    const { data: rows, error: fetchError } = await supabase
      .from('outreach_queue')
      .select('id, lead_id, template_id, automation_step, contact_email, subject, full_email, body')
      .in('id', ids)
      .eq('user_id', userId)
      .eq('review_status', 'approved')

    if (fetchError) {
      console.error('[outreach-queue/send] fetch error:', fetchError)
      return NextResponse.json({ error: 'FETCH_FAILED' }, { status: 500 })
    }

    if (!rows?.length) {
      return NextResponse.json({ error: 'NO_APPROVED_ROWS', sent: 0, failed: 0 }, { status: 200 })
    }

    let sent = 0
    let failed = 0
    const sentIds: string[] = []
    const failedIds: string[] = []
    const failures: SendFailure[] = []

    for (const row of rows as QueueRow[]) {
      if (!row.contact_email) {
        const message = 'Missing recipient email'
        console.warn('[outreach-queue/send] SKIP (no email):', {
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          subject: row.subject,
        })
        failedIds.push(row.id)
        failures.push({
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          subject: row.subject,
          message,
          resendError: {},
        })
        failed++
        await delay(SEND_DELAY_MS)
        continue
      }

      const emailBody = row.full_email || row.body || ''
      if (!emailBody || !row.subject) {
        const message = !emailBody ? 'Missing email body' : 'Missing email subject'
        console.warn('[outreach-queue/send] SKIP (no content):', {
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          subject: row.subject,
          hasBody: Boolean(emailBody),
        })
        failedIds.push(row.id)
        failures.push({
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          subject: row.subject,
          message,
          resendError: {},
        })
        failed++
        await delay(SEND_DELAY_MS)
        continue
      }

      try {
        const payload = {
          from: OUTREACH_FROM_EMAIL,
          to: [row.contact_email],
          subject: row.subject,
          html: buildOutreachEmailHtml(emailBody, { senderProfile }),
        }

        console.log('[outreach-queue/send] resend.emails.send START', {
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          to: payload.to,
          from: payload.from,
          subject: payload.subject,
        })

        const resendResponse = await resend.emails.send(payload)
        const resendResponseError = (resendResponse as { error?: unknown } | null)?.error || null

        console.log('[outreach-queue/send] resend.emails.send RESULT', {
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          subject: row.subject,
          resendResponse,
          resendError: resendResponseError,
          messageId:
            (resendResponse as { data?: { id?: string }; id?: string } | null)?.data?.id ||
            (resendResponse as { id?: string } | null)?.id ||
            null,
        })

        if (resendResponseError) {
          console.error('[outreach-queue/send] resend.emails.send RESPONSE ERROR', {
            queueId: row.id,
            leadId: row.lead_id,
            recipient: row.contact_email,
            subject: row.subject,
            resendResponse,
            resendError: resendResponseError,
          })
        }

        sentIds.push(row.id)
        sent++
      } catch (err) {
        const resendError = serializeError(err)
        const message = getErrorMessage(err)
        console.error('[outreach-queue/send] resend.emails.send FAILED', {
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          subject: row.subject,
          resendResponse: null,
          resendError,
          stack: err instanceof Error ? err.stack : null,
        })
        failedIds.push(row.id)
        failures.push({
          queueId: row.id,
          leadId: row.lead_id,
          recipient: row.contact_email,
          subject: row.subject,
          message,
          resendError,
        })
        failed++
      } finally {
        await delay(SEND_DELAY_MS)
      }
    }

    const now = new Date().toISOString()

    // Mark sent rows
    if (sentIds.length > 0) {
      const { error: updateError } = await supabase
        .from('outreach_queue')
        .update({ review_status: 'sent', updated_at: now })
        .in('id', sentIds)
        .eq('user_id', userId)

      if (updateError) {
        console.error('[outreach-queue/send] update sent error (non-fatal):', updateError)
      }

      const lifecycleResult = await advanceSentLeadLifecycles({
        userId,
        rows: rows as QueueRow[],
        sentIds,
        now,
      })

      console.log('[outreach-queue/send] lifecycle advancement:', lifecycleResult)
    }

    return NextResponse.json({
      sent,
      failed,
      failures,
      error: failed > 0 && sent === 0 ? 'SEND_FAILED' : undefined,
      message: failures[0]?.message,
      queueId: failures[0]?.queueId,
      recipient: failures[0]?.recipient,
    })
  } catch (err) {
    const serialized = serializeError(err)
    console.error('[outreach-queue/send] SERVER ERROR', {
      resendError: serialized,
      stack: err instanceof Error ? err.stack : null,
    })
    return NextResponse.json(
      {
        error: 'SERVER_ERROR',
        message: getErrorMessage(err),
        queueId: null,
        recipient: null,
      },
      { status: 500 }
    )
  }
}
