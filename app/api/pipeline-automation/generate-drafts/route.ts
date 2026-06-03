import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { getPipelineLifecycleStatus, type PipelineStage } from '@/lib/pipeline/lifecycle'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type StepKey = 'firstOutreach' | 'followUp' | 'finalAttempt'
type AutomationStepValue = 'first_outreach' | 'follow_up' | 'final_attempt'

type LeadRow = {
  id: string
  company_name: string | null
  contact_name: string | null
  email: string | null
  website: string | null
  city: string | null
  industry: string | null
  status: string | null
  pipeline_stage: string | null
  first_contact_at: string | null
  followup_due_at: string | null
  followup_sent_at: string | null
  final_attempt_sent_at: string | null
  last_contact_at: string | null
  outreach_attempts: number | null
  next_action_status: string | null
  closed_at: string | null
  date_added: string | null
  status_updated_at: string | null
  last_activity_at: string | null
}

type TemplateRow = {
  id: string
  name: string | null
  subject: string | null
  body: string | null
  signature?: string | null
}

const DUPLICATE_STATUSES = new Set(['draft', 'approved'])
const LEAD_PAGE_SIZE = 1000
const DRAFT_BATCH_SIZE = 100
const PIPELINE_AUTOMATION_LEAD_FILTER =
  'status.in.(pipeline,contacted,followup_due,followup_sent,interested,closed_no_response,no_response,rejected,invalid),pipeline_stage.in.(ready,contacted,followup,ready_followup,final_attempt,closed)'
const LEAD_SELECT =
  'id, company_name, contact_name, email, website, city, industry, status, pipeline_stage, first_contact_at, followup_due_at, followup_sent_at, final_attempt_sent_at, last_contact_at, outreach_attempts, next_action_status, closed_at, date_added, status_updated_at, last_activity_at'

function serializeError(error: unknown, fallbackCode: string) {
  const maybeError = error as {
    code?: string | null
    message?: string | null
    details?: string | null
    hint?: string | null
  } | null

  return {
    error: fallbackCode,
    message: maybeError?.message ? String(maybeError.message) : error instanceof Error ? error.message : 'Unknown error',
    details: maybeError?.details ? String(maybeError.details) : null,
    hint: maybeError?.hint ? String(maybeError.hint) : null,
    code: maybeError?.code ? String(maybeError.code) : null,
  }
}

function logDatabaseOperation({
  operation,
  success,
  rowCount,
  error,
  payload,
}: {
  operation: string
  success: boolean
  rowCount: number
  error?: unknown
  payload?: unknown
}) {
  const logPayload = {
    operation,
    success,
    rowCount,
    supabaseError: error || null,
    ...(payload !== undefined ? { payload } : {}),
  }

  if (success) {
    console.log('[pipeline-automation/generate-drafts] database operation:', logPayload)
  } else {
    console.error('[pipeline-automation/generate-drafts] database operation failed:', logPayload)
  }
}

function fromAdminTable(admin: ReturnType<typeof createAdminClient>, table: string) {
  return admin.from(table as never) as any
}

function getAutomationStep(lead: LeadRow): StepKey | null {
  const lifecycleStatus = getLeadLifecycleStatus(lead)

  if (lifecycleStatus === 'ready') return 'firstOutreach'
  if (lifecycleStatus === 'ready_followup') return 'followUp'
  if (lifecycleStatus === 'final_attempt') return 'finalAttempt'

  return null
}

function getPersistedAutomationStep(step: StepKey): AutomationStepValue {
  if (step === 'firstOutreach') return 'first_outreach'
  if (step === 'followUp') return 'follow_up'
  return 'final_attempt'
}

function renderTemplate(
  template: string | null | undefined,
  lead: { business?: string | null; name?: string | null; location?: string | null }
) {
  return (template || '')
    .replace(/{{business_name}}/g, lead.business || '')
    .replace(/{{contact_name}}/g, lead.name || '')
    .replace(/{{location}}/g, lead.location || '')
}

function buildFullEmail(template: TemplateRow, lead: LeadRow) {
  const renderedBody = renderTemplate(template.body, {
    business: lead.company_name,
    name: lead.contact_name,
    location: lead.city,
  }).trim()
  const signature = template.signature?.trim()

  return [renderedBody, signature].filter(Boolean).join('\n\n')
}

async function fetchEligibleLeads(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const leads: LeadRow[] = []
  const buckets = createLifecycleBuckets()
  let from = 0

  while (true) {
    const to = from + LEAD_PAGE_SIZE - 1
    const { data, error } = await fromAdminTable(admin, 'leads')
      .select(LEAD_SELECT)
      .eq('user_id', userId)
      .or(PIPELINE_AUTOMATION_LEAD_FILTER)
      .order('id', { ascending: true })
      .range(from, to)

    logDatabaseOperation({
      operation: 'Eligible leads lookup',
      success: !error,
      rowCount: data?.length || 0,
      error,
    })

    if (error) throw error

    const rows = (data || []) as LeadRow[]
    for (const lead of rows) {
      const lifecycleStatus = getLeadLifecycleStatus(lead)
      buckets[lifecycleStatus].push(lead)

      if (getAutomationStep(lead)) {
        leads.push(lead)
      }
    }

    if (rows.length < LEAD_PAGE_SIZE) break
    from += LEAD_PAGE_SIZE
  }

  return { leads, buckets }
}

function createLifecycleBuckets(): Record<PipelineStage, LeadRow[]> {
  return {
    ready: [],
    contacted: [],
    ready_followup: [],
    final_attempt: [],
    closed: [],
  }
}

function getLeadLifecycleStatus(lead: LeadRow) {
  return getPipelineLifecycleStatus({
    ...lead,
    company_name: lead.company_name || '',
    city: lead.city || null,
    industry: lead.industry || null,
    email: lead.email || null,
    phone: null,
    status: lead.status || '',
  })
}

async function fetchQueuedLeadIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  leadIds: string[]
) {
  const queued = new Set<string>()

  for (let index = 0; index < leadIds.length; index += DRAFT_BATCH_SIZE) {
    const chunk = leadIds.slice(index, index + DRAFT_BATCH_SIZE)
    const { data, error } = await fromAdminTable(admin, 'outreach_queue')
      .select('lead_id, status, review_status')
      .eq('user_id', userId)
      .in('lead_id', chunk)

    logDatabaseOperation({
      operation: 'Existing outreach_queue duplicate lookup',
      success: !error,
      rowCount: data?.length || 0,
      error,
    })

    if (error) throw error

    for (const row of data || []) {
      if (!row.lead_id) continue
      if (DUPLICATE_STATUSES.has(row.status) || DUPLICATE_STATUSES.has(row.review_status)) {
        queued.add(row.lead_id)
      }
    }
  }

  return queued
}

function stripTemplateId(rows: Array<Record<string, unknown>>) {
  return rows.map(({ template_id: _templateId, ...row }) => row)
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const admin = createAdminClient()

    const { data: settings, error: settingsError } = await fromAdminTable(admin, 'pipeline_automation_settings')
      .select('enabled, step1_template_id, step2_template_id, step3_template_id')
      .eq('user_id', userId)
      .maybeSingle()

    logDatabaseOperation({
      operation: 'Settings lookup',
      success: !settingsError,
      rowCount: settings ? 1 : 0,
      error: settingsError,
    })

    if (settingsError) {
      return NextResponse.json(serializeError(settingsError, 'SETTINGS_FETCH_FAILED'), { status: 500 })
    }

    if (!settings?.enabled) {
      return NextResponse.json(
        { error: 'AUTOMATION_DISABLED', message: 'Pipeline automation is disabled.', details: null, hint: null, code: null },
        { status: 400 }
      )
    }

    const stepTemplateIds: Record<StepKey, string | null> = {
      firstOutreach: settings.step1_template_id || null,
      followUp: settings.step2_template_id || null,
      finalAttempt: settings.step3_template_id || null,
    }
    const templateIds = Array.from(new Set(Object.values(stepTemplateIds).filter(Boolean) as string[]))

    if (templateIds.length === 0) {
      return NextResponse.json(
        { error: 'NO_TEMPLATES_CONFIGURED', message: 'No automation templates are configured.', details: null, hint: null, code: null },
        { status: 400 }
      )
    }

    const { data: templates, error: templatesError } = await admin
      .from('templates')
      .select('id, name, subject, body, signature')
      .eq('user_id', userId)
      .in('id', templateIds)

    logDatabaseOperation({
      operation: 'Template lookup',
      success: !templatesError,
      rowCount: templates?.length || 0,
      error: templatesError,
    })

    if (templatesError) {
      return NextResponse.json(serializeError(templatesError, 'TEMPLATES_FETCH_FAILED'), { status: 500 })
    }

    const templateRows = (templates || []) as TemplateRow[]
    const templatesById = new Map(templateRows.map((template) => [template.id, template]))
    const { leads, buckets } = await fetchEligibleLeads(admin, userId)
    const leadBatches = chunkArray(leads, DRAFT_BATCH_SIZE)
    const lifecycleCounts = {
      ready: buckets.ready.length,
      readyFollowup: buckets.ready_followup.length,
      finalAttempt: buckets.final_attempt.length,
      skipped: buckets.contacted.length + buckets.closed.length,
      closed: buckets.closed.length,
    }

    console.log('[pipeline-automation/generate-drafts] batching:', {
      leadCount: leads.length,
      lifecycleCounts,
      batchCount: leadBatches.length,
      batchSize: DRAFT_BATCH_SIZE,
    })

    let skipped = 0
    const counts = {
      firstOutreach: 0,
      followUp: 0,
      finalAttempt: 0,
    }
    let created = 0

    for (const [batchIndex, leadBatch] of leadBatches.entries()) {
      console.log('[pipeline-automation/generate-drafts] processing batch:', {
        batchIndex: batchIndex + 1,
        batchCount: leadBatches.length,
        leadCount: leadBatch.length,
        batchSize: DRAFT_BATCH_SIZE,
      })

      const queuedLeadIds = await fetchQueuedLeadIds(admin, userId, leadBatch.map((lead) => lead.id))
      const insertRows: Array<Record<string, unknown> & { automation_step: AutomationStepValue; step_key: StepKey }> = []

      for (const lead of leadBatch) {
        const step = getAutomationStep(lead)
        if (!step) continue

        const templateId = stepTemplateIds[step]
        const template = templateId ? templatesById.get(templateId) : null

        if (!template || queuedLeadIds.has(lead.id)) {
          skipped += 1
          continue
        }

        const subject = renderTemplate(template.subject, {
          business: lead.company_name,
          name: lead.contact_name,
          location: lead.city,
        }).trim() || 'Quick question'
        const fullEmail = buildFullEmail(template, lead)

        insertRows.push({
          step_key: step,
          user_id: userId,
          lead_id: lead.id,
          template_id: template.id,
          automation_step: getPersistedAutomationStep(step),
          source: 'pipeline_automation',
          company_name: lead.company_name,
          contact_email: lead.email,
          location: lead.city,
          website: lead.website,
          subject,
          body: fullEmail,
          full_email: fullEmail,
          style: 'template',
          context_status: 'basic',
          status: 'draft',
          review_status: 'draft',
        })
      }

      if (insertRows.length === 0) {
        continue
      }

      const queueRows = insertRows.map(({ step_key: _stepKey, ...row }) => row)
      let insertResult = await fromAdminTable(admin, 'outreach_queue').insert(queueRows).select('id, lead_id, template_id, automation_step')

      logDatabaseOperation({
        operation: 'outreach_queue insert',
        success: !insertResult.error,
        rowCount: insertResult.data?.length || 0,
        error: insertResult.error,
        payload: insertResult.error ? queueRows : undefined,
      })

      if (insertResult.error?.code === '42703' && String(insertResult.error.message || '').includes('template_id')) {
        console.warn('[pipeline-automation/generate-drafts] template_id column missing; retrying without template_id')
        insertResult = await fromAdminTable(admin, 'outreach_queue')
          .insert(stripTemplateId(queueRows))
          .select('id, lead_id')

        logDatabaseOperation({
          operation: 'outreach_queue insert retry without template_id',
          success: !insertResult.error,
          rowCount: insertResult.data?.length || 0,
          error: insertResult.error,
          payload: insertResult.error ? stripTemplateId(queueRows) : undefined,
        })
      }

      if (insertResult.error) {
        return NextResponse.json(serializeError(insertResult.error, 'QUEUE_INSERT_FAILED'), { status: 500 })
      }

      const createdRows = insertResult.data || []
      const stepByLeadId = new Map(insertRows.map((row) => [row.lead_id as string, row.step_key]))
      const templateIdByLeadId = new Map(insertRows.map((row) => [row.lead_id as string, row.template_id as string]))
      const automationStepByLeadId = new Map(insertRows.map((row) => [row.lead_id as string, row.automation_step]))

      for (const row of createdRows) {
        const step = row.lead_id ? stepByLeadId.get(row.lead_id) : null
        if (step) counts[step] += 1
      }

      created += createdRows.length

      const activityRows = createdRows
        .filter((row: { id?: string; lead_id?: string | null }) => row.lead_id)
        .map((row: { id?: string; lead_id?: string | null }) => {
          const step = row.lead_id ? stepByLeadId.get(row.lead_id) : null
          const templateId = row.lead_id ? templateIdByLeadId.get(row.lead_id) : null
          const automationStep = row.lead_id ? automationStepByLeadId.get(row.lead_id) : null

          return {
            lead_id: row.lead_id,
            user_id: userId,
            event_type: 'draft_generated',
            metadata: {
              source: 'pipeline_automation',
              queue_id: row.id,
              automation_step: automationStep,
              template_id: templateId,
            },
          }
        })

      if (activityRows.length > 0) {
        const { error: activityError } = await fromAdminTable(admin, 'lead_activity_events').insert(activityRows)

        logDatabaseOperation({
          operation: 'lead_activity_events insert',
          success: !activityError,
          rowCount: activityError ? 0 : activityRows.length,
          error: activityError,
          payload: activityError ? activityRows : undefined,
        })

        if (activityError) {
          return NextResponse.json(serializeError(activityError, 'ACTIVITY_INSERT_FAILED'), { status: 500 })
        }
      }
    }

    return NextResponse.json({
      created,
      skipped,
      lifecycleCounts,
      ...counts,
    })
  } catch (error) {
    const payload = serializeError(error, 'GENERATE_DRAFTS_FAILED')
    console.error('[pipeline-automation/generate-drafts] POST error:', payload)
    return NextResponse.json(payload, { status: 500 })
  }
}
