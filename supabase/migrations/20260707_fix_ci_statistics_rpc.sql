-- Commercial Intelligence Statistics RPC
-- Single aggregation endpoint for CI dashboard
-- Database-level aggregation only, no client-side filtering
-- Scales efficiently to millions of leads

-- Drop old version if it exists (will be replaced)
DROP FUNCTION IF EXISTS public.count_leads_by_ci_status(UUID);

-- Create definitive statistics function
CREATE OR REPLACE FUNCTION public.get_ci_statistics(p_user_id UUID)
RETURNS TABLE(
  -- Counts by status
  total_leads BIGINT,
  not_started BIGINT,
  pending BIGINT,
  processing BIGINT,
  completed BIGINT,
  failed BIGINT,
  skipped BIGINT,
  -- Derived metrics
  completion_percentage NUMERIC,
  avg_processing_seconds NUMERIC,
  last_completed_at TIMESTAMPTZ,
  -- Current activity
  actively_processing BOOLEAN
) AS $$
WITH stats AS (
  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE ci_enrichment_status IS NULL OR ci_enrichment_status = 'not_generated') as not_started,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'pending') as pending,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'processing') as processing,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'completed') as completed,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'failed') as failed,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'skipped') as skipped,
    COUNT(*) FILTER (WHERE ci_enrichment_status IN ('processing', 'pending')) as in_progress
  FROM leads
  WHERE user_id = p_user_id
)
SELECT
  stats.total as total_leads,
  stats.not_started,
  stats.pending,
  stats.processing,
  stats.completed,
  stats.failed,
  stats.skipped,
  -- Completion %: (completed / all_that_entered_pipeline) * 100
  -- Excludes not_started since they haven't been touched
  CASE
    WHEN (stats.completed + stats.failed + stats.skipped + stats.pending + stats.processing) = 0 THEN 0
    ELSE ROUND((stats.completed::NUMERIC / (stats.completed + stats.failed + stats.skipped + stats.pending + stats.processing)) * 100)
  END as completion_percentage,
  -- Average processing time from ALL successful completions (not time-limited)
  ROUND(AVG(EXTRACT(EPOCH FROM (leads.ci_completed_at - leads.ci_started_at))))::NUMERIC as avg_processing_seconds,
  -- Most recent completion timestamp
  MAX(leads.ci_completed_at) FILTER (WHERE leads.ci_enrichment_status = 'completed') as last_completed_at,
  -- Whether any leads are currently being processed
  (stats.in_progress > 0) as actively_processing
FROM stats
CROSS JOIN leads
WHERE leads.user_id = p_user_id
  AND leads.ci_enrichment_status = 'completed'
  AND leads.ci_started_at IS NOT NULL
  AND leads.ci_completed_at IS NOT NULL
GROUP BY
  stats.total,
  stats.not_started,
  stats.pending,
  stats.processing,
  stats.completed,
  stats.failed,
  stats.skipped,
  stats.in_progress;
$$ LANGUAGE SQL SECURITY DEFINER SET search_path = public;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_ci_statistics(UUID) TO authenticated;
