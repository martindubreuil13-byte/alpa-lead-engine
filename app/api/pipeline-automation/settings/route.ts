import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const DEFAULT_SETTINGS = {
  enabled: false,
  step1_template_id: null,
  step2_template_id: null,
  step2_delay_days: 3,
  step3_template_id: null,
  step3_delay_days: 5,
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  step1_template_id: z.string().uuid().nullable(),
  step2_template_id: z.string().uuid().nullable(),
  step2_delay_days: z.number().int().min(0).max(365),
  step3_template_id: z.string().uuid().nullable(),
  step3_delay_days: z.number().int().min(0).max(365),
})

function normalizeSettings(row: Record<string, unknown> | null | undefined) {
  if (!row) return DEFAULT_SETTINGS

  return {
    enabled: row.enabled === true,
    step1_template_id: typeof row.step1_template_id === 'string' ? row.step1_template_id : null,
    step2_template_id: typeof row.step2_template_id === 'string' ? row.step2_template_id : null,
    step2_delay_days:
      typeof row.step2_delay_days === 'number' ? row.step2_delay_days : DEFAULT_SETTINGS.step2_delay_days,
    step3_template_id: typeof row.step3_template_id === 'string' ? row.step3_template_id : null,
    step3_delay_days:
      typeof row.step3_delay_days === 'number' ? row.step3_delay_days : DEFAULT_SETTINGS.step3_delay_days,
  }
}

function serializeSupabaseError(error: any) {
  return {
    code: error?.code ? String(error.code) : null,
    message: error?.message ? String(error.message) : 'Unknown database error',
    details: error?.details ? String(error.details) : null,
    hint: error?.hint ? String(error.hint) : null,
  }
}

function buildFailureMessage(action: string, error: ReturnType<typeof serializeSupabaseError>) {
  return [
    `Failed to ${action}: ${error.message}`,
    error.code ? `code=${error.code}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ]
    .filter(Boolean)
    .join(' | ')
}

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError
    const admin = createAdminClient()

    const [{ data: templates, error: templatesError }, { data: settings, error: settingsError }] =
      await Promise.all([
        supabase
          .from('templates')
          .select('id, name, subject, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        (admin.from('pipeline_automation_settings' as never) as any)
          .select(
            'enabled, step1_template_id, step2_template_id, step2_delay_days, step3_template_id, step3_delay_days'
          )
          .eq('user_id', userId)
          .maybeSingle(),
      ])

    if (templatesError) {
      console.error('[pipeline-automation/settings] templates fetch error:', templatesError)
      return NextResponse.json({ error: 'TEMPLATES_FETCH_FAILED' }, { status: 500 })
    }

    if (settingsError) {
      const dbError = serializeSupabaseError(settingsError)
      const message = buildFailureMessage('load settings', dbError)
      console.error('[pipeline-automation/settings] settings fetch error:', dbError)
      return NextResponse.json({ error: 'SETTINGS_FETCH_FAILED', message, dbError }, { status: 500 })
    }

    return NextResponse.json({
      templates: templates || [],
      settings: normalizeSettings(settings as Record<string, unknown> | null),
    })
  } catch (error) {
    console.error('[pipeline-automation/settings] GET error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = settingsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError
    const admin = createAdminClient()

    const payload = {
      user_id: userId,
      ...parsed.data,
    }

    const { data, error } = await (admin.from('pipeline_automation_settings' as never) as any).upsert(
      payload,
      { onConflict: 'user_id' }
    )
      .select(
        'enabled, step1_template_id, step2_template_id, step2_delay_days, step3_template_id, step3_delay_days'
      )
      .maybeSingle()

    if (error) {
      const dbError = serializeSupabaseError(error)
      const message = buildFailureMessage('save settings', dbError)
      console.error('[pipeline-automation/settings] upsert error:', { dbError, payload })
      return NextResponse.json({ error: 'SETTINGS_SAVE_FAILED', message, dbError }, { status: 500 })
    }

    return NextResponse.json({ success: true, settings: normalizeSettings(data as Record<string, unknown> | null) })
  } catch (error) {
    console.error('[pipeline-automation/settings] POST error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
