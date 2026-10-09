-- Repeatable test for 20261010_secure_remaining_exposure.sql.
-- Run ONLY against a throwaway local Postgres (Supabase image), never production:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/secure-remaining-exposure.sql
\set ON_ERROR_STOP on

-- ---- replicate the production state that was audited ----
CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, company_name text, ci_enrichment_status text, ci_started_at timestamptz, ci_completed_at timestamptz);
CREATE TABLE public.activity_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, event text, email text, created_at timestamptz DEFAULT now());
CREATE TABLE public.lead_follow_ups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.pipeline_automation_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.follow_up_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.lead_activity_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.agent_icp (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.agent_lead_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.agent_missions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.commercial_intelligence_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.email_usage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.outreach_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.user_ctas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leads','activity_logs','lead_follow_ups','pipeline_automation_settings','follow_up_settings','lead_activity_events','agent_icp','agent_lead_queue','agent_missions','commercial_intelligence_queue','email_usage','outreach_queue','templates','user_ctas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP; END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

CREATE POLICY "Public read access" ON public.leads FOR SELECT TO public USING (true);
CREATE POLICY "Allow public read access" ON public.leads FOR SELECT TO public USING (true);
CREATE POLICY "Users can view their leads" ON public.leads FOR SELECT TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can update their leads" ON public.leads FOR UPDATE TO public USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow select for all" ON public.activity_logs FOR SELECT TO public USING (true);
CREATE POLICY "Allow insert for all" ON public.activity_logs FOR INSERT TO public WITH CHECK (true);

CREATE FUNCTION public.get_ci_statistics(p_user_id uuid) RETURNS TABLE(total_leads bigint) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT count(*) FROM leads WHERE user_id = p_user_id $$;
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ begin insert into public.profiles(id,email) values (new.id,new.email) on conflict (id) do nothing; return new; end $$;
CREATE FUNCTION public.claim_ci_queue_items(p_limit integer DEFAULT 10) RETURNS TABLE(id uuid) LANGUAGE sql AS $$ SELECT id FROM commercial_intelligence_queue LIMIT p_limit $$;
CREATE FUNCTION public.complete_ci_enrichment(p_queue_id uuid, p_lead_id uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb, p_success boolean, p_error_msg text) RETURNS TABLE(success boolean) LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.reset_stale_ci_processing(p_timeout_seconds integer DEFAULT 300) RETURNS TABLE(reset_count integer) LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.backfill_missing_ci_queue_entries(p_user_id uuid DEFAULT NULL) RETURNS TABLE(n bigint) LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION public.audit_ci_queue_consistency(p_user_id uuid DEFAULT NULL) RETURNS TABLE(n bigint) LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION public.increment_usage(p_usage_id uuid, p_count integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;

INSERT INTO public.leads (user_id, company_name, ci_enrichment_status) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','A-Co','completed'),
 ('bbbbbbbb-0000-0000-0000-000000000002','B-Co','completed');
INSERT INTO public.activity_logs (user_id, event, email) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','search','a@t.test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','search','b@t.test');
CREATE TEMP TABLE before_snapshot AS SELECT (select count(*) from public.leads) l, (select count(*) from public.activity_logs) a;
GRANT ALL ON before_snapshot TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.denied(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE sql; RAISE EXCEPTION 'TEST FAILED (allowed): %', label;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.rows_eq(sql text, expected bigint, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN EXECUTE sql INTO n;
  IF n IS DISTINCT FROM expected THEN RAISE EXCEPTION 'TEST FAILED (% expected %, got %)', label, expected, n; END IF;
  RAISE NOTICE 'PASS: %', label; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.denied(text,text), pg_temp.rows_eq(text,bigint,text) TO PUBLIC;

\echo ===== BEFORE: confirm vulnerabilities reproduce =====
SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false), set_config('request.jwt.claim.sub','',false);
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.leads', 2, 'BEFORE: anon reads all leads');
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.activity_logs', 2, 'BEFORE: anon reads all activity_logs');
SELECT pg_temp.rows_eq('SELECT total_leads FROM public.get_ci_statistics(''bbbbbbbb-0000-0000-0000-000000000002'')', 1, 'BEFORE: anon reads B stats');
RESET ROLE;

-- apply twice (idempotency)
\i supabase/migrations/20261010_secure_remaining_exposure.sql
\i supabase/migrations/20261010_secure_remaining_exposure.sql

\echo ===== AFTER: anon =====
SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false), set_config('request.jwt.claim.sub','',false);
SELECT pg_temp.denied('SELECT * FROM public.leads', 'anon cannot read leads');
SELECT pg_temp.denied('SELECT * FROM public.activity_logs', 'anon cannot read activity_logs');
SELECT pg_temp.denied($$INSERT INTO public.activity_logs(event) VALUES ('x')$$, 'anon cannot insert activity_logs');
SELECT pg_temp.denied('TRUNCATE public.leads', 'anon cannot truncate leads');
SELECT pg_temp.denied('SELECT * FROM public.commercial_intelligence_queue', 'anon cannot read CI queue');
SELECT pg_temp.denied('SELECT * FROM public.get_ci_statistics(gen_random_uuid())', 'anon cannot call get_ci_statistics');
SELECT pg_temp.denied('SELECT public.handle_new_user()', 'anon cannot call handle_new_user');
SELECT pg_temp.denied('SELECT * FROM public.claim_ci_queue_items(1)', 'anon cannot call claim_ci_queue_items');
SELECT pg_temp.denied('SELECT public.increment_usage(gen_random_uuid(), 1)', 'anon cannot call increment_usage');
RESET ROLE;

\echo ===== AFTER: authenticated user A =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.leads', 1, 'A sees only own leads');
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.activity_logs', 1, 'A sees only own activity');
SELECT pg_temp.rows_eq('SELECT total_leads FROM public.get_ci_statistics(''aaaaaaaa-0000-0000-0000-000000000001'')', 1, 'A can read own CI statistics');
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.get_ci_statistics(''bbbbbbbb-0000-0000-0000-000000000002'') WHERE total_leads > 0', 0, 'A gets nothing for B in get_ci_statistics');
SELECT pg_temp.denied($$INSERT INTO public.activity_logs(user_id,event) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','x')$$, 'A cannot insert activity_logs from client');
SELECT pg_temp.denied('TRUNCATE public.leads', 'A cannot truncate leads');
SELECT pg_temp.denied('TRUNCATE public.commercial_intelligence_queue', 'A cannot truncate CI queue');
SELECT pg_temp.denied('SELECT * FROM public.lead_follow_ups', 'A cannot read admin-only lead_follow_ups');
SELECT pg_temp.denied('SELECT * FROM public.pipeline_automation_settings', 'A cannot read admin-only pipeline settings');
SELECT pg_temp.denied('SELECT public.handle_new_user()', 'A cannot call handle_new_user');
-- legitimate: own update works, cross-user update affects 0 rows
UPDATE public.leads SET company_name='A-Co-2' WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.leads WHERE company_name='A-Co-2'$$, 1, 'A can update own lead');
UPDATE public.leads SET company_name='HACK' WHERE user_id='bbbbbbbb-0000-0000-0000-000000000002';
RESET ROLE;
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.leads WHERE company_name='HACK'$$, 0, 'A cannot update B lead');

\echo ===== AFTER: service_role + sign-up trigger =====
SET ROLE service_role;
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.leads', 2, 'service_role reads all leads');
INSERT INTO public.activity_logs(user_id,event) VALUES (NULL,'svc-track');
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.activity_logs', 3, 'service_role can insert activity_logs');
RESET ROLE;
-- NOTE: sign-up trigger firing after REVOKE EXECUTE is verified separately against auth.users in the Supabase image (see report).

\echo ===== data preserved =====
SELECT pg_temp.rows_eq('SELECT l - (select count(*) from public.leads) FROM before_snapshot', 0, 'no leads deleted');
\echo ALL TESTS PASSED
