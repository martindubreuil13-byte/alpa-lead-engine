-- Captured read-only from production (pg_get_functiondef) on 2026-10-14. Used only by the offline spend-engine test.
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
