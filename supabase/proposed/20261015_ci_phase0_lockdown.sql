BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- B2 Phase 0 — research execution lockdown.
--
-- STATUS: PROPOSED. NOT APPLIED. Do not run through `supabase db push` (the migration history on this
-- project is not in sync with what was applied by hand). Review, then apply deliberately. It does not depend
-- on 20261013_ci_completion_integrity.sql (see "Independence" below).
--
-- Verified against production (read-only) before writing:
--   * `authenticated` holds EXECUTE on claim_ci_queue_items, complete_ci_enrichment,
--     reset_stale_ci_processing, backfill_missing_ci_queue_entries and audit_ci_queue_consistency.
--   * `authenticated` holds INSERT and UPDATE on every leads.ci_* column and on commercial_profile,
--     website_snapshot and business_signals, and `leads` has no trigger: a customer can write a profile,
--     a status or a cost for their own lead directly.
--   * backfill_missing_ci_queue_entries is SECURITY INVOKER: with a NULL user it queues a job for every
--     one of the caller's leads that is not yet queued.
--
-- What this does (no row is read, changed, deleted, reset or re-queued; the 146 historical jobs are untouched):
--
--   1. Execution functions become service-role-only. The customer sessions can no longer claim a job,
--      complete a job with data of their choosing, reset claims, bulk-queue their leads or run the
--      consistency audit. Every overload present at apply time is covered. The service-role worker
--      functions are not touched.
--   2. A trigger on public.leads refuses customer-session writes to the research columns:
--        - UPDATE: none of the protected columns may change.
--        - INSERT: they must hold their defaults (status 'pending', zero retries, zero cost, the default
--          model versions) or NULL; a customer cannot create a lead that already carries a profile.
--      Server code (service role) and the database's own SECURITY DEFINER functions (running as their
--      owner, such as save_discover_results and the worker completion) are unrestricted. Reading is
--      unchanged: customers keep reading their own profiles through the existing SELECT policies.
--   3. get_ci_statistics (read-only, SECURITY INVOKER) stays available to customers.
--
-- Not changed: the customer INSERT into commercial_intelligence_queue (a plain "pending, own lead" request,
-- already constrained by the B1.1 guard). Those rows are inert: nothing claims a row unless worker_eligible is
-- true, and only the service role can set that. Phase 1 replaces this with server-side, run-scoped queueing.
--
-- Independence: this file does NOT need 20261013_ci_completion_integrity.sql (verified: it applies cleanly and
-- passes its tests on the production-faithful schema without it). If 20261013 is ever applied afterwards it
-- creates an 8-argument complete_ci_enrichment granted to `authenticated`: re-run this file after it. It is
-- safe to re-run. The recommended path is to NOT apply the customer half of 20261013 at all (see the plan).
--
-- Rollback: supabase/proposed/20261015_ci_phase0_lockdown_rollback.sql

-- ---------------------------------------------------------------------------------------------
-- 0. Preflight: stop, changing nothing, if the schema is not what the guard trigger assumes. A trigger that
--    names a missing column would fail every customer write to leads, so this must pass first.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c.name, ', ') INTO v_missing
  FROM unnest(ARRAY['ci_enrichment_status', 'ci_started_at', 'ci_completed_at', 'ci_last_error', 'ci_retry_count',
                    'ci_processing_duration_ms', 'ci_cost_estimate', 'ci_model_versions', 'website_snapshot',
                    'business_signals', 'commercial_profile']) AS c(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns i
    WHERE i.table_schema = 'public' AND i.table_name = 'leads' AND i.column_name = c.name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 0 preflight: public.leads is missing column(s): %', v_missing;
  END IF;

  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'Phase 0 preflight: auth.role() does not exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.leads'::regclass AND NOT tgisinternal
      AND tgname <> 'trg_guard_leads_research_columns'
  ) THEN
    RAISE EXCEPTION 'Phase 0 preflight: public.leads already has other triggers; review before adding this one';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Execution functions: service role only (every overload that exists now)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('claim_ci_queue_items', 'complete_ci_enrichment', 'reset_stale_ci_processing',
                        'backfill_missing_ci_queue_entries', 'audit_ci_queue_consistency')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Customer sessions cannot write research state or results
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_leads_research_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
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
$$;

-- A trigger function is never called directly; firing a trigger does not check EXECUTE.
REVOKE EXECUTE ON FUNCTION public.guard_leads_research_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_leads_research_columns ON public.leads;
CREATE TRIGGER trg_guard_leads_research_columns
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.guard_leads_research_columns();

COMMIT;
