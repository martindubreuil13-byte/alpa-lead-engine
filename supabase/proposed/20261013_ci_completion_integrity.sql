-- B1.2a — Completion integrity for the research queue.
--
-- STATUS: PROPOSED. NOT APPLIED. For review only. Apply as ONE transaction (BEGIN; ... COMMIT;).
-- Depends on B1.1 (20261012_ci_queue_integrity.sql), which is already live. Do not re-run B1.1.
--
-- Three changes. 1 and 2 are on the existing completion functions (no second completion mechanism);
-- 3 is one small guard trigger on the queue table:
--
--   1. A job completes only when a usable profile exists (both complete_ci_enrichment and
--      complete_ci_enrichment_worker).
--        - p_success with a profile that has a non-empty summary           -> completed (as before)
--        - p_success with NO snapshot, signals or profile (nothing to research,
--          e.g. the lead has no website)                                   -> job completed, lead 'skipped',
--                                                                             existing profile data untouched
--        - p_success with anything else (a profile without a summary, ...) -> treated as a FAILURE:
--                                                                             the normal retry policy applies
--      Before this, a "success" carrying NULL data completed the job and overwrote the lead's profile with NULL.
--      A successful completion also never replaces stored data with NULL (COALESCE).
--      Worker claim-token fencing and every failure/retry rule are unchanged.
--
--   2. Customer-path fencing, MANDATORY. The worker path is fenced by claim_token; the customer path had
--      nothing, so a run that stalled past the stale timeout and then resumed could complete a job another
--      run had since re-claimed. The smallest fix needs no new column and does not touch the claim function:
--      every re-claim of a job passes through a reset or a failed attempt, and each of those increments
--      retry_count (section 3 makes that a database-enforced rule). complete_ci_enrichment therefore takes
--      p_expected_retry_count (the retry_count the claim returned) and completes only the attempt it names.
--        - omitted / NULL:                 (false, 'attempt_required'), nothing is read or written
--        - different from the row's count: (false, 'claim_lost'),       nothing is written
--        - equal to the row's count:       the completion proceeds (still requires status 'processing',
--                                          ownership, and no worker claim token)
--      Adding a parameter creates a new signature, so the old 7-argument function is dropped in the same
--      transaction. The new parameter keeps a NULL default so that an old caller gets the explicit
--      'attempt_required' answer instead of a "function not found" error.
--
--   3. Retry-count monotonicity, enforced. The fencing above is only as strong as the guarantee that
--      retry_count changes whenever a job leaves 'processing' for a state from which it can be claimed
--      again. Every function that exists today does that, but nothing stopped a direct service-role UPDATE
--      from resetting a job without counting the attempt. A small trigger now refuses that:
--      a job leaving 'processing' for 'pending' or 'failed' must have a higher retry_count than it had.
--      It does not apply to 'completed' (terminal), claims (pending -> processing) or any other column.
--      It can be omitted without affecting sections 1 and 2, but then the guarantee is by convention only.
--
-- ROLLOUT: apply this migration, then deploy the application code that always sends p_expected_retry_count.
-- Until both are in place, customer-path completions are refused (job stays 'processing' and is recovered
-- by stale reset, using up one retry): nothing is corrupted in either order. No customer-path job is
-- running while automatic research is off.
--
-- Rollback: supabase/proposed/20261013_ci_completion_integrity_rollback.sql

-- ---------------------------------------------------------------------------------------------
-- 1. Customer path: fenced by attempt number, requires a usable profile
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text);

CREATE FUNCTION public.complete_ci_enrichment(
  p_queue_id uuid, p_lead_id uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb,
  p_success boolean, p_error_msg text, p_expected_retry_count integer DEFAULT NULL
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retry_count integer;
  v_max_retries integer;
  v_has_profile boolean;
  v_skipped boolean;
  v_failure boolean;
  v_error text;
BEGIN
  BEGIN
    IF p_expected_retry_count IS NULL THEN
      RETURN QUERY SELECT false, 'attempt_required'::text;
      RETURN;
    END IF;

    SELECT q.retry_count, q.max_retries
    INTO v_retry_count, v_max_retries
    FROM public.commercial_intelligence_queue q
    WHERE q.id = p_queue_id
      AND q.lead_id = p_lead_id
      AND q.user_id = auth.uid()
      AND q.status = 'processing'
      AND q.claim_token IS NULL
      AND q.retry_count = p_expected_retry_count
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'claim_lost'::text;
      RETURN;
    END IF;

    v_has_profile := p_profile IS NOT NULL
      AND jsonb_typeof(p_profile) = 'object'
      AND btrim(COALESCE(p_profile ->> 'summary', '')) <> '';
    v_skipped := p_success AND p_snapshot IS NULL AND p_signals IS NULL AND p_profile IS NULL;
    v_failure := NOT p_success OR (NOT v_skipped AND NOT v_has_profile);
    v_error := COALESCE(p_error_msg, CASE WHEN p_success THEN 'Research finished without a usable business profile' END);

    IF v_skipped THEN
      UPDATE public.commercial_intelligence_queue
      SET status = 'completed', completed_at = NOW(), last_error = NULL, started_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET ci_enrichment_status = 'skipped', ci_completed_at = NOW(),
          ci_started_at = COALESCE(ci_started_at, NOW()), ci_last_error = NULL, ci_retry_count = 0
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'enrichment_completed'::text;
    ELSIF NOT v_failure THEN
      UPDATE public.commercial_intelligence_queue
      SET status = 'completed', completed_at = NOW(), last_error = NULL, started_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET website_snapshot = COALESCE(p_snapshot, website_snapshot),
          business_signals = COALESCE(p_signals, business_signals),
          commercial_profile = p_profile,
          ci_enrichment_status = 'completed', ci_completed_at = NOW(),
          ci_started_at = COALESCE(ci_started_at, NOW()), ci_last_error = NULL, ci_retry_count = 0
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'enrichment_completed'::text;
    ELSIF v_retry_count + 1 < v_max_retries THEN
      UPDATE public.commercial_intelligence_queue
      SET status = 'pending', retry_count = retry_count + 1, last_retry_at = NOW(),
          last_error = v_error, started_at = NULL, completed_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET ci_enrichment_status = 'pending', ci_last_error = v_error,
          ci_retry_count = COALESCE(ci_retry_count, 0) + 1, ci_completed_at = NULL,
          ci_started_at = COALESCE(ci_started_at, NOW())
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'retry_pending'::text;
    ELSE
      UPDATE public.commercial_intelligence_queue
      SET status = 'failed', retry_count = retry_count + 1, last_error = v_error,
          completed_at = NOW(), started_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET ci_enrichment_status = 'failed', ci_last_error = v_error,
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

REVOKE EXECUTE ON FUNCTION public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Worker path: same signature (grants are kept), same claim-token fencing, same retry rules,
--    plus the usable-profile rule
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_ci_enrichment_worker(p_queue_id uuid, p_lead_id uuid, p_claim_token uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb, p_success boolean, p_error_msg text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_retry_count INT;
  v_max_retries INT;
  v_has_profile BOOLEAN;
  v_skipped BOOLEAN;
  v_failure BOOLEAN;
  v_error TEXT;
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

  v_has_profile := p_profile IS NOT NULL
    AND jsonb_typeof(p_profile) = 'object'
    AND btrim(COALESCE(p_profile ->> 'summary', '')) <> '';
  v_skipped := p_success AND p_snapshot IS NULL AND p_signals IS NULL AND p_profile IS NULL;
  v_failure := NOT p_success OR (NOT v_skipped AND NOT v_has_profile);
  v_error := COALESCE(p_error_msg, CASE WHEN p_success THEN 'Research finished without a usable business profile' END);

  IF v_skipped THEN
    UPDATE commercial_intelligence_queue
    SET status = 'completed', completed_at = NOW(), started_at = NULL,
        claim_token = NULL, last_error = NULL
    WHERE id = p_queue_id;

    UPDATE leads
    SET ci_enrichment_status = 'skipped',
        ci_completed_at = NOW(),
        ci_started_at = COALESCE(ci_started_at, NOW()),
        ci_last_error = NULL,
        ci_retry_count = 0
    WHERE id = p_lead_id;

    RETURN QUERY SELECT true, 'enrichment_completed'::TEXT;
  ELSIF NOT v_failure THEN
    UPDATE commercial_intelligence_queue
    SET status = 'completed', completed_at = NOW(), started_at = NULL,
        claim_token = NULL, last_error = NULL
    WHERE id = p_queue_id;

    UPDATE leads
    SET website_snapshot = COALESCE(p_snapshot, website_snapshot),
        business_signals = COALESCE(p_signals, business_signals),
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
        claim_token = NULL, last_error = v_error
    WHERE id = p_queue_id;

    UPDATE leads
    SET ci_enrichment_status = 'pending', ci_last_error = v_error,
        ci_retry_count = v_retry_count + 1, ci_completed_at = NULL,
        ci_started_at = COALESCE(ci_started_at, NOW())
    WHERE id = p_lead_id;

    RETURN QUERY SELECT true, 'retry_pending'::TEXT;
  ELSE
    UPDATE commercial_intelligence_queue
    SET status = 'failed', retry_count = retry_count + 1,
        last_retry_at = NOW(), completed_at = NOW(), started_at = NULL,
        claim_token = NULL, last_error = v_error
    WHERE id = p_queue_id;

    UPDATE leads
    SET ci_enrichment_status = 'failed', ci_last_error = v_error,
        ci_retry_count = v_retry_count + 1, ci_completed_at = NULL,
        ci_started_at = COALESCE(ci_started_at, NOW())
    WHERE id = p_lead_id;

    RETURN QUERY SELECT true, 'enrichment_failed'::TEXT;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. A job that leaves 'processing' to be retried or failed must count the attempt
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_ci_queue_attempt_monotonic()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'processing'
     AND NEW.status IN ('pending', 'failed')
     AND NEW.retry_count <= OLD.retry_count
  THEN
    RAISE EXCEPTION 'a research job leaving "processing" must count the attempt (retry_count % -> %)', OLD.retry_count, NEW.retry_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_ci_queue_attempt_monotonic() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_ci_queue_attempt_monotonic ON public.commercial_intelligence_queue;
CREATE TRIGGER trg_guard_ci_queue_attempt_monotonic
  BEFORE UPDATE OF status, retry_count ON public.commercial_intelligence_queue
  FOR EACH ROW EXECUTE FUNCTION public.guard_ci_queue_attempt_monotonic();
