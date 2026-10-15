-- Rolls back 20261017_api_cost_intelligence.sql. Drops only the objects it created; recorded cost rows, reconciliations and
-- prepaid purchases are lost.
DROP FUNCTION IF EXISTS public.admin_reconciliation_overview(date, text);
DROP FUNCTION IF EXISTS public.admin_research_history(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.admin_cost_overview(timestamptz, timestamptz, text);
DROP TABLE IF EXISTS public.api_prepaid_purchases;
DROP TABLE IF EXISTS public.api_billing_reconciliations;
DROP TABLE IF EXISTS public.api_cost_limits;
DROP TABLE IF EXISTS public.api_usage_runs;
DROP TABLE IF EXISTS public.api_usage_events;
