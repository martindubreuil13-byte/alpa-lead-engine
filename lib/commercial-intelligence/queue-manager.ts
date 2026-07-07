import { createServerClient } from '@/lib/supabase/server'

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
  supabase?: any
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

/**
 * Atomically claim pending queue items for processing.
 * Uses PostgreSQL row locking (FOR UPDATE SKIP LOCKED) to ensure
 * no two workers receive the same item.
 *
 * Returns items that:
 * - Status = 'pending'
 * - Haven't exceeded max_retries
 * - Meet retry backoff (60 second delay between retries)
 *
 * Items are atomically marked as 'processing' before returning.
 */
export async function claimPendingQueueItems(limit = 10): Promise<QueueItem[]> {
  const startedAt = Date.now()
  console.log(`[CI-TRACE] STEP 5 ENTER claimPendingQueueItems limit=${limit}`)
  console.log('[CI-TRACE] STEP 5 BEFORE claimPendingQueueItems.createServerClient')
  const supabase = await createServerClient()
  console.log(`[CI-TRACE] STEP 5 AFTER claimPendingQueueItems.createServerClient elapsed_ms=${Date.now() - startedAt}`)

  try {
    console.log(`[CI-Queue] Claiming up to ${limit} pending items...`)

    const authCheckStartedAt = Date.now()
    console.log(`[CI-DIAG] before claimPendingQueueItems.auth.getUser limit=${limit}`)
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    console.log(
      `[CI-DIAG] after claimPendingQueueItems.auth.getUser has_user=${Boolean(user?.id)} user_id=${user?.id || 'null'} has_error=${Boolean(userError)} error=${userError?.message || 'null'} elapsed_ms=${Date.now() - authCheckStartedAt}`
    )

    const sessionCheckStartedAt = Date.now()
    console.log(`[CI-DIAG] before claimPendingQueueItems.auth.getSession limit=${limit}`)
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    console.log(
      `[CI-DIAG] after claimPendingQueueItems.auth.getSession has_session=${Boolean(sessionData.session)} has_access_token=${Boolean(sessionData.session?.access_token)} user_id=${sessionData.session?.user?.id || 'null'} expires_at=${sessionData.session?.expires_at || 'null'} has_error=${Boolean(sessionError)} error=${sessionError?.message || 'null'} elapsed_ms=${Date.now() - sessionCheckStartedAt}`
    )

    const rpcStartedAt = Date.now()
    console.log(`[CI-TRACE] STEP 5 BEFORE rpc claim_ci_queue_items limit=${limit}`)
    console.log(
      `[CI-DIAG] before rpc claim_ci_queue_items limit=${limit} authenticated_user_id=${user?.id || 'null'} has_access_token=${Boolean(sessionData.session?.access_token)}`
    )
    const { data, error } = await supabase.rpc('claim_ci_queue_items', {
      p_limit: limit,
    })
    console.log(
      `[CI-TRACE] STEP 5 AFTER rpc claim_ci_queue_items claimed_count=${data?.length || 0} has_error=${Boolean(error)} elapsed_ms=${Date.now() - rpcStartedAt}`
    )
    console.log(
      `[CI-DIAG] after rpc claim_ci_queue_items claimed_count=${data?.length || 0} has_error=${Boolean(error)} elapsed_ms=${Date.now() - rpcStartedAt}`
    )

    if (error) {
      console.error('[CI-TRACE] STEP 5 ERROR claimPendingQueueItems rpc failed', error, (error as any)?.stack)
      console.error(`[CI-Queue] Failed to claim items`, error)
      console.log(
        `[CI-DIAG] early return claimPendingQueueItems reason=rpc_error claimed_count=0 elapsed_ms=${Date.now() - startedAt}`
      )
      return []
    }

    const items = (data || []) as QueueItem[]
    console.log(
      `[CI-TRACE] STEP 5 PASS claimPendingQueueItems claimed_count=${items.length} queue_items=${JSON.stringify(items.map((item) => ({ queue_id: item.id, lead_id: item.lead_id, retry_count: item.retry_count, max_retries: item.max_retries })))} elapsed_ms=${Date.now() - startedAt}`
    )
    if (items.length > 0) {
      console.log(`[CI-Queue] Claimed ${items.length} items for processing`)
    } else {
      console.log(
        `[CI-DIAG] early return claimPendingQueueItems reason=no_rows_claimed claimed_count=0 elapsed_ms=${Date.now() - startedAt}`
      )
    }

    return items
  } catch (err) {
    console.error('[CI-TRACE] STEP 5 ERROR claimPendingQueueItems caught', err, err instanceof Error ? err.stack : undefined)
    console.error(`[CI-Queue] Exception claiming items`, err)
    console.log(
      `[CI-DIAG] early return claimPendingQueueItems reason=caught_exception claimed_count=0 elapsed_ms=${Date.now() - startedAt}`
    )
    return []
  }
}

/**
 * Reset queue items stuck in 'processing' status due to worker crash.
 * Items processing for > timeout_seconds are reset to 'pending' for retry.
 * Called at worker startup to recover from crashes.
 */
export async function resetStaleProcessingItems(timeoutSeconds = 300): Promise<{ resetCount: number }> {
  const startedAt = Date.now()
  console.log(`[CI-TRACE] STEP 4 ENTER resetStaleProcessingItems timeout_seconds=${timeoutSeconds}`)
  console.log('[CI-TRACE] STEP 4 BEFORE resetStaleProcessingItems.createServerClient')
  const supabase = await createServerClient()
  console.log(`[CI-TRACE] STEP 4 AFTER resetStaleProcessingItems.createServerClient elapsed_ms=${Date.now() - startedAt}`)

  try {
    console.log(`[CI-Queue] Resetting stale processing items (timeout: ${timeoutSeconds}s)`)

    const rpcStartedAt = Date.now()
    console.log(`[CI-TRACE] STEP 4 BEFORE rpc reset_stale_ci_processing timeout_seconds=${timeoutSeconds}`)
    const { data, error } = await supabase.rpc('reset_stale_ci_processing', {
      p_timeout_seconds: timeoutSeconds,
    })
    console.log(
      `[CI-TRACE] STEP 4 AFTER rpc reset_stale_ci_processing reset_count=${data?.[0]?.reset_count || 0} has_error=${Boolean(error)} elapsed_ms=${Date.now() - rpcStartedAt}`
    )

    if (error) {
      console.error('[CI-TRACE] STEP 4 ERROR resetStaleProcessingItems rpc failed', error, (error as any)?.stack)
      console.error(`[CI-Queue] Failed to reset stale items`, error)
      return { resetCount: 0 }
    }

    const resetCount = data?.[0]?.reset_count || 0
    if (resetCount > 0) {
      console.log(`[CI-Queue] Reset ${resetCount} stale items`)
    }

    console.log(`[CI-TRACE] STEP 4 PASS resetStaleProcessingItems reset_count=${resetCount} elapsed_ms=${Date.now() - startedAt}`)
    return { resetCount }
  } catch (err) {
    console.error('[CI-TRACE] STEP 4 ERROR resetStaleProcessingItems caught', err, err instanceof Error ? err.stack : undefined)
    console.error(`[CI-Queue] Exception resetting stale items`, err)
    return { resetCount: 0 }
  }
}

/**
 * Atomically complete enrichment and update queue + lead.
 * Ensures queue and lead always stay in sync.
 *
 * On success:
 * - Queue marked 'completed'
 * - Lead updated with enrichment data
 *
 * On failure:
 * - If retry_count < max_retries: queue marked 'pending', will retry
 * - Else: queue marked 'failed'
 * - Lead marked with error
 * - retry_count incremented
 */
export async function completeEnrichment(
  queueId: string,
  leadId: string,
  snapshot: any,
  signals: any,
  profile: any,
  success: boolean,
  errorMsg?: string
): Promise<{ ok: boolean; nextStatus?: string }> {
  const supabase = await createServerClient()

  try {
    const { data, error } = await supabase.rpc('complete_ci_enrichment', {
      p_queue_id: queueId,
      p_lead_id: leadId,
      p_snapshot: snapshot,
      p_signals: signals,
      p_profile: profile,
      p_success: success,
      p_error_msg: errorMsg || null,
    })

    if (error) {
      console.error(`[CI-Queue] Failed to complete enrichment: ${queueId}`, error)
      return { ok: false }
    }

    const result = data?.[0]
    if (result?.success) {
      const nextStatus = result.message || (success ? 'completed' : 'pending')

      // Trigger webhook to revalidate UI (fire and forget)
      try {
        const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/commercial-intelligence/webhook/complete`
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueId, leadId, status: nextStatus }),
        }).catch((err) => {
          console.error(`[CI-Queue] Webhook call failed: ${err.message}`)
        })
      } catch (webhookErr) {
        console.error(`[CI-Queue] Webhook error: ${webhookErr}`)
      }

      return { ok: true, nextStatus }
    }

    console.error(`[CI-Queue] Enrichment completion failed: ${result?.message}`)
    return { ok: false }
  } catch (err) {
    console.error(`[CI-Queue] Exception completing enrichment: ${queueId}`, err)
    return { ok: false }
  }
}

/**
 * Get queue statistics for monitoring.
 */
export async function getQueueStats(): Promise<{
  pending: number
  processing: number
  completed: number
  failed: number
  total: number
}> {
  const supabase = await createServerClient()

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
