-- Fix complete_ci_enrichment RPC to maintain consistent state transitions
-- Previous issue: retry state (pending) was setting completed_at, creating contradictory state
-- Solution: conditional completed_at based on terminal status (completed/failed vs pending/retrying)

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
      -- SUCCESS: terminal state (completed)
      -- Queue: completed state with all data cleared
      -- Leads: mark as completed with enrichment data and timestamp
      UPDATE commercial_intelligence_queue
      SET status = 'completed',
          completed_at = NOW(),
          last_error = NULL,
          started_at = NULL
      WHERE id = p_queue_id;

      UPDATE leads
      SET website_snapshot = p_snapshot,
          business_signals = p_signals,
          commercial_profile = p_profile,
          ci_enrichment_status = 'completed',
          ci_completed_at = NOW(),
          ci_started_at = COALESCE(ci_started_at, NOW()),
          ci_last_error = NULL,
          ci_retry_count = 0
      WHERE id = p_lead_id;

      RETURN QUERY SELECT true, 'enrichment_completed'::TEXT;

    ELSE
      -- FAILURE: determine retry status
      SELECT (q.retry_count + 1 < q.max_retries)
      INTO v_should_retry
      FROM commercial_intelligence_queue q
      WHERE q.id = p_queue_id;

      v_should_retry := COALESCE(v_should_retry, false);
      v_next_status := CASE WHEN v_should_retry THEN 'pending' ELSE 'failed' END;

      IF v_should_retry THEN
        -- RETRY: non-terminal state (pending)
        -- Queue: reset to pending for retry, do NOT set completed_at
        -- Leads: set to pending, increment retry count, do NOT set ci_completed_at
        UPDATE commercial_intelligence_queue
        SET status = 'pending',
            retry_count = retry_count + 1,
            last_error = p_error_msg,
            last_retry_at = NOW(),
            started_at = NULL,
            completed_at = NULL
        WHERE id = p_queue_id;

        UPDATE leads
        SET ci_enrichment_status = 'pending',
            ci_last_error = p_error_msg,
            ci_retry_count = ci_retry_count + 1,
            ci_completed_at = NULL,
            ci_started_at = COALESCE(ci_started_at, NOW())
        WHERE id = p_lead_id;

        RETURN QUERY SELECT true, 'retry_pending'::TEXT;

      ELSE
        -- FAILED: terminal state (failed)
        -- Queue: mark as failed with timestamp
        -- Leads: mark as failed, do NOT set ci_completed_at (failed is not terminal in UI/schema, leave null)
        UPDATE commercial_intelligence_queue
        SET status = 'failed',
            retry_count = retry_count + 1,
            last_error = p_error_msg,
            completed_at = NOW(),
            started_at = NULL
        WHERE id = p_queue_id;

        UPDATE leads
        SET ci_enrichment_status = 'failed',
            ci_last_error = p_error_msg,
            ci_retry_count = ci_retry_count + 1,
            ci_completed_at = NULL,
            ci_started_at = COALESCE(ci_started_at, NOW())
        WHERE id = p_lead_id;

        RETURN QUERY SELECT true, 'enrichment_failed'::TEXT;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM::TEXT;
  END;
END;
$$ LANGUAGE plpgsql;
