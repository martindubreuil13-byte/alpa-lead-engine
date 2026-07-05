-- Production safety fixes for Commercial Intelligence queue
-- Addresses: deduplication, atomic claiming, stale recovery, transaction safety

-- Add retry control columns
ALTER TABLE commercial_intelligence_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commercial_intelligence_queue ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE commercial_intelligence_queue ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;

-- Deduplication: prevent multiple active jobs for same lead
-- Unique constraint on (lead_id) WHERE status IN ('pending', 'processing')
-- If a job already exists for a lead in active status, new enqueue will fail
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_queue_unique_active_per_lead
ON commercial_intelligence_queue(lead_id)
WHERE status IN ('pending', 'processing');

-- Atomic queue claiming with row locking
-- Selects pending items that meet retry backoff, marks as processing
-- Multiple workers cannot receive the same item (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION claim_ci_queue_items(p_limit INT DEFAULT 10)
RETURNS TABLE (
  id UUID,
  lead_id UUID,
  retry_count INT,
  max_retries INT
) AS $$
DECLARE
  v_claimed_ids UUID[];
BEGIN
  -- Atomically select and lock items for claiming
  -- SKIP LOCKED ensures no two workers claim the same item
  SELECT ARRAY_AGG(q.id) INTO v_claimed_ids
  FROM commercial_intelligence_queue q
  WHERE q.status = 'pending'
    -- Backoff: don't retry immediately, wait 60 seconds between retries
    AND (q.last_retry_at IS NULL OR NOW() >= q.last_retry_at + INTERVAL '60 seconds')
    -- Haven't exceeded max retries
    AND q.retry_count < q.max_retries
  ORDER BY q.created_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED;

  -- Mark claimed items as processing (still in transaction)
  UPDATE commercial_intelligence_queue
  SET status = 'processing',
      started_at = COALESCE(started_at, NOW())
  WHERE id = ANY(v_claimed_ids);

  -- Return claimed items for processing
  RETURN QUERY
  SELECT q.id, q.lead_id, q.retry_count, q.max_retries
  FROM commercial_intelligence_queue q
  WHERE q.id = ANY(v_claimed_ids)
  ORDER BY q.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Stale processing recovery
-- Items stuck in processing for >5 minutes are reset to pending for retry
-- Called periodically or at worker startup
CREATE OR REPLACE FUNCTION reset_stale_ci_processing(p_timeout_seconds INT DEFAULT 300)
RETURNS TABLE (reset_count INT) AS $$
DECLARE
  v_reset_count INT;
BEGIN
  -- Reset items processing for too long, haven't exceeded retries
  UPDATE commercial_intelligence_queue
  SET status = 'pending',
      retry_count = retry_count + 1,
      last_retry_at = NOW(),
      started_at = NULL
  WHERE status = 'processing'
    AND started_at < NOW() - (p_timeout_seconds || ' seconds')::INTERVAL
    AND retry_count < max_retries;

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RETURN QUERY SELECT v_reset_count;
END;
$$ LANGUAGE plpgsql;

-- Atomic lead + queue update after enrichment
-- Ensures consistency: queue and lead always in sync
-- Called after enrichLeadDirect() completes
CREATE OR REPLACE FUNCTION complete_ci_enrichment(
  p_queue_id UUID,
  p_lead_id UUID,
  p_snapshot JSONB,
  p_signals JSONB,
  p_profile JSONB,
  p_success BOOLEAN,
  p_error_msg TEXT
)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE
  v_next_status VARCHAR(50);
  v_should_retry BOOLEAN;
BEGIN
  BEGIN
    IF p_success THEN
      -- Success: mark queue completed and update lead with full enrichment
      UPDATE commercial_intelligence_queue
      SET status = 'completed',
          completed_at = NOW(),
          last_error = NULL
      WHERE id = p_queue_id;

      UPDATE leads
      SET website_snapshot = p_snapshot,
          business_signals = p_signals,
          commercial_profile = p_profile,
          ci_enrichment_status = 'completed',
          ci_completed_at = NOW(),
          ci_started_at = COALESCE(ci_started_at, NOW()),
          ci_last_error = NULL
      WHERE id = p_lead_id;

      RETURN QUERY SELECT true, 'enrichment_completed'::TEXT;

    ELSE
      -- Failure: determine retry status
      -- Get current retry state from queue
      SELECT (q.retry_count + 1 < q.max_retries)
      INTO v_should_retry
      FROM commercial_intelligence_queue q
      WHERE q.id = p_queue_id;

      v_should_retry := COALESCE(v_should_retry, false);
      v_next_status := CASE WHEN v_should_retry THEN 'pending' ELSE 'failed' END;

      -- Update queue: retry or fail
      UPDATE commercial_intelligence_queue
      SET status = v_next_status,
          completed_at = NOW(),
          last_error = p_error_msg,
          retry_count = retry_count + 1,
          last_retry_at = NOW(),
          started_at = NULL
      WHERE id = p_queue_id;

      -- Update lead: set status to match queue, store error
      UPDATE leads
      SET ci_enrichment_status = CASE
            WHEN v_should_retry THEN 'pending'
            ELSE 'failed'
          END,
          ci_completed_at = NOW(),
          ci_last_error = p_error_msg
      WHERE id = p_lead_id;

      RETURN QUERY SELECT true, v_next_status::TEXT;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM::TEXT;
  END;
END;
$$ LANGUAGE plpgsql;

-- Queue retention helper (informational)
-- Completed/failed jobs older than 30 days can be archived or deleted
-- DO NOT run automatically; admin decision only
-- Example: DELETE FROM commercial_intelligence_queue WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '30 days';
