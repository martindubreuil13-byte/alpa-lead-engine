import { createServerClient } from '@/lib/supabase/server'
import { extractWebsiteSnapshot } from './extract-website-snapshot'
import { generateBusinessSignals } from './generate-business-signals'
import { generateCommercialProfile } from './generate-commercial-profile'
import { hasUsableProfile } from './research-completion'
import { createResearchDeadline, ResearchDeadlineError, RESEARCH_DEADLINE_MS } from './research-deadline'
import { runResearchStages } from './research-run'
import { assertResearchEnabled } from './research-switch'
import type { CommercialProfile, BusinessSignals, WebsiteSnapshot } from './types'

/**
 * 'direct'   (default, manual research routes): this function stores the outcome on the lead itself.
 * 'deferred' (queue paths): this function only reports the outcome. The queue job and the lead are
 *            finalized together by complete_ci_enrichment[_worker], so the lead is never marked
 *            completed or failed before its queue job is, and a stale worker cannot write at all.
 */
export type EnrichPersistMode = 'direct' | 'deferred'

export interface EnrichLeadDirectResult {
  success: boolean
  leadId: string
  website_snapshot: WebsiteSnapshot | null
  business_signals: BusinessSignals | null
  commercial_profile: CommercialProfile | null
  ci_enrichment_status: 'completed' | 'failed' | 'skipped'
  ci_started_at: string
  ci_completed_at: string
  ci_last_error: string | null
  ci_retry_count: number
  ci_processing_duration_ms: number
  ci_cost_estimate: number
  ci_model_versions: {
    snapshot: string
    signals: string
    profile: string
  }
  error?: {
    code: string
    message: string
  }
}

export async function enrichLeadDirect(
  leadId: string,
  options: { client?: any; persist?: EnrichPersistMode; deadlineMs?: number } = {}
): Promise<EnrichLeadDirectResult> {
  const startTime = Date.now()
  const persist: EnrichPersistMode = options.persist ?? 'direct'
  // Manual (direct) research obeys the emergency switch before it touches anything. Queued research
  // ('deferred') is only ever reached through a claim, and claims are gated by the same switch.
  if (persist === 'direct') assertResearchEnabled()
  const deadline = createResearchDeadline(options.deadlineMs ?? RESEARCH_DEADLINE_MS)
  console.log(`[CI-TRACE] STEP 6 ENTER enrichLeadDirect lead_id=${leadId}`)
  console.log(`[CI-TRACE] STEP 6 BEFORE enrichLeadDirect.createServerClient lead_id=${leadId}`)
  const supabase = options.client || (await createServerClient())
  console.log(`[CI-TRACE] STEP 6 AFTER enrichLeadDirect.createServerClient lead_id=${leadId} elapsed_ms=${Date.now() - startTime}`)

  try {
    // Stage: Load lead
    console.log(`[CI] Loading lead: ${leadId}`)
    const loadStartedAt = Date.now()
    console.log(`[CI-TRACE] STEP 6 BEFORE leads.select load lead_id=${leadId}`)
    const { data: lead, error: leadError } = await deadline.guard(
      Promise.resolve(
        supabase.from('leads').select('id, user_id, website, company_name').eq('id', leadId).abortSignal(deadline.signal).single()
      ),
      'lead load'
    )
    console.log(
      `[CI-TRACE] STEP 6 AFTER leads.select load lead_id=${leadId} found=${Boolean(lead)} has_error=${Boolean(leadError)} elapsed_ms=${Date.now() - loadStartedAt}`
    )

    if (leadError) {
      console.error('[CI-TRACE] STEP 6 ERROR enrichLeadDirect lead load failed', leadError, (leadError as any)?.stack)
      console.error(`[CI] Lead fetch error: ${leadError.message}`, leadError)
      throw new Error(`Load lead failed: ${leadError.message}`)
    }

    if (!lead) {
      console.error(`[CI-TRACE] STEP 6 EARLY_RETURN enrichLeadDirect reason=lead_not_found lead_id=${leadId}`)
      console.error(`[CI] Lead not found: ${leadId}`)
      throw new Error(`Lead not found: ${leadId}`)
    }

    console.log(`[CI] Lead loaded: ${lead.company_name} (${lead.id})`)

    if (!lead.website) {
      console.log(`[CI] Lead has no website, skipping enrichment: ${leadId}`)
      const duration = Date.now() - startTime
      const startedAt = new Date().toISOString()

      console.log(`[CI-TRACE] STEP 6 EARLY_RETURN enrichLeadDirect reason=no_website lead_id=${leadId}`)
      const skipUpdateStartedAt = Date.now()
      console.log(`[CI-TRACE] STEP 8 BEFORE leads.update skipped lead_id=${lead.id}`)
      const { error: updateError } = persist === 'deferred' ? { error: null } : await supabase
        .from('leads')
        .update({
          ci_enrichment_status: 'skipped',
          ci_started_at: startedAt,
          ci_completed_at: new Date().toISOString(),
          ci_processing_duration_ms: duration,
          ci_retry_count: 0,
        })
        .eq('id', lead.id)
      console.log(
        `[CI-TRACE] STEP 8 AFTER leads.update skipped lead_id=${lead.id} has_error=${Boolean(updateError)} elapsed_ms=${Date.now() - skipUpdateStartedAt}`
      )

      if (updateError) {
        console.error('[CI-TRACE] STEP 8 ERROR leads.update skipped failed', updateError, (updateError as any)?.stack)
        console.error(`[CI] Failed to update lead as skipped: ${updateError.message}`)
      }

      return {
        success: true,
        leadId: lead.id,
        website_snapshot: null,
        business_signals: null,
        commercial_profile: null,
        ci_enrichment_status: 'skipped',
        ci_started_at: startedAt,
        ci_completed_at: new Date().toISOString(),
        ci_last_error: 'No website provided',
        ci_retry_count: 0,
        ci_processing_duration_ms: duration,
        ci_cost_estimate: 0,
        ci_model_versions: {
          snapshot: 'v1',
          signals: 'v1',
          profile: 'gpt-4o-mini',
        },
      }
    }

    const startedAt = new Date().toISOString()

    // Manual ('direct') research shows "processing" on the lead itself. Queued ('deferred') research must
    // not: this write has no claim check, so a run that stalled before reaching it could overwrite a lead
    // that another run had already completed, and its own completion would then be refused as claim_lost,
    // leaving the lead "processing" for good. For queued jobs the queue claim and the completion RPC own
    // every state change.
    console.log(`[CI] Marking lead as processing: ${leadId} (persist=${persist})`)
    const processingStartedAt = Date.now()
    console.log(`[CI-TRACE] STEP 6 BEFORE leads.update processing lead_id=${lead.id}`)
    const { error: processingError } = persist === 'deferred' ? { error: null } : await deadline.guard(
      Promise.resolve(
        supabase
          .from('leads')
          .update({ ci_enrichment_status: 'processing', ci_started_at: startedAt })
          .eq('id', lead.id)
          .abortSignal(deadline.signal)
      ),
      'processing marker'
    )
    console.log(
      `[CI-TRACE] STEP 6 AFTER leads.update processing lead_id=${lead.id} has_error=${Boolean(processingError)} elapsed_ms=${Date.now() - processingStartedAt}`
    )

    if (processingError) {
      console.error('[CI-TRACE] STEP 6 ERROR leads.update processing failed', processingError, (processingError as any)?.stack)
      console.error(`[CI] Failed to mark lead as processing: ${processingError.message}`)
      throw new Error(`Failed to mark lead as processing: ${processingError.message}`)
    }

    // Stages 1-3 (snapshot, signals, profile) run under one deadline that also aborts the fetches
    // and the OpenAI request. A stage failure becomes an error here, never a throw.
    const research = await runResearchStages(
      lead.website,
      {
        snapshot: (website, { signal }) => extractWebsiteSnapshot(website, { fetchOptions: { signal } }),
        signals: (website, { signal }) => generateBusinessSignals(website, { signal }),
        profile: (website, snapshot, signals, { signal }) => generateCommercialProfile(website, snapshot, signals, { signal }),
      },
      { deadline }
    )
    const { snapshot: snapshotResult, signals: signalsResult, profile: profileResult } = research
    const errors = [...research.errors]
    const totalCost = research.cost
    console.log(
      `[CI] Stages: snapshot=${snapshotResult.ok} signals=${signalsResult.ok} profile=${profileResult.ok} deadline_exceeded=${research.deadlineExceeded}`
    )

    const duration = Date.now() - startTime

    // A profile only counts when it carries a summary. Without one the run is a failure, whatever else succeeded.
    if (profileResult.ok && !hasUsableProfile(profileResult.data)) {
      errors.push('Commercial profile was empty')
    }

    const hasErrors = errors.length > 0
    const completedAt = new Date().toISOString()

    console.log(`[CI] Enrichment complete: success=${!hasErrors}, errors=${errors.length}, duration=${duration}ms, cost=${totalCost}`)

    // Stage: Save to Supabase
    console.log(`[CI] Saving enrichment data to Supabase`)
    // Only what this run actually produced is written: a failed or partial run must not replace
    // an earlier snapshot, signals or profile with NULL.
    const updatePayload: Record<string, any> = {
      ...(snapshotResult.ok && snapshotResult.data ? { website_snapshot: snapshotResult.data } : {}),
      ...(signalsResult.ok && signalsResult.data ? { business_signals: signalsResult.data } : {}),
      ...(profileResult.ok && hasUsableProfile(profileResult.data) ? { commercial_profile: profileResult.data } : {}),
      ci_enrichment_status: hasErrors ? 'failed' : 'completed',
      ci_started_at: startedAt,
      ci_completed_at: completedAt,
      ci_last_error: errors.length > 0 ? errors[0] : null,
      ci_retry_count: 0,
      ci_processing_duration_ms: duration,
      ci_model_versions: {
        snapshot: 'v1',
        signals: 'v1',
        profile: 'gpt-4o-mini',
      },
      ci_cost_estimate: totalCost,
    }

    const persistStartedAt = Date.now()
    console.log(
      `[CI-TRACE] STEP 8 BEFORE leads.update enrichment lead_id=${lead.id} next_status=${hasErrors ? 'failed' : 'completed'} has_profile=${Boolean(profileResult.ok ? profileResult.data : null)}`
    )
    // Queue paths ('deferred') report the outcome and stop: the completion RPC writes the lead and the
    // queue job in one transaction, fenced by the claim. Writing here would finish the lead first.
    const { error: updateError } = persist === 'deferred' ? { error: null } : await supabase
      .from('leads')
      .update(updatePayload)
      .eq('id', lead.id)
    console.log(
      `[CI-TRACE] STEP 8 AFTER leads.update enrichment lead_id=${lead.id} has_error=${Boolean(updateError)} elapsed_ms=${Date.now() - persistStartedAt}`
    )

    if (updateError) {
      console.error('[CI-TRACE] STEP 8 ERROR leads.update enrichment failed', updateError, (updateError as any)?.stack)
      console.error(`[CI] Failed to persist enrichment: ${updateError.message}`, updateError)
      throw new Error(`Failed to persist enrichment: ${updateError.message}`)
    }

    console.log(`[CI] Enrichment saved successfully`)
    console.log(
      `[CI-TRACE] STEP 6 PASS enrichLeadDirect lead_id=${lead.id} success=${!hasErrors} ci_status=${hasErrors ? 'failed' : 'completed'} has_profile=${Boolean(profileResult.ok ? profileResult.data : null)} elapsed_ms=${Date.now() - startTime}`
    )

    return {
      success: !hasErrors,
      leadId: lead.id,
      website_snapshot: snapshotResult.ok ? snapshotResult.data || null : null,
      business_signals: signalsResult.ok ? signalsResult.data || null : null,
      commercial_profile: profileResult.ok && hasUsableProfile(profileResult.data) ? profileResult.data || null : null,
      ci_enrichment_status: hasErrors ? 'failed' : 'completed',
      ci_started_at: startedAt,
      ci_completed_at: completedAt,
      ci_last_error: errors.length > 0 ? errors[0] : null,
      ci_retry_count: 0,
      ci_processing_duration_ms: duration,
      ci_cost_estimate: totalCost,
      ci_model_versions: {
        snapshot: 'v1',
        signals: 'v1',
        profile: 'gpt-4o-mini',
      },
      error: hasErrors
        ? {
            code: research.deadlineExceeded ? 'DEADLINE_EXCEEDED' : 'ENRICHMENT_PARTIAL',
            message: errors[0] || 'Unknown error',
          }
        : undefined,
    }
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const startedAt = new Date().toISOString()

    console.error(`[CI] Fatal enrichment error: ${errorMessage}`, err)
    console.error('[CI-TRACE] STEP 6 ERROR enrichLeadDirect fatal', err, err instanceof Error ? err.stack : undefined)

    try {
      console.log(`[CI] Updating lead with fatal error status`)
      const fatalUpdateStartedAt = Date.now()
      console.log(`[CI-TRACE] STEP 8 BEFORE leads.update fatal_error lead_id=${leadId}`)
      const { error: updateError } = persist === 'deferred' ? { error: null } : await supabase
        .from('leads')
        .update({
          ci_enrichment_status: 'failed',
          ci_started_at: startedAt,
          ci_completed_at: new Date().toISOString(),
          ci_last_error: errorMessage,
          ci_retry_count: 0,
          ci_processing_duration_ms: duration,
        })
        .eq('id', leadId)
      console.log(
        `[CI-TRACE] STEP 8 AFTER leads.update fatal_error lead_id=${leadId} has_error=${Boolean(updateError)} elapsed_ms=${Date.now() - fatalUpdateStartedAt}`
      )

      if (updateError) {
        console.error('[CI-TRACE] STEP 8 ERROR leads.update fatal_error failed', updateError, (updateError as any)?.stack)
        console.error(`[CI] Failed to update lead with error: ${updateError.message}`)
      }
    } catch (updateErr) {
      console.error('[CI-TRACE] STEP 8 ERROR leads.update fatal_error caught', updateErr, updateErr instanceof Error ? updateErr.stack : undefined)
      console.error(`[CI] Exception while updating lead after error`, updateErr)
    }

    return {
      success: false,
      leadId: leadId,
      website_snapshot: null,
      business_signals: null,
      commercial_profile: null,
      ci_enrichment_status: 'failed',
      ci_started_at: startedAt,
      ci_completed_at: new Date().toISOString(),
      ci_last_error: errorMessage,
      ci_retry_count: 0,
      ci_processing_duration_ms: duration,
      ci_cost_estimate: 0,
      ci_model_versions: {
        snapshot: 'v1',
        signals: 'v1',
        profile: 'gpt-4o-mini',
      },
      error: {
        code: err instanceof ResearchDeadlineError ? 'DEADLINE_EXCEEDED' : 'ENRICHMENT_ERROR',
        message: errorMessage,
      },
    }
  } finally {
    deadline.dispose()
  }
}
