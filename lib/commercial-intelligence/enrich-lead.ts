import { createServerClient } from '@/lib/supabase/server'
import { extractWebsiteSnapshot } from './extract-website-snapshot'
import { generateBusinessSignals } from './generate-business-signals'
import { generateCommercialProfile } from './generate-commercial-profile'
import type { CommercialIntelligenceData, EnrichmentJob } from './types'

const MAX_PROCESSING_DURATION = 60000 // 60 seconds

export interface EnrichmentResult {
  success: boolean
  leadId: string
  data?: CommercialIntelligenceData
  error?: {
    code: string
    message: string
  }
  processingDurationMs: number
  cost: number
}

export async function enrichLeadCommercialIntelligence(
  job: EnrichmentJob
): Promise<EnrichmentResult> {
  const startTime = Date.now()

  try {
    // Fetch lead data
    const supabase = await createServerClient()
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, user_id, website, company_name')
      .eq('id', job.lead_id)
      .single()

    if (leadError || !lead) {
      throw new Error(`Lead not found: ${job.lead_id}`)
    }

    if (!lead.website) {
      // Mark as skipped in job
      const duration = Date.now() - startTime
      await updateJob(supabase, job.id, {
        status: 'completed',
        processing_duration_ms: duration,
        completed_at: new Date().toISOString(),
      })

      return {
        success: true,
        leadId: lead.id,
        processingDurationMs: duration,
        cost: 0,
      }
    }

    // Update job status to processing
    await updateJob(supabase, job.id, {
      status: 'processing',
      started_at: new Date().toISOString(),
    })

    // Mark lead as processing
    await supabase
      .from('leads')
      .update({
        ci_enrichment_status: 'processing',
        ci_started_at: new Date().toISOString(),
      })
      .eq('id', lead.id)

    let totalCost = 0
    const errors: Array<{ stage: string; code: string; message: string }> = []

    // Stage 1: Extract Website Snapshot
    const snapshotResult = await extractWebsiteSnapshot(lead.website)
    totalCost += snapshotResult.cost

    if (!snapshotResult.ok) {
      errors.push({
        stage: 'snapshot',
        code: snapshotResult.error?.code || 'UNKNOWN',
        message: snapshotResult.error?.message || 'Unknown error',
      })
    }

    // Stage 2: Generate Business Signals
    const signalsResult = await generateBusinessSignals(lead.website)
    totalCost += signalsResult.cost

    if (!signalsResult.ok) {
      errors.push({
        stage: 'signals',
        code: signalsResult.error?.code || 'UNKNOWN',
        message: signalsResult.error?.message || 'Unknown error',
      })
    }

    // Stage 3: Generate Commercial Profile (requires snapshot & signals)
    let profileResult: Awaited<ReturnType<typeof generateCommercialProfile>> = {
      ok: false,
      error: undefined,
      duration_ms: 0,
      cost: 0,
    }
    if (snapshotResult.ok && signalsResult.ok) {
      profileResult = await generateCommercialProfile(
        lead.website,
        snapshotResult.data,
        signalsResult.data
      )
      totalCost += profileResult.cost
    } else {
      errors.push({
        stage: 'profile',
        code: 'SKIPPED',
        message: 'Skipped due to snapshot or signals failure',
      })
    }

    const duration = Date.now() - startTime

    // Check if processing took too long
    if (duration > MAX_PROCESSING_DURATION) {
      errors.push({
        stage: 'timeout',
        code: 'TIMEOUT',
        message: `Processing exceeded ${MAX_PROCESSING_DURATION}ms limit`,
      })
    }

    const hasErrors = errors.length > 0
    const enrichmentData: CommercialIntelligenceData = {
      website_snapshot: snapshotResult.ok ? snapshotResult.data || null : null,
      business_signals: signalsResult.ok ? signalsResult.data || null : null,
      commercial_profile: profileResult.ok ? profileResult.data || null : null,
      enrichment_status: hasErrors ? 'failed' : 'completed',
      enriched_at: new Date().toISOString(),
      started_at: job.started_at || null,
      last_error: errors.length > 0 ? JSON.stringify(errors) : null,
      retry_count: job.retry_count,
      processing_duration_ms: duration,
      model_versions: {
        snapshot: 'v1',
        signals: 'v1',
        profile: 'gpt-4o-mini',
      },
      cost_estimate: totalCost,
    }

    // Update lead with enrichment data
    const updatePayload: Record<string, any> = {
      website_snapshot: snapshotResult.ok ? snapshotResult.data : null,
      business_signals: signalsResult.ok ? signalsResult.data : null,
      commercial_profile: profileResult.ok ? profileResult.data : null,
      ci_enrichment_status: hasErrors ? 'failed' : 'completed',
      ci_enriched_at: new Date().toISOString(),
      ci_last_error: errors.length > 0 ? errors[0].message : null,
      ci_retry_count: job.retry_count,
      ci_processing_duration_ms: duration,
      ci_model_versions: enrichmentData.model_versions,
      ci_cost_estimate: totalCost,
    }

    const { error: updateError } = await supabase
      .from('leads')
      .update(updatePayload)
      .eq('id', lead.id)

    if (updateError) {
      errors.push({
        stage: 'persist',
        code: updateError.code || 'UPDATE_FAILED',
        message: updateError.message,
      })

      throw new Error(`Failed to persist enrichment: ${updateError.message}`)
    }

    // Update job record
    await updateJob(supabase, job.id, {
      status: hasErrors ? 'failed' : 'completed',
      completed_at: new Date().toISOString(),
      processing_duration_ms: duration,
      error_message: errors.length > 0 ? errors[0].message : null,
      error_code: errors.length > 0 ? errors[0].code : null,
      total_cost: totalCost,
      snapshot_status: snapshotResult.ok ? 'completed' : 'failed',
      signals_status: signalsResult.ok ? 'completed' : 'failed',
      profile_status: profileResult.ok ? 'completed' : 'failed',
    })

    return {
      success: !hasErrors,
      leadId: lead.id,
      data: enrichmentData,
      error: hasErrors
        ? {
            code: errors[0].code,
            message: errors[0].message,
          }
        : undefined,
      processingDurationMs: duration,
      cost: totalCost,
    }
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    // Update job as failed
    try {
      const supabase = await createServerClient()
      await updateJob(supabase, job.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        processing_duration_ms: duration,
        error_message: errorMessage,
        error_code: 'ENRICHMENT_ERROR',
        retry_count: job.retry_count,
      })

      // Mark lead as failed
      await supabase
        .from('leads')
        .update({
          ci_enrichment_status: 'failed',
          ci_last_error: errorMessage,
          ci_retry_count: job.retry_count,
          ci_processing_duration_ms: duration,
        })
        .eq('id', job.lead_id)
    } catch {
      console.error('Failed to update job/lead after error', err)
    }

    return {
      success: false,
      leadId: job.lead_id,
      error: {
        code: 'ENRICHMENT_ERROR',
        message: errorMessage,
      },
      processingDurationMs: duration,
      cost: 0,
    }
  }
}

async function updateJob(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  jobId: string,
  updates: Partial<{
    status: string
    started_at: string
    completed_at: string
    processing_duration_ms: number
    error_message: string | null
    error_code: string | null
    total_cost: number
    snapshot_status: string | null
    signals_status: string | null
    profile_status: string | null
    retry_count: number
  }>
) {
  const { error } = await supabase
    .from('commercial_intelligence_jobs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    console.error('Failed to update job:', error)
  }
}
