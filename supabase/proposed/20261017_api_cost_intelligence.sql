-- PROPOSED, NOT APPLIED. API cost intelligence (admin dashboard "Costs").
-- Adds three tables and one read function. Additive only: no existing table, function, policy or limit is changed.
-- Everything is service-role only (the admin dashboard reads it through an admin-guarded route); customers cannot read it.
-- Rows hold counts, ids and an ESTIMATE at list price. They never hold keys, query text, request/response bodies or email addresses.

-- 1. One row per provider request (a Google Place Details request is ONE row listing the data SKUs it generated).
CREATE TABLE IF NOT EXISTS public.api_usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL CHECK (provider IN ('serper', 'google_places', 'openai')),
  operation text NOT NULL CHECK (operation IN ('maps_search', 'text_search', 'place_details', 'chat_completion')),
  purpose text NOT NULL DEFAULT 'other' CHECK (purpose IN ('discovery', 'research_profile', 'guest_profile', 'outreach', 'agent', 'other')),
  audience text NOT NULL DEFAULT 'system' CHECK (audience IN ('guest', 'member', 'system')),
  run_id uuid,
  user_id uuid,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  credits numeric(12, 3),
  input_tokens integer,
  output_tokens integer,
  model text,
  skus text[],
  estimated_cost_usd numeric(12, 6) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  cost_basis text NOT NULL DEFAULT 'estimate' CHECK (cost_basis IN ('estimate')),
  ok boolean NOT NULL DEFAULT true,
  http_status integer,
  results_returned integer
);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON public.api_usage_events (created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider_created ON public.api_usage_events (provider, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_run ON public.api_usage_events (run_id) WHERE run_id IS NOT NULL;

-- 2. One row per discovery run: what the customer actually received from the spending.
CREATE TABLE IF NOT EXISTS public.api_usage_runs (
  run_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  audience text NOT NULL DEFAULT 'member' CHECK (audience IN ('guest', 'member', 'system')),
  delivered integer NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  duplicates integer NOT NULL DEFAULT 0 CHECK (duplicates >= 0),
  rejected integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  stop_reason text
);
CREATE INDEX IF NOT EXISTS idx_api_usage_runs_created ON public.api_usage_runs (created_at);

-- 3. Spending thresholds. Alert infrastructure only: nothing reads `enforce` yet, and no row is created by this file.
CREATE TABLE IF NOT EXISTS public.api_cost_limits (
  scope text NOT NULL CHECK (scope IN ('monthly', 'run')),
  provider text NOT NULL CHECK (provider IN ('serper', 'google_places', 'openai', 'all')),
  limit_usd numeric(12, 2) NOT NULL CHECK (limit_usd > 0),
  alert_at_percent integer NOT NULL DEFAULT 80 CHECK (alert_at_percent BETWEEN 1 AND 100),
  enforce boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, provider)
);

ALTER TABLE public.api_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cost_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_usage_events, public.api_usage_runs, public.api_cost_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.api_usage_events, public.api_usage_runs, public.api_cost_limits TO service_role;

-- 4. One aggregated answer for the dashboard (never raw rows). The range is [p_from, p_to). Days are grouped in p_tz.
CREATE OR REPLACE FUNCTION public.admin_cost_overview(p_from timestamptz, p_to timestamptz, p_tz text DEFAULT 'UTC')
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH e AS (
    SELECT * FROM public.api_usage_events WHERE created_at >= p_from AND created_at < p_to
  ),
  month AS (
    SELECT date_trunc('month', p_to - interval '1 second', p_tz) AS m0
  )
  SELECT jsonb_build_object(
    'by_operation', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'provider', provider, 'operation', operation, 'requests', requests, 'failed', failed, 'credits', credits,
        'input_tokens', input_tokens, 'output_tokens', output_tokens, 'cost', cost, 'unpriced', unpriced
      ) ORDER BY provider, operation)
      FROM (
        SELECT provider, operation, sum(request_count)::bigint AS requests,
               sum(request_count) FILTER (WHERE NOT ok)::bigint AS failed,
               coalesce(sum(credits), 0) AS credits,
               coalesce(sum(input_tokens), 0)::bigint AS input_tokens, coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
               coalesce(sum(estimated_cost_usd), 0) AS cost,
               sum(request_count) FILTER (WHERE estimated_cost_usd IS NULL)::bigint AS unpriced
        FROM e GROUP BY provider, operation
      ) t), '[]'::jsonb),
    'by_purpose', coalesce((
      SELECT jsonb_agg(jsonb_build_object('provider', provider, 'purpose', purpose, 'requests', requests, 'ok_requests', ok_requests, 'cost', cost) ORDER BY provider, purpose)
      FROM (
        SELECT provider, purpose, sum(request_count)::bigint AS requests,
               coalesce(sum(request_count) FILTER (WHERE ok), 0)::bigint AS ok_requests, coalesce(sum(estimated_cost_usd), 0) AS cost
        FROM e GROUP BY provider, purpose
      ) t), '[]'::jsonb),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', day, 'provider', provider, 'requests', requests, 'cost', cost) ORDER BY day, provider)
      FROM (
        SELECT to_char(timezone(p_tz, created_at), 'YYYY-MM-DD') AS day, provider, sum(request_count)::bigint AS requests,
               coalesce(sum(estimated_cost_usd), 0) AS cost
        FROM e GROUP BY 1, 2
      ) t), '[]'::jsonb),
    'daily_delivered', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', day, 'runs', runs, 'delivered', delivered) ORDER BY day)
      FROM (
        SELECT to_char(timezone(p_tz, created_at), 'YYYY-MM-DD') AS day, count(*)::bigint AS runs, sum(delivered)::bigint AS delivered
        FROM public.api_usage_runs WHERE created_at >= p_from AND created_at < p_to GROUP BY 1
      ) t), '[]'::jsonb),
    'runs', (
      SELECT jsonb_build_object('count', count(*), 'delivered', coalesce(sum(delivered), 0), 'duplicates', coalesce(sum(duplicates), 0), 'rejected', coalesce(sum(rejected), 0))
      FROM public.api_usage_runs WHERE created_at >= p_from AND created_at < p_to),
    'first_event_at', (SELECT min(created_at) FROM public.api_usage_events),
    'month_by_provider', coalesce((
      SELECT jsonb_agg(jsonb_build_object('provider', provider, 'cost', cost))
      FROM (SELECT provider, coalesce(sum(estimated_cost_usd), 0) AS cost
            FROM public.api_usage_events, month WHERE created_at >= month.m0 AND created_at < p_to GROUP BY provider) t), '[]'::jsonb),
    'google_month_events', coalesce((
      SELECT jsonb_object_agg(sku, n)
      FROM (SELECT sku, sum(request_count)::bigint AS n
            FROM public.api_usage_events, month, unnest(coalesce(skus, ARRAY[]::text[])) AS sku
            WHERE provider = 'google_places' AND ok AND created_at >= month.m0 AND created_at < p_to GROUP BY sku) t), '{}'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.admin_cost_overview(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cost_overview(timestamptz, timestamptz, text) TO service_role;

-- 5. History that already exists: settled research charges (OpenAI profile estimates recorded by the research pipeline since run-scoped
-- billing began). Read-only over the existing ci_research_charges table; used for days before call-level tracking started.
CREATE OR REPLACE FUNCTION public.admin_research_history(p_from timestamptz, p_to timestamptz, p_tz text DEFAULT 'UTC')
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', day, 'settled', settled, 'cost', cost) ORDER BY day)
      FROM (
        SELECT to_char(timezone(p_tz, settled_at), 'YYYY-MM-DD') AS day, count(*)::bigint AS settled, coalesce(sum(actual_usd), 0) AS cost
        FROM public.ci_research_charges
        WHERE state = 'settled' AND settled_at >= p_from AND settled_at < p_to GROUP BY 1
      ) t), '[]'::jsonb),
    'first_settled_at', (SELECT min(settled_at) FROM public.ci_research_charges WHERE state = 'settled')
  );
$$;
REVOKE ALL ON FUNCTION public.admin_research_history(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_research_history(timestamptz, timestamptz, text) TO service_role;
