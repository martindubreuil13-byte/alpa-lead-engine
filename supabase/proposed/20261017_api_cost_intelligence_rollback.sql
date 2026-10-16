-- Rolls back 20261017_api_cost_intelligence.sql. Drops only the objects it created; recorded cost rows, reconciliations, prepaid
-- purchases and their edit history, and tracking-failure records are lost.
DROP FUNCTION IF EXISTS public.admin_tracking_health();
DROP FUNCTION IF EXISTS public.admin_edit_prepaid_purchase(bigint, integer, date, numeric, text, numeric, numeric, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_reconciliation_overview(date, text);
DROP FUNCTION IF EXISTS public.admin_research_history(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.admin_cost_overview(timestamptz, timestamptz, text);
DROP TABLE IF EXISTS public.api_prepaid_purchase_history;
DROP TABLE IF EXISTS public.api_prepaid_purchases;
DROP FUNCTION IF EXISTS public.api_prepaid_history_guard();
DROP FUNCTION IF EXISTS public.api_prepaid_purchases_guard();
DROP TABLE IF EXISTS public.api_tracking_failures;
DROP TABLE IF EXISTS public.api_billing_reconciliations;
DROP TABLE IF EXISTS public.api_cost_limits;
DROP TABLE IF EXISTS public.api_usage_runs;
DROP TABLE IF EXISTS public.api_usage_events;
