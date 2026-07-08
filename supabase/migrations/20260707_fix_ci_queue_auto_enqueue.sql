-- CRITICAL FIX: Auto-create missing queue entries in claim_ci_queue_items
--
-- ROOT CAUSE: The worker was returning 0 processed items because:
-- 1. Dashboard counts leads with pending/null ci_enrichment_status
-- 2. Worker only looks at commercial_intelligence_queue table
-- 3. Leads without queue entries are invisible to the worker
-- 4. Only the scraper endpoint creates queue entries via enqueueLeadEnrichment()
--
-- SOLUTION: Make claim_ci_queue_items automatically create missing queue entries
-- for any leads with pending/null CI status, then claim work normally.
--
-- This ensures:
-- - Existing leads are picked up by the worker
-- - Dashboard and worker use the same definition of "work remaining"
-- - Worker can continuously process all eligible leads
--
-- BEFORE: Worker claims 0 items even though dashboard shows thousands waiting
-- AFTER: Worker auto-creates queue entries and starts processing

CREATE OR REPLACE FUNCTION claim_ci_queue_items(p_limit INT DEFAULT 10)
RETURNS TABLE (
  id UUID,
  lead_id UUID,
  retry_count INT,
  max_retries INT
) AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();

  -- Step 1: Auto-create missing queue entries for leads with pending CI status
  -- This handles leads that exist in the leads table but were never enqueued
  -- (e.g., leads imported before CI feature, or created through API directly)
  WITH missing_queue_entries AS (
    SELECT l.id as lead_id, l.user_id
    FROM leads l
    WHERE l.user_id = v_user_id
      AND (l.ci_enrichment_status IS NULL
        OR l.ci_enrichment_status = 'not_generated'
        OR l.ci_enrichment_status = 'pending')
      AND l.id NOT IN (
        SELECT DISTINCT lead_id FROM commercial_intelligence_queue
        WHERE user_id = v_user_id
      )
    LIMIT 1000  -- Create up to 1000 missing entries per call
  )
  INSERT INTO commercial_intelligence_queue (lead_id, user_id, status, retry_count, max_retries)
  SELECT lead_id, user_id, 'pending', 0, 3
  FROM missing_queue_entries
  ON CONFLICT DO NOTHING;

  -- Step 2: Claim eligible items from queue using standard queue pattern
  RETURN QUERY
  WITH candidate_rows AS (
    SELECT q.id
    FROM commercial_intelligence_queue q
    WHERE q.status = 'pending'
      AND q.user_id = v_user_id
      -- Backoff: don't retry immediately, wait 60 seconds between retries
      AND (q.last_retry_at IS NULL OR NOW() >= q.last_retry_at + INTERVAL '60 seconds')
      -- Haven't exceeded max retries
      AND q.retry_count < q.max_retries
    ORDER BY q.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated_rows AS (
    UPDATE commercial_intelligence_queue q
    SET status = 'processing',
        started_at = COALESCE(q.started_at, NOW())
    FROM candidate_rows c
    WHERE q.id = c.id
    RETURNING q.id, q.lead_id, q.retry_count, q.max_retries, q.created_at
  )
  SELECT u.id, u.lead_id, u.retry_count, u.max_retries
  FROM updated_rows u
  ORDER BY u.created_at ASC;
END;
$$ LANGUAGE plpgsql;
