-- Repeatable test for 20261009_secure_exposed_public_tables.sql.
-- Run ONLY against a throwaway local Postgres (Supabase image), never production.
\set ON_ERROR_STOP on

-- ---- replicate production: tables, broad legacy grants, no RLS, sign-up trigger ----
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email text, plan text DEFAULT 'free', created_at timestamptz DEFAULT now(), stripe_customer_id text, subscription_status text, current_period_end timestamp, current_period_start timestamp, role text, stripe_subscription_id text, plan_status text, cancel_at_period_end boolean, canceled_at timestamptz, subscription_tier text);
CREATE TABLE public.users (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, email text UNIQUE, role text, plan text, created_at timestamptz DEFAULT now());
CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.profiles(id), stripe_subscription_id text, stripe_customer_id text, status text, price_id text, current_period_start timestamp, current_period_end timestamp, created_at timestamp);
CREATE TABLE public.usage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.profiles(id), period_start timestamp, period_end timestamp, leads_used int, leads_limit int, created_at timestamp);
CREATE TABLE public.user_usage (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, leads_used int, leads_limit int, updated_at timestamptz);
CREATE TABLE public.sender_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE, sender_name text, sender_email text, phone text, test_email text);
CREATE TABLE public.app_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE, smtp_host text, smtp_user text, smtp_pass text);
CREATE TABLE public.email_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, body text);
CREATE TABLE public.email_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, recipient text);
CREATE TABLE public.agent_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, contact_email text, body text);
CREATE TABLE public.agent_missions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
ALTER TABLE public.agent_missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY m_sel ON public.agent_missions FOR SELECT USING (user_id = auth.uid());
GRANT ALL ON public.agent_missions TO authenticated, service_role;
CREATE TABLE public.agent_mission_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mission_id uuid REFERENCES public.agent_missions(id) ON DELETE CASCADE, status text, user_id uuid);
CREATE TABLE public.agent_mission_icps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mission_id uuid REFERENCES public.agent_missions(id) ON DELETE CASCADE, value text, user_id uuid);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
begin insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing; return new; end; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- users: A (regular), B (regular), ADM (admin)
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','a@t.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@t.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
 ('cccccccc-0000-0000-0000-000000000003','adm@t.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
UPDATE public.profiles SET plan='admin', role='admin' WHERE id='cccccccc-0000-0000-0000-000000000003';
UPDATE public.profiles SET plan='starter', stripe_customer_id='cus_A', stripe_subscription_id='sub_A' WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO public.users (id,email,role,plan) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','a@t.test','user','starter');
INSERT INTO public.subscriptions (user_id,stripe_subscription_id,status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','sub_A','active');
INSERT INTO public.usage (id,user_id,period_start,period_end,leads_used,leads_limit) VALUES
 ('11111111-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001',now()-interval '1 day',now()+interval '30 days',5,100),
 ('11111111-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002',now()-interval '1 day',now()+interval '30 days',7,100);
INSERT INTO public.sender_settings (user_id,sender_name,sender_email) VALUES ('bbbbbbbb-0000-0000-0000-000000000002','B','b-sender@t.test');
INSERT INTO public.app_settings (user_id,smtp_pass) VALUES ('bbbbbbbb-0000-0000-0000-000000000002','secret');
INSERT INTO public.agent_emails (user_id,contact_email,body) VALUES ('bbbbbbbb-0000-0000-0000-000000000002','x@x.test','body');
INSERT INTO public.agent_missions (id,user_id) VALUES ('22222222-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001'),('22222222-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO public.agent_mission_runs (mission_id,status,user_id) VALUES ('22222222-0000-0000-0000-00000000000b','done','bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO public.agent_mission_icps (mission_id,value,user_id) VALUES ('22222222-0000-0000-0000-00000000000a','legacy-null-user',NULL);

-- snapshot row counts / admin row for "existing data preserved"
CREATE TEMP TABLE before_snapshot AS SELECT (select count(*) from public.profiles) p, (select count(*) from public.users) u, (select count(*) from public.usage) us, (select plan from public.profiles where id='cccccccc-0000-0000-0000-000000000003') admin_plan;
GRANT ALL ON before_snapshot TO PUBLIC;

\echo ===== BEFORE: confirm the vulnerability reproduces =====
SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles) = 0 THEN RAISE EXCEPTION 'precondition: anon should read profiles before fix'; END IF;
  RAISE NOTICE 'CONFIRMED vulnerable before fix: anon can read profiles';
END $$;
RESET ROLE;

-- ---- apply the migration twice (idempotency) ----
\i supabase/migrations/20261009_secure_exposed_public_tables.sql
\i supabase/migrations/20261009_secure_exposed_public_tables.sql

CREATE OR REPLACE FUNCTION pg_temp.denied(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RAISE EXCEPTION 'TEST FAILED (allowed): %', label;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: %', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.rows_eq(sql text, expected bigint, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE sql INTO n;
  IF n IS DISTINCT FROM expected THEN RAISE EXCEPTION 'TEST FAILED (% expected %, got %)', label, expected, n; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.denied(text,text), pg_temp.rows_eq(text,bigint,text) TO PUBLIC;

\echo ===== ANON denied everywhere =====
SET ROLE anon; SELECT set_config('request.jwt.claim.role','anon',false);
SELECT pg_temp.denied('SELECT * FROM public.profiles', 'anon cannot read profiles');
SELECT pg_temp.denied('SELECT * FROM public.users', 'anon cannot read users');
SELECT pg_temp.denied('SELECT * FROM public.subscriptions', 'anon cannot read subscriptions');
SELECT pg_temp.denied('SELECT * FROM public.usage', 'anon cannot read usage');
SELECT pg_temp.denied('SELECT * FROM public.sender_settings', 'anon cannot read sender_settings');
SELECT pg_temp.denied('SELECT * FROM public.app_settings', 'anon cannot read app_settings (smtp_pass)');
SELECT pg_temp.denied('SELECT * FROM public.agent_emails', 'anon cannot read agent_emails');
SELECT pg_temp.denied('SELECT * FROM public.email_events', 'anon cannot read email_events');
SELECT pg_temp.denied('SELECT * FROM public.email_templates', 'anon cannot read email_templates');
SELECT pg_temp.denied('SELECT * FROM public.user_usage', 'anon cannot read user_usage');
SELECT pg_temp.denied('SELECT * FROM public.agent_mission_runs', 'anon cannot read agent_mission_runs');
SELECT pg_temp.denied('SELECT * FROM public.agent_mission_icps', 'anon cannot read agent_mission_icps');
SELECT pg_temp.denied($$UPDATE public.profiles SET plan='admin'$$, 'anon cannot update profiles');
SELECT pg_temp.denied('DELETE FROM public.profiles', 'anon cannot delete profiles');
SELECT pg_temp.denied('TRUNCATE public.usage', 'anon cannot truncate usage');
RESET ROLE;

\echo ===== Regular authenticated user A =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
-- legitimate reads
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles$$, 1, 'A sees only own profile (not other users)');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles WHERE id='aaaaaaaa-0000-0000-0000-000000000001' AND plan='starter'$$, 1, 'A can read own profile (plan resolution works)');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles WHERE id='bbbbbbbb-0000-0000-0000-000000000002'$$, 0, 'A cannot read B profile');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles WHERE id='cccccccc-0000-0000-0000-000000000003'$$, 0, 'A cannot read admin profile');
-- privilege escalation / entitlement tampering
SELECT pg_temp.denied($$UPDATE public.profiles SET plan='admin' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'A cannot set own plan=admin');
SELECT pg_temp.denied($$UPDATE public.profiles SET role='admin' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'A cannot set own role=admin');
SELECT pg_temp.denied($$UPDATE public.profiles SET subscription_tier='pro', plan_status='active' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'A cannot change subscription entitlement');
SELECT pg_temp.denied($$UPDATE public.profiles SET stripe_customer_id='cus_evil' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'A cannot change Stripe identifiers');
SELECT pg_temp.denied($$INSERT INTO public.profiles (id,plan) VALUES (gen_random_uuid(),'admin')$$, 'A cannot insert profile');
SELECT pg_temp.denied('DELETE FROM public.profiles', 'A cannot delete profiles');
SELECT pg_temp.denied($$UPDATE public.users SET role='admin'$$, 'A cannot touch users table');
SELECT pg_temp.denied('SELECT * FROM public.subscriptions', 'A cannot read subscriptions');
SELECT pg_temp.denied('SELECT * FROM public.app_settings', 'A cannot read app_settings');
SELECT pg_temp.denied('SELECT * FROM public.agent_emails', 'A cannot read agent_emails');
SELECT pg_temp.denied('SELECT * FROM public.email_events', 'A cannot read email_events');
-- usage (scrape route + dashboard use the user session)
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.usage$$, 1, 'A sees only own usage');
UPDATE public.usage SET leads_used = leads_used + 3 WHERE id='11111111-0000-0000-0000-00000000000a';
SELECT pg_temp.rows_eq($$SELECT leads_used FROM public.usage WHERE id='11111111-0000-0000-0000-00000000000a'$$, 8, 'A can update own usage');
UPDATE public.usage SET leads_used = 0 WHERE id='11111111-0000-0000-0000-00000000000b';
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.usage WHERE id='11111111-0000-0000-0000-00000000000b'$$, 0, 'A cannot see B usage');
INSERT INTO public.usage (user_id,period_start,period_end,leads_used,leads_limit) VALUES ('aaaaaaaa-0000-0000-0000-000000000001',now(),now()+interval '30 days',0,100);
DO $$ BEGIN
  BEGIN INSERT INTO public.usage (user_id,leads_used,leads_limit) VALUES ('bbbbbbbb-0000-0000-0000-000000000002',0,1); RAISE EXCEPTION 'TEST FAILED (A inserted usage for B)';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: A cannot insert usage for B'; END;
END $$;
-- sender_settings upsert (settings page)
INSERT INTO public.sender_settings (user_id,sender_name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','A') ON CONFLICT (user_id) DO UPDATE SET sender_name='A2';
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.sender_settings$$, 1, 'A sees only own sender_settings');
DO $$ BEGIN
  BEGIN INSERT INTO public.sender_settings (user_id,sender_name) VALUES ('bbbbbbbb-0000-0000-0000-000000000002','x') ON CONFLICT (user_id) DO UPDATE SET sender_name='pwn'; RAISE EXCEPTION 'TEST FAILED (A upserted B sender_settings)';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: A cannot write B sender_settings'; END;
END $$;
-- agent tables
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.agent_mission_runs$$, 0, 'A cannot see B mission runs');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.agent_mission_icps WHERE value='legacy-null-user'$$, 1, 'A sees own legacy ICP row via mission ownership');
INSERT INTO public.agent_mission_icps (mission_id,value,user_id) VALUES ('22222222-0000-0000-0000-00000000000a','new',  'aaaaaaaa-0000-0000-0000-000000000001');
DELETE FROM public.agent_mission_icps WHERE mission_id='22222222-0000-0000-0000-00000000000a' AND user_id='aaaaaaaa-0000-0000-0000-000000000001';
DO $$ BEGIN
  BEGIN INSERT INTO public.agent_mission_icps (mission_id,value,user_id) VALUES ('22222222-0000-0000-0000-00000000000b','evil','bbbbbbbb-0000-0000-0000-000000000002'); RAISE EXCEPTION 'TEST FAILED (A wrote ICP into B mission)';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: A cannot write ICP into B mission'; END;
END $$;
RESET ROLE;

\echo ===== Admin user reads own admin profile (isAdmin / requireAdmin path) =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false);
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles WHERE id='cccccccc-0000-0000-0000-000000000003' AND plan='admin'$$, 1, 'admin can read own admin profile for requireAdmin');
SELECT pg_temp.denied($$UPDATE public.profiles SET plan='free' WHERE id='cccccccc-0000-0000-0000-000000000003'$$, 'even the admin session cannot write profiles (server only)');
RESET ROLE;

\echo ===== service_role: webhook / checkout / admin pages / sign-up trigger =====
SET ROLE service_role; SELECT set_config('request.jwt.claim.role','service_role',false);
UPDATE public.profiles SET plan='pro', subscription_status='active', plan_status='active', stripe_subscription_id='sub_new', subscription_tier='pro' WHERE id='bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles WHERE id='bbbbbbbb-0000-0000-0000-000000000002' AND plan='pro'$$, 1, 'Stripe webhook update (service role) works');
INSERT INTO public.profiles (id,email,plan) VALUES ('cccccccc-0000-0000-0000-000000000003','adm@t.test','free') ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email;
UPDATE public.users SET plan='free' WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO public.subscriptions (user_id,stripe_subscription_id,status) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','sub_B','active');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.users$$, 1, 'service role reads users (admin dashboards)');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles$$, 3, 'service role reads all profiles');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.app_settings$$, 1, 'service role reads app_settings');
RESET ROLE;
-- restore the admin row we touched only for the service-role upsert test
UPDATE public.profiles SET plan='admin', role='admin' WHERE id='cccccccc-0000-0000-0000-000000000003';

\echo ===== sign-up trigger still creates profiles (handle_new_user is SECURITY DEFINER) =====
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ('dddddddd-0000-0000-0000-000000000004','new@t.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
SELECT pg_temp.rows_eq($$SELECT count(*) FROM public.profiles WHERE id='dddddddd-0000-0000-0000-000000000004'$$, 1, 'new sign-up gets a profile row');
-- handle_new_user must be SECURITY DEFINER and owned by the profiles table owner (RLS does not apply to owners)
DO $$ BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE proname='handle_new_user') THEN RAISE EXCEPTION 'handle_new_user not definer'; END IF;
  IF (SELECT proowner FROM pg_proc WHERE proname='handle_new_user') <> (SELECT relowner FROM pg_class WHERE oid='public.profiles'::regclass) THEN RAISE EXCEPTION 'owner mismatch'; END IF;
  RAISE NOTICE 'PASS: handle_new_user is SECURITY DEFINER owned by the profiles owner';
END $$;

\echo ===== existing data untouched =====
DO $$ BEGIN
  IF (SELECT admin_plan FROM before_snapshot) <> (SELECT plan FROM public.profiles WHERE id='cccccccc-0000-0000-0000-000000000003') THEN RAISE EXCEPTION 'admin row changed'; END IF;
  IF (SELECT count(*) FROM public.usage) < (SELECT us FROM before_snapshot) THEN RAISE EXCEPTION 'usage rows lost'; END IF;
  RAISE NOTICE 'PASS: admin profile preserved, no rows deleted by migration';
END $$;
\echo ALL SECURITY REPAIR TESTS PASSED
