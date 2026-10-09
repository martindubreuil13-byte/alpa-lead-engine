-- Server-controlled Commercial Intelligence worker.
-- Existing and public rows remain ineligible. Only owner-verified private
-- preview requests explicitly set worker_eligible=true.

ALTER TABLE commercial_intelligence_queue
  ADD COLUMN IF NOT EXISTS worker_eligible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE commercial_intelligence_queue
  ALTER COLUMN worker_eligible SET DEFAULT false;

ALTER TABLE commercial_intelligence_queue
  ADD COLUMN IF NOT EXISTS claim_token UUID;

CREATE INDEX IF NOT EXISTS idx_ci_queue_worker_claim
ON commercial_intelligence_queue(status, created_at)
WHERE worker_eligible = true AND status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION claim_ci_queue_items_worker(p_limit INT DEFAULT 5)
RETURNS TABLE (
  id UUID,
  lead_id UUID,
  retry_count INT,
  max_retries INT,
  claim_token UUID
) AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  RETURN QUERY
  WITH candidate_rows AS (
    SELECT q.id
    FROM commercial_intelligence_queue q
    WHERE q.worker_eligible = true
      AND q.status = 'pending'
      AND (q.last_retry_at IS NULL OR NOW() >= q.last_retry_at + INTERVAL '60 seconds')
      AND q.retry_count < q.max_retries
    ORDER BY q.created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 20)
    FOR UPDATE SKIP LOCKED
  ),
  updated_rows AS (
    UPDATE commercial_intelligence_queue q
    SET status = 'processing',
        started_at = NOW(),
        claim_token = gen_random_uuid()
    FROM candidate_rows c
    WHERE q.id = c.id
    RETURNING q.id, q.lead_id, q.retry_count, q.max_retries, q.claim_token, q.created_at
  )
  SELECT u.id, u.lead_id, u.retry_count, u.max_retries, u.claim_token
  FROM updated_rows u
  ORDER BY u.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reset_stale_ci_processing_worker(p_timeout_seconds INT DEFAULT 300)
RETURNS TABLE (reset_count INT, failed_count INT) AS $$
DECLARE
  v_reset_count INT := 0;
  v_failed_count INT := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  WITH exhausted AS (
    UPDATE commercial_intelligence_queue
    SET status = 'failed',
        retry_count = retry_count + 1,
        last_retry_at = NOW(),
        completed_at = NOW(),
        started_at = NULL,
        claim_token = NULL,
        last_error = 'Worker interrupted and retry limit reached'
    WHERE worker_eligible = true
      AND status = 'processing'
      AND started_at < NOW() - (GREATEST(p_timeout_seconds, 60) || ' seconds')::INTERVAL
      AND retry_count + 1 >= max_retries
    RETURNING lead_id
  )
  UPDATE leads l
  SET ci_enrichment_status = 'failed',
      ci_last_error = 'Worker interrupted and retry limit reached',
      ci_completed_at = NULL,
      ci_retry_count = COALESCE(l.ci_retry_count, 0) + 1
  WHERE l.id IN (SELECT lead_id FROM exhausted);
  GET DIAGNOSTICS v_failed_count = ROW_COUNT;

  UPDATE commercial_intelligence_queue
  SET status = 'pending',
      retry_count = retry_count + 1,
      last_retry_at = NOW(),
      started_at = NULL,
      completed_at = NULL,
      claim_token = NULL,
      last_error = 'Worker interrupted; scheduled for retry'
  WHERE worker_eligible = true
    AND status = 'processing'
    AND started_at < NOW() - (GREATEST(p_timeout_seconds, 60) || ' seconds')::INTERVAL
    AND retry_count + 1 < max_retries;
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  RETURN QUERY SELECT v_reset_count, v_failed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION complete_ci_enrichment_worker(
  p_queue_id UUID,
  p_lead_id UUID,
  p_claim_token UUID,
  p_snapshot JSONB,
  p_signals JSONB,
  p_profile JSONB,
  p_success BOOLEAN,
  p_error_msg TEXT
)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION claim_ci_queue_items_worker(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reset_stale_ci_processing_worker(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_ci_enrichment_worker(UUID, UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_ci_queue_items_worker(INT) TO service_role;
GRANT EXECUTE ON FUNCTION reset_stale_ci_processing_worker(INT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_ci_enrichment_worker(UUID, UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) TO service_role;

-- Only trusted server-side roles may turn worker processing on. Ordinary
-- authenticated/anon PostgREST sessions can still insert and update their own
-- queue rows (RLS is unchanged) but cannot set or change worker_eligible.
CREATE OR REPLACE FUNCTION guard_ci_queue_worker_eligible()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'INSERT' AND NEW.worker_eligible IS TRUE THEN
      RAISE EXCEPTION 'worker_eligible can only be set by trusted server code'
        USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND NEW.worker_eligible IS DISTINCT FROM OLD.worker_eligible THEN
      RAISE EXCEPTION 'worker_eligible can only be changed by trusted server code'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_ci_queue_worker_eligible ON commercial_intelligence_queue;
CREATE TRIGGER trg_guard_ci_queue_worker_eligible
BEFORE INSERT OR UPDATE ON commercial_intelligence_queue
FOR EACH ROW EXECUTE FUNCTION guard_ci_queue_worker_eligible();

-- Owner-verified private preview enqueue. Called only by server code with the
-- service role, after the application has verified the owner. Handles new and
-- rediscovered leads without duplicates, and never touches completed profiles.
-- Returns: queued | enabled_existing | already_queued | already_processing |
--          already_complete | no_website | lead_not_found
CREATE OR REPLACE FUNCTION enqueue_private_preview_ci_worker(
  p_lead_id UUID,
  p_user_id UUID
)
RETURNS TEXT AS $$
DECLARE
  v_summary TEXT;
  v_website TEXT;
  v_queue_id UUID;
  v_status TEXT;
  v_eligible BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT NULLIF(BTRIM(l.commercial_profile->>'summary'), ''), NULLIF(BTRIM(l.website), '')
  INTO v_summary, v_website
  FROM leads l
  WHERE l.id = p_lead_id AND l.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'lead_not_found'; END IF;
  IF v_summary IS NOT NULL THEN RETURN 'already_complete'; END IF;
  IF v_website IS NULL THEN RETURN 'no_website'; END IF;

  SELECT q.id, q.status, q.worker_eligible
  INTO v_queue_id, v_status, v_eligible
  FROM commercial_intelligence_queue q
  WHERE q.lead_id = p_lead_id AND q.status IN ('pending', 'processing')
  FOR UPDATE;

  IF FOUND THEN
    IF v_status = 'processing' THEN RETURN 'already_processing'; END IF;
    IF v_eligible THEN RETURN 'already_queued'; END IF;
    UPDATE commercial_intelligence_queue SET worker_eligible = true WHERE id = v_queue_id;
    RETURN 'enabled_existing';
  END IF;

  BEGIN
    INSERT INTO commercial_intelligence_queue (lead_id, user_id, status, worker_eligible)
    VALUES (p_lead_id, p_user_id, 'pending', true);
  EXCEPTION WHEN unique_violation THEN
    UPDATE commercial_intelligence_queue
    SET worker_eligible = true
    WHERE lead_id = p_lead_id AND status = 'pending';
    RETURN 'enabled_existing';
  END;

  UPDATE leads
  SET ci_enrichment_status = 'pending', ci_last_error = NULL, ci_retry_count = 0
  WHERE id = p_lead_id AND ci_enrichment_status IN ('failed', 'skipped', 'completed');

  RETURN 'queued';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION enqueue_private_preview_ci_worker(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_private_preview_ci_worker(UUID, UUID) TO service_role;

-- Supabase-hosted scheduling for Vercel Hobby. The linked project supports
-- these extensions, but neither is currently enabled.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Run manually after storing these two Supabase Vault secrets:
--   alpa_ci_worker_url     Full deployed worker endpoint URL
--   alpa_ci_worker_secret Value matching Vercel CRON_SECRET
-- SELECT configure_alpa_ci_worker_schedule();
CREATE OR REPLACE FUNCTION configure_alpa_ci_worker_schedule()
RETURNS BIGINT AS $$
DECLARE
  v_job_id BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'alpa_ci_worker_url'
  ) OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'alpa_ci_worker_secret'
  ) THEN
    RAISE EXCEPTION 'Missing alpa_ci_worker_url or alpa_ci_worker_secret Vault secret';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alpa-private-ci-worker') THEN
    PERFORM cron.unschedule('alpa-private-ci-worker');
  END IF;

  SELECT cron.schedule(
    'alpa-private-ci-worker',
    '*/5 * * * *',
    $job$
      SELECT net.http_get(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alpa_ci_worker_url'),
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'alpa_ci_worker_secret')
        ),
        timeout_milliseconds := 290000
      );
    $job$
  ) INTO v_job_id;

  RETURN v_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, cron, net, vault;

REVOKE ALL ON FUNCTION configure_alpa_ci_worker_schedule() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION configure_alpa_ci_worker_schedule() TO postgres;
