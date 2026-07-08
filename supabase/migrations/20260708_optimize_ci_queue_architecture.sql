-- OPTIMIZATION: Commercial Intelligence Queue Architecture Hardening
--
-- Changes:
-- 1. Replace NOT IN with NOT EXISTS (safer, better performance at scale)
-- 2. Add missing indexes for 100k+ lead datasets
-- 3. Verify worker remains pure consumer
-- 4. Optimize queries for PostgreSQL at scale

-- ============================================================================
-- PART 1: Add Missing Indexes for Scale
-- ============================================================================

-- Critical: (user_id, status) for claiming work
CREATE INDEX IF NOT EXISTS idx_ci_queue_user_status
ON commercial_intelligence_queue(user_id, status)
WHERE status IN ('pending', 'processing');

-- Helpful: (user_id, last_retry_at) for repair operations
CREATE INDEX IF NOT EXISTS idx_ci_queue_user_retry
ON commercial_intelligence_queue(user_id, last_retry_at)
WHERE status = 'pending';

-- ============================================================================
-- PART 2: Worker RPC - Pure Consumer (Optimized)
-- ============================================================================
-- No changes to logic, only ensuring it remains pure.
-- Uses existing indexes for performance.

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
      AND (q.last_retry_at IS NULL OR NOW() >= q.last_retry_at + INTERVAL '60 seconds')
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

-- ============================================================================
-- PART 3: Repair Utility - Optimized with NOT EXISTS
-- ============================================================================
-- CRITICAL: Use NOT EXISTS instead of NOT IN for safety and performance
--
-- NOT IN issue: If subquery contains NULL, NOT IN returns NULL (incorrect)
-- NOT EXISTS: Explicitly NULL-safe, better correlated subquery performance

CREATE OR REPLACE FUNCTION backfill_missing_ci_queue_entries(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  leads_found BIGINT,
  queue_entries_created BIGINT,
  queue_entries_skipped BIGINT
) AS $$
DECLARE
  v_leads_found BIGINT;
  v_created BIGINT;
  v_skipped BIGINT;
BEGIN
  WITH missing_queue_entries AS (
    SELECT l.id as lead_id, l.user_id
    FROM leads l
    WHERE (p_user_id IS NULL OR l.user_id = p_user_id)
      AND (l.ci_enrichment_status IS NULL
        OR l.ci_enrichment_status = 'not_generated'
        OR l.ci_enrichment_status = 'pending')
      AND NOT EXISTS (
        SELECT 1 FROM commercial_intelligence_queue q
        WHERE q.lead_id = l.id
        AND q.user_id = l.user_id
      )
  ),
  create_entries AS (
    INSERT INTO commercial_intelligence_queue (lead_id, user_id, status, retry_count, max_retries)
    SELECT lead_id, user_id, 'pending', 0, 3
    FROM missing_queue_entries
    ON CONFLICT DO NOTHING
    RETURNING lead_id
  )
  SELECT
    (SELECT COUNT(*) FROM missing_queue_entries),
    (SELECT COUNT(*) FROM create_entries),
    (SELECT COUNT(*) FROM missing_queue_entries) - (SELECT COUNT(*) FROM create_entries)
  INTO v_leads_found, v_created, v_skipped;

  RETURN QUERY SELECT v_leads_found, v_created, v_skipped;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 4: Audit Function - Optimized with NOT EXISTS
-- ============================================================================
-- CRITICAL: Use EXISTS/NOT EXISTS instead of IN/NOT IN

CREATE OR REPLACE FUNCTION audit_ci_queue_consistency(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  total_leads_needing_ci BIGINT,
  leads_with_queue_entry BIGINT,
  leads_without_queue_entry BIGINT,
  consistency_status TEXT
) AS $$
DECLARE
  v_total BIGINT;
  v_with_entry BIGINT;
  v_without_entry BIGINT;
  v_status TEXT;
BEGIN
  -- Count leads that should be enriched
  SELECT COUNT(*) INTO v_total
  FROM leads l
  WHERE (p_user_id IS NULL OR l.user_id = p_user_id)
    AND (l.ci_enrichment_status IS NULL
      OR l.ci_enrichment_status = 'not_generated'
      OR l.ci_enrichment_status = 'pending');

  -- Count how many have queue entries (using EXISTS for safety)
  SELECT COUNT(*) INTO v_with_entry
  FROM leads l
  WHERE (p_user_id IS NULL OR l.user_id = p_user_id)
    AND (l.ci_enrichment_status IS NULL
      OR l.ci_enrichment_status = 'not_generated'
      OR l.ci_enrichment_status = 'pending')
    AND EXISTS (
      SELECT 1 FROM commercial_intelligence_queue q
      WHERE q.lead_id = l.id
    );

  v_without_entry := v_total - v_with_entry;
  v_status := CASE WHEN v_without_entry = 0 THEN 'CONSISTENT' ELSE 'CORRUPTED' END;

  RETURN QUERY SELECT v_total, v_with_entry, v_without_entry, v_status;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 5: Verification & Testing
-- ============================================================================
-- Run these queries to verify:

-- Test 1: Verify worker can claim work
-- SELECT * FROM claim_ci_queue_items(10);

-- Test 2: Check consistency
-- SELECT * FROM audit_ci_queue_consistency();

-- Test 3: If corrupted, repair
-- SELECT * FROM backfill_missing_ci_queue_entries();

-- Test 4: Verify new indexes exist
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'commercial_intelligence_queue'
-- ORDER BY indexname;
