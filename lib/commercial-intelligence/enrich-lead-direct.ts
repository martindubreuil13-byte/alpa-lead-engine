import { createServerClient } from '@/lib/supabase/server'
import { extractWebsiteSnapshot } from './extract-website-snapshot'
import { generateBusinessSignals } from './generate-business-signals'
import { generateCommercialProfile } from './generate-commercial-profile'
import type { CommercialProfile, BusinessSignals, WebsiteSnapshot } from './types'

const MAX_PROCESSING_DURATION = 60000 // 60 seconds

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

export async function enrichLeadDirect(leadId: string): Promise<EnrichLeadDirectResult> {
  const startTime = Date.now()
  const supabase = await createServerClient()

  try {
    // Stage: Load lead
    console.log(`[CI] Loading lead: ${leadId}`)
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, user_id, website, company_name')
      .eq('id', leadId)
      .single()

    if (leadError) {
      console.error(`[CI] Lead fetch error: ${leadError.message}`, leadError)
      throw new Error(`Load lead failed: ${leadError.message}`)
    }

    if (!lead) {
      console.error(`[CI] Lead not found: ${leadId}`)
      throw new Error(`Lead not found: ${leadId}`)
    }

    console.log(`[CI] Lead loaded: ${lead.company_name} (${lead.id})`)

    if (!lead.website) {
      console.log(`[CI] Lead has no website, skipping enrichment: ${leadId}`)
      const duration = Date.now() - startTime
      const startedAt = new Date().toISOString()

      const { error: updateError } = await supabase
        .from('leads')
        .update({
          ci_enrichment_status: 'skipped',
          ci_started_at: startedAt,
          ci_completed_at: new Date().toISOString(),
          ci_processing_duration_ms: duration,
          ci_retry_count: 0,
        })
        .eq('id', lead.id)

      if (updateError) {
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

    console.log(`[CI] Marking lead as processing: ${leadId}`)
    const { error: processingError } = await supabase
      .from('leads')
      .update({
        ci_enrichment_status: 'processing',
        ci_started_at: startedAt,
      })
      .eq('id', lead.id)

    if (processingError) {
      console.error(`[CI] Failed to mark lead as processing: ${processingError.message}`)
      throw new Error(`Failed to mark lead as processing: ${processingError.message}`)
    }

    let totalCost = 0
    const errors: string[] = []

    // Stage 1: Extract Website Snapshot
    console.log(`[CI] Stage 1: Extracting website snapshot from ${lead.website}`)
    let snapshotResult
    try {
      snapshotResult = await extractWebsiteSnapshot(lead.website)
      totalCost += snapshotResult.cost
      console.log(`[CI] Stage 1 result: ok=${snapshotResult.ok}, cost=${snapshotResult.cost}`)
      if (!snapshotResult.ok) {
        console.error(`[CI] Stage 1 error: ${snapshotResult.error?.message}`)
        errors.push(snapshotResult.error?.message || 'Failed to extract website snapshot')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[CI] Stage 1 exception: ${msg}`, err)
      errors.push(`Website snapshot extraction failed: ${msg}`)
      snapshotResult = { ok: false, error: { code: 'SNAPSHOT_ERROR', message: msg }, duration_ms: 0, cost: 0 }
    }

    // Stage 2: Generate Business Signals
    console.log(`[CI] Stage 2: Generating business signals for ${lead.website}`)
    let signalsResult
    try {
      signalsResult = await generateBusinessSignals(lead.website)
      totalCost += signalsResult.cost
      console.log(`[CI] Stage 2 result: ok=${signalsResult.ok}, cost=${signalsResult.cost}`)
      if (!signalsResult.ok) {
        console.error(`[CI] Stage 2 error: ${signalsResult.error?.message}`)
        errors.push(signalsResult.error?.message || 'Failed to generate business signals')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[CI] Stage 2 exception: ${msg}`, err)
      errors.push(`Business signals generation failed: ${msg}`)
      signalsResult = { ok: false, error: { code: 'SIGNALS_ERROR', message: msg }, duration_ms: 0, cost: 0 }
    }

    // Stage 3: Generate Commercial Profile (requires snapshot & signals)
    console.log(`[CI] Stage 3: Generating commercial profile`)
    let profileResult: Awaited<ReturnType<typeof generateCommercialProfile>> = {
      ok: false,
      error: undefined,
      duration_ms: 0,
      cost: 0,
    }

    if (snapshotResult.ok && signalsResult.ok) {
      try {
        profileResult = await generateCommercialProfile(
          lead.website,
          snapshotResult.data,
          signalsResult.data
        )
        totalCost += profileResult.cost
        console.log(`[CI] Stage 3 result: ok=${profileResult.ok}, cost=${profileResult.cost}`)
        if (!profileResult.ok) {
          console.error(`[CI] Stage 3 error: ${profileResult.error?.message}`)
          errors.push(profileResult.error?.message || 'Failed to generate commercial profile')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[CI] Stage 3 exception: ${msg}`, err)
        errors.push(`Commercial profile generation failed: ${msg}`)
        profileResult = { ok: false, error: { code: 'PROFILE_ERROR', message: msg }, duration_ms: 0, cost: 0 }
      }
    } else {
      console.log(`[CI] Stage 3 skipped: snapshot.ok=${snapshotResult.ok}, signals.ok=${signalsResult.ok}`)
      errors.push('Commercial profile generation skipped due to snapshot or signals failure')
    }

    const duration = Date.now() - startTime

    // Check if processing took too long
    if (duration > MAX_PROCESSING_DURATION) {
      console.warn(`[CI] Processing exceeded timeout: ${duration}ms > ${MAX_PROCESSING_DURATION}ms`)
      errors.push(`Processing exceeded ${MAX_PROCESSING_DURATION}ms limit`)
    }

    const hasErrors = errors.length > 0
    const completedAt = new Date().toISOString()

    console.log(`[CI] Enrichment complete: success=${!hasErrors}, errors=${errors.length}, duration=${duration}ms, cost=${totalCost}`)

    // Stage: Save to Supabase
    console.log(`[CI] Saving enrichment data to Supabase`)
    const updatePayload: Record<string, any> = {
      website_snapshot: snapshotResult.ok ? snapshotResult.data : null,
      business_signals: signalsResult.ok ? signalsResult.data : null,
      commercial_profile: profileResult.ok ? profileResult.data : null,
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

    const { error: updateError } = await supabase
      .from('leads')
      .update(updatePayload)
      .eq('id', lead.id)

    if (updateError) {
      console.error(`[CI] Failed to persist enrichment: ${updateError.message}`, updateError)
      throw new Error(`Failed to persist enrichment: ${updateError.message}`)
    }

    console.log(`[CI] Enrichment saved successfully`)

    return {
      success: !hasErrors,
      leadId: lead.id,
      website_snapshot: snapshotResult.ok ? snapshotResult.data || null : null,
      business_signals: signalsResult.ok ? signalsResult.data || null : null,
      commercial_profile: profileResult.ok ? profileResult.data || null : null,
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
            code: 'ENRICHMENT_PARTIAL',
            message: errors[0] || 'Unknown error',
          }
        : undefined,
    }
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    const startedAt = new Date().toISOString()

    console.error(`[CI] Fatal enrichment error: ${errorMessage}`, err)

    try {
      console.log(`[CI] Updating lead with fatal error status`)
      const { error: updateError } = await supabase
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

      if (updateError) {
        console.error(`[CI] Failed to update lead with error: ${updateError.message}`)
      }
    } catch (updateErr) {
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
        code: 'ENRICHMENT_ERROR',
        message: errorMessage,
      },
    }
  }
}
