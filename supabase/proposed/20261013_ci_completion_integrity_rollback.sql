-- Rollback for 20261013_ci_completion_integrity.sql.
--
-- STATUS: PROPOSED. NOT APPLIED. Run as ONE transaction (BEGIN; ... COMMIT;).
-- Restores the B1.1 customer-path function (7 arguments, no attempt fencing, no profile rule) and the
-- original worker completion function. It does not touch B1.1 objects or any data.

-- Section 3 of the proposal: the attempt-monotonicity guard
DROP TRIGGER IF EXISTS trg_guard_ci_queue_attempt_monotonic ON public.commercial_intelligence_queue;
DROP FUNCTION IF EXISTS public.guard_ci_queue_attempt_monotonic();

-- Customer path: B1.1 version
DROP FUNCTION IF EXISTS public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text, integer);

CREATE FUNCTION public.complete_ci_enrichment(
  p_queue_id uuid, p_lead_id uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb,
  p_success boolean, p_error_msg text
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retry_count integer;
  v_max_retries integer;
BEGIN
  BEGIN
    SELECT q.retry_count, q.max_retries
    INTO v_retry_count, v_max_retries
    FROM public.commercial_intelligence_queue q
    WHERE q.id = p_queue_id
      AND q.lead_id = p_lead_id
      AND q.user_id = auth.uid()
      AND q.status = 'processing'
      AND q.claim_token IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'claim_lost'::text;
      RETURN;
    END IF;

    IF p_success THEN
      UPDATE public.commercial_intelligence_queue
      SET status = 'completed', completed_at = NOW(), last_error = NULL, started_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET website_snapshot = p_snapshot, business_signals = p_signals, commercial_profile = p_profile,
          ci_enrichment_status = 'completed', ci_completed_at = NOW(),
          ci_started_at = COALESCE(ci_started_at, NOW()), ci_last_error = NULL, ci_retry_count = 0
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'enrichment_completed'::text;
    ELSIF v_retry_count + 1 < v_max_retries THEN
      UPDATE public.commercial_intelligence_queue
      SET status = 'pending', retry_count = retry_count + 1, last_retry_at = NOW(),
          last_error = p_error_msg, started_at = NULL, completed_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET ci_enrichment_status = 'pending', ci_last_error = p_error_msg,
          ci_retry_count = COALESCE(ci_retry_count, 0) + 1, ci_completed_at = NULL,
          ci_started_at = COALESCE(ci_started_at, NOW())
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'retry_pending'::text;
    ELSE
      UPDATE public.commercial_intelligence_queue
      SET status = 'failed', retry_count = retry_count + 1, last_error = p_error_msg,
          completed_at = NOW(), started_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET ci_enrichment_status = 'failed', ci_last_error = p_error_msg,
          ci_retry_count = COALESCE(ci_retry_count, 0) + 1, ci_completed_at = NULL,
          ci_started_at = COALESCE(ci_started_at, NOW())
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'enrichment_failed'::text;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY SELECT false, SQLERRM::text;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text) TO authenticated, service_role;

-- Worker path: original version
CREATE OR REPLACE FUNCTION public.complete_ci_enrichment_worker(p_queue_id uuid, p_lead_id uuid, p_claim_token uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb, p_success boolean, p_error_msg text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_retry_count INT;
  v_max_retries INT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT q.retry_count, q.max_retries
  INTO v_retry_count, v_max_retries
  FROM commercial_intelligence_queue q
  WHERE q.id = p_queue_id
    AND q.lead_id = p_lead_id
    AND q.status = 'processing'
    AND q.claim_token = p_claim_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'claim_lost'::TEXT;
    RETURN;
  END IF;

  IF p_success THEN
    UPDATE commercial_intelligence_queue
    SET status = 'completed', completed_at = NOW(), started_at = NULL,
        claim_token = NULL, last_error = NULL
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
  ELSIF v_retry_count + 1 < v_max_retries THEN
    UPDATE commercial_intelligence_queue
    SET status = 'pending', retry_count = retry_count + 1,
        last_retry_at = NOW(), started_at = NULL, completed_at = NULL,
        claim_token = NULL, last_error = p_error_msg
    WHERE id = p_queue_id;

    UPDATE leads
    SET ci_enrichment_status = 'pending', ci_last_error = p_error_msg,
        ci_retry_count = v_retry_count + 1, ci_completed_at = NULL,
        ci_started_at = COALESCE(ci_started_at, NOW())
    WHERE id = p_lead_id;

    RETURN QUERY SELECT true, 'retry_pending'::TEXT;
  ELSE
    UPDATE commercial_intelligence_queue
    SET status = 'failed', retry_count = retry_count + 1,
        last_retry_at = NOW(), completed_at = NOW(), started_at = NULL,
        claim_token = NULL, last_error = p_error_msg
    WHERE id = p_queue_id;

    UPDATE leads
    SET ci_enrichment_status = 'failed', ci_last_error = p_error_msg,
        ci_retry_count = v_retry_count + 1, ci_completed_at = NULL,
        ci_started_at = COALESCE(ci_started_at, NOW())
    WHERE id = p_lead_id;

    RETURN QUERY SELECT true, 'enrichment_failed'::TEXT;
  END IF;
END;
$function$;
