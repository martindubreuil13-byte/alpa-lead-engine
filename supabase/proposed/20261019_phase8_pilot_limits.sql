-- PROPOSED OPERATOR SCRIPT. NOT APPLIED. Not a migration: no schema change; it only sets values through the existing audited
-- function public.set_ci_research_limits (service role, logged in ci_research_control_log).
--
-- Controlled-pilot values, validated offline against the real Phase 1 SQL (tests/ci-spend-engine.test.mjs):
--   per_job_reserve    0.002  (unchanged)  reserved at claim; replaced by the real cost when the attempt settles
--   per_profile_ceiling 0.004 (was 0.006)  covers one attempt plus one customer retry; an interrupted attempt billed at its
--                                          reservation (0.002) still admits the retry (0.002 + 0.002 is not above 0.004)
--   per_run_cap        0.05   (was 0.10)   a 50-profile run costs about 0.02 at the observed cost; overspending stops at 0.05
--   per_lead_monthly   0.001  (unchanged)  customer month = plan leads x 0.001 (Prospector 0.12, Starter 0.50, Free 0.025)
--   global_monthly     10     (was 2)      about 4x the expected first-month use; a hard stop
--   max_leads_per_run  50     (unchanged)
--   per_user_concurrency 2    (unchanged)
--   max_attempts       1      (unchanged)  no automatic retry; the customer's one retry is granted by the application
--   run_ttl_hours      48     (unchanged)
--
-- Run only after approval, in the SQL editor / with the service role. Check first:  select get_ci_research_status();
select set_config('request.jwt.claim.role', 'service_role', false);
select set_ci_research_limits(0.002, 0.004, 0.05, 0.001, 10, 50, 2, 1, 48, 'phase8-pilot');
select get_ci_research_status();   -- expect the values above and allow_all_customers = false

-- Rollback to the values in force before the pilot:
-- select set_ci_research_limits(0.002, 0.006, 0.10, 0.001, 2, 50, 2, 1, 48, 'phase8-pilot-rollback');
