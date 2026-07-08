-- PURE ARCHITECTURE: Worker as Pure Consumer
--
-- Design Principle: Single Responsibility
-- - Lead creation endpoints CREATE queue entries (synchronously)
-- - Queue table STORES work (no creation logic)
-- - Worker CONSUMES work (pure observer, never creates)
-- - Repair utility FIXES exceptional cases (migrations, historical data)
--
-- This is the production-grade architecture that scales to millions of leads.
-- The worker never creates work. Lead creation always enqueues atomically.

-- ============================================================================
-- PART 1: Worker RPC - Pure Consumer (Revert Auto-Creation)
-- ============================================================================

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
-- PART 2: Repair Utility - Backfill Missing Queue Entries
-- ============================================================================
-- For migrations, historical data recovery, and exceptional cases.
-- Safe to run multiple times (idempotent).
-- Use when leads exist without queue entries (data corruption).

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
      AND l.id NOT IN (
        SELECT DISTINCT lead_id FROM commercial_intelligence_queue
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
-- PART 3: Audit Function - Verify Consistency
-- ============================================================================
-- Check that every lead requiring CI has a queue entry.
-- Returns CONSISTENT if all is well, CORRUPTED if repair needed.

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
  SELECT COUNT(*) INTO v_total
  FROM leads l
  WHERE (p_user_id IS NULL OR l.user_id = p_user_id)
    AND (l.ci_enrichment_status IS NULL
      OR l.ci_enrichment_status = 'not_generated'
      OR l.ci_enrichment_status = 'pending');

  SELECT COUNT(*) INTO v_with_entry
  FROM leads l
  WHERE (p_user_id IS NULL OR l.user_id = p_user_id)
    AND (l.ci_enrichment_status IS NULL
      OR l.ci_enrichment_status = 'not_generated'
      OR l.ci_enrichment_status = 'pending')
    AND l.id IN (SELECT DISTINCT lead_id FROM commercial_intelligence_queue);

  v_without_entry := v_total - v_with_entry;
  v_status := CASE WHEN v_without_entry = 0 THEN 'CONSISTENT' ELSE 'CORRUPTED' END;

  RETURN QUERY SELECT v_total, v_with_entry, v_without_entry, v_status;
END;
$$ LANGUAGE plpgsql;
