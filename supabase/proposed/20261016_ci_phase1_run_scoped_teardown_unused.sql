BEGIN;
SET LOCAL lock_timeout='5s';
-- PROPOSED. NOT APPLIED. Removes an install that was NEVER USED. It refuses (changing nothing) as soon as any authorization,
-- lead-set, spending or control-log record exists, because those are the audit trail of live research and must not be
-- dropped casually. After live use, use 20261016_ci_phase1_run_scoped_disable.sql and fix forward.
--
-- It does not re-grant the old first-in-first-out claim to the service role: that claim reads any worker_eligible pending
-- row, and putting it back is a separate, explicit decision.
DO $$
DECLARE
  v_used bigint;
BEGIN
  SELECT (SELECT count(*) FROM public.ci_research_runs) + (SELECT count(*) FROM public.ci_research_run_leads)
       + (SELECT count(*) FROM public.ci_research_charges) + (SELECT count(*) FROM public.ci_research_control_log)
  INTO v_used;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'Teardown refused: % authorization, spending or control records exist. Use the disable script instead.', v_used;
  END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_intelligence_queue WHERE run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Teardown refused: run-scoped queue rows exist. Use the disable script instead.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_ci_run_progress(uuid);
DROP FUNCTION IF EXISTS public.get_ci_research_status();
DROP FUNCTION IF EXISTS public.set_ci_research_limits(numeric, numeric, numeric, numeric, numeric, integer, integer, integer, integer, text);
DROP FUNCTION IF EXISTS public.set_ci_research_access(boolean, uuid[], text);
DROP FUNCTION IF EXISTS public.set_ci_research_enabled(boolean, text);
DROP FUNCTION IF EXISTS public.cancel_ci_research_run(uuid, uuid);
DROP FUNCTION IF EXISTS public.recover_ci_run_items(integer);
DROP FUNCTION IF EXISTS public.complete_ci_run_item(uuid, uuid, uuid, jsonb, jsonb, jsonb, boolean, text, numeric);
DROP FUNCTION IF EXISTS public.claim_ci_run_items(integer);
DROP FUNCTION IF EXISTS public.authorize_ci_research_run(uuid, uuid, integer);
DROP TABLE IF EXISTS public.ci_research_charges;
DROP TABLE IF EXISTS public.ci_research_run_leads;
DROP TABLE IF EXISTS public.ci_research_runs;
DROP TABLE IF EXISTS public.ci_research_control_log;
DROP TABLE IF EXISTS public.ci_research_controls;
DROP INDEX IF EXISTS public.idx_ci_queue_run_active;
COMMIT;
