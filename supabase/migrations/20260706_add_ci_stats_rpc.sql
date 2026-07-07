-- Commercial Intelligence: Efficient statistics aggregation
-- Replaces client-side filtering with database-level aggregation
-- Scales efficiently to millions of leads

CREATE OR REPLACE FUNCTION public.count_leads_by_ci_status(p_user_id UUID)
RETURNS TABLE(
  total_leads BIGINT,
  not_started BIGINT,
  pending BIGINT,
  processing BIGINT,
  completed BIGINT,
  failed BIGINT,
  skipped BIGINT,
  avg_processing_seconds NUMERIC
) AS $$
SELECT
  COUNT(*) as total_leads,
  COUNT(*) FILTER (WHERE ci_enrichment_status IS NULL OR ci_enrichment_status = 'not_generated') as not_started,
  COUNT(*) FILTER (WHERE ci_enrichment_status = 'pending') as pending,
  COUNT(*) FILTER (WHERE ci_enrichment_status = 'processing') as processing,
  COUNT(*) FILTER (WHERE ci_enrichment_status = 'completed') as completed,
  COUNT(*) FILTER (WHERE ci_enrichment_status = 'failed') as failed,
  COUNT(*) FILTER (WHERE ci_enrichment_status = 'skipped') as skipped,
  ROUND(AVG(EXTRACT(EPOCH FROM (ci_completed_at - ci_started_at))))::NUMERIC as avg_processing_seconds
FROM leads
WHERE user_id = p_user_id
  AND ci_started_at IS NOT NULL
  AND ci_completed_at IS NOT NULL
  AND ci_completed_at > NOW() - INTERVAL '24 hours';
$$ LANGUAGE SQL SECURITY DEFINER SET search_path = public;
