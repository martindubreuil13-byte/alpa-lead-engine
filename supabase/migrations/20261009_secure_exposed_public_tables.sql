-- Security repair: 12 public tables had RLS disabled and full privileges
-- (including DELETE/TRUNCATE) granted to anon and authenticated, so anyone with
-- the public anon key could read or rewrite them. In particular
-- profiles.plan = 'admin' (the application's admin check) was user-writable.
--
-- Approach (non-destructive, no data changes, safe to re-run):
--   1. Enable RLS on all twelve tables.
--   2. Revoke every client-role privilege, then grant back only what the app
--      actually does through user sessions (verified by code audit):
--        profiles               owner SELECT only (browser + server read own row)
--        usage                  owner SELECT/INSERT/UPDATE (scrape route + dashboard)
--        sender_settings        owner SELECT/INSERT/UPDATE/DELETE (settings UI upsert)
--        agent_mission_runs     owner (direct or via mission) SELECT/INSERT/UPDATE
--        agent_mission_icps     owner (direct or via mission) SELECT/INSERT/UPDATE/DELETE
--      All other tables become service-role only (no client grants, no policies):
--        users, subscriptions, app_settings, email_events, agent_emails,
--        user_usage, email_templates
--   3. service_role is unaffected (it bypasses RLS) and keeps its grants, so
--      Stripe webhooks, checkout, subscription resolution, admin pages and
--      cron jobs continue to work. handle_new_user() is SECURITY DEFINER and
--      keeps creating profiles for new sign-ups.
--
-- No client role can write profiles, so a user can no longer set plan/role,
-- subscription status or Stripe identifiers on themselves.

-- 1. Enable RLS ------------------------------------------------------------
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_emails        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mission_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mission_icps  ENABLE ROW LEVEL SECURITY;

-- 2. Remove all client-role privileges -------------------------------------
REVOKE ALL ON public.profiles, public.users, public.subscriptions, public.usage,
  public.user_usage, public.sender_settings, public.app_settings,
  public.email_templates, public.email_events, public.agent_emails,
  public.agent_mission_runs, public.agent_mission_icps
  FROM PUBLIC, anon, authenticated;

-- Make sure the trusted server role keeps full access.
GRANT ALL ON public.profiles, public.users, public.subscriptions, public.usage,
  public.user_usage, public.sender_settings, public.app_settings,
  public.email_templates, public.email_events, public.agent_emails,
  public.agent_mission_runs, public.agent_mission_icps
  TO service_role;

-- 3. Grant back the minimum the application needs for signed-in users ------
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sender_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agent_mission_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_mission_icps TO authenticated;

-- 4. Row policies (idempotent) ---------------------------------------------
-- profiles: read own row only. No INSERT/UPDATE/DELETE policy or grant exists.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- usage
DROP POLICY IF EXISTS "usage_select_own" ON public.usage;
CREATE POLICY "usage_select_own" ON public.usage
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "usage_insert_own" ON public.usage;
CREATE POLICY "usage_insert_own" ON public.usage
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "usage_update_own" ON public.usage;
CREATE POLICY "usage_update_own" ON public.usage
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- sender_settings
DROP POLICY IF EXISTS "sender_settings_select_own" ON public.sender_settings;
CREATE POLICY "sender_settings_select_own" ON public.sender_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "sender_settings_insert_own" ON public.sender_settings;
CREATE POLICY "sender_settings_insert_own" ON public.sender_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "sender_settings_update_own" ON public.sender_settings;
CREATE POLICY "sender_settings_update_own" ON public.sender_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "sender_settings_delete_own" ON public.sender_settings;
CREATE POLICY "sender_settings_delete_own" ON public.sender_settings
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- agent_mission_runs / agent_mission_icps: user_id may be NULL on legacy rows,
-- so ownership also resolves through the owning mission (agent_missions.user_id).
DROP POLICY IF EXISTS "agent_mission_runs_select_own" ON public.agent_mission_runs;
CREATE POLICY "agent_mission_runs_select_own" ON public.agent_mission_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()));
DROP POLICY IF EXISTS "agent_mission_runs_insert_own" ON public.agent_mission_runs;
CREATE POLICY "agent_mission_runs_insert_own" ON public.agent_mission_runs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()));
DROP POLICY IF EXISTS "agent_mission_runs_update_own" ON public.agent_mission_runs;
CREATE POLICY "agent_mission_runs_update_own" ON public.agent_mission_runs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()));

DROP POLICY IF EXISTS "agent_mission_icps_select_own" ON public.agent_mission_icps;
CREATE POLICY "agent_mission_icps_select_own" ON public.agent_mission_icps
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()));
DROP POLICY IF EXISTS "agent_mission_icps_insert_own" ON public.agent_mission_icps;
CREATE POLICY "agent_mission_icps_insert_own" ON public.agent_mission_icps
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()));
DROP POLICY IF EXISTS "agent_mission_icps_update_own" ON public.agent_mission_icps;
CREATE POLICY "agent_mission_icps_update_own" ON public.agent_mission_icps
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()));
DROP POLICY IF EXISTS "agent_mission_icps_delete_own" ON public.agent_mission_icps;
CREATE POLICY "agent_mission_icps_delete_own" ON public.agent_mission_icps
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.agent_missions m WHERE m.id = mission_id AND m.user_id = auth.uid()));

-- users, subscriptions, user_usage, app_settings, email_events, agent_emails,
-- email_templates: intentionally no policies and no client grants (service role only).
