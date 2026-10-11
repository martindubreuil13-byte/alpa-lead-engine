-- Disposable-database fixture: the PRODUCTION queue schema as read (read-only) on 2026-10-10.
--
-- This is NOT a migration and must never be run against Supabase. It rebuilds, in an empty local
-- Postgres 17 (the Supabase image), the objects the B1.1 migration touches, so the migration can be
-- tested against what production really has, including its drift from the repository migrations
-- (production has neither the partial unique index nor the status CHECK that
-- 20260704_fix_ci_queue_production_safety.sql / 20260704_add_commercial_intelligence_queue.sql declare).
--
-- Only `auth.uid()` / `auth.role()` are stand-ins; they read the same request settings Supabase sets.

-- Production grants EXECUTE on every NEW function in `public` to anon, authenticated and service_role
-- (on top of PostgreSQL's own default of PUBLIC). The fixture reproduces that, so a function that forgets to
-- REVOKE is visible to the tests exactly as it would be in production.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- leads (only the columns the queue functions read or write)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text,
  website text,
  website_snapshot jsonb,
  business_signals jsonb,
  commercial_profile jsonb,
  ci_enrichment_status varchar DEFAULT 'pending',
  ci_started_at timestamptz,
  ci_completed_at timestamptz,
  ci_last_error text,
  ci_retry_count integer,
  ci_processing_duration_ms integer,
  ci_cost_estimate numeric,
  ci_model_versions jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can delete their leads" ON public.leads FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own leads" ON public.leads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can only see their leads" ON public.leads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their leads" ON public.leads FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

-- ---------------------------------------------------------------------------------------------
-- commercial_intelligence_queue, as in production (no unique index, no status CHECK)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.commercial_intelligence_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status character varying NOT NULL DEFAULT 'pending',
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  last_retry_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  processing_duration_ms integer,
  total_cost numeric DEFAULT 0,
  worker_eligible boolean NOT NULL DEFAULT false,
  claim_token uuid,
  CONSTRAINT commercial_intelligence_queue_pkey PRIMARY KEY (id),
  CONSTRAINT commercial_intelligence_queue_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE,
  CONSTRAINT commercial_intelligence_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_ci_queue_status_created ON public.commercial_intelligence_queue (status, created_at);
CREATE INDEX idx_ci_queue_lead_id ON public.commercial_intelligence_queue (lead_id);
CREATE INDEX idx_ci_queue_user_id ON public.commercial_intelligence_queue (user_id);
CREATE INDEX idx_ci_queue_user_status ON public.commercial_intelligence_queue (user_id, status) WHERE status IN ('pending', 'processing');
CREATE INDEX idx_ci_queue_user_retry ON public.commercial_intelligence_queue (user_id, last_retry_at) WHERE status = 'pending';
CREATE INDEX idx_ci_queue_worker_claim ON public.commercial_intelligence_queue (status, created_at) WHERE worker_eligible = true AND status IN ('pending', 'processing');

ALTER TABLE public.commercial_intelligence_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own ci queue" ON public.commercial_intelligence_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own ci queue" ON public.commercial_intelligence_queue FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own ci queue" ON public.commercial_intelligence_queue FOR SELECT USING (auth.uid() = user_id);

-- Production ACL: authenticated = arwdm (insert, select, update, delete, maintain), service_role = full.
REVOKE ALL ON public.commercial_intelligence_queue FROM PUBLIC, anon;
GRANT INSERT, SELECT, UPDATE, DELETE, MAINTAIN ON public.commercial_intelligence_queue TO authenticated;
GRANT ALL ON public.commercial_intelligence_queue TO service_role;

-- Existing worker-eligibility guard (unchanged by B1.1)
CREATE OR REPLACE FUNCTION public.guard_ci_queue_worker_eligible() RETURNS trigger LANGUAGE plpgsql AS $function$
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
$function$;

CREATE TRIGGER trg_guard_ci_queue_worker_eligible
  BEFORE INSERT OR UPDATE ON public.commercial_intelligence_queue
  FOR EACH ROW EXECUTE FUNCTION public.guard_ci_queue_worker_eligible();

-- ---------------------------------------------------------------------------------------------
-- User-path functions: SECURITY INVOKER, scoped only by row-level security (as in production)
-- ---------------------------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.backfill_missing_ci_queue_entries(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(leads_found bigint, queue_entries_created bigint, queue_entries_skipped bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ---------------------------------------------------------------------------------------------
-- Service-role worker functions (SECURITY DEFINER; unchanged by B1.1)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_ci_queue_items_worker(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, lead_id uuid, retry_count integer, max_retries integer, claim_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

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

CREATE OR REPLACE FUNCTION public.reset_stale_ci_processing_worker(p_timeout_seconds integer DEFAULT 300)
 RETURNS TABLE(reset_count integer, failed_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_private_preview_ci_worker(p_lead_id uuid, p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- Function privileges as in production
REVOKE EXECUTE ON FUNCTION public.claim_ci_queue_items(integer), public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing(integer), public.backfill_missing_ci_queue_entries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ci_queue_items(integer), public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing(integer), public.backfill_missing_ci_queue_entries(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_ci_queue_items_worker(integer),
  public.complete_ci_enrichment_worker(uuid, uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing_worker(integer), public.enqueue_private_preview_ci_worker(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ci_queue_items_worker(integer),
  public.complete_ci_enrichment_worker(uuid, uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing_worker(integer), public.enqueue_private_preview_ci_worker(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- Read-only functions the app calls (SECURITY INVOKER; unchanged by B1.1)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ci_statistics(p_user_id uuid)
 RETURNS TABLE(total_leads bigint, not_started bigint, pending bigint, processing bigint, completed bigint, failed bigint, skipped bigint, completion_percentage numeric, avg_processing_seconds numeric, last_completed_at timestamp with time zone, actively_processing boolean)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
WITH stats AS (
  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE ci_enrichment_status IS NULL OR ci_enrichment_status = 'not_generated') as not_started,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'pending') as pending,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'processing') as processing,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'completed') as completed,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'failed') as failed,
    COUNT(*) FILTER (WHERE ci_enrichment_status = 'skipped') as skipped,
    COUNT(*) FILTER (WHERE ci_enrichment_status IN ('processing', 'pending')) as in_progress
  FROM leads
  WHERE user_id = p_user_id
),
completed_stats AS (
  SELECT
    ROUND(AVG(EXTRACT(EPOCH FROM (ci_completed_at - ci_started_at))))::NUMERIC as avg_seconds,
    MAX(ci_completed_at) as last_completed
  FROM leads
  WHERE user_id = p_user_id
    AND ci_enrichment_status = 'completed'
    AND ci_started_at IS NOT NULL
    AND ci_completed_at IS NOT NULL
)
SELECT
  stats.total as total_leads,
  stats.not_started,
  stats.pending,
  stats.processing,
  stats.completed,
  stats.failed,
  stats.skipped,
  CASE
    WHEN (stats.completed + stats.failed + stats.skipped + stats.pending + stats.processing) = 0 THEN 0
    ELSE ROUND((stats.completed::NUMERIC / (stats.completed + stats.failed + stats.skipped + stats.pending + stats.processing)) * 100)
  END as completion_percentage,
  cs.avg_seconds as avg_processing_seconds,
  cs.last_completed as last_completed_at,
  (stats.in_progress > 0) as actively_processing
FROM stats
CROSS JOIN completed_stats cs;
$function$;

CREATE OR REPLACE FUNCTION public.audit_ci_queue_consistency(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_leads_needing_ci bigint, leads_with_queue_entry bigint, leads_without_queue_entry bigint, consistency_status text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    AND EXISTS (
      SELECT 1 FROM commercial_intelligence_queue q
      WHERE q.lead_id = l.id
    );

  v_without_entry := v_total - v_with_entry;
  v_status := CASE WHEN v_without_entry = 0 THEN 'CONSISTENT' ELSE 'CORRUPTED' END;

  RETURN QUERY SELECT v_total, v_with_entry, v_without_entry, v_status;
END;
$function$;

-- Production ACLs for these two: executable by authenticated and service_role only.
REVOKE EXECUTE ON FUNCTION public.get_ci_statistics(uuid), public.audit_ci_queue_consistency(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ci_statistics(uuid), public.audit_ci_queue_consistency(uuid) TO authenticated, service_role;
