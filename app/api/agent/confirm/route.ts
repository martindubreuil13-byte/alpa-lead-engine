import { after, NextResponse } from 'next/server'
import { z } from 'zod'

import { executeMissionRun } from '@/lib/agent/mission-executor'
import { computeFirstRunAt, normalizeScheduleTime } from '@/lib/agent/schedule'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const IS_DEV = process.env.NODE_ENV !== 'production'

const offerContextSchema = z.object({
  what_you_do: z.string(),
  who_you_help: z.string(),
  main_benefit: z.string(),
  angle: z.string(),
})

const requestSchema = z.object({
  offer_input: z.string().trim().min(1).max(1000),
  audience_input: z.string().trim().min(1).max(1000),
  location_input: z.string().trim().min(1).max(300),
  offer_context: offerContextSchema,
  icp_expanded: z.array(z.string()).min(1),
  search_patterns: z.array(z.string()).min(1),
  daily_target: z.number().int().min(1).max(10000).default(10),
  cta: z.string().trim().max(300).optional(),
  send_window: z.string().optional().nullable(),
  sender_signature: z.string().trim().max(200).optional().nullable(),
  start_mode: z.enum(['now', 'later']).default('now'),
  start_at_local: z.string().trim().optional().nullable(),
  schedule_timezone: z.string().trim().min(1).max(120).default('UTC'),
  schedule_local_time: z.string().trim().optional().nullable(),
})

function devError(
  code: string,
  err: { message?: string; hint?: string; code?: string } | null | undefined,
) {
  if (!IS_DEV) return {}
  return {
    details: err?.message ?? 'no message',
    hint: err?.hint ?? null,
    db_code: err?.code ?? null,
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const body = await req.json().catch(() => null)
    const normalized = {
      ...body,
      send_window: body?.send_window ?? null,
      daily_target: body?.daily_target ?? 10,
      cta: body?.cta ?? 'Reply to this message',
      sender_signature: body?.sender_signature ?? null,
    }
    const parsed = requestSchema.safeParse(normalized)

    if (!parsed.success) {
      console.error('[agent/confirm] validation error:', parsed.error.flatten())
      return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
    }

    const {
      offer_input,
      audience_input,
      location_input,
      offer_context,
      icp_expanded,
      search_patterns,
      daily_target,
      cta,
      send_window,
      sender_signature,
      start_mode,
      start_at_local,
      schedule_timezone,
      schedule_local_time,
    } = parsed.data

    if (!offer_input || !audience_input || !location_input) {
      return NextResponse.json({ error: 'MISSING_REQUIRED_FIELDS' }, { status: 400 })
    }

    // Auto-generate mission name: first audience segment · location
    const shortAudience = audience_input.split(',')[0]
    const missionName = `${shortAudience.trim()} · ${location_input}`

    const resolvedScheduleTimezone = (() => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: schedule_timezone }).format(new Date())
        return schedule_timezone
      } catch {
        return 'UTC'
      }
    })()

    const normalizedScheduleTime =
      schedule_local_time && schedule_local_time.trim()
        ? normalizeScheduleTime(schedule_local_time)
        : start_mode === 'later' && start_at_local
          ? normalizeScheduleTime(start_at_local.split('T')[1] || '')
          : normalizeScheduleTime(
              new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: resolvedScheduleTimezone,
              }).format(new Date())
            )

    const firstRunAt = computeFirstRunAt({
      startMode: start_mode,
      timeZone: resolvedScheduleTimezone,
      startAtLocal: start_at_local,
      localTime: normalizedScheduleTime,
    })
    const missionStatus = start_mode === 'later' ? 'scheduled' : 'active'

    // ── Step 1: Create ICP record (used by mission runner for context) ────────

    const icpStructuredOutput = {
      target_businesses: icp_expanded.slice(0, 5),
      locations: [location_input],
      pain_points: [offer_context.main_benefit],
      messaging_angles: [offer_context.angle],
      summary: `Got it. I'll focus on ${offer_context.who_you_help}.`,
    }

    const { data: icp, error: icpError } = await supabase
      .from('agent_icp')
      .insert({
        user_id: userId,
        raw_input: offer_input,
        structured_output: icpStructuredOutput,
        status: 'active',
        is_active: true,
      })
      .select('id')
      .single()

    if (icpError || !icp) {
      console.error('[agent/confirm] icp insert error:', JSON.stringify(icpError, null, 2))
      return NextResponse.json(
        { error: 'ICP_CREATE_FAILED', ...devError('ICP_CREATE_FAILED', icpError) },
        { status: 500 },
      )
    }

    // Deactivate any previously active ICPs
    await supabase
      .from('agent_icp')
      .update({ is_active: false, status: 'draft' })
      .eq('user_id', userId)
      .neq('id', icp.id)

    // ── Step 2: Create mission ────────────────────────────────────────────────

    const missionPayload = {
      user_id: userId,
      icp_id: icp.id,
      name: missionName,
      status: missionStatus,
      // leads_per_day = active field read by mission runner; daily_target = user config
      leads_per_day: daily_target,
      daily_target: daily_target,
      contact_mode: 'email',
      require_email: true,
      require_phone: false,
      require_website: true,
      location: location_input,
      outreach_mode: 'draft_only',
      offer_input,
      audience_input,
      location_input,
      offer_context,
      icp_expanded,
      search_patterns,
      cta: cta || null,
      send_window: send_window || null,
      sender_signature: sender_signature || null,
      schedule_timezone: resolvedScheduleTimezone,
      schedule_local_time: normalizedScheduleTime,
      starts_at: firstRunAt.toISOString(),
      next_run_at: firstRunAt.toISOString(),
    }

    if (IS_DEV) {
      console.log('[agent/confirm] inserting mission:', JSON.stringify(missionPayload, null, 2))
    }

    const { data: mission, error: missionError } = await supabase
      .from('agent_missions')
      .insert(missionPayload)
      .select('id, status')
      .single()

    if (missionError || !mission) {
      console.error('[agent/confirm] mission insert error:', JSON.stringify(missionError, null, 2))
      // Rollback: clean up the ICP record we just created
      await supabase.from('agent_icp').delete().eq('id', icp.id)
      return NextResponse.json(
        { error: 'MISSION_CREATE_FAILED', ...devError('MISSION_CREATE_FAILED', missionError) },
        { status: 500 },
      )
    }

    if (IS_DEV) {
      console.log('[agent/confirm] mission created:', mission.id, '(status:', mission.status + ')')
    }

    // ── Step 3: Create mission ICP segment rows ───────────────────────────────

    let icpInsertFailures = 0
    for (let index = 0; index < icp_expanded.slice(0, 20).length; index++) {
      const label = icp_expanded[index]

      const icpToInsert = {
        user_id: userId,
        mission_id: mission.id,
        label: label ?? 'ICP',
        value: label ?? 'default',
        query: label ?? '',
        position: index,
        is_active: true,
      }

      if (!icpToInsert.value) {
        console.error('[agent/confirm] ICP SKIPPED — missing value at index', index, label)
        continue
      }

      if (IS_DEV) {
        console.log('[agent/confirm] inserting ICP row:', JSON.stringify(icpToInsert))
      }

      const { error: icpRowError } = await supabase
        .from('agent_mission_icps')
        .insert(icpToInsert)

      if (icpRowError) {
        console.error('[agent/confirm] ICP row insert error (index', index + '):', JSON.stringify(icpRowError))
        icpInsertFailures++
      }
    }

    // If every ICP row failed to insert, roll back and surface the error
    if (icpInsertFailures > 0 && icpInsertFailures >= icp_expanded.slice(0, 20).length) {
      await supabase.from('agent_missions').delete().eq('id', mission.id)
      await supabase.from('agent_icp').delete().eq('id', icp.id)
      return NextResponse.json(
        { error: 'MISSION_ICP_CREATE_FAILED' },
        { status: 500 },
      )
    }

    // ── Step 4: Kick off first run immediately if start_mode === 'now' ────────

    if (start_mode === 'now') {
      after(async () => {
        await executeMissionRun({
          missionId: mission.id,
          triggerType: 'manual',
          ignoreSchedule: true,
        })
      })
    }

    return NextResponse.json({
      success: true,
      missionId: mission.id,
      status: mission.status,
      next_run_at: firstRunAt.toISOString(),
    })
  } catch (error) {
    console.error('[agent/confirm] unhandled error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
