import { enrichLeadContext } from '@/lib/agent/enrich-context'
import { generateOutreachDraft } from '@/lib/agent/generate-outreach-draft'
import {
  buildLeadIdentity,
  createLeadDedupeState,
  hasLeadCollision,
  rememberLeadIdentity,
} from '@/lib/agent/lead-dedupe'
import { computeNextRunAfterCompletion } from '@/lib/agent/schedule'
import { syncAgentLeadsToMain } from '@/lib/agent/sync-agent-leads-to-main'
import { runSharedProspectorDiscovery } from '@/lib/scraper/run-scraper-shared'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

type AdminClient = ReturnType<typeof createAdminClient>
type MissionRow = Database['public']['Tables']['agent_missions']['Row']
type MissionRunRow = Database['public']['Tables']['agent_mission_runs']['Row']
type MissionIcpRow = Database['public']['Tables']['agent_mission_icps']['Row']
type QueueLeadRow = Database['public']['Tables']['agent_lead_queue']['Row']
type LeadContext = Awaited<ReturnType<typeof enrichLeadContext>>

const DISCOVERY_CONCURRENCY = Math.max(1, Number(process.env.AGENT_DISCOVERY_CONCURRENCY || 3))
const DRAFT_CONCURRENCY = Math.max(1, Number(process.env.AGENT_DRAFT_CONCURRENCY || 2))
const MIN_DISCOVERY_BATCH = 8
const MAX_DISCOVERY_BATCH = 25
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i
const JUNK_EMAIL_RE = /^(noreply|no-reply|do-not-reply|donotreply|mailer-daemon|postmaster)@/i

type ExecuteMissionRunParams = {
  missionId: string
  triggerType: 'manual' | 'scheduler'
  ignoreSchedule?: boolean
}

type ExecuteMissionRunResult =
  | {
      ok: true
      runId: string
      missionId: string
      status: MissionRunRow['status']
      acceptedCount: number
      draftsGeneratedCount: number
      stopReason: string
    }
  | {
      ok: false
      missionId: string
      reason: 'mission_not_found' | 'mission_not_runnable' | 'already_running'
    }

type DraftMissionContext = {
  offerContext: {
    what_you_do: string
    who_you_help: string
    main_benefit: string
    angle: string
  } | null
  offerInput: string
  audienceInput: string
  locationInput: string
  missionCta: string | null
  senderSignature: string | null
  icpAngles: string[]
  painSolved: string | null
  valueOutcome: string | null
}

function isValidEmail(email: string | null | undefined) {
  const normalized = String(email || '').trim()
  return Boolean(normalized && EMAIL_RE.test(normalized) && !JUNK_EMAIL_RE.test(normalized))
}

function rotateVariants(variants: MissionIcpRow[], cursor: number) {
  if (variants.length === 0) return variants
  const offset = ((cursor % variants.length) + variants.length) % variants.length
  return [...variants.slice(offset), ...variants.slice(0, offset)]
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function buildDiscoveryQuery(mission: MissionRow, variant: MissionIcpRow | { label: string; query?: string | null }) {
  const base = String(variant.query || variant.label || '').trim()
  const location = String(mission.location_input || mission.location || '').trim()
  if (!base) return ''
  if (!location) return base

  const lowerBase = base.toLowerCase()
  const lowerLocation = location.toLowerCase()
  if (lowerBase.includes(lowerLocation)) return base

  return `${base} ${location}`.trim()
}

function fromAdminTable(admin: AdminClient, table: string) {
  return admin.from(table as never) as any
}

async function insertRunLog(admin: AdminClient, params: {
  runId: string
  missionId: string
  userId: string
  level?: string
  message: string
  meta?: Record<string, unknown>
}) {
  await fromAdminTable(admin, 'agent_mission_run_logs').insert({
    run_id: params.runId,
    mission_id: params.missionId,
    user_id: params.userId,
    level: params.level ?? 'info',
    message: params.message,
    meta: params.meta ?? null,
  })
}

async function updateRun(admin: AdminClient, runId: string, patch: Database['public']['Tables']['agent_mission_runs']['Update']) {
  await fromAdminTable(admin, 'agent_mission_runs')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

async function loadMission(admin: AdminClient, missionId: string) {
  const { data } = await fromAdminTable(admin, 'agent_missions')
    .select('*')
    .eq('id', missionId)
    .maybeSingle()

  return (data ?? null) as MissionRow | null
}

async function loadMissionVariants(admin: AdminClient, mission: MissionRow) {
  const { data } = await fromAdminTable(admin, 'agent_mission_icps')
    .select('*')
    .eq('mission_id', mission.id)
    .eq('user_id', mission.user_id)
    .eq('is_active', true)
    .order('position', { ascending: true })

  if (data && data.length > 0) {
    return data
  }

  const fallbackLabels = parseStringArray(mission.icp_expanded).length > 0
    ? parseStringArray(mission.icp_expanded)
    : String(mission.audience_input || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)

  return fallbackLabels.map((label, index) => ({
    id: `fallback-${index}`,
    user_id: mission.user_id,
    mission_id: mission.id,
    label,
    query: label,
    position: index,
    is_active: true,
    created_at: mission.created_at,
    updated_at: mission.created_at,
  }))
}

async function createRun(admin: AdminClient, mission: MissionRow, triggerType: ExecuteMissionRunParams['triggerType']) {
  const { data, error } = await fromAdminTable(admin, 'agent_mission_runs')
    .insert({
      user_id: mission.user_id,
      mission_id: mission.id,
      status: 'queued',
      trigger_type: triggerType,
      scheduled_for: mission.next_run_at,
      requested_leads: mission.daily_target,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return null
    }
    throw error
  }

  return data
}

async function seedDedupeState(admin: AdminClient, mission: MissionRow) {
  const state = createLeadDedupeState()
  const { data } = await fromAdminTable(admin, 'agent_lead_queue')
    .select('business_name, location, website, email, phone')
    .eq('mission_id', mission.id)
    .eq('user_id', mission.user_id)

  for (const row of ((data ?? []) as Array<Pick<QueueLeadRow, 'business_name' | 'location' | 'website' | 'email' | 'phone'>>)) {
    rememberLeadIdentity(
      state,
      buildLeadIdentity({
        business_name: row.business_name,
        location: row.location,
        website: row.website,
        email: row.email,
        phone: row.phone,
      })
    )
  }

  return state
}

async function persistAcceptedLeads(
  admin: AdminClient,
  mission: MissionRow,
  runId: string,
  leads: Awaited<ReturnType<typeof runSharedProspectorDiscovery>>['finalEnrichedLeads'],
) {
  let insertedCount = 0

  for (const lead of leads) {
    const identity = buildLeadIdentity({
      business_name: lead.company_name,
      website: lead.website,
      email: lead.email,
      phone: lead.phone,
      location: lead.city,
    })

const dedupKey =
  identity.normalizedDomain ||
  identity.normalizedPhone ||
  identity.normalizedWebsite ||
  identity.normalizedBusinessName ||
  null

const leadToInsert = {
  mission_id: mission.id,
  user_id: mission.user_id,
  run_id: runId,

  business_name: lead.company_name ?? null,
  website: lead.website ?? null,
  email: lead.email ?? null,
  phone: lead.phone ?? null,
  location: lead.city ?? null,

  domain: (lead as any).domain ?? null,
  normalized_domain: identity.normalizedDomain ?? null,
  normalized_business_name: identity.normalizedBusinessName ?? null,

  dedup_key: dedupKey,

  source: (lead as any).source ?? 'scraper',
  metadata: (lead as any).metadata ?? {},
}

    try {
      const { error } = await fromAdminTable(admin, 'agent_lead_queue').insert(leadToInsert)
      if (!error) {
        insertedCount++
      } else {
        console.error('[executor] insert failed', error)
      }
    } catch (err) {
      console.error('[executor] insert crash', err)
    }
  }

  return insertedCount
}

function buildDraftMissionContext(mission: MissionRow): DraftMissionContext {
  const offerContext =
    mission.offer_context && typeof mission.offer_context === 'object'
      ? (mission.offer_context as DraftMissionContext['offerContext'])
      : null

  const icpAngles = parseStringArray(mission.icp_expanded).slice(0, 3)
  if (offerContext?.angle && !icpAngles.includes(offerContext.angle)) {
    icpAngles.unshift(offerContext.angle)
  }

  return {
    offerContext,
    offerInput: String(mission.offer_input || '').trim(),
    audienceInput: String(mission.audience_input || '').trim(),
    locationInput: String(mission.location_input || mission.location || '').trim(),
    missionCta: mission.cta ?? null,
    senderSignature: mission.sender_signature ?? null,
    icpAngles,
    painSolved: offerContext?.angle ?? null,
    valueOutcome: offerContext?.main_benefit ?? null,
  }
}

async function generateDraftsForRun(admin: AdminClient, params: {
  mission: MissionRow
  run: MissionRunRow
}) {
  const missionDraftContext = buildDraftMissionContext(params.mission)
  const enrichmentCache = new Map<string, LeadContext>()

  const { data: queueLeads } = await fromAdminTable(admin, 'agent_lead_queue')
    .select('id, business_name, email, website, location, dedup_key')
    .eq('mission_id', params.mission.id)
    .eq('run_id', params.run.id)
    .eq('user_id', params.mission.user_id)

  const typedQueueLeads = (queueLeads ?? []) as Array<
    Pick<QueueLeadRow, 'id' | 'business_name' | 'email' | 'website' | 'location' | 'dedup_key'>
  >

  if (!typedQueueLeads.length) {
    return 0
  }

  const { data: existingDrafts } = await fromAdminTable(admin, 'outreach_queue')
    .select('dedup_key')
    .eq('mission_id', params.mission.id)
    .eq('user_id', params.mission.user_id)

  const existingKeys = new Set(
    (existingDrafts ?? [])
      .map((row: { dedup_key: string | null }) => row.dedup_key || '')
      .filter(Boolean)
  )

  const toProcess = typedQueueLeads.filter(
    (lead) => lead.dedup_key && !existingKeys.has(lead.dedup_key)
  )
  if (toProcess.length === 0) {
    return 0
  }

  let queueIndex = 0
  let draftsGenerated = 0

  const workerCount = Math.min(DRAFT_CONCURRENCY, toProcess.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (queueIndex < toProcess.length) {
      const index = queueIndex
      queueIndex += 1
      const lead = toProcess[index]
      if (!lead || !lead.dedup_key) continue

      const cacheKey = (lead.website || lead.business_name || '').toLowerCase()
      let context = cacheKey ? enrichmentCache.get(cacheKey) : undefined
      if (!context) {
        context = await enrichLeadContext({
          company_name: lead.business_name,
          website: lead.website,
        })
        if (cacheKey) enrichmentCache.set(cacheKey, context)
      }

      const draft = await generateOutreachDraft({
        company_name: lead.business_name || context.company_name || 'your company',
        audience_input: missionDraftContext.audienceInput,
        location_input: missionDraftContext.locationInput || lead.location || null,
        mission_cta: missionDraftContext.missionCta,
        sender_signature: missionDraftContext.senderSignature,
        offer: missionDraftContext.offerInput || 'our service',
        angles: missionDraftContext.icpAngles,
        context,
        offer_context: missionDraftContext.offerContext,
        pain_solved: missionDraftContext.painSolved,
        value_outcome: missionDraftContext.valueOutcome,
        variation_seed: index % 3,
      })

      if (!draft.subject || !draft.body) {
        continue
      }

      const { error } = await fromAdminTable(admin, 'outreach_queue').insert({
        user_id: params.mission.user_id,
        mission_id: params.mission.id,
        run_id: params.run.id,
        lead_id: lead.id,
        source: 'agent',
        company_name: lead.business_name || null,
        contact_email: lead.email || null,
        location: lead.location || null,
        website: lead.website || null,
        dedup_key: lead.dedup_key,
        subject: draft.subject,
        hook: draft.hook,
        body: draft.body,
        cta: missionDraftContext.missionCta,
        full_email: draft.full_email || draft.body,
        personalization_score: draft.personalization_score,
        quality_score: draft.quality_score,
        context_status: context.enriched ? 'enriched' : 'basic',
        context_title: context.title || null,
        context_description: context.description || null,
        context_h1: context.h1 || null,
        review_status: 'draft',
      })

      if (!error) {
        draftsGenerated += 1
        existingKeys.add(lead.dedup_key)
      }
    }
  })

  await Promise.all(workers)
  return draftsGenerated
}

export async function executeMissionRun(params: ExecuteMissionRunParams): Promise<ExecuteMissionRunResult> {
  const admin = createAdminClient()
  const mission = await loadMission(admin, params.missionId)

  if (!mission) {
    return { ok: false, missionId: params.missionId, reason: 'mission_not_found' }
  }

  if (!['active', 'scheduled'].includes(mission.status)) {
    return { ok: false, missionId: mission.id, reason: 'mission_not_runnable' }
  }



  const now = new Date()
  if (!params.ignoreSchedule && mission.next_run_at && now < new Date(mission.next_run_at)) {
    return { ok: false, missionId: mission.id, reason: 'mission_not_runnable' }
  }

  const run = await createRun(admin, mission, params.triggerType)
  if (!run) {
    return { ok: false, missionId: mission.id, reason: 'already_running' }
  }

  // Resolved target — guards against 0 / null / undefined which would cause the
  // worker loop to exit immediately without scraping anything.
  const target = Math.max(mission.daily_target || 10, 1)

  console.log('[executor] RUN START', mission.id)
  console.log('[executor] TARGET', target, '(raw daily_target:', mission.daily_target + ')')

  // ── Pre-flight: load ICP variants before transitioning to 'running' ─────────
  // If we can't run, finalize the run record here and return early — no try/finally needed.

  console.log('[executor] FETCHING ICPS...')
  const allVariants = await loadMissionVariants(admin, mission)

  if (!allVariants || allVariants.length === 0) {
    await updateRun(admin, run.id, {
      status: 'failed',
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
      stop_reason: 'no_icp_variants',
      error_message: 'No ICP variants found for mission',
    })
    await fromAdminTable(admin, 'agent_missions')
      .update({
        status: mission.status === 'scheduled' ? 'active' : mission.status,
        last_run_at: now.toISOString(),
        last_run_status: 'failed',
        last_stop_reason: 'no_icp_variants',
        updated_at: now.toISOString(),
      })
      .eq('id', mission.id)
    return {
      ok: true,
      runId: run.id,
      missionId: mission.id,
      status: 'failed',
      acceptedCount: 0,
      draftsGeneratedCount: 0,
      stopReason: 'no_icp_variants',
    }
  }

  const variants = rotateVariants(allVariants, mission.rotation_cursor)
  const activeVariants = variants.filter((variant) => variant.is_active)

  console.log('[executor] ICPS', allVariants.length, 'total,', activeVariants.length, 'active')

  if (activeVariants.length === 0) {
    await updateRun(admin, run.id, {
      status: 'failed',
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
      stop_reason: 'no_icp_variants',
      error_message: 'Mission has no active ICP variants',
    })
    await fromAdminTable(admin, 'agent_missions')
      .update({
        status: mission.status === 'scheduled' ? 'active' : mission.status,
        last_run_at: now.toISOString(),
        last_run_status: 'failed',
        last_stop_reason: 'no_icp_variants',
        updated_at: now.toISOString(),
      })
      .eq('id', mission.id)
    return {
      ok: true,
      runId: run.id,
      missionId: mission.id,
      status: 'failed',
      acceptedCount: 0,
      draftsGeneratedCount: 0,
      stopReason: 'no_icp_variants',
    }
  }

  // ── Transition: mark run as 'running' ────────────────────────────────────────
  // Everything from here on MUST finalize through the finally block below.

  await updateRun(admin, run.id, {
    status: 'running',
    started_at: now.toISOString(),
  })

  await fromAdminTable(admin, 'agent_missions')
    .update({
      status: 'active',
      last_run_status: 'running',
      last_stop_reason: null,
      updated_at: now.toISOString(),
    })
    .eq('id', mission.id)

  await insertRunLog(admin, {
    runId: run.id,
    missionId: mission.id,
    userId: mission.user_id,
    message: 'Mission run started',
    meta: {
      triggerType: params.triggerType,
      requestedLeads: mission.daily_target,
      variantCount: activeVariants.length,
    },
  })

  // ── State variables — declared outside try so finally can always read them ───

  const acceptedLeads: Awaited<ReturnType<typeof runSharedProspectorDiscovery>>['finalEnrichedLeads'] = []
  let runStatus: MissionRunRow['status'] = 'running'
  let insertedCount = 0
  let discoveredCount = 0
  let emailCount = 0
  let dedupedCount = 0
  let stopReason = 'no_more_results'
  let draftsGeneratedCount = 0
  let finalStopReason = 'no_more_results'

  try {
    const dedupeState = await seedDedupeState(admin, mission)

    let queueIndex = 0

    const workerCount = Math.min(DISCOVERY_CONCURRENCY, activeVariants.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (queueIndex < activeVariants.length && acceptedLeads.length < target) {
        const currentIndex = queueIndex
        queueIndex += 1
        const variant = activeVariants[currentIndex]
        if (!variant) continue

        const query = buildDiscoveryQuery(mission, variant)
        if (!query) {
          console.log('[executor] SKIP ICP (empty query):', variant.label)
          continue
        }

        console.log('[executor] RUN ICP', variant.label, '| query:', query)

        const remaining = Math.max(target - acceptedLeads.length, 0)
        if (remaining <= 0) {
          stopReason = 'quota_reached'
          console.log('[executor] STOP CONDITION', { accepted: acceptedLeads.length, target })
          break
        }

        const maxLeads = Math.min(MAX_DISCOVERY_BATCH, Math.max(MIN_DISCOVERY_BATCH, remaining * 2))
        await insertRunLog(admin, {
          runId: run.id,
          missionId: mission.id,
          userId: mission.user_id,
          message: 'Starting deterministic discovery',
          meta: { query, icp: variant.label, remaining, maxLeads },
        })

        const result = await runSharedProspectorDiscovery(
          {
            query,
            defaultCity: String(mission.location_input || mission.location || '').trim() || 'Global',
            region: '',
            country: String(mission.location_input || mission.location || '').trim() || 'Global',
            maxLeads,
            mode: 'fast',
          },
          () => {}
        )

        console.log('[executor] LEADS RETURNED', result.finalEnrichedLeads.length, '(discovered:', result.discoveredCount + ')')

        discoveredCount += result.discoveredCount

        const emailFirst = result.finalEnrichedLeads.filter((lead) => isValidEmail(lead.email))
        emailCount += emailFirst.length

        let acceptedThisVariant = 0
        for (const lead of emailFirst) {
          if (acceptedLeads.length >= target) {
            stopReason = 'quota_reached'
            break
          }

          const identity = buildLeadIdentity({
            business_name: lead.company_name,
            website: lead.website,
            email: lead.email,
            phone: lead.phone,
            location: lead.city,
          })

          if (
            !identity.normalizedDomain &&
            !identity.normalizedPhone &&
            !identity.normalizedWebsite &&
            !identity.normalizedBusinessName
          ) {
            dedupedCount += 1
            continue
          }

          if (hasLeadCollision(dedupeState, identity)) {
            dedupedCount += 1
            continue
          }

          rememberLeadIdentity(dedupeState, identity)
          acceptedLeads.push(lead)
          acceptedThisVariant += 1
        }

        if (acceptedLeads.length >= target) {
          stopReason = 'quota_reached'
        }

        console.log('[executor] STOP CONDITION', { accepted: acceptedLeads.length, target, stopReason })

        await insertRunLog(admin, {
          runId: run.id,
          missionId: mission.id,
          userId: mission.user_id,
          message: 'Deterministic discovery finished',
          meta: {
            query,
            icp: variant.label,
            discoveredCount: result.discoveredCount,
            emailCount: emailFirst.length,
            acceptedCount: acceptedThisVariant,
            filteredWithoutEmail: result.discoveredCount - emailFirst.length,
          },
        })
      }
    })

    await Promise.all(workers)

insertedCount = await persistAcceptedLeads(
  admin,
  mission,
  run.id,
  acceptedLeads.slice(0, target)
)
    await syncAgentLeadsToMain({
      supabase: admin,
      userId: mission.user_id,
      missionId: mission.id,
    })

    draftsGeneratedCount = await generateDraftsForRun(admin, { mission, run })

    runStatus =
      insertedCount >= target
        ? 'completed'
        : insertedCount > 0
          ? 'partial'
          : 'failed'

    finalStopReason =
      stopReason === 'quota_reached'
        ? 'quota_reached'
        : insertedCount > 0
          ? 'no_more_results'
          : 'no_accepted_leads'

    console.log('[executor] RUN COMPLETE — inserted:', insertedCount, '/ target:', target, '| stopReason:', finalStopReason)

    await insertRunLog(admin, {
      runId: run.id,
      missionId: mission.id,
      userId: mission.user_id,
      message: 'Mission run completed',
      meta: {
        status: runStatus,
        stopReason: finalStopReason,
        discoveredCount,
        acceptedCount: insertedCount,
        draftsGeneratedCount,
      },
    })

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown mission executor error'
    console.error('[executor] EXECUTOR ERROR', message, error)
    runStatus = 'failed'
    finalStopReason = 'error'

    await insertRunLog(admin, {
      runId: run.id,
      missionId: mission.id,
      userId: mission.user_id,
      level: 'error',
      message: 'Mission run failed with error',
      meta: { error: message },
    }).catch(() => {})

  } finally {
    // ── Guaranteed finalization — always runs regardless of try/catch outcome ──
    const finishedAt = new Date()
    const safeStatus = runStatus || 'completed'

    console.log('[executor] RUN FINALIZED', { runStatus: safeStatus, insertedCount, finalStopReason })

    try {
      await updateRun(admin, run.id, {
        status: safeStatus,
        finished_at: finishedAt.toISOString(),
        discovered_count: discoveredCount || 0,
        accepted_count: insertedCount || 0,
        email_count: emailCount || 0,
        deduped_count: dedupedCount || 0,
        drafts_generated_count: draftsGeneratedCount || 0,
        stop_reason: finalStopReason || null,
      })
    } catch (runUpdateErr) {
      console.error('[executor] FINALIZE RUN UPDATE ERROR', runUpdateErr)
    }

    try {
      await fromAdminTable(admin, 'agent_missions')
        .update({
          status: 'active',
          last_run_at: finishedAt.toISOString(),
          last_run_status: safeStatus,
          last_stop_reason: finalStopReason || null,
          next_run_at: computeNextRunAfterCompletion({
            timeZone: mission.schedule_timezone,
            localTime: mission.schedule_local_time,
            completedAt: finishedAt,
          }).toISOString(),
          rotation_cursor:
            variants.length > 0
              ? (mission.rotation_cursor + Math.max(1, activeVariants.length)) % variants.length
              : 0,
          updated_at: finishedAt.toISOString(),
        })
        .eq('id', mission.id)
    } catch (missionUpdateErr) {
      console.error('[executor] FINALIZE MISSION UPDATE ERROR', missionUpdateErr)
    }
  }

  return {
    ok: true,
    runId: run.id,
    missionId: mission.id,
    status: runStatus,
    acceptedCount: insertedCount,
    draftsGeneratedCount,
    stopReason: finalStopReason,
  }
}
