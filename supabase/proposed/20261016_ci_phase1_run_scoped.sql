BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- B2 Phase 1 — run-scoped Business Intelligence.
--
-- STATUS: PROPOSED. NOT APPLIED. Do not run through `supabase db push` (the migration history on this project is not in
-- sync with what was applied by hand). Review, then apply deliberately through the SQL Editor. Additive and idempotent:
-- it creates new tables and functions, changes no existing row, and removes nothing except the service role's right to
-- call the old first-in-first-out claim (see section 7).
--
-- WHY. Research must be authorized for one specific Discover run, never for "whatever is pending". This adds an explicit,
-- auditable authorization record per run and a claim function that can only ever claim jobs belonging to an authorized,
-- unexpired, uncancelled run of the same customer.
--
--   * A run is authorized from its atomic-save RECEIPT (discover_save_receipts). The saved lead ids come from the receipt
--     itself, not from the caller, so a request for 25 businesses of which 23 were saved authorizes exactly those 23.
--   * Authorization is idempotent per run_id: repeating it creates no second job and no second record.
--   * Jobs live in the EXISTING queue (commercial_intelligence_queue). Run jobs keep worker_eligible = false, so the
--     old claim paths can never see them, and carry the run_id. No broad worker_eligible update is ever performed.
--   * The 146 historical jobs have run_id NULL: they can never match a run-scoped claim, however the switches are set.
--   * Spending is reserved before work starts, per attempt, in a ledger (one reservation per queue job and attempt), and
--     bounded four ways: per job (all attempts of one profile), per run, per customer per month, and globally.
--     A missing limit fails closed. Research never touches the customer's lead allowance (public.usage).
--   * The kill switch is a row in the database (default OFF) that the claim function itself reads, on top of the
--     CI_RESEARCH_ENABLED environment variable the application checks. Turning it off takes effect at the next claim.
--   * Access is an explicit allow-list (default: nobody). Authorization AND claiming both require the customer to be on
--     the list (or allow_all_customers to be set deliberately), so research can be switched on for the owner alone.
--     A per-run lead cap bounds how many saved businesses one run may authorize.
--
-- Not touched: leads, usage, discover_save_receipts, the queue's existing rows and guards, and the service-role worker
-- completion function (reused as is).
-- Undo, without destroying anything: supabase/proposed/20261016_ci_phase1_run_scoped_disable.sql (switch off, access cleared,
-- every record kept). Removal of an UNUSED install only: ..._teardown_unused.sql (refuses once any record exists).

-- ---------------------------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.commercial_intelligence_queue') IS NULL THEN RAISE EXCEPTION 'Phase 1 preflight: queue table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'commercial_intelligence_queue' AND column_name = 'run_id') THEN
    RAISE EXCEPTION 'Phase 1 preflight: queue.run_id is missing (B1.1 not applied?)';
  END IF;
  IF to_regclass('public.discover_save_receipts') IS NULL THEN RAISE EXCEPTION 'Phase 1 preflight: discover_save_receipts missing (atomic save not applied?)'; END IF;
  IF to_regprocedure('public.complete_ci_enrichment_worker(uuid,uuid,uuid,jsonb,jsonb,jsonb,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Phase 1 preflight: complete_ci_enrichment_worker missing';
  END IF;
  IF to_regprocedure('auth.role()') IS NULL THEN RAISE EXCEPTION 'Phase 1 preflight: auth.role() missing'; END IF;
  IF to_regclass('public.leads') IS NULL THEN RAISE EXCEPTION 'Phase 1 preflight: leads missing'; END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Operator controls (one row). Default OFF; every limit NULL, which fails closed.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ci_research_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  per_job_reserve_usd numeric(10,6) CHECK (per_job_reserve_usd IS NULL OR per_job_reserve_usd > 0),
  per_profile_ceiling_usd numeric(10,6) CHECK (per_profile_ceiling_usd IS NULL OR per_profile_ceiling_usd > 0),
  per_run_cap_usd numeric(10,6) CHECK (per_run_cap_usd IS NULL OR per_run_cap_usd >= 0),
  per_lead_monthly_usd numeric(10,6) CHECK (per_lead_monthly_usd IS NULL OR per_lead_monthly_usd > 0),
  global_monthly_limit_usd numeric(12,6) CHECK (global_monthly_limit_usd IS NULL OR global_monthly_limit_usd >= 0),
  max_leads_per_run integer CHECK (max_leads_per_run IS NULL OR max_leads_per_run BETWEEN 1 AND 500),
  -- Who may have research: nobody by default. The allow-list is the owner-only mechanism; allow_all is a deliberate step.
  allow_all_customers boolean NOT NULL DEFAULT false,
  allowed_user_ids uuid[] NOT NULL DEFAULT '{}',
  per_user_concurrency integer NOT NULL DEFAULT 4 CHECK (per_user_concurrency BETWEEN 1 AND 20),
  max_attempts integer NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 3),
  run_ttl_hours integer NOT NULL DEFAULT 24 CHECK (run_ttl_hours BETWEEN 1 AND 168),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
INSERT INTO public.ci_research_controls (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ci_research_control_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  operator text NOT NULL,
  action text NOT NULL,
  detail jsonb
);

-- ---------------------------------------------------------------------------------------------
-- 2. Authorization record and the exact set of saved leads it covers
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ci_research_runs (
  run_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  saved_count integer NOT NULL,
  queued_count integer NOT NULL DEFAULT 0,
  budget_limit_usd numeric(10,6) NOT NULL CHECK (budget_limit_usd >= 0),
  customer_month_limit_usd numeric(10,6) NOT NULL CHECK (customer_month_limit_usd >= 0),
  max_attempts integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ci_research_run_leads (
  run_id uuid NOT NULL REFERENCES public.ci_research_runs(run_id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  user_id uuid NOT NULL,
  initial_state text NOT NULL CHECK (initial_state IN ('queued', 'unavailable_no_website', 'skipped_existing', 'skipped_limit')),
  PRIMARY KEY (run_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_ci_run_leads_lead ON public.ci_research_run_leads (lead_id);

-- One reservation per queue job and attempt. No foreign key to the queue: spending history must outlive a deleted lead.
CREATE TABLE IF NOT EXISTS public.ci_research_charges (
  queue_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 0),
  run_id uuid NOT NULL REFERENCES public.ci_research_runs(run_id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reserved_usd numeric(10,6) NOT NULL CHECK (reserved_usd > 0),
  actual_usd numeric(10,6) CHECK (actual_usd IS NULL OR actual_usd >= 0),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'settled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  PRIMARY KEY (queue_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_ci_charges_user_month ON public.ci_research_charges (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ci_charges_run ON public.ci_research_charges (run_id);
CREATE INDEX IF NOT EXISTS idx_ci_charges_created ON public.ci_research_charges (created_at);

CREATE INDEX IF NOT EXISTS idx_ci_queue_run_active
  ON public.commercial_intelligence_queue (run_id, created_at)
  WHERE run_id IS NOT NULL AND status IN ('pending', 'processing');

-- ---------------------------------------------------------------------------------------------
-- 3. Table privileges and row security: customers read their own run, nothing else, and write nothing
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.ci_research_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_control_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_run_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ci_research_charges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ci_research_controls, public.ci_research_control_log, public.ci_research_runs,
  public.ci_research_run_leads, public.ci_research_charges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ci_research_controls, public.ci_research_control_log, public.ci_research_runs,
  public.ci_research_run_leads, public.ci_research_charges TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ci_research_control_log_id_seq TO service_role;
GRANT SELECT ON public.ci_research_runs, public.ci_research_run_leads TO authenticated;

DROP POLICY IF EXISTS "Customers read their own research runs" ON public.ci_research_runs;
CREATE POLICY "Customers read their own research runs" ON public.ci_research_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Customers read their own research run leads" ON public.ci_research_run_leads;
CREATE POLICY "Customers read their own research run leads" ON public.ci_research_run_leads FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------------------------
-- 4. Authorization (service role only)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_ci_research_run(p_run_id uuid, p_user_id uuid, p_plan_leads_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Claim (service role only): authorized runs only, fair across customers, budget-checked, switch-checked
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_ci_run_items(p_limit integer DEFAULT 5)
RETURNS TABLE(id uuid, lead_id uuid, user_id uuid, run_id uuid, retry_count integer, max_retries integer, claim_token uuid, reserved_usd numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Completion, recovery, cancellation, operator controls, read-only status
-- ---------------------------------------------------------------------------------------------
-- Completion reuses the fenced worker completion. Only a job claimed through a run can complete here; a usable
-- profile is required for success; the attempt's reservation is settled with the reported actual cost in the same
-- transaction. A lost claim (late or duplicate completion) changes nothing.
CREATE OR REPLACE FUNCTION public.complete_ci_run_item(
  p_queue_id uuid, p_lead_id uuid, p_claim_token uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb,
  p_success boolean, p_error_msg text, p_actual_cost_usd numeric DEFAULT 0
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Stale recovery for run jobs (the old worker reset only handles worker_eligible rows). An interrupted attempt counts as
-- an attempt, is billed at its reservation (the cost cannot be known), and is failed once attempts are exhausted.
CREATE OR REPLACE FUNCTION public.recover_ci_run_items(p_timeout_seconds integer DEFAULT 600)
RETURNS TABLE(reset_count integer, failed_count integer, settled_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Cancels a customer's own run: nothing new is claimed; jobs not yet started are closed as cancelled; a job already
-- running finishes and its profile is kept. Idempotent.
CREATE OR REPLACE FUNCTION public.cancel_ci_research_run(p_run_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.set_ci_research_enabled(p_enabled boolean, p_operator text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_ci_research_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- Operator-run, audited configuration. Each call is logged. Turning access OFF (empty list, allow_all false) is always allowed.
CREATE OR REPLACE FUNCTION public.set_ci_research_access(p_allow_all boolean, p_allowed_user_ids uuid[], p_operator text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.set_ci_research_limits(
  p_per_job_reserve_usd numeric, p_per_profile_ceiling_usd numeric, p_per_run_cap_usd numeric, p_per_lead_monthly_usd numeric,
  p_global_monthly_limit_usd numeric, p_max_leads_per_run integer, p_per_user_concurrency integer, p_max_attempts integer,
  p_run_ttl_hours integer, p_operator text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Customer-readable progress (SECURITY INVOKER: row security returns only the caller's own run)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ci_run_progress(p_run_id uuid)
RETURNS TABLE(lead_id uuid, state text, retry_count integer, last_error text, run_status text, expires_at timestamptz, queued_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Function privileges. Everything is service-role only except the customer's own progress read.
-- ---------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.authorize_ci_research_run(uuid, uuid, integer),
  public.claim_ci_run_items(integer),
  public.complete_ci_run_item(uuid, uuid, uuid, jsonb, jsonb, jsonb, boolean, text, numeric),
  public.recover_ci_run_items(integer),
  public.cancel_ci_research_run(uuid, uuid),
  public.set_ci_research_enabled(boolean, text),
  public.set_ci_research_access(boolean, uuid[], text),
  public.set_ci_research_limits(numeric, numeric, numeric, numeric, numeric, integer, integer, integer, integer, text),
  public.get_ci_research_status(),
  public.get_ci_run_progress(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_ci_research_run(uuid, uuid, integer),
  public.claim_ci_run_items(integer),
  public.complete_ci_run_item(uuid, uuid, uuid, jsonb, jsonb, jsonb, boolean, text, numeric),
  public.recover_ci_run_items(integer),
  public.cancel_ci_research_run(uuid, uuid),
  public.set_ci_research_enabled(boolean, text),
  public.set_ci_research_access(boolean, uuid[], text),
  public.set_ci_research_limits(numeric, numeric, numeric, numeric, numeric, integer, integer, integer, integer, text),
  public.get_ci_research_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ci_run_progress(uuid) TO authenticated, service_role;

-- The old first-in-first-out worker claim takes any worker_eligible pending row. Nothing in the application calls it any
-- more; removing the service role's right to it makes "no broad claim over the pending queue" a database guarantee.
REVOKE EXECUTE ON FUNCTION public.claim_ci_queue_items_worker(integer) FROM service_role;

COMMIT;
