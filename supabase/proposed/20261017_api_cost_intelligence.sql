-- PROPOSED, NOT APPLIED. API cost intelligence (admin dashboard "Costs").
-- Adds tables and read functions. Additive only: no existing table, function, policy or limit is changed.
-- Everything is service-role only (the admin dashboard reads and writes it through admin-guarded routes); customers cannot read it.
-- Usage rows hold counts, ids and an ESTIMATE. They never hold keys, query text, request/response bodies or email addresses.
-- Reconciliation and prepaid purchases live in their own tables and never modify a usage row.
-- Requires public.discover_save_receipts (applied by 20261014_discover_atomic_saves.sql): the tracking-health check compares
-- member discovery runs with the runs this feature recorded.

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
--    request_key makes a double submission store one purchase. A purchase can be corrected but never deleted: edits go through
--    admin_edit_prepaid_purchase, which keeps the previous values in api_prepaid_purchase_history first. Nothing here touches usage.
CREATE TABLE IF NOT EXISTS public.api_prepaid_purchases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_key text NOT NULL UNIQUE CHECK (char_length(request_key) BETWEEN 8 AND 64),
  provider text NOT NULL CHECK (provider IN ('serper', 'google_places', 'openai')),
  purchased_on date NOT NULL,
  amount_paid numeric(14, 4) NOT NULL CHECK (amount_paid > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  exchange_rate_to_usd numeric(14, 6) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_usd > 0),
  amount_usd numeric(14, 4) GENERATED ALWAYS AS (round(amount_paid * exchange_rate_to_usd, 4)) STORED,
  credits numeric(14, 2) CHECK (credits IS NULL OR credits > 0),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz,
  CHECK ((currency = 'USD') = (exchange_rate_to_usd = 1))
);

-- Append-only audit trail: one row per edit, holding the values that were replaced, who changed them and when.
CREATE TABLE IF NOT EXISTS public.api_prepaid_purchase_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_id bigint NOT NULL REFERENCES public.api_prepaid_purchases (id),
  replaced_version integer NOT NULL,
  request_key text NOT NULL UNIQUE,
  purchased_on date NOT NULL,
  amount_paid numeric(14, 4) NOT NULL,
  currency text NOT NULL,
  exchange_rate_to_usd numeric(14, 6) NOT NULL,
  amount_usd numeric(14, 4) NOT NULL,
  credits numeric(14, 2),
  note text,
  changed_by uuid,
  changed_by_label text CHECK (changed_by_label IS NULL OR char_length(changed_by_label) <= 200),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, replaced_version)
);
CREATE INDEX IF NOT EXISTS idx_api_prepaid_history_purchase ON public.api_prepaid_purchase_history (purchase_id);

CREATE OR REPLACE FUNCTION public.api_prepaid_purchases_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Prepaid purchases cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('alpa.purchase_edit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Prepaid purchases are changed only through admin_edit_prepaid_purchase' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS api_prepaid_purchases_guard_row ON public.api_prepaid_purchases;
CREATE TRIGGER api_prepaid_purchases_guard_row BEFORE UPDATE OR DELETE ON public.api_prepaid_purchases FOR EACH ROW EXECUTE FUNCTION public.api_prepaid_purchases_guard();
DROP TRIGGER IF EXISTS api_prepaid_purchases_guard_truncate ON public.api_prepaid_purchases;
CREATE TRIGGER api_prepaid_purchases_guard_truncate BEFORE TRUNCATE ON public.api_prepaid_purchases FOR EACH STATEMENT EXECUTE FUNCTION public.api_prepaid_purchases_guard();

CREATE OR REPLACE FUNCTION public.api_prepaid_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The prepaid purchase history is append-only' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS api_prepaid_history_guard_row ON public.api_prepaid_purchase_history;
CREATE TRIGGER api_prepaid_history_guard_row BEFORE UPDATE OR DELETE ON public.api_prepaid_purchase_history FOR EACH ROW EXECUTE FUNCTION public.api_prepaid_history_guard();
DROP TRIGGER IF EXISTS api_prepaid_history_guard_truncate ON public.api_prepaid_purchase_history;
CREATE TRIGGER api_prepaid_history_guard_truncate BEFORE TRUNCATE ON public.api_prepaid_purchase_history FOR EACH STATEMENT EXECUTE FUNCTION public.api_prepaid_history_guard();

-- 5b. Tracking health: usage-write failures that could be recorded. A row is a batch (a count between two moments), written when the
--     database is next reachable. Only counts, times and a short error code are kept: never a message, a query or a payload.
--     A failure while the database is unreachable cannot be written, and an instance that is killed mid-request records nothing.
CREATE TABLE IF NOT EXISTS public.api_tracking_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  occurred_first_at timestamptz NOT NULL,
  occurred_last_at timestamptz NOT NULL,
  failed_count integer NOT NULL CHECK (failed_count > 0),
  kind text NOT NULL CHECK (kind IN ('write_failed', 'timeout', 'mixed')),
  detail_code text CHECK (detail_code IS NULL OR char_length(detail_code) <= 16)
);
CREATE INDEX IF NOT EXISTS idx_api_tracking_failures_last ON public.api_tracking_failures (occurred_last_at);

ALTER TABLE public.api_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_cost_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_billing_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_prepaid_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_prepaid_purchase_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tracking_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_usage_events, public.api_usage_runs, public.api_cost_limits, public.api_billing_reconciliations, public.api_prepaid_purchases,
  public.api_prepaid_purchase_history, public.api_tracking_failures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.api_usage_events, public.api_usage_runs, public.api_cost_limits, public.api_billing_reconciliations, public.api_tracking_failures TO service_role;
-- Purchases and their history: no delete and no truncate for anyone, in addition to the triggers above.
GRANT SELECT, INSERT, UPDATE ON public.api_prepaid_purchases TO service_role;
GRANT SELECT, INSERT ON public.api_prepaid_purchase_history TO service_role;

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
      SELECT jsonb_agg(
        (to_jsonb(p) - 'created_by' - 'updated_by' - 'request_key') ||
        jsonb_build_object('history', coalesce((
          SELECT jsonb_agg(to_jsonb(h) - 'changed_by' - 'request_key' - 'purchase_id' ORDER BY h.replaced_version)
          FROM public.api_prepaid_purchase_history h WHERE h.purchase_id = p.id), '[]'::jsonb))
        ORDER BY purchased_on DESC, id DESC)
      FROM (SELECT * FROM public.api_prepaid_purchases ORDER BY purchased_on DESC, id DESC LIMIT 50) p), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.admin_reconciliation_overview(date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reconciliation_overview(date, text) TO service_role;

-- 9. Edit a prepaid purchase. One transaction: lock the row, ignore a repeated request, refuse a stale version, keep the values being
--    replaced in the history, then update. Only api_prepaid_purchases and its history are touched; usage and reconciliations never are.
--    Returns {status: 'updated' | 'duplicate' | 'stale' | 'unchanged' | 'not_found', version}.
CREATE OR REPLACE FUNCTION public.admin_edit_prepaid_purchase(
  p_id bigint, p_expected_version integer, p_purchased_on date, p_amount_paid numeric, p_currency text, p_rate numeric,
  p_credits numeric, p_note text, p_admin uuid, p_admin_label text, p_request_key text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.api_prepaid_purchases%ROWTYPE;
BEGIN
  IF p_request_key IS NULL OR char_length(p_request_key) NOT BETWEEN 8 AND 64 THEN
    RAISE EXCEPTION 'A request key is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.api_prepaid_purchases WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF EXISTS (SELECT 1 FROM public.api_prepaid_purchase_history WHERE request_key = p_request_key) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'version', v.version);
  END IF;
  IF v.version <> p_expected_version THEN RETURN jsonb_build_object('status', 'stale', 'version', v.version); END IF;
  IF v.purchased_on = p_purchased_on AND v.amount_paid = p_amount_paid AND v.currency = p_currency
     AND v.exchange_rate_to_usd = p_rate AND v.credits IS NOT DISTINCT FROM p_credits AND v.note IS NOT DISTINCT FROM p_note THEN
    RETURN jsonb_build_object('status', 'unchanged', 'version', v.version);
  END IF;

  INSERT INTO public.api_prepaid_purchase_history
    (purchase_id, replaced_version, request_key, purchased_on, amount_paid, currency, exchange_rate_to_usd, amount_usd, credits, note, changed_by, changed_by_label)
  VALUES
    (v.id, v.version, p_request_key, v.purchased_on, v.amount_paid, v.currency, v.exchange_rate_to_usd, v.amount_usd, v.credits, v.note, p_admin, left(p_admin_label, 200));

  PERFORM set_config('alpa.purchase_edit', 'on', true);
  UPDATE public.api_prepaid_purchases
     SET purchased_on = p_purchased_on, amount_paid = p_amount_paid, currency = p_currency, exchange_rate_to_usd = p_rate,
         credits = p_credits, note = p_note, version = v.version + 1, updated_by = p_admin, updated_at = now()
   WHERE id = v.id;
  PERFORM set_config('alpa.purchase_edit', 'off', true);
  RETURN jsonb_build_object('status', 'updated', 'version', v.version + 1);
END $$;
REVOKE ALL ON FUNCTION public.admin_edit_prepaid_purchase(bigint, integer, date, numeric, text, numeric, numeric, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_prepaid_purchase(bigint, integer, date, numeric, text, numeric, numeric, text, uuid, text, text) TO service_role;

-- 10. Raw facts for the tracking-health panel (the verdict is decided in the application). "Expected" activity is independent of this
--     feature: member discovery runs that saved results (discover_save_receipts) once tracking had started, older than 15 minutes so a
--     run still finishing is not counted as missing. Guest searches and AI profile calls have no such independent record.
CREATE OR REPLACE FUNCTION public.admin_tracking_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH started AS (SELECT min(created_at) AS t FROM public.api_usage_events),
  win AS (
    SELECT greatest(now() - interval '7 days', (SELECT t FROM started) - interval '1 hour') AS from_t, now() - interval '15 minutes' AS to_t
  ),
  expected AS (
    SELECT r.run_id FROM public.discover_save_receipts r, win WHERE r.created_at >= win.from_t AND r.created_at < win.to_t
  )
  SELECT jsonb_build_object(
    'first_event_at', (SELECT t FROM started),
    'last_event_at', (SELECT max(created_at) FROM public.api_usage_events),
    'events_24h', (SELECT count(*) FROM public.api_usage_events WHERE created_at >= now() - interval '24 hours'),
    'expected_runs', (SELECT count(*) FROM expected),
    'covered_runs', (SELECT count(*) FROM expected e WHERE EXISTS (SELECT 1 FROM public.api_usage_runs u WHERE u.run_id = e.run_id)),
    'failures_7d', (SELECT coalesce(sum(failed_count), 0) FROM public.api_tracking_failures WHERE occurred_last_at >= now() - interval '7 days'),
    'failures_30d', (SELECT coalesce(sum(failed_count), 0) FROM public.api_tracking_failures WHERE occurred_last_at >= now() - interval '30 days'),
    'last_failure_at', (SELECT max(occurred_last_at) FROM public.api_tracking_failures)
  );
$$;
REVOKE ALL ON FUNCTION public.admin_tracking_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tracking_health() TO service_role;
