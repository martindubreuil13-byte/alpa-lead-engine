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

CREATE OR REPLACE FUNCTION public.begin_guest_profile(p_id uuid, p_lead text, p_run uuid, p_max integer DEFAULT 25, p_max_attempts integer DEFAULT 40, p_daily_max integer DEFAULT 1000)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.guest_trials; el jsonb; idx integer; made integer; day_key text; day_used integer;
begin
 if p_lead is null or length(p_lead) > 100 or p_max < 1 or p_max > 25 or p_max_attempts < 1 or p_max_attempts > 100 or p_daily_max < 1 or p_daily_max > 5000 then return 'not_found'; end if;
 select * into t from public.guest_trials where id = p_id for update;
 if not found or t.created_at < now() - interval '30 days' then return 'expired'; end if;
 select x.e, x.ord - 1 into el, idx from jsonb_array_elements(t.leads) with ordinality as x(e, ord) where x.e->>'id' = p_lead limit 1;
 if el is null then return 'not_found'; end if;
 if jsonb_typeof(el->'light_profile') = 'object' then return 'cached'; end if;
 if jsonb_typeof(el->'profile_claim') = 'object' and (el->'profile_claim'->>'until')::timestamptz > now() then return 'busy'; end if;
 select count(*) into made from jsonb_array_elements(t.leads) e where jsonb_typeof(e->'light_profile') = 'object';
 if made >= p_max or t.profile_attempts >= p_max_attempts then return 'limit'; end if;
 day_key := 'profile-day:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
 insert into public.guest_trial_rate_limits(bucket) values (day_key) on conflict do nothing;
 select attempts into day_used from public.guest_trial_rate_limits where bucket = day_key for update;
 if day_used >= p_daily_max then return 'budget'; end if;
 update public.guest_trial_rate_limits set attempts = attempts + 1 where bucket = day_key;
 update public.guest_trials
    set leads = jsonb_set(leads, array[idx::text], el || jsonb_build_object('profile_claim', jsonb_build_object('run', p_run, 'until', now() + interval '45 seconds'))),
        profile_attempts = profile_attempts + 1
  where id = p_id;
 return 'claimed';
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_ci_research_run(p_run_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.ci_research_runs%ROWTYPE;
  v_closed integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ci_run:' || p_run_id::text, 0));
  SELECT * INTO v_run FROM public.ci_research_runs WHERE run_id = p_run_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ci_research_runs SET status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()) WHERE run_id = p_run_id;
  UPDATE public.commercial_intelligence_queue
  SET status = 'failed', completed_at = now(), claim_token = NULL, last_error = 'cancelled by customer'
  WHERE run_id = p_run_id AND status = 'pending';
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN jsonb_build_object('run_id', p_run_id, 'status', 'cancelled', 'closed', v_closed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_ci_queue_items(p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, lead_id uuid, retry_count integer, max_retries integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate_rows AS (
    SELECT q.id
    FROM public.commercial_intelligence_queue q
    WHERE q.status = 'pending'
      AND q.user_id = auth.uid()
      AND q.claim_token IS NULL
      AND (q.last_retry_at IS NULL OR NOW() >= q.last_retry_at + INTERVAL '60 seconds')
      AND q.retry_count < q.max_retries
    ORDER BY q.created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
    FOR UPDATE SKIP LOCKED
  ),
  updated_rows AS (
    UPDATE public.commercial_intelligence_queue q
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

CREATE OR REPLACE FUNCTION public.complete_ci_enrichment(p_queue_id uuid, p_lead_id uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb, p_success boolean, p_error_msg text)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_retry_count integer;
  v_max_retries integer;
BEGIN
  BEGIN
    -- Only the caller's own job that is still being processed can be completed (a repeat or late
    -- completion cannot overwrite a newer outcome).
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

CREATE OR REPLACE FUNCTION public.complete_ci_run_item(p_queue_id uuid, p_lead_id uuid, p_claim_token uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb, p_success boolean, p_error_msg text, p_actual_cost_usd numeric DEFAULT 0)
 RETURNS TABLE(success boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt integer;
  v_ok boolean;
  v_result record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;

  SELECT q.retry_count INTO v_attempt
  FROM public.commercial_intelligence_queue q
  WHERE q.id = p_queue_id AND q.lead_id = p_lead_id AND q.status = 'processing' AND q.claim_token = p_claim_token AND q.run_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'claim_lost'::text;
    RETURN;
  END IF;

  v_ok := coalesce(p_success, false)
          AND nullif(btrim(coalesce(p_profile ->> 'summary', '')), '') IS NOT NULL
          AND p_snapshot IS NOT NULL AND p_signals IS NOT NULL;

  SELECT * INTO v_result FROM public.complete_ci_enrichment_worker(
    p_queue_id, p_lead_id, p_claim_token,
    CASE WHEN v_ok THEN p_snapshot END, CASE WHEN v_ok THEN p_signals END, CASE WHEN v_ok THEN p_profile END,
    v_ok,
    CASE WHEN v_ok THEN NULL WHEN coalesce(p_success, false) THEN 'Research finished without a usable business profile' ELSE p_error_msg END
  );

  IF v_result.success THEN
    UPDATE public.ci_research_charges c
    SET state = 'settled', settled_at = now(),
        actual_usd = least(greatest(coalesce(p_actual_cost_usd, 0), 0), c.reserved_usd * 10)
    WHERE c.queue_id = p_queue_id AND c.attempt = v_attempt AND c.state = 'reserved';
  END IF;

  RETURN QUERY SELECT v_result.success, v_result.message;
END;
$function$;

CREATE OR REPLACE FUNCTION public.configure_alpa_ci_worker_schedule()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'cron', 'net', 'vault'
AS $function$
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

CREATE OR REPLACE FUNCTION public.finish_guest_profile(p_id uuid, p_lead text, p_run uuid, p_profile jsonb, p_max integer DEFAULT 25)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.guest_trials; el jsonb; idx integer; made integer;
begin
 if jsonb_typeof(p_profile) is distinct from 'object' or pg_column_size(p_profile) > 4000 then return false; end if;
 select * into t from public.guest_trials where id = p_id for update;
 if not found then return false; end if;
 select x.e, x.ord - 1 into el, idx from jsonb_array_elements(t.leads) with ordinality as x(e, ord) where x.e->>'id' = p_lead limit 1;
 if el is null or (el->'profile_claim'->>'run') is distinct from p_run::text then return false; end if;
 select count(*) into made from jsonb_array_elements(t.leads) e where jsonb_typeof(e->'light_profile') = 'object';
 if made >= p_max then return false; end if;
 update public.guest_trials set leads = jsonb_set(leads, array[idx::text], (el - 'profile_claim') || jsonb_build_object('light_profile', p_profile)) where id = p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.finish_guest_trial(p_id uuid, p_run uuid, p_reserved integer, p_leads jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.guest_trials; n integer;
begin
 select * into t from public.guest_trials where id=p_id for update;
 if not found or t.active_run is distinct from p_run then return false; end if;
 n := jsonb_array_length(p_leads);
 if n > p_reserved or p_reserved < 1 or p_reserved > 25 then return false; end if;
 update public.guest_trials set leads=leads || p_leads, used=used-p_reserved+n,
 active_run=null, active_until=null where id=p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.get_ci_research_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ctl public.ci_research_controls%ROWTYPE;
  v_month timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ctl FROM public.ci_research_controls WHERE id;
  RETURN jsonb_build_object(
    'enabled', coalesce(v_ctl.enabled, false),
    'budgets_configured', v_ctl.per_job_reserve_usd IS NOT NULL AND v_ctl.per_profile_ceiling_usd IS NOT NULL AND v_ctl.per_run_cap_usd IS NOT NULL
                          AND v_ctl.per_lead_monthly_usd IS NOT NULL AND v_ctl.global_monthly_limit_usd IS NOT NULL AND v_ctl.max_leads_per_run IS NOT NULL,
    'limits', jsonb_build_object('per_job_reserve_usd', v_ctl.per_job_reserve_usd, 'per_profile_ceiling_usd', v_ctl.per_profile_ceiling_usd,
      'per_run_cap_usd', v_ctl.per_run_cap_usd, 'per_lead_monthly_usd', v_ctl.per_lead_monthly_usd,
      'global_monthly_limit_usd', v_ctl.global_monthly_limit_usd, 'per_user_concurrency', v_ctl.per_user_concurrency,
      'max_attempts', v_ctl.max_attempts, 'run_ttl_hours', v_ctl.run_ttl_hours, 'max_leads_per_run', v_ctl.max_leads_per_run),
    'access', jsonb_build_object('allow_all_customers', v_ctl.allow_all_customers, 'allowed_customers', cardinality(v_ctl.allowed_user_ids)),
    'month_spent_usd', (SELECT coalesce(sum(coalesce(actual_usd, reserved_usd)), 0) FROM public.ci_research_charges WHERE created_at >= v_month),
    'active_runs', (SELECT count(*) FROM public.ci_research_runs WHERE status = 'active' AND expires_at > now()),
    'queued_jobs', (SELECT count(*) FROM public.commercial_intelligence_queue q JOIN public.ci_research_runs r ON r.run_id = q.run_id
                    WHERE q.status = 'pending' AND r.status = 'active' AND r.expires_at > now()),
    'processing_jobs', (SELECT count(*) FROM public.commercial_intelligence_queue WHERE run_id IS NOT NULL AND status = 'processing'),
    'updated_at', v_ctl.updated_at, 'updated_by', v_ctl.updated_by
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ci_run_progress(p_run_id uuid)
 RETURNS TABLE(lead_id uuid, state text, retry_count integer, last_error text, run_status text, expires_at timestamp with time zone, queued_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT rl.lead_id,
         CASE
           WHEN rl.initial_state = 'unavailable_no_website' THEN 'unavailable'
           WHEN rl.initial_state IN ('skipped_existing', 'skipped_limit') THEN 'unavailable'
           WHEN q.id IS NULL THEN 'queued'
           WHEN q.status = 'completed' AND nullif(btrim(coalesce(l.commercial_profile ->> 'summary', '')), '') IS NOT NULL THEN 'ready'
           WHEN q.status = 'completed' THEN 'unavailable'
           WHEN q.status = 'processing' THEN 'researching'
           WHEN q.status = 'pending' AND q.retry_count > 0 THEN 'retry_pending'
           WHEN q.status = 'pending' THEN 'queued'
           WHEN q.status = 'failed' AND q.last_error ILIKE 'cancelled%' THEN 'cancelled'
           WHEN q.status = 'failed' AND l.website_snapshot IS NOT NULL
                AND nullif(btrim(coalesce(l.commercial_profile ->> 'summary', '')), '') IS NULL THEN 'partial'
           WHEN q.status = 'failed' THEN 'failed'
           ELSE 'queued'
         END AS state,
         coalesce(q.retry_count, 0), q.last_error, ru.status, ru.expires_at, q.created_at
  FROM public.ci_research_run_leads rl
  JOIN public.ci_research_runs ru ON ru.run_id = rl.run_id
  LEFT JOIN public.commercial_intelligence_queue q ON q.lead_id = rl.lead_id AND q.run_id = rl.run_id
  LEFT JOIN public.leads l ON l.id = rl.lead_id
  WHERE rl.run_id = p_run_id AND ru.user_id = auth.uid();
$function$;

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
