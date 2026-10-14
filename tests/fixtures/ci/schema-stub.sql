-- The minimum of ALPA's production schema the research spend engine needs, for an offline engine (no Supabase). Only structure:
-- every function under test is the real one from supabase/applied-records or captured from production.
create schema if not exists auth;
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.leads (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, company_name text, website text,
  ci_enrichment_status text default 'pending', ci_last_error text, ci_retry_count integer default 0,
  ci_started_at timestamptz, ci_completed_at timestamptz, website_snapshot jsonb, business_signals jsonb, commercial_profile jsonb
);
create table public.commercial_intelligence_queue (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null, user_id uuid not null,
  status varchar not null default 'pending', retry_count integer not null default 0, max_retries integer not null default 3,
  last_retry_at timestamptz, last_error text, created_at timestamptz not null default now(), started_at timestamptz,
  completed_at timestamptz, updated_at timestamptz not null default now(), processing_duration_ms integer,
  total_cost numeric default 0, worker_eligible boolean not null default false, claim_token uuid, run_id uuid
);
create table public.discover_save_receipts (
  run_id uuid not null primary key, user_id uuid not null, request_hash text not null default '', result jsonb not null, created_at timestamptz not null default now()
);
-- The legacy worker entry points that Phase 1 revokes from the service role (their bodies are irrelevant here).
create function public.claim_ci_queue_items_worker(integer) returns void language sql as $$ select $$;
create function public.reset_stale_ci_processing_worker(integer) returns void language sql as $$ select $$;
