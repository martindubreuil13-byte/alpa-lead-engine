-- PROPOSED, NOT APPLIED. API cost intelligence (admin dashboard "Costs").
-- Adds tables and read functions. Additive only: no existing table, function, policy or limit is changed.
-- Everything is service-role only (the admin dashboard reads and writes it through admin-guarded routes); customers cannot read it.
-- Usage rows hold counts, ids and an ESTIMATE. They never hold keys, query text, request/response bodies or email addresses.
-- Reconciliation and prepaid purchases live in their own tables and never modify a usage row.

-- 1. One row per provider request (a Google request is ONE row listing the billing events/SKUs it generated).
--    event_key identifies the event, so writing it twice (a retry, a second flush) stores it once.
CREATE TABLE IF NOT EXISTS public.api_usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL CHECK (provider IN ('serper', 'google_places', 'openai')),
  operation text NOT NULL CHECK (operation IN ('maps_search', 'text_search', 'place_details', 'chat_completion')),
  purpose text NOT NULL DEFAULT 'other' CHECK (purpose IN ('discovery', 'research_profile', 'guest_profile', 'outreach', 'agent', 'other')),
  audience text NOT NULL DEFAULT 'system' CHECK (audience IN ('guest', 'member', 'system')),
  run_id uuid,
  user_id uuid,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  credits numeric(12, 3),
  credits_basis text CHECK (credits_basis IN ('reported', 'configured')),
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

-- 4. Monthly reconciliation: what the provider actually charged for a month, as verified and entered by an administrator.
--    The original amount, its currency and the exchange rate used are kept; billed_usd is derived from them, never typed.
--    A row with no amount is "pending". Nothing here changes api_usage_events.
CREATE TABLE IF NOT EXISTS public.api_billing_reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  billing_month date NOT NULL CHECK (billing_month = date_trunc('month', billing_month)::date),
  provider text NOT NULL CHECK (provider IN ('serper', 'google_places', 'openai')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled')),
  billed_amount numeric(14, 4) CHECK (billed_amount IS NULL OR billed_amount >= 0),
  billed_currency text NOT NULL DEFAULT 'USD' CHECK (billed_currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_usd numeric(14, 6) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_usd > 0),
  billed_usd numeric(14, 4) GENERATED ALWAYS AS (round(billed_amount * exchange_rate_to_usd, 4)) STORED,
  reported_credits numeric(14, 2) CHECK (reported_credits IS NULL OR reported_credits >= 0),
  reconciled_on date,
  estimated_usd_at_reconciliation numeric(14, 6),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (billing_month, provider),
  -- USD is rate 1; a foreign amount must carry the rate used (a rate of exactly 1 would be a silent treat-as-USD).
  CHECK ((billed_currency = 'USD') = (exchange_rate_to_usd = 1)),
  CHECK (status = 'pending' OR (billed_amount IS NOT NULL AND reconciled_on IS NOT NULL))
);

-- 5. Prepaid purchases (Serper credits). Recorded separately: buying credits is not that month's usage expense.
CREATE TABLE IF NOT EXISTS public.api_prepaid_purchases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('serper', 'google_places', 'openai')),
  purchased_on date NOT NULL,
  amount_paid numeric(14, 4) NOT NULL CHECK (amount_paid > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_usd numeric(14, 6) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_usd > 0),
  amount_usd numeric(14, 4) GENERATED ALWAYS AS (round(amount_paid * exchange_rate_to_usd, 4)) STORED,
  credits numeric(14, 2) CHECK (credits IS NULL OR credits > 0),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((currency = 'USD') = (exchange_rate_to_usd = 1))
);

ALTER TABLE public.api_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cost_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_billing_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_prepaid_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_usage_events, public.api_usage_runs, public.api_cost_limits, public.api_billing_reconciliations, public.api_prepaid_purchases
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.api_usage_events, public.api_usage_runs, public.api_cost_limits, public.api_billing_reconciliations, public.api_prepaid_purchases
  TO service_role;

-- 6. One aggregated answer for the dashboard (never raw rows). The range is [p_from, p_to). Days are grouped in p_tz.
--    "today" and "month" are always measured up to now, whatever range is being viewed. Costs are ESTIMATES before any free allowance.
CREATE OR REPLACE FUNCTION public.admin_cost_overview(p_from timestamptz, p_to timestamptz, p_tz text DEFAULT 'UTC')
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH e AS (
    SELECT * FROM public.api_usage_events WHERE created_at >= p_from AND created_at < p_to
  ),
  clock AS (
    SELECT date_trunc('day', now(), p_tz) AS d0, date_trunc('month', now(), p_tz) AS m0
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
    'today_by_provider', coalesce((
      SELECT jsonb_agg(jsonb_build_object('provider', provider, 'cost', cost))
      FROM (SELECT provider, coalesce(sum(estimated_cost_usd), 0) AS cost
            FROM public.api_usage_events, clock WHERE created_at >= clock.d0 GROUP BY provider) t), '[]'::jsonb),
    'month_by_provider', coalesce((
      SELECT jsonb_agg(jsonb_build_object('provider', provider, 'cost', cost))
      FROM (SELECT provider, coalesce(sum(estimated_cost_usd), 0) AS cost
            FROM public.api_usage_events, clock WHERE created_at >= clock.m0 GROUP BY provider) t), '[]'::jsonb),
    'month_delivered', (
      SELECT coalesce(sum(delivered), 0)::bigint FROM public.api_usage_runs, clock WHERE created_at >= clock.m0),
    -- Google billing EVENTS (SKUs) in the range. One request generates several events; these are not extra requests.
    'google_sku_events', coalesce((
      SELECT jsonb_object_agg(sku, n)
      FROM (SELECT sku, sum(request_count)::bigint AS n
            FROM e, unnest(coalesce(skus, ARRAY[]::text[])) AS sku
            WHERE provider = 'google_places' AND ok GROUP BY sku) t), '{}'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.admin_cost_overview(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cost_overview(timestamptz, timestamptz, text) TO service_role;

-- 7. History that already exists: settled research charges (OpenAI profile estimates recorded by the research pipeline since run-scoped
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

-- 8. One billing month for the reconciliation section: the estimate per provider (from the request log, in p_tz), what was entered as
--    billed, and the prepaid purchases. p_month is any date in the month.
CREATE OR REPLACE FUNCTION public.admin_reconciliation_overview(p_month date, p_tz text DEFAULT 'UTC')
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH w AS (
    SELECT date_trunc('month', p_month)::date AS m,
           (date_trunc('month', p_month)::timestamp AT TIME ZONE p_tz) AS t0,
           ((date_trunc('month', p_month) + interval '1 month')::timestamp AT TIME ZONE p_tz) AS t1
  )
  SELECT jsonb_build_object(
    'month', (SELECT m FROM w),
    'estimated', coalesce((
      SELECT jsonb_agg(jsonb_build_object('provider', provider, 'requests', requests, 'credits', credits, 'cost', cost, 'unpriced', unpriced) ORDER BY provider)
      FROM (
        SELECT provider, sum(request_count)::bigint AS requests, coalesce(sum(credits), 0) AS credits,
               coalesce(sum(estimated_cost_usd), 0) AS cost, coalesce(sum(request_count) FILTER (WHERE estimated_cost_usd IS NULL), 0)::bigint AS unpriced
        FROM public.api_usage_events, w WHERE created_at >= w.t0 AND created_at < w.t1 GROUP BY provider
      ) t), '[]'::jsonb),
    'reconciliations', coalesce((
      SELECT jsonb_agg(to_jsonb(r) - 'updated_by' ORDER BY provider)
      FROM public.api_billing_reconciliations r, w WHERE r.billing_month = w.m), '[]'::jsonb),
    'purchases', coalesce((
      SELECT jsonb_agg(to_jsonb(p) - 'created_by' ORDER BY purchased_on DESC, id DESC)
      FROM (SELECT * FROM public.api_prepaid_purchases ORDER BY purchased_on DESC, id DESC LIMIT 50) p), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.admin_reconciliation_overview(date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconciliation_overview(date, text) TO service_role;
