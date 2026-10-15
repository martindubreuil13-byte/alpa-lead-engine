CREATE OR REPLACE FUNCTION public.authorize_ci_research_run(p_run_id uuid, p_user_id uuid, p_plan_leads_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ctl public.ci_research_controls%ROWTYPE;
  v_run public.ci_research_runs%ROWTYPE;
  v_receipt public.discover_save_receipts%ROWTYPE;
  v_site_ids uuid[];
  v_nosite_ids uuid[];
  v_limit_ids uuid[];
  v_all_site_ids uuid[];
  v_budget numeric;
  v_queued integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_user_id IS NULL OR p_plan_leads_limit IS NULL OR p_plan_leads_limit < 1 THEN
    RAISE EXCEPTION 'Invalid authorization request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ci_run:' || p_run_id::text, 0));

  -- Idempotent: the same run authorizes once. Another customer's run is refused.
  SELECT * INTO v_run FROM public.ci_research_runs WHERE run_id = p_run_id;
  IF FOUND THEN
    IF v_run.user_id <> p_user_id THEN
      RAISE EXCEPTION 'No confirmed save for this run and customer' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('run_id', v_run.run_id, 'already', true, 'status', v_run.status, 'saved', v_run.saved_count,
      'queued', v_run.queued_count, 'budget_limit_usd', v_run.budget_limit_usd, 'expires_at', v_run.expires_at);
  END IF;

  -- Only a run whose atomic save was confirmed, for this customer, can be authorized.
  SELECT * INTO v_receipt FROM public.discover_save_receipts WHERE run_id = p_run_id;
  IF NOT FOUND OR v_receipt.user_id <> p_user_id THEN
    RAISE EXCEPTION 'No confirmed save for this run and customer' USING ERRCODE = '42501';
  END IF;

  -- Fail closed: no configured budget, no authorization.
  SELECT * INTO v_ctl FROM public.ci_research_controls WHERE id;
  IF NOT FOUND OR v_ctl.per_job_reserve_usd IS NULL OR v_ctl.per_profile_ceiling_usd IS NULL OR v_ctl.per_run_cap_usd IS NULL
     OR v_ctl.per_lead_monthly_usd IS NULL OR v_ctl.global_monthly_limit_usd IS NULL OR v_ctl.max_leads_per_run IS NULL THEN
    RAISE EXCEPTION 'Research budgets are not configured' USING ERRCODE = '55000';
  END IF;
  -- Owner-only (or any chosen set of customers): everyone else is simply not authorized.
  IF NOT (v_ctl.allow_all_customers OR p_user_id = ANY (v_ctl.allowed_user_ids)) THEN
    RAISE EXCEPTION 'Research is not enabled for this customer' USING ERRCODE = '42501';
  END IF;

  -- The exact set: ids the receipt confirms as saved (in the receipt's order) that really belong to this customer.
  -- Businesses with a website are authorized up to max_leads_per_run; the rest of the run is recorded, never queued.
  SELECT coalesce(array_agg(m.id ORDER BY m.ord) FILTER (WHERE m.has_site), '{}'),
         coalesce(array_agg(m.id ORDER BY m.ord) FILTER (WHERE NOT m.has_site), '{}')
  INTO v_all_site_ids, v_nosite_ids
  FROM (
    SELECT l.id, s.ord, (nullif(btrim(coalesce(l.website, '')), '') IS NOT NULL) AS has_site
    FROM jsonb_array_elements(v_receipt.result->'outcomes') WITH ORDINALITY AS s(o, ord)
    JOIN public.leads l ON l.id = (s.o->>'id')::uuid AND l.user_id = p_user_id
    WHERE s.o->>'status' = 'saved' AND s.o->>'id' IS NOT NULL
  ) m;
  v_site_ids := v_all_site_ids[1:v_ctl.max_leads_per_run];
  v_limit_ids := coalesce(v_all_site_ids[v_ctl.max_leads_per_run + 1:], '{}');
  v_site_ids := coalesce(v_site_ids, '{}');

  v_budget := least(v_ctl.per_run_cap_usd, cardinality(v_site_ids) * v_ctl.per_profile_ceiling_usd);

  INSERT INTO public.ci_research_runs (run_id, user_id, saved_count, queued_count, budget_limit_usd, customer_month_limit_usd,
                                       max_attempts, expires_at)
  VALUES (p_run_id, p_user_id, cardinality(v_site_ids) + cardinality(v_nosite_ids) + cardinality(v_limit_ids), 0, v_budget,
          p_plan_leads_limit * v_ctl.per_lead_monthly_usd, v_ctl.max_attempts, now() + make_interval(hours => v_ctl.run_ttl_hours))
  RETURNING * INTO v_run;

  INSERT INTO public.ci_research_run_leads (run_id, lead_id, user_id, initial_state)
  SELECT p_run_id, i, p_user_id, 'queued' FROM unnest(v_site_ids) AS i
  UNION ALL
  SELECT p_run_id, i, p_user_id, 'unavailable_no_website' FROM unnest(v_nosite_ids) AS i
  UNION ALL
  SELECT p_run_id, i, p_user_id, 'skipped_limit' FROM unnest(v_limit_ids) AS i;

  -- Jobs only for the exact set. A lead that already has an active job keeps it: it is never adopted or modified.
  WITH inserted AS (
    INSERT INTO public.commercial_intelligence_queue (lead_id, user_id, status, retry_count, max_retries, run_id, worker_eligible)
    SELECT i, p_user_id, 'pending', 0, v_ctl.max_attempts, p_run_id, false FROM unnest(v_site_ids) AS i
    ON CONFLICT DO NOTHING
    RETURNING lead_id
  )
  SELECT count(*) INTO v_queued FROM inserted;

  UPDATE public.ci_research_run_leads rl
  SET initial_state = 'skipped_existing'
  WHERE rl.run_id = p_run_id AND rl.initial_state = 'queued'
    AND NOT EXISTS (SELECT 1 FROM public.commercial_intelligence_queue q WHERE q.lead_id = rl.lead_id AND q.run_id = p_run_id);

  UPDATE public.ci_research_runs SET queued_count = v_queued WHERE run_id = p_run_id RETURNING * INTO v_run;

  RETURN jsonb_build_object('run_id', v_run.run_id, 'already', false, 'status', v_run.status, 'saved', v_run.saved_count,
    'queued', v_run.queued_count, 'budget_limit_usd', v_run.budget_limit_usd, 'expires_at', v_run.expires_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_ci_run_items(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, lead_id uuid, user_id uuid, run_id uuid, retry_count integer, max_retries integer, claim_token uuid, reserved_usd numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_ctl public.ci_research_controls%ROWTYPE;
  v_row public.commercial_intelligence_queue%ROWTYPE;
  v_run public.ci_research_runs%ROWTYPE;
  v_candidate record;
  v_limit integer;
  v_month timestamptz;
  v_global numeric;
  v_profile numeric;
  v_run_used numeric;
  v_user_used numeric;
  v_active integer;
  v_claimed integer := 0;
  v_token uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;

  -- Claims are serialized: budget checks and reservations never race each other.
  PERFORM pg_advisory_xact_lock(hashtextextended('ci_budget', 0));

  SELECT * INTO v_ctl FROM public.ci_research_controls WHERE ci_research_controls.id;
  -- The operator switch lives here, so even a direct call cannot claim while it is off. Missing limit = fail closed.
  IF NOT FOUND OR NOT v_ctl.enabled THEN RETURN; END IF;
  IF v_ctl.per_job_reserve_usd IS NULL OR v_ctl.per_profile_ceiling_usd IS NULL OR v_ctl.global_monthly_limit_usd IS NULL THEN RETURN; END IF;

  v_limit := least(greatest(coalesce(p_limit, 1), 1), 20);
  v_month := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  SELECT coalesce(sum(coalesce(c.actual_usd, c.reserved_usd)), 0) INTO v_global FROM public.ci_research_charges c WHERE c.created_at >= v_month;

  -- Candidates: pending jobs of authorized, unexpired, uncancelled runs of the SAME customer, and only for leads the run
  -- covers. Ordered one-per-customer first (round robin), so one large customer cannot starve the others.
  FOR v_candidate IN
    SELECT q.id AS queue_id,
           row_number() OVER (PARTITION BY q.user_id ORDER BY q.created_at, q.id) AS turn,
           q.created_at AS created_at
    FROM public.commercial_intelligence_queue q
    JOIN public.ci_research_runs ru ON ru.run_id = q.run_id AND ru.user_id = q.user_id
    WHERE q.run_id IS NOT NULL
      AND q.status = 'pending'
      AND q.claim_token IS NULL
      AND ru.status = 'active'
      AND ru.expires_at > now()
      AND (v_ctl.allow_all_customers OR ru.user_id = ANY (v_ctl.allowed_user_ids))
      AND q.retry_count < q.max_retries
      AND (q.last_retry_at IS NULL OR now() >= q.last_retry_at + interval '60 seconds')
      AND EXISTS (SELECT 1 FROM public.ci_research_run_leads rl WHERE rl.run_id = q.run_id AND rl.lead_id = q.lead_id AND rl.user_id = q.user_id)
    ORDER BY turn, created_at
    LIMIT v_limit * 5
  LOOP
    EXIT WHEN v_claimed >= v_limit;

    SELECT * INTO v_row FROM public.commercial_intelligence_queue q
    WHERE q.id = v_candidate.queue_id AND q.status = 'pending' AND q.claim_token IS NULL
    FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    SELECT * INTO v_run FROM public.ci_research_runs ru WHERE ru.run_id = v_row.run_id;

    -- concurrency per customer: jobs running now, including the ones this very call has already claimed
    SELECT count(*) INTO v_active FROM public.commercial_intelligence_queue p
    WHERE p.user_id = v_row.user_id AND p.run_id IS NOT NULL AND p.status = 'processing';
    CONTINUE WHEN v_active >= v_ctl.per_user_concurrency;

    -- ceiling for everything spent on this one profile (bounds retries)
    SELECT coalesce(sum(coalesce(c.actual_usd, c.reserved_usd)), 0) INTO v_profile FROM public.ci_research_charges c WHERE c.queue_id = v_row.id;
    IF v_profile + v_ctl.per_job_reserve_usd > v_ctl.per_profile_ceiling_usd THEN
      UPDATE public.commercial_intelligence_queue SET status = 'failed', completed_at = now(), claim_token = NULL, last_error = 'profile_budget_exhausted' WHERE id = v_row.id;
      UPDATE public.leads SET ci_enrichment_status = 'failed', ci_last_error = 'profile_budget_exhausted' WHERE id = v_row.lead_id;
      CONTINUE;
    END IF;

    -- budget of this run
    SELECT coalesce(sum(coalesce(c.actual_usd, c.reserved_usd)), 0) INTO v_run_used FROM public.ci_research_charges c WHERE c.run_id = v_row.run_id;
    IF v_run_used + v_ctl.per_job_reserve_usd > v_run.budget_limit_usd THEN
      UPDATE public.commercial_intelligence_queue SET status = 'failed', completed_at = now(), claim_token = NULL, last_error = 'run_budget_exhausted' WHERE id = v_row.id;
      UPDATE public.leads SET ci_enrichment_status = 'failed', ci_last_error = 'run_budget_exhausted' WHERE id = v_row.lead_id;
      CONTINUE;
    END IF;

    -- this customer's monthly research budget (waits, does not fail: it resets next month or the run expires)
    SELECT coalesce(sum(coalesce(c.actual_usd, c.reserved_usd)), 0) INTO v_user_used
    FROM public.ci_research_charges c WHERE c.user_id = v_row.user_id AND c.created_at >= v_month;
    CONTINUE WHEN v_user_used + v_ctl.per_job_reserve_usd > v_run.customer_month_limit_usd;

    -- global monthly budget: stop claiming for everyone
    IF v_global + v_ctl.per_job_reserve_usd > v_ctl.global_monthly_limit_usd THEN EXIT; END IF;

    -- one reservation per job and attempt: a repeat is refused, never double-counted
    INSERT INTO public.ci_research_charges (queue_id, attempt, run_id, user_id, reserved_usd)
    VALUES (v_row.id, v_row.retry_count, v_row.run_id, v_row.user_id, v_ctl.per_job_reserve_usd)
    ON CONFLICT (queue_id, attempt) DO NOTHING;
    CONTINUE WHEN NOT FOUND;

    v_token := gen_random_uuid();
    UPDATE public.commercial_intelligence_queue SET status = 'processing', started_at = now(), claim_token = v_token WHERE id = v_row.id;

    v_global := v_global + v_ctl.per_job_reserve_usd;
    v_claimed := v_claimed + 1;

    id := v_row.id; lead_id := v_row.lead_id; user_id := v_row.user_id; run_id := v_row.run_id;
    retry_count := v_row.retry_count; max_retries := v_row.max_retries; claim_token := v_token; reserved_usd := v_ctl.per_job_reserve_usd;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_discover_capacity(p_user_id uuid, p_leads_limit integer, p_monthly boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_usage public.usage%ROWTYPE;
  v_used integer;
  v_now timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_leads_limit IS NULL OR p_leads_limit < 0 OR p_monthly IS NULL THEN
    RAISE EXCEPTION 'Invalid capacity request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('discover:' || p_user_id::text, 0));
  -- A waiting transaction may have started before the winning transaction created the period.
  v_now := clock_timestamp();
  IF p_monthly THEN
    SELECT * INTO v_usage FROM public.usage
    WHERE user_id = p_user_id AND period_start <= v_now AND period_end >= v_now
    ORDER BY period_start DESC, id DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.usage(user_id, leads_used, leads_limit, period_start, period_end)
      VALUES(p_user_id, 0, p_leads_limit, v_now, date_trunc('month', v_now) + interval '1 month' + (v_now - date_trunc('month', v_now)))
      RETURNING * INTO v_usage;
    ELSIF v_usage.leads_limit IS DISTINCT FROM p_leads_limit THEN
      UPDATE public.usage SET leads_limit = p_leads_limit WHERE id = v_usage.id
      RETURNING * INTO v_usage;
    END IF;
    IF v_usage.leads_used IS NULL OR v_usage.leads_used < 0 THEN
      RAISE EXCEPTION 'Invalid stored usage';
    END IF;
    RETURN jsonb_build_object('leads_used', v_usage.leads_used, 'leads_limit', p_leads_limit,
      'current_period_end', v_usage.period_end, 'usage_id', v_usage.id);
  END IF;
  SELECT count(*) INTO v_used FROM public.leads
  WHERE user_id = p_user_id AND (email IS NOT NULL OR phone IS NOT NULL);
  RETURN jsonb_build_object('leads_used', v_used, 'leads_limit', p_leads_limit, 'current_period_end', NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ci_queue_user_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Server code (service role) and the database's own functions (running as their owner) are not
  -- restricted; only direct writes from customer sessions are.
  IF current_user IN ('anon', 'authenticated') AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'research queue rows cannot be modified directly'
        USING ERRCODE = '42501';
    END IF;

    -- INSERT: a plain request to research one of the caller's own leads, nothing else.
    IF NEW.status IS DISTINCT FROM 'pending'
       OR NEW.retry_count IS DISTINCT FROM 0
       OR NEW.max_retries IS DISTINCT FROM 3
       OR NEW.claim_token IS NOT NULL
       OR NEW.worker_eligible IS TRUE
       OR NEW.started_at IS NOT NULL
       OR NEW.completed_at IS NOT NULL
       OR NEW.last_retry_at IS NOT NULL
       OR NEW.last_error IS NOT NULL
       OR NEW.processing_duration_ms IS NOT NULL
       OR COALESCE(NEW.total_cost, 0) <> 0
       -- the database's own clock only: a backdated created_at would jump the FIFO order
       OR NEW.created_at IS DISTINCT FROM now()
       OR NEW.updated_at IS DISTINCT FROM now()
       -- run ids are assigned by trusted server code; a customer cannot join or fake a run
       OR NEW.run_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'research queue rows can only be requested, not preset'
        USING ERRCODE = '42501';
    END IF;

    -- Evaluated with the caller's own row-level security: only the caller's leads are visible.
    IF NOT EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = NEW.lead_id AND l.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'research can only be requested for your own leads'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ci_queue_worker_eligible()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

CREATE OR REPLACE FUNCTION public.guard_leads_research_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only direct writes from customer sessions are restricted.
  IF current_user IN ('anon', 'authenticated') AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.ci_enrichment_status IS DISTINCT FROM OLD.ci_enrichment_status
         OR NEW.ci_started_at IS DISTINCT FROM OLD.ci_started_at
         OR NEW.ci_completed_at IS DISTINCT FROM OLD.ci_completed_at
         OR NEW.ci_last_error IS DISTINCT FROM OLD.ci_last_error
         OR NEW.ci_retry_count IS DISTINCT FROM OLD.ci_retry_count
         OR NEW.ci_processing_duration_ms IS DISTINCT FROM OLD.ci_processing_duration_ms
         OR NEW.ci_cost_estimate IS DISTINCT FROM OLD.ci_cost_estimate
         OR NEW.ci_model_versions IS DISTINCT FROM OLD.ci_model_versions
         OR NEW.website_snapshot IS DISTINCT FROM OLD.website_snapshot
         OR NEW.business_signals IS DISTINCT FROM OLD.business_signals
         OR NEW.commercial_profile IS DISTINCT FROM OLD.commercial_profile
      THEN
        RAISE EXCEPTION 'research state and results cannot be modified directly'
          USING ERRCODE = '42501';
      END IF;
    ELSIF
         NEW.ci_enrichment_status IS DISTINCT FROM 'pending'
         AND NEW.ci_enrichment_status IS NOT NULL
      OR NEW.ci_started_at IS NOT NULL
      OR NEW.ci_completed_at IS NOT NULL
      OR NEW.ci_last_error IS NOT NULL
      OR COALESCE(NEW.ci_retry_count, 0) <> 0
      OR NEW.ci_processing_duration_ms IS NOT NULL
      OR COALESCE(NEW.ci_cost_estimate, 0) <> 0
      OR (NEW.ci_model_versions IS NOT NULL
          AND NEW.ci_model_versions IS DISTINCT FROM '{"profile": "v1", "signals": "v1", "snapshot": "v1"}'::jsonb)
      OR NEW.website_snapshot IS NOT NULL
      OR NEW.business_signals IS NOT NULL
      OR NEW.commercial_profile IS NOT NULL
    THEN
      RAISE EXCEPTION 'a lead cannot be created with research state or results'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.increment_usage(p_usage_id uuid, p_count integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update usage
  set leads_used = leads_used + p_count
  where id = p_usage_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recover_ci_run_items(p_timeout_seconds integer DEFAULT 600)
 RETURNS TABLE(reset_count integer, failed_count integer, settled_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reset integer := 0;
  v_failed integer := 0;
  v_settled integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;

  WITH exhausted AS (
    UPDATE public.commercial_intelligence_queue
    SET status = 'failed', retry_count = retry_count + 1, last_retry_at = now(), completed_at = now(), started_at = NULL,
        claim_token = NULL, last_error = 'Research interrupted and attempts exhausted'
    WHERE run_id IS NOT NULL AND status = 'processing'
      AND started_at < now() - (greatest(p_timeout_seconds, 60) || ' seconds')::interval
      AND retry_count + 1 >= max_retries
    RETURNING lead_id
  )
  UPDATE public.leads l
  SET ci_enrichment_status = 'failed', ci_last_error = 'Research interrupted and attempts exhausted', ci_completed_at = NULL
  WHERE l.id IN (SELECT lead_id FROM exhausted);
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  UPDATE public.commercial_intelligence_queue
  SET status = 'pending', retry_count = retry_count + 1, last_retry_at = now(), started_at = NULL, completed_at = NULL,
      claim_token = NULL, last_error = 'Research interrupted; scheduled for retry'
  WHERE run_id IS NOT NULL AND status = 'processing'
    AND started_at < now() - (greatest(p_timeout_seconds, 60) || ' seconds')::interval
    AND retry_count + 1 < max_retries;
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  UPDATE public.ci_research_charges c
  SET state = 'settled', settled_at = now(), actual_usd = c.reserved_usd
  WHERE c.state = 'reserved'
    AND NOT EXISTS (SELECT 1 FROM public.commercial_intelligence_queue q WHERE q.id = c.queue_id AND q.status = 'processing' AND q.retry_count = c.attempt);
  GET DIAGNOSTICS v_settled = ROW_COUNT;

  RETURN QUERY SELECT v_reset, v_failed, v_settled;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_guest_profile(p_id uuid, p_lead text, p_run uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.guest_trials; el jsonb; idx integer;
begin
 select * into t from public.guest_trials where id = p_id for update;
 if not found then return false; end if;
 select x.e, x.ord - 1 into el, idx from jsonb_array_elements(t.leads) with ordinality as x(e, ord) where x.e->>'id' = p_lead limit 1;
 if el is null or (el->'profile_claim'->>'run') is distinct from p_run::text then return false; end if;
 update public.guest_trials set leads = jsonb_set(leads, array[idx::text], el - 'profile_claim') where id = p_id;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.reserve_guest_trial(p_id uuid, p_bucket text, p_count integer, p_run uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.guest_trials; n integer; a integer;
begin
 if p_count < 1 or p_count > 25 or length(p_bucket) > 100 then return 0; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_bucket, 0));
 select * into t from public.guest_trials where id=p_id for update;
 if not found or t.created_at < now()-interval '30 days' or t.attempts >= 3 or t.used >= 25
 or (t.active_run is not null and t.active_until > now()) then return 0; end if;
 insert into public.guest_trial_rate_limits(bucket) values(p_bucket) on conflict do nothing;
 select attempts into a from public.guest_trial_rate_limits where bucket=p_bucket;
 if a >= 6 then return 0; end if;
 n := least(p_count, 25-t.used);
 update public.guest_trial_rate_limits set attempts=attempts+1 where bucket=p_bucket;
 update public.guest_trials set used=used+n, attempts=attempts+1, active_run=p_run,
 active_until=now()+interval '6 minutes' where id=p_id;
 return n;
end $function$;

CREATE OR REPLACE FUNCTION public.reset_stale_ci_processing(p_timeout_seconds integer DEFAULT 300)
 RETURNS TABLE(reset_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reset_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;

  -- An interrupted job is a failed attempt: out of retries means failed, not "reset forever".
  WITH exhausted AS (
    UPDATE public.commercial_intelligence_queue
    SET status = 'failed', retry_count = retry_count + 1, last_retry_at = NOW(),
        completed_at = NOW(), started_at = NULL,
        last_error = 'Processing interrupted and retry limit reached'
    WHERE user_id = auth.uid()
      AND status = 'processing'
      AND claim_token IS NULL
      AND started_at < NOW() - (GREATEST(p_timeout_seconds, 60) || ' seconds')::interval
      AND retry_count + 1 >= max_retries
    RETURNING lead_id
  )
  UPDATE public.leads l
  SET ci_enrichment_status = 'failed',
      ci_last_error = 'Processing interrupted and retry limit reached',
      ci_completed_at = NULL,
      ci_retry_count = COALESCE(l.ci_retry_count, 0) + 1
  WHERE l.user_id = auth.uid() AND l.id IN (SELECT lead_id FROM exhausted);

  UPDATE public.commercial_intelligence_queue
  SET status = 'pending', retry_count = retry_count + 1, last_retry_at = NOW(),
      started_at = NULL, completed_at = NULL,
      last_error = 'Processing interrupted; scheduled for retry'
  WHERE user_id = auth.uid()
    AND status = 'processing'
    AND claim_token IS NULL
    AND started_at < NOW() - (GREATEST(p_timeout_seconds, 60) || ' seconds')::interval
    AND retry_count + 1 < max_retries;
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  RETURN QUERY SELECT v_reset_count;
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

CREATE OR REPLACE FUNCTION public.save_discover_results(p_run_id uuid, p_user_id uuid, p_leads_limit integer, p_monthly boolean, p_leads jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_hash text;
  v_receipt public.discover_save_receipts%ROWTYPE;
  v_capacity jsonb;
  v_usage_id uuid;
  v_used integer;
  v_item jsonb;
  v_lead public.leads%ROWTYPE;
  v_id uuid;
  v_status text;
  v_index integer := 0;
  v_added integer := 0;
  v_outcomes jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_user_id IS NULL OR p_leads IS NULL OR jsonb_typeof(p_leads) <> 'array' THEN
    RAISE EXCEPTION 'Invalid save request' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_leads) > 50 THEN
    RAISE EXCEPTION 'Save batch exceeds Discover limit' USING ERRCODE = '22023';
  END IF;
  -- Same owner lock is used for period creation, capacity recheck and every batch commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('discover:' || p_user_id::text, 0));
  v_hash := md5(jsonb_build_object('user', p_user_id, 'limit', p_leads_limit,
    'monthly', p_monthly, 'leads', p_leads)::text);
  SELECT * INTO v_receipt FROM public.discover_save_receipts WHERE run_id = p_run_id;
  IF FOUND THEN
    IF v_receipt.user_id <> p_user_id OR v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'Save reference reused with different input' USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.result;
  END IF;
  v_capacity := public.get_discover_capacity(p_user_id, p_leads_limit, p_monthly);
  v_used := (v_capacity->>'leads_used')::integer;
  IF p_monthly THEN
    v_usage_id := (v_capacity->>'usage_id')::uuid;
    IF v_usage_id IS NULL THEN RAISE EXCEPTION 'Usage period was not confirmed'; END IF;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_leads) LOOP
    v_id := NULL;
    v_status := 'invalid';
    IF jsonb_typeof(v_item) <> 'object' OR nullif(btrim(v_item->>'company_name'), '') IS NULL OR
       (nullif(btrim(v_item->>'email'), '') IS NULL AND nullif(btrim(v_item->>'phone'), '') IS NULL) THEN
      v_status := 'invalid';
    ELSIF EXISTS (
      SELECT 1 FROM public.leads existing WHERE existing.user_id = p_user_id
      AND lower(regexp_replace(btrim(existing.company_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(btrim(v_item->>'company_name'), '\s+', ' ', 'g'))
      AND lower(btrim(coalesce(existing.city, ''))) = lower(btrim(coalesce(v_item->>'city', '')))
      AND (
        (nullif(btrim(v_item->>'email'), '') IS NOT NULL AND
          lower(btrim(existing.email)) = lower(btrim(v_item->>'email')))
        OR (nullif(regexp_replace(v_item->>'phone', '\D', '', 'g'), '') IS NOT NULL AND
          regexp_replace(existing.phone, '\D', '', 'g') = regexp_replace(v_item->>'phone', '\D', '', 'g'))
        OR (nullif(btrim(v_item->>'website'), '') IS NOT NULL AND
          regexp_replace(regexp_replace(lower(btrim(existing.website)), '^https?://(www\.)?', ''), '/+$', '') =
          regexp_replace(regexp_replace(lower(btrim(v_item->>'website')), '^https?://(www\.)?', ''), '/+$', ''))
      )
    ) THEN
      -- Production has no business UNIQUE constraint. Check identity inside the owner lock.
      -- Require matching name and location plus contact/site evidence; never modify the older lead.
      v_status := 'duplicate';
    ELSIF v_used >= p_leads_limit THEN
      v_status := 'limit';
    ELSE
      BEGIN
        -- Populate typed values, but INSERT only an explicit allowlist. Owner/status/id cannot be overridden.
        v_lead := jsonb_populate_record(NULL::public.leads, v_item);
        v_id := gen_random_uuid();
        INSERT INTO public.leads(id, user_id, company_name, email, phone, website, city, industry,
          status, source, email_confidence, email_source, is_generic_email, cost_estimate)
        VALUES(v_id, p_user_id, btrim(v_lead.company_name), nullif(btrim(v_lead.email), ''),
          nullif(btrim(v_lead.phone), ''), v_lead.website, v_lead.city, v_lead.industry,
          'inbox', v_lead.source, v_lead.email_confidence, v_lead.email_source,
          coalesce(v_lead.is_generic_email, false), coalesce(v_lead.cost_estimate, 0));
        -- Older schemas lack this optional activity field. Match the existing insert behavior.
        IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.leads'::regclass
          AND attname = 'last_activity_at' AND NOT attisdropped) THEN
          EXECUTE 'UPDATE public.leads SET last_activity_at = $1 WHERE id = $2'
          USING now(), v_id;
        END IF;
        v_status := 'saved';
      EXCEPTION
        WHEN unique_violation THEN v_status := 'duplicate'; v_id := NULL;
        WHEN not_null_violation OR check_violation OR foreign_key_violation OR invalid_text_representation
          THEN v_status := 'invalid'; v_id := NULL;
        WHEN OTHERS THEN
          -- Infrastructure, permission, schema and unexpected trigger failures abort the whole batch.
          RAISE;
      END;
      IF v_status = 'saved' THEN v_used := v_used + 1; v_added := v_added + 1; END IF;
    END IF;
    v_outcomes := v_outcomes || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'status', v_status, 'id', v_id));
    v_index := v_index + 1;
  END LOOP;
  IF p_monthly AND v_added > 0 THEN
    -- Any failure here rolls back leads and receipt as well. Never persist an estimated counter.
    UPDATE public.usage SET leads_used = leads_used + v_added WHERE id = v_usage_id;
  END IF;
  v_result := jsonb_build_object('outcomes', v_outcomes, 'leads_used', v_used,
    'leads_limit', p_leads_limit, 'current_period_end', v_capacity->'current_period_end');
  INSERT INTO public.discover_save_receipts(run_id, user_id, request_hash, result)
  VALUES(p_run_id, p_user_id, v_hash, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ci_research_access(p_allow_all boolean, p_allowed_user_ids uuid[], p_operator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF p_allow_all IS NULL OR p_allowed_user_ids IS NULL OR nullif(btrim(coalesce(p_operator, '')), '') IS NULL THEN
    RAISE EXCEPTION 'allow_all, the customer list and an operator name are required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ci_research_controls
  SET allow_all_customers = p_allow_all, allowed_user_ids = p_allowed_user_ids, updated_at = now(), updated_by = p_operator
  WHERE id;
  INSERT INTO public.ci_research_control_log (operator, action, detail)
  VALUES (p_operator, 'set_access', jsonb_build_object('allow_all', p_allow_all, 'allowed_customers', cardinality(p_allowed_user_ids)));
  RETURN jsonb_build_object('allow_all', p_allow_all, 'allowed_customers', cardinality(p_allowed_user_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ci_research_enabled(p_enabled boolean, p_operator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL OR nullif(btrim(coalesce(p_operator, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An operator name is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ci_research_controls SET enabled = p_enabled, updated_at = now(), updated_by = p_operator WHERE id;
  INSERT INTO public.ci_research_control_log (operator, action, detail)
  VALUES (p_operator, CASE WHEN p_enabled THEN 'enable' ELSE 'disable' END, jsonb_build_object('enabled', p_enabled));
  RETURN jsonb_build_object('enabled', p_enabled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ci_research_limits(p_per_job_reserve_usd numeric, p_per_profile_ceiling_usd numeric, p_per_run_cap_usd numeric, p_per_lead_monthly_usd numeric, p_global_monthly_limit_usd numeric, p_max_leads_per_run integer, p_per_user_concurrency integer, p_max_attempts integer, p_run_ttl_hours integer, p_operator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_operator, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An operator name is required' USING ERRCODE = '22023';
  END IF;
  -- Every value is required: a limit is never silently left unset (an unset limit means "no research").
  IF p_per_job_reserve_usd IS NULL OR p_per_profile_ceiling_usd IS NULL OR p_per_run_cap_usd IS NULL OR p_per_lead_monthly_usd IS NULL
     OR p_global_monthly_limit_usd IS NULL OR p_max_leads_per_run IS NULL OR p_per_user_concurrency IS NULL OR p_max_attempts IS NULL
     OR p_run_ttl_hours IS NULL THEN
    RAISE EXCEPTION 'Every limit must be given' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ci_research_controls
  SET per_job_reserve_usd = p_per_job_reserve_usd, per_profile_ceiling_usd = p_per_profile_ceiling_usd, per_run_cap_usd = p_per_run_cap_usd,
      per_lead_monthly_usd = p_per_lead_monthly_usd, global_monthly_limit_usd = p_global_monthly_limit_usd,
      max_leads_per_run = p_max_leads_per_run, per_user_concurrency = p_per_user_concurrency, max_attempts = p_max_attempts,
      run_ttl_hours = p_run_ttl_hours, updated_at = now(), updated_by = p_operator
  WHERE id;
  INSERT INTO public.ci_research_control_log (operator, action, detail)
  VALUES (p_operator, 'set_limits', jsonb_build_object('per_job_reserve_usd', p_per_job_reserve_usd, 'per_profile_ceiling_usd', p_per_profile_ceiling_usd,
    'per_run_cap_usd', p_per_run_cap_usd, 'per_lead_monthly_usd', p_per_lead_monthly_usd, 'global_monthly_limit_usd', p_global_monthly_limit_usd,
    'max_leads_per_run', p_max_leads_per_run, 'per_user_concurrency', p_per_user_concurrency, 'max_attempts', p_max_attempts, 'run_ttl_hours', p_run_ttl_hours));
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_outreach_queue_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
