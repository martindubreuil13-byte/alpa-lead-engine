-- Rolls back 20261017_api_cost_intelligence.sql. Drops only the objects it created; the recorded cost rows are lost.
DROP FUNCTION IF EXISTS public.admin_research_history(timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.admin_cost_overview(timestamptz, timestamptz, text);
DROP TABLE IF EXISTS public.api_cost_limits;
DROP TABLE IF EXISTS public.api_usage_runs;
DROP TABLE IF EXISTS public.api_usage_events;
