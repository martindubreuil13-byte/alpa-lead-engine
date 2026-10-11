BEGIN;
SET LOCAL lock_timeout='5s';
-- PROPOSED. NOT APPLIED. Reverses 20261015_ci_phase0_lockdown.sql: removes the leads guard trigger and gives
-- customer sessions their previous EXECUTE rights back. Running this re-opens the exposure the lockdown closed.
DROP TRIGGER IF EXISTS trg_guard_leads_research_columns ON public.leads;
DROP FUNCTION IF EXISTS public.guard_leads_research_columns();

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
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_function);
  END LOOP;
END $$;
COMMIT;
