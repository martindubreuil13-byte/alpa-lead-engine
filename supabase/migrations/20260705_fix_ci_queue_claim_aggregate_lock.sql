-- Fix claim_ci_queue_items(): PostgreSQL does not allow FOR UPDATE with aggregate queries.
-- Use the standard concurrent queue pattern:
-- 1. Select candidate rows with FOR UPDATE SKIP LOCKED.
-- 2. Update those rows from the candidate CTE.
-- 3. Return the updated rows to the worker.

CREATE OR REPLACE FUNCTION claim_ci_queue_items(p_limit INT DEFAULT 10)
RETURNS TABLE (
  id UUID,
  lead_id UUID,
  retry_count INT,
  max_retries INT
) AS $$
BEGIN
  RETURN QUERY
  WITH candidate_rows AS (
    SELECT q.id
    FROM commercial_intelligence_queue q
    WHERE q.status = 'pending'
      AND q.user_id = auth.uid()
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
