import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

type QueueClient = any

export interface QueueItem {
  id: string
  lead_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  retry_count: number
  max_retries: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  last_error: string | null
  last_retry_at: string | null
}

export interface WorkerQueueItem extends QueueItem {
  claim_token: string
}

/**
 * Enqueue a lead for Commercial Intelligence enrichment.
 * Creates a persistent queue record before returning.
 * Does NOT start enrichment immediately.
 *
 * Inserts only minimum required fields:
 * - lead_id (required)
 * - status = 'pending'
 *
 * All other fields use database defaults.
 */
export async function enqueueLeadEnrichment(
  leadId: string,
  supabase?: any,
  options: { workerEligible?: boolean; adminClient?: QueueClient } = {}
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const startedAt = Date.now()
  console.log(`[CI-TRACE] STEP 2 ENTER enqueueLeadEnrichment lead_id=${leadId}`)
  console.log('[FORENSIC] enqueueLeadEnrichment ENTRY with leadId:', leadId, 'typeof:', typeof leadId)

  // Use provided client (same request context) or create new one
  console.log(`[CI-TRACE] STEP 2 BEFORE enqueueLeadEnrichment.createServerClient lead_id=${leadId}`)
  const client = supabase || (await createServerClient())
  console.log(`[CI-TRACE] STEP 2 AFTER enqueueLeadEnrichment.createServerClient lead_id=${leadId} elapsed_ms=${Date.now() - startedAt}`)
  console.log('[FORENSIC] Supabase client:', supabase ? 'provided' : 'created-new')

  // Diagnostics: Log connection details
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const projectRef = supabaseUrl?.split('//')[1]?.split('.')[0] || 'unknown'
  console.log('[DIAG-ENQUEUE] Supabase URL:', supabaseUrl)
  console.log('[DIAG-ENQUEUE] Project Ref:', projectRef)
  console.log('[DIAG-ENQUEUE] Client initialized from:', new Error().stack?.split('\n')[2])

  try {
    console.log(`[CI-QUEUE] enqueue called`)

    // Get current user ID from Supabase auth
    const authStartedAt = Date.now()
    console.log(`[CI-TRACE] STEP 2 BEFORE enqueueLeadEnrichment.auth.getUser lead_id=${leadId}`)
    const { data: authData, error: authError } = await client.auth.getUser()
    console.log(
      `[CI-TRACE] STEP 2 AFTER enqueueLeadEnrichment.auth.getUser lead_id=${leadId} has_user=${Boolean(authData.user?.id)} elapsed_ms=${Date.now() - authStartedAt}`
    )
    if (authError || !authData.user?.id) {
      console.error(
        '[CI-TRACE] STEP 2 EARLY_RETURN enqueueLeadEnrichment reason=not_authenticated',
        authError,
        authError instanceof Error ? authError.stack : undefined
      )
      console.error('[CI-QUEUE] queue insert error: Could not get authenticated user')
      return { ok: false, error: 'Not authenticated' }
    }

    const userId = authData.user.id
    console.log('[FORENSIC] Authenticated user_id:', userId)

    // Owner-verified private preview: eligibility is granted only through the
    // service-role RPC (the database rejects it from user sessions). The RPC
    // also covers rediscovered leads without duplicating jobs or profiles.
    if (options.workerEligible === true) {
      const { data: outcome, error: rpcError } = await (options.adminClient || createAdminClient()).rpc(
        'enqueue_private_preview_ci_worker',
        { p_lead_id: leadId, p_user_id: userId }
      )
      if (rpcError) {
        console.error(`[CI-QUEUE] private preview enqueue error: ${leadId} - ${rpcError.message}`)
        return { ok: false, error: `Private preview enqueue failed: ${rpcError.message}` }
      }
      return { ok: true, data: { id: leadId, lead_id: leadId, status: 'pending', outcome } }
    }

    const payload = {
      lead_id: leadId,
      user_id: userId,
      status: 'pending',
    }
    console.log('[FORENSIC] Insert payload:', JSON.stringify(payload))

    // Insert only minimum required fields
    // Database provides defaults for: retry_count, created_at, etc.
    console.log('[FORENSIC] About to call client.from().insert().select().single()')
    const insertStartedAt = Date.now()
    console.log(`[CI-TRACE] STEP 2 BEFORE commercial_intelligence_queue.insert lead_id=${leadId} queue_status=pending`)
    const { data, error } = await client
      .from('commercial_intelligence_queue')
      .insert(payload)
      .select('id, lead_id, status, created_at')
      .single()
    console.log(
      `[CI-TRACE] STEP 2 AFTER commercial_intelligence_queue.insert lead_id=${leadId} queue_id=${data?.id || 'N/A'} queue_status=${data?.status || 'N/A'} has_error=${Boolean(error)} elapsed_ms=${Date.now() - insertStartedAt}`
    )

    console.log('[FORENSIC] Supabase response received')
    console.log('[FORENSIC] Response data:', JSON.stringify(data))
    console.log('[FORENSIC] Response error:', error ? JSON.stringify(error) : 'null')

    // Unique constraint violation = lead already enqueued, silent success
    if (error?.code === '23505') {
      console.log(
        `[CI-TRACE] STEP 2 EARLY_RETURN enqueueLeadEnrichment reason=dedup lead_id=${leadId} elapsed_ms=${Date.now() - startedAt}`
      )
      console.log(`[CI-QUEUE] queue insert success (dedup): ${leadId}`)
      return { ok: true, data: { id: leadId, lead_id: leadId, status: 'pending', dedup: true } }
    }

    if (error) {
      console.error(
        '[CI-TRACE] STEP 2 ERROR enqueueLeadEnrichment insert failed',
        error,
        (error as any)?.stack
      )
      console.error(`[CI-QUEUE] queue insert error: ${leadId} - ${error.code}: ${error.message}`)
      console.error('[DIAG-ERROR] Complete error object:', JSON.stringify(error, null, 2))
      console.error('[DIAG-ERROR] Error hint:', (error as any).hint)
      console.error('[DIAG-ERROR] Error details:', (error as any).details)
      console.error('[DIAG-ERROR] Error context:', (error as any).context)
      return { ok: false, error: `Queue insert failed: ${error.message}` }
    }

    if (!data) {
      console.error(`[CI-TRACE] STEP 2 EARLY_RETURN enqueueLeadEnrichment reason=no_data lead_id=${leadId}`)
      console.error(`[CI-QUEUE] queue insert error: ${leadId} - No data returned from insert`)
      return { ok: false, error: 'Insert succeeded but no data returned' }
    }

    console.log(`[CI-QUEUE] queue insert success: ${leadId}`)
    console.log('[FORENSIC] enqueueLeadEnrichment SUCCESS EXIT, returning data:', JSON.stringify(data))
    console.log(
      `[CI-TRACE] STEP 2 PASS enqueueLeadEnrichment lead_id=${leadId} queue_id=${data.id} queue_status=${data.status} elapsed_ms=${Date.now() - startedAt}`
    )
    return { ok: true, data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[CI-TRACE] STEP 2 ERROR enqueueLeadEnrichment caught', err, err instanceof Error ? err.stack : undefined)
    console.error(`[CI-QUEUE] queue insert error: ${leadId} - Exception: ${msg}`)
    console.error('[FORENSIC] Exception caught:', JSON.stringify(err, null, 2))
    return { ok: false, error: msg }
  }
}

// The customer-session claim, reset and completion functions were removed in B2 Phase 0: customers no
// longer drive research. The service-role worker functions below are the only execution path.

/**
 * Get queue statistics for monitoring.
 */
export async function getQueueStats(client?: QueueClient): Promise<{
  pending: number
  processing: number
  completed: number
  failed: number
  total: number
}> {
  const supabase = client || (await createServerClient())

  try {
    const { data, error } = await supabase.from('commercial_intelligence_queue').select('status')

    if (error || !data) {
      return { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 }
    }

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: data.length,
    }

    for (const item of data) {
      stats[item.status as keyof typeof stats]++
    }

    return stats
  } catch (err) {
    console.error(`[CI-Queue] Exception getting stats`, err)
    return { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 }
  }
}

/** Service-role-only worker claim. The RPC atomically locks rows and returns a
 * claim token used to fence late or duplicate completions. */
export async function claimWorkerQueueItems(
  client: QueueClient,
  limit = 5
): Promise<WorkerQueueItem[]> {
  const { data, error } = await client.rpc('claim_ci_queue_items_worker', {
    p_limit: limit,
  })

  if (error) throw new Error(`Worker claim failed: ${error.message}`)
  return (data || []) as WorkerQueueItem[]
}

export async function resetStaleWorkerItems(
  client: QueueClient,
  timeoutSeconds = 300
): Promise<{ resetCount: number; failedCount: number }> {
  const { data, error } = await client.rpc('reset_stale_ci_processing_worker', {
    p_timeout_seconds: timeoutSeconds,
  })

  if (error) throw new Error(`Worker stale recovery failed: ${error.message}`)
  return {
    resetCount: data?.[0]?.reset_count || 0,
    failedCount: data?.[0]?.failed_count || 0,
  }
}

export async function completeWorkerEnrichment(
  client: QueueClient,
  item: WorkerQueueItem,
  snapshot: any,
  signals: any,
  profile: any,
  success: boolean,
  errorMsg?: string
): Promise<{ ok: boolean; nextStatus?: string }> {
  const { data, error } = await client.rpc('complete_ci_enrichment_worker', {
    p_queue_id: item.id,
    p_lead_id: item.lead_id,
    p_claim_token: item.claim_token,
    p_snapshot: snapshot,
    p_signals: signals,
    p_profile: profile,
    p_success: success,
    p_error_msg: errorMsg || null,
  })

  if (error) throw new Error(`Worker completion failed: ${error.message}`)
  const result = data?.[0]
  return { ok: Boolean(result?.success), nextStatus: result?.message }
}
