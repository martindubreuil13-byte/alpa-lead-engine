-- Rollback for 20261012_ci_queue_integrity.sql (PROPOSED. NOT APPLIED.)
--
-- Restores the previous user-path functions and customer rights, and removes the new guards.
-- It deliberately does NOT drop the run_id column, so any run identifiers written meanwhile are kept
-- (run_id is nullable and unused by the current application).
--
-- Restoring "UPDATE/DELETE for customers" re-opens the gaps B1.1 closes; use only if the user-path
-- functions misbehave in production and the fix cannot wait.

DROP TRIGGER IF EXISTS trg_guard_ci_queue_user_write ON public.commercial_intelligence_queue;
DROP FUNCTION IF EXISTS public.guard_ci_queue_user_write();

DROP INDEX IF EXISTS public.idx_ci_queue_unique_active_per_lead;
ALTER TABLE public.commercial_intelligence_queue DROP CONSTRAINT IF EXISTS valid_status;

-- Previous (SECURITY INVOKER) user-path functions, exactly as they were in production on 2026-10-10.
CREATE OR REPLACE FUNCTION public.claim_ci_queue_items(p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, lead_id uuid, retry_count integer, max_retries integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_ci_enrichment(p_queue_id uuid, p_lead_id uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb, p_success boolean, p_error_msg text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_should_retry BOOLEAN;
BEGIN
  BEGIN
    IF p_success THEN
      UPDATE commercial_intelligence_queue
      SET status = 'completed', completed_at = NOW(), last_error = NULL, started_at = NULL
      WHERE id = p_queue_id;

      UPDATE leads
      SET website_snapshot = p_snapshot, business_signals = p_signals, commercial_profile = p_profile,
          ci_enrichment_status = 'completed', ci_completed_at = NOW(),
          ci_started_at = COALESCE(ci_started_at, NOW()), ci_last_error = NULL, ci_retry_count = 0
      WHERE id = p_lead_id;

      RETURN QUERY SELECT TRUE, 'enrichment_completed'::TEXT;
    ELSE
      SELECT (retry_count + 1 < max_retries) INTO v_should_retry
      FROM commercial_intelligence_queue WHERE id = p_queue_id;
      v_should_retry := COALESCE(v_should_retry, FALSE);

      IF v_should_retry THEN
        UPDATE commercial_intelligence_queue
        SET status = 'pending', retry_count = retry_count + 1, last_retry_at = NOW(),
            last_error = p_error_msg, started_at = NULL, completed_at = NULL
        WHERE id = p_queue_id;

        UPDATE leads
        SET ci_enrichment_status = 'pending', ci_last_error = p_error_msg,
            ci_retry_count = COALESCE(ci_retry_count, 0) + 1, ci_completed_at = NULL,
            ci_started_at = COALESCE(ci_started_at, NOW())
        WHERE id = p_lead_id;

        RETURN QUERY SELECT TRUE, 'retry_pending'::TEXT;
      ELSE
        UPDATE commercial_intelligence_queue
        SET status = 'failed', retry_count = retry_count + 1, last_error = p_error_msg,
            completed_at = NOW(), started_at = NULL
        WHERE id = p_queue_id;

        UPDATE leads
        SET ci_enrichment_status = 'failed', ci_last_error = p_error_msg,
            ci_retry_count = COALESCE(ci_retry_count, 0) + 1, ci_completed_at = NULL,
            ci_started_at = COALESCE(ci_started_at, NOW())
        WHERE id = p_lead_id;

        RETURN QUERY SELECT TRUE, 'enrichment_failed'::TEXT;
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_stale_ci_processing(p_timeout_seconds integer DEFAULT 300)
 RETURNS TABLE(reset_count integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reset_count INT;
BEGIN
  UPDATE commercial_intelligence_queue
  SET
      status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      last_retry_at = NOW()
  WHERE status = 'processing'
    AND started_at < NOW() - (p_timeout_seconds || ' seconds')::INTERVAL
    AND retry_count < max_retries;

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  RETURN QUERY
  SELECT v_reset_count;
END;
$function$;


GRANT UPDATE, DELETE, MAINTAIN ON TABLE public.commercial_intelligence_queue TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_intelligence_queue'
      AND policyname = 'Users can update their own ci queue'
  ) THEN
    CREATE POLICY "Users can update their own ci queue" ON public.commercial_intelligence_queue
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
