-- PREPARED, NOT APPLIED. Follow-up to 20261009_secure_exposed_public_tables.sql.
--
-- Confirmed findings (production audit, 2026-10-09):
--   1. leads has two SELECT policies with USING (true) for role public, so the
--      anon key can read every user's leads.
--   2. activity_logs has SELECT USING (true) and INSERT WITH CHECK (true) for role
--      public: anyone can read all activity (emails, queries) and inject rows.
--   3. get_ci_statistics(p_user_id) is SECURITY DEFINER and executable by anon,
--      so any caller can read any user's lead statistics.
--   4. All 14 remaining client-facing tables grant anon and authenticated the full
--      privilege set including TRUNCATE (not governed by RLS), REFERENCES, TRIGGER.
--   5. handle_new_user() and the CI/usage RPCs are executable by anon via PUBLIC.
--
-- Non-destructive: no row is read, changed or deleted. Safe to re-run.
-- Does not touch the discovery engine, the CI queue logic, or the (unapplied)
-- background-worker migration.

-- 1. leads: remove the cross-user public read policies. Owner policies
--    ("Users can view their leads" etc.) remain; admin pages use the service role.
DROP POLICY IF EXISTS "Allow public read access" ON public.leads;
DROP POLICY IF EXISTS "Public read access" ON public.leads;

-- 2. activity_logs: owner read only. /api/track writes with the service role.
DROP POLICY IF EXISTS "Allow insert for all" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow select for all" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_own" ON public.activity_logs;
CREATE POLICY "activity_logs_select_own" ON public.activity_logs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3. Table privileges. anon never needs these tables; authenticated loses the
--    non-RLS-governed privileges everywhere.
REVOKE ALL ON public.activity_logs, public.agent_icp, public.agent_lead_queue,
  public.agent_missions, public.commercial_intelligence_queue, public.email_usage,
  public.follow_up_settings, public.lead_activity_events, public.lead_follow_ups,
  public.leads, public.outreach_queue, public.pipeline_automation_settings,
  public.templates, public.user_ctas
  FROM PUBLIC, anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.activity_logs, public.agent_icp,
  public.agent_lead_queue, public.agent_missions, public.commercial_intelligence_queue,
  public.email_usage, public.follow_up_settings, public.lead_activity_events,
  public.lead_follow_ups, public.leads, public.outreach_queue,
  public.pipeline_automation_settings, public.templates, public.user_ctas
  FROM authenticated;

-- activity_logs: read-only for signed-in users.
REVOKE INSERT, UPDATE, DELETE ON public.activity_logs FROM authenticated;

-- Admin/service-only tables (accessed only through createAdminClient in the app).
REVOKE ALL ON public.follow_up_settings, public.lead_activity_events,
  public.lead_follow_ups, public.pipeline_automation_settings FROM authenticated;

GRANT ALL ON public.activity_logs, public.agent_icp, public.agent_lead_queue,
  public.agent_missions, public.commercial_intelligence_queue, public.email_usage,
  public.follow_up_settings, public.lead_activity_events, public.lead_follow_ups,
  public.leads, public.outreach_queue, public.pipeline_automation_settings,
  public.templates, public.user_ctas
  TO service_role;

-- 4. Functions.
-- get_ci_statistics: run as the caller so leads RLS scopes the result to the
-- caller's own rows (the app passes its own user id).
ALTER FUNCTION public.get_ci_statistics(uuid) SECURITY INVOKER;

-- handle_new_user is a trigger function; it must never be an RPC. Triggers do not
-- check EXECUTE at fire time, so sign-up keeps working.
ALTER FUNCTION public.handle_new_user() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_ci_statistics(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ci_statistics(uuid) TO authenticated, service_role;

-- Signed-in-only RPCs (SECURITY INVOKER, so RLS already scopes them to the caller).
REVOKE EXECUTE ON FUNCTION
  public.claim_ci_queue_items(integer),
  public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing(integer),
  public.backfill_missing_ci_queue_entries(uuid),
  public.audit_ci_queue_consistency(uuid),
  public.increment_usage(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.claim_ci_queue_items(integer),
  public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing(integer),
  public.backfill_missing_ci_queue_entries(uuid),
  public.audit_ci_queue_consistency(uuid),
  public.increment_usage(uuid, integer)
  TO authenticated, service_role;

-- Pin search_path on invoker functions (all reference public tables unqualified).
ALTER FUNCTION public.claim_ci_queue_items(integer) SET search_path = public;
ALTER FUNCTION public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text) SET search_path = public;
ALTER FUNCTION public.reset_stale_ci_processing(integer) SET search_path = public;
ALTER FUNCTION public.backfill_missing_ci_queue_entries(uuid) SET search_path = public;
ALTER FUNCTION public.audit_ci_queue_consistency(uuid) SET search_path = public;
ALTER FUNCTION public.increment_usage(uuid, integer) SET search_path = public;
