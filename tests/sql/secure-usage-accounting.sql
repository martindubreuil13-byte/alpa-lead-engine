-- Repeatable test for 20261011_secure_usage_accounting.sql.
-- Run ONLY against a throwaway local Supabase Postgres, never production:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/secure-usage-accounting.sql
\set ON_ERROR_STOP on

CREATE TABLE public.usage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, period_start timestamp, period_end timestamp, leads_used int, leads_limit int, created_at timestamp);
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
-- state produced by 20261009:
REVOKE ALL ON public.usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.usage TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.usage TO authenticated;
CREATE POLICY usage_select_own ON public.usage FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY usage_insert_own ON public.usage FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY usage_update_own ON public.usage FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- legacy function as in production (invoker, PUBLIC execute)
CREATE FUNCTION public.increment_usage(p_usage_id uuid, p_count integer) RETURNS void LANGUAGE plpgsql AS $$ begin update usage set leads_used = leads_used + p_count where id = p_usage_id; end; $$;

INSERT INTO public.usage (id,user_id,period_start,period_end,leads_used,leads_limit) VALUES
 ('11111111-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001',now()-interval '1 day',now()+interval '30 days',5,100),
 ('11111111-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002',now()-interval '1 day',now()+interval '30 days',7,100);
CREATE TEMP TABLE before_snapshot AS SELECT id, user_id, leads_used, leads_limit FROM public.usage;
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

\echo ===== BEFORE: vulnerability reproduces =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
UPDATE public.usage SET leads_limit = 999999 WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.rows_eq($$SELECT leads_limit FROM public.usage WHERE id='11111111-0000-0000-0000-00000000000a'$$, 999999, 'BEFORE: customer raised own leads_limit');
RESET ROLE;
UPDATE public.usage SET leads_limit=100 WHERE id='11111111-0000-0000-0000-00000000000a';  -- restore fixture

\i supabase/migrations/20261011_secure_usage_accounting.sql
\i supabase/migrations/20261011_secure_usage_accounting.sql

\echo ===== AFTER: customer A =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
SELECT pg_temp.rows_eq('SELECT count(*) FROM public.usage', 1, 'A reads only own usage row');
SELECT pg_temp.denied($$UPDATE public.usage SET leads_limit=999999$$, 'A cannot change leads_limit');
SELECT pg_temp.denied($$UPDATE public.usage SET leads_used=0$$, 'A cannot reset leads_used');
SELECT pg_temp.denied($$INSERT INTO public.usage(user_id,leads_used,leads_limit) VALUES ('aaaaaaaa-0000-0000-0000-000000000001',0,999999)$$, 'A cannot insert a fresh usage period');
SELECT pg_temp.denied('DELETE FROM public.usage', 'A cannot delete usage');
SELECT pg_temp.denied('TRUNCATE public.usage', 'A cannot truncate usage');
SELECT pg_temp.denied($$SELECT public.increment_usage('11111111-0000-0000-0000-00000000000a', -5)$$, 'A cannot call increment_usage');
RESET ROLE;

\echo ===== AFTER: anon =====
SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false), set_config('request.jwt.claim.sub','',false);
SELECT pg_temp.denied('SELECT * FROM public.usage', 'anon cannot read usage');
SELECT pg_temp.denied($$SELECT public.increment_usage('11111111-0000-0000-0000-00000000000a', 1)$$, 'anon cannot call increment_usage');
RESET ROLE;

\echo ===== AFTER: service_role runs the /api/scrape accounting flow =====
SET ROLE service_role;
-- limit sync (plan change), new period, optimistic increment as in incrementUsageRow
UPDATE public.usage SET leads_limit = 200 WHERE id='11111111-0000-0000-0000-00000000000a';
SELECT pg_temp.rows_eq($$SELECT leads_limit FROM public.usage WHERE id='11111111-0000-0000-0000-00000000000a'$$, 200, 'service role can sync leads_limit');
INSERT INTO public.usage(user_id,period_start,period_end,leads_used,leads_limit) VALUES ('aaaaaaaa-0000-0000-0000-000000000001',now()+interval '31 days',now()+interval '61 days',0,200);
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.usage WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001'$$, 2, 'service role can create a new period (reset)');
UPDATE public.usage SET leads_used = 5 + 3 WHERE id='11111111-0000-0000-0000-00000000000a' AND leads_used = 5;
SELECT pg_temp.rows_eq($$SELECT leads_used FROM public.usage WHERE id='11111111-0000-0000-0000-00000000000a'$$, 8, 'service role optimistic increment succeeds');
UPDATE public.usage SET leads_used = 5 + 3 WHERE id='11111111-0000-0000-0000-00000000000a' AND leads_used = 5;  -- stale writer
SELECT pg_temp.rows_eq($$SELECT leads_used FROM public.usage WHERE id='11111111-0000-0000-0000-00000000000a'$$, 8, 'stale concurrent increment does not double-count');
SELECT public.increment_usage('11111111-0000-0000-0000-00000000000b', 2);
SELECT pg_temp.rows_eq($$SELECT leads_used FROM public.usage WHERE id='11111111-0000-0000-0000-00000000000b'$$, 9, 'service role can call increment_usage');
RESET ROLE;

\echo ===== B unaffected / unrelated rows unchanged =====
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.usage u JOIN before_snapshot b USING(id) WHERE u.id='11111111-0000-0000-0000-00000000000b' AND u.leads_limit=b.leads_limit AND u.user_id=b.user_id$$, 1, 'B limit/user unchanged');
\echo ALL TESTS PASSED
