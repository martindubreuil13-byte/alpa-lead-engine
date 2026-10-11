-- Disposable PostgreSQL 17 fixture only. NEVER run this file in production.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users);
CREATE TABLE public.usage(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.profiles,
 leads_used integer NOT NULL DEFAULT 0, leads_limit integer NOT NULL, period_start timestamp NOT NULL, period_end timestamp NOT NULL);
CREATE TABLE public.leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users,
 company_name text NOT NULL, email text, phone text, website text, city text, industry text, status text DEFAULT 'inbox',
 source text, email_confidence text, email_source text, is_generic_email boolean, cost_estimate numeric,
 last_activity_at timestamptz, created_at timestamptz DEFAULT now(), CHECK(email IS NOT NULL OR phone IS NOT NULL), CHECK(status IN ('inbox','pipeline','contacted','followup_due','followup_sent','closed_no_response','replied','rejected')));
INSERT INTO auth.users VALUES('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),
 ('33333333-3333-3333-3333-333333333333'),('44444444-4444-4444-4444-444444444444'),('55555555-5555-5555-5555-555555555555');
INSERT INTO public.profiles SELECT id FROM auth.users;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
\ir ../../supabase/proposed/20261014_discover_atomic_saves.sql
SELECT set_config('request.jwt.claim.role','service_role',false);
CREATE FUNCTION pg_temp.check_it(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
DO $$
DECLARE a jsonb; b jsonb; payload jsonb := '[{"company_name":"A","phone":"123","user_id":"22222222-2222-2222-2222-222222222222","status":"won"},{"company_name":"A","phone":"123"},{"company_name":"No contact"},{"company_name":"B","email":"b@example.com"},{"company_name":"C","phone":"456"}]';
BEGIN
 a := public.save_discover_results('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',2,true,payload);
 PERFORM pg_temp.check_it(a->>'leads_used'='2','only successful inserts consume monthly usage');
 PERFORM pg_temp.check_it(a->'outcomes'->1->>'status'='duplicate','duplicates do not consume capacity');
 PERFORM pg_temp.check_it(a->'outcomes'->2->>'status'='invalid','missing contacts do not consume capacity');
 PERFORM pg_temp.check_it(a->'outcomes'->4->>'status'='limit','remaining capacity enforced in transaction');
 PERFORM pg_temp.check_it((SELECT count(*)=2 FROM leads WHERE user_id='11111111-1111-1111-1111-111111111111' AND status='inbox'),'owner and status cannot be overwritten by payload');
 b := public.save_discover_results('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',2,true,payload);
 PERFORM pg_temp.check_it(a=b AND (SELECT leads_used=2 FROM usage WHERE user_id='11111111-1111-1111-1111-111111111111'),'same batch replay returns receipt without double counting');
 BEGIN
  PERFORM public.save_discover_results('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',2,true,'[]');
  RAISE EXCEPTION 'changed payload unexpectedly accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM pg_temp.check_it(true,'changed input cannot reuse a receipt');
 a := public.save_discover_results('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222',1,false,'[{"company_name":"Free A","phone":"1"},{"company_name":"Free B","phone":"2"}]');
 PERFORM pg_temp.check_it(a->>'leads_used'='1' AND a->'outcomes'->1->>'status'='limit','free plan counts stored leads and enforces capacity');
 PERFORM pg_temp.check_it(NOT EXISTS(SELECT 1 FROM usage WHERE user_id='22222222-2222-2222-2222-222222222222'),'free plan does not start monthly accounting');
 PERFORM pg_temp.check_it(NOT has_function_privilege('authenticated','public.save_discover_results(uuid,uuid,integer,boolean,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.get_discover_capacity(uuid,integer,boolean)','EXECUTE'),'clients cannot execute accounting RPCs');
 PERFORM pg_temp.check_it(NOT has_table_privilege('authenticated','public.discover_save_receipts','SELECT'),'receipts are server-only');
END $$;
CREATE FUNCTION fail_usage_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.user_id='33333333-3333-3333-3333-333333333333' AND NEW.leads_used>0 THEN RAISE EXCEPTION 'simulated usage failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fail_usage_write BEFORE UPDATE ON usage FOR EACH ROW EXECUTE FUNCTION fail_usage_write();
DO $$ BEGIN
 BEGIN
  PERFORM public.save_discover_results('cccccccc-cccc-cccc-cccc-cccccccccccc','33333333-3333-3333-3333-333333333333',5,true,'[{"company_name":"Rollback","phone":"1"}]');
  RAISE EXCEPTION 'update should fail';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'simulated usage failure' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.check_it(NOT EXISTS(SELECT 1 FROM leads WHERE user_id='33333333-3333-3333-3333-333333333333') AND NOT EXISTS(SELECT 1 FROM discover_save_receipts WHERE run_id='cccccccc-cccc-cccc-cccc-cccccccccccc'),'usage failure rolls back leads and receipt');
END $$;
DROP TRIGGER fail_usage_write ON usage;
-- Concurrent-run harness uses this delay to force overlapping transactions.
CREATE FUNCTION delay_test_lead() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.user_id IN ('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555') THEN PERFORM pg_sleep(0.3); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delay_test_lead BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION delay_test_lead();
-- Unexpected save failures abort the entire batch, including earlier inserts.
CREATE FUNCTION reject_test_lead() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.company_name='Explode' THEN RAISE EXCEPTION 'simulated save failure'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER reject_test_lead BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION reject_test_lead();
DO $$ BEGIN
 BEGIN
  PERFORM public.save_discover_results('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','33333333-3333-3333-3333-333333333333',5,true,'[{"company_name":"Earlier in batch","phone":"1"},{"company_name":"Explode","phone":"2"}]');
  RAISE EXCEPTION 'save should fail';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'simulated save failure' THEN RAISE; END IF; END;
 PERFORM pg_temp.check_it(NOT EXISTS(SELECT 1 FROM leads WHERE company_name='Earlier in batch') AND NOT EXISTS(SELECT 1 FROM discover_save_receipts WHERE run_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),'later save error rolls back earlier inserts and receipt');
END $$;
DROP TRIGGER reject_test_lead ON leads;
-- Same source business in a different run is a duplicate, not another charge.
DO $$ DECLARE r jsonb; BEGIN
 r:=public.save_discover_results('ffffffff-ffff-ffff-ffff-ffffffffffff','11111111-1111-1111-1111-111111111111',5,true,'[{"company_name":"A","phone":"123"}]');
 PERFORM pg_temp.check_it(r->>'leads_used'='2' AND r->'outcomes'->0->>'status'='duplicate','a duplicate in another run does not consume usage');
END $$;
-- Optional activity metadata does not make saves fail against an older schema.
ALTER TABLE public.leads DROP COLUMN last_activity_at;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.save_discover_results('abababab-abab-abab-abab-abababababab','11111111-1111-1111-1111-111111111111',5,true,'[{"company_name":"Older schema","phone":"123"}]');
 PERFORM pg_temp.check_it(r->>'leads_used'='3' AND r->'outcomes'->0->>'status'='saved','missing optional activity column is supported');
END $$;
-- A caller without the trusted server role cannot exploit SECURITY DEFINER.
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $$ BEGIN
 BEGIN
  PERFORM public.get_discover_capacity('11111111-1111-1111-1111-111111111111',10000,true);
  RAISE EXCEPTION 'role guard should deny';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.check_it(true,'role guard rejects an untrusted caller');
END $$;

SELECT set_config('request.jwt.claim.role','service_role',false);
-- Real production has no business uniqueness constraint; match normalized identity under the owner lock.
DO $$ DECLARE r jsonb; BEGIN
 r:=public.save_discover_results('12121212-1212-1212-1212-121212121212','11111111-1111-1111-1111-111111111111',20,true,'[{"company_name":"  a  ","phone":"(1) 23"},{"company_name":"A","phone":"123","city":"Other branch"},{"company_name":"A","email":"different@example.com"}]');
 PERFORM pg_temp.check_it(r->'outcomes'->0->>'status'='duplicate','formatted phone and name identify existing business');
 PERFORM pg_temp.check_it(r->'outcomes'->1->>'status'='saved','different location remains a separate business');
 PERFORM pg_temp.check_it(r->'outcomes'->2->>'status'='saved','same name without matching contact remains distinct');
 r:=public.save_discover_results('13131313-1313-1313-1313-131313131313','22222222-2222-2222-2222-222222222222',20,false,'[{"company_name":"A","phone":"123"}]');
 PERFORM pg_temp.check_it(r->'outcomes'->0->>'status'='saved','duplicate detection is scoped to authenticated owner');
END $$;
