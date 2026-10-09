-- Database-level authorization tests for the CI worker migration.
-- Run against a THROWAWAY local Postgres (Supabase image), never production:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/worker-eligibility.sql
-- The migration's pg_cron/pg_net/vault tail is excluded (needs hosted extensions).

\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_name TEXT, website TEXT, commercial_profile JSONB,
  website_snapshot JSONB, business_signals JSONB,
  ci_enrichment_status VARCHAR(50) DEFAULT 'pending',
  ci_last_error TEXT, ci_retry_count INT DEFAULT 0,
  ci_started_at TIMESTAMPTZ, ci_completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS commercial_intelligence_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  retry_count INT NOT NULL DEFAULT 0, max_retries INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, last_error TEXT, last_retry_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_queue_unique_active_per_lead
  ON commercial_intelligence_queue(lead_id) WHERE status IN ('pending','processing');
ALTER TABLE commercial_intelligence_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY q_sel ON commercial_intelligence_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY q_ins ON commercial_intelligence_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY q_upd ON commercial_intelligence_queue FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE ON commercial_intelligence_queue, leads TO authenticated;
GRANT ALL ON commercial_intelligence_queue, leads TO service_role;

\i /tmp/migration_core.sql

CREATE OR REPLACE FUNCTION pg_temp.expect_fail(sql TEXT, label TEXT) RETURNS void AS $$
BEGIN
  EXECUTE sql;
  RAISE EXCEPTION 'TEST FAILED (statement succeeded): %', label;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: %', label;
END $$ LANGUAGE plpgsql;

INSERT INTO leads (id, user_id, company_name, website) VALUES
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','Clinic A','https://a.example'),
 ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','Clinic B','https://b.example'),
 ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','Done Clinic','https://c.example'),
 ('00000000-0000-0000-0000-0000000000a4','11111111-1111-1111-1111-111111111111','No Site',NULL),
 ('00000000-0000-0000-0000-0000000000a5','22222222-2222-2222-2222-222222222222','Other user','https://o.example');
UPDATE leads SET commercial_profile='{"summary":"Existing valid profile"}', ci_enrichment_status='completed'
  WHERE id='00000000-0000-0000-0000-0000000000a3';
-- historical pending row, ineligible
INSERT INTO commercial_intelligence_queue (lead_id,user_id) VALUES
 ('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111');

-- ===== ordinary authenticated user =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

-- legitimate public insert (default eligibility) still works
INSERT INTO commercial_intelligence_queue (lead_id,user_id) VALUES
 ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111');
-- explicit false still works
UPDATE commercial_intelligence_queue SET worker_eligible=false WHERE lead_id='00000000-0000-0000-0000-0000000000a1';
-- ordinary status update still works
UPDATE commercial_intelligence_queue SET status='processing', started_at=now() WHERE lead_id='00000000-0000-0000-0000-0000000000a1';
UPDATE commercial_intelligence_queue SET status='pending', started_at=NULL WHERE lead_id='00000000-0000-0000-0000-0000000000a1';

-- attacks
SELECT pg_temp.expect_fail($$INSERT INTO commercial_intelligence_queue (lead_id,user_id,worker_eligible) VALUES ('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111',true)$$, 'authenticated INSERT worker_eligible=true rejected');
SELECT pg_temp.expect_fail($$UPDATE commercial_intelligence_queue SET worker_eligible=true WHERE lead_id='00000000-0000-0000-0000-0000000000a1'$$, 'authenticated UPDATE to worker_eligible=true rejected');
SELECT pg_temp.expect_fail($$SELECT enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111')$$, 'authenticated cannot call enqueue RPC');
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',false);
SELECT set_config('request.jwt.claim.role','anon',false);
SELECT pg_temp.expect_fail($$INSERT INTO commercial_intelligence_queue (lead_id,user_id,worker_eligible) VALUES ('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111',true)$$, 'anon insert rejected');
RESET ROLE;

-- ===== service role (trusted server) =====
SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE r TEXT; n INT;
BEGIN
  r := enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111');
  IF r <> 'enabled_existing' THEN RAISE EXCEPTION 'a1 expected enabled_existing got %', r; END IF;
  r := enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111');
  IF r <> 'already_queued' THEN RAISE EXCEPTION 'a1 repeat expected already_queued got %', r; END IF;
  r := enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111');
  IF r <> 'enabled_existing' THEN RAISE EXCEPTION 'a2 expected enabled_existing got %', r; END IF;
  r := enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111');
  IF r <> 'already_complete' THEN RAISE EXCEPTION 'a3 expected already_complete got %', r; END IF;
  r := enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a4','11111111-1111-1111-1111-111111111111');
  IF r <> 'no_website' THEN RAISE EXCEPTION 'a4 expected no_website got %', r; END IF;
  r := enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a5','11111111-1111-1111-1111-111111111111');
  IF r <> 'lead_not_found' THEN RAISE EXCEPTION 'cross-user expected lead_not_found got %', r; END IF;
  SELECT count(*) INTO n FROM commercial_intelligence_queue WHERE lead_id IN ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2');
  IF n <> 2 THEN RAISE EXCEPTION 'duplicate queue rows created: %', n; END IF;
  SELECT count(*) INTO n FROM commercial_intelligence_queue WHERE lead_id='00000000-0000-0000-0000-0000000000a3';
  IF n <> 0 THEN RAISE EXCEPTION 'completed lead was queued'; END IF;
  IF (SELECT commercial_profile->>'summary' FROM leads WHERE id='00000000-0000-0000-0000-0000000000a3') <> 'Existing valid profile' THEN
    RAISE EXCEPTION 'completed profile overwritten'; END IF;
  RAISE NOTICE 'PASS: service-role enqueue (existing, repeat, complete, no-website, cross-user, no duplicates)';
END $$;

-- requeue a previously failed lead (no active row) and a brand-new lead
RESET ROLE;
UPDATE leads SET ci_enrichment_status='failed', ci_last_error='boom' WHERE id='00000000-0000-0000-0000-0000000000a1';
UPDATE commercial_intelligence_queue SET status='failed', completed_at=now() WHERE lead_id='00000000-0000-0000-0000-0000000000a1';
SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE r TEXT; n INT;
BEGIN
  r := enqueue_private_preview_ci_worker('00000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111');
  IF r <> 'queued' THEN RAISE EXCEPTION 'failed lead expected queued got %', r; END IF;
  SELECT count(*) INTO n FROM commercial_intelligence_queue WHERE lead_id='00000000-0000-0000-0000-0000000000a1' AND status='pending' AND worker_eligible;
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one active eligible row, got %', n; END IF;
  IF (SELECT ci_enrichment_status FROM leads WHERE id='00000000-0000-0000-0000-0000000000a1') <> 'pending' THEN
    RAISE EXCEPTION 'lead status not reset'; END IF;
  RAISE NOTICE 'PASS: failed lead safely requeued';
END $$;
-- trusted role may also toggle directly
UPDATE commercial_intelligence_queue SET worker_eligible=false WHERE lead_id='00000000-0000-0000-0000-0000000000a2';
RESET ROLE;
\echo ALL DATABASE AUTHORIZATION TESTS PASSED
