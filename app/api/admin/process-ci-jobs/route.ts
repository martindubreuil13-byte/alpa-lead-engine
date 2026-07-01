import { createServerClient } from '@/lib/supabase/server'
import { enrichLeadCommercialIntelligence } from '@/lib/commercial-intelligence/enrich-lead'
import type { EnrichmentJob } from '@/lib/commercial-intelligence/types'

const MAX_JOBS_PER_RUN = 10
const MAX_RETRIES = 5

export async function POST(req: Request) {
  // Simple auth: just check for admin secret header
  const adminSecret = req.headers.get('x-admin-secret')
  if (adminSecret !== process.env.ADMIN_ENRICHMENT_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabase = await createServerClient()

    // Fetch pending jobs
    const { data: pendingJobs, error: fetchError } = await supabase
      .from('commercial_intelligence_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(MAX_JOBS_PER_RUN)

    if (fetchError) {
      console.error('Failed to fetch jobs:', fetchError)
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Failed to fetch jobs',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: 0,
          message: 'No pending jobs',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Process jobs
    const results = []
    for (const job of pendingJobs) {
      try {
        const result = await enrichLeadCommercialIntelligence(job as EnrichmentJob)
        results.push({
          jobId: job.id,
          leadId: result.leadId,
          success: result.success,
          duration: result.processingDurationMs,
          cost: result.cost,
        })
      } catch (err) {
        console.error(`Failed to process job ${job.id}:`, err)

        // Check if we should retry
        const retryCount = (job.retry_count || 0) + 1
        if (retryCount < MAX_RETRIES) {
          // Schedule for retry
          const nextRetryAt = new Date()
          nextRetryAt.setSeconds(nextRetryAt.getSeconds() + Math.pow(2, retryCount) * 60) // Exponential backoff

          await supabase
            .from('commercial_intelligence_jobs')
            .update({
              status: 'retrying',
              retry_count: retryCount,
              next_retry_at: nextRetryAt.toISOString(),
              error_message: err instanceof Error ? err.message : 'Unknown error',
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)

          results.push({
            jobId: job.id,
            leadId: job.lead_id,
            success: false,
            error: 'Scheduled for retry',
            retryCount,
          })
        } else {
          // Give up after max retries
          await supabase
            .from('commercial_intelligence_jobs')
            .update({
              status: 'failed',
              error_message: `Failed after ${MAX_RETRIES} retries`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)

          results.push({
            jobId: job.id,
            leadId: job.lead_id,
            success: false,
            error: 'Max retries exceeded',
          })
        }
      }
    }

    // Process retrying jobs that are due
    const { data: retryingJobs } = await supabase
      .from('commercial_intelligence_jobs')
      .select('*')
      .eq('status', 'retrying')
      .lt('next_retry_at', new Date().toISOString())
      .limit(Math.max(0, MAX_JOBS_PER_RUN - results.length))

    if (retryingJobs && retryingJobs.length > 0) {
      for (const job of retryingJobs) {
        try {
          const result = await enrichLeadCommercialIntelligence(job as EnrichmentJob)
          results.push({
            jobId: job.id,
            leadId: result.leadId,
            success: result.success,
            duration: result.processingDurationMs,
            cost: result.cost,
            retry: true,
          })
        } catch (err) {
          console.error(`Failed to retry job ${job.id}:`, err)

          const retryCount = (job.retry_count || 0) + 1
          if (retryCount < MAX_RETRIES) {
            const nextRetryAt = new Date()
            nextRetryAt.setSeconds(nextRetryAt.getSeconds() + Math.pow(2, retryCount) * 60)

            await supabase
              .from('commercial_intelligence_jobs')
              .update({
                retry_count: retryCount,
                next_retry_at: nextRetryAt.toISOString(),
                error_message: err instanceof Error ? err.message : 'Unknown error',
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)

            results.push({
              jobId: job.id,
              leadId: job.lead_id,
              success: false,
              error: 'Scheduled for retry',
              retryCount,
            })
          } else {
            await supabase
              .from('commercial_intelligence_jobs')
              .update({
                status: 'failed',
                error_message: `Failed after ${MAX_RETRIES} retries`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)

            results.push({
              jobId: job.id,
              leadId: job.lead_id,
              success: false,
              error: 'Max retries exceeded',
            })
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.length,
        results,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Job processing error:', err)
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
