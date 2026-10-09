-- PREPARED, NOT APPLIED. Follow-up to 20261009/20261010.
--
-- Problem: public.usage grants authenticated INSERT/UPDATE (owner-scoped), so a
-- signed-in customer can edit their own leads_limit / leads_used, or insert a fresh
-- period row, and bypass their quota. public.increment_usage() is also callable by
-- signed-in users and takes any usage row id's count.
--
-- Fix: usage becomes read-only for clients. /api/scrape (the only writer) now
-- performs its usage reads-for-update, period creation, limit sync and increments
-- with the service-role client after verifying the user server-side.
--
-- Non-destructive: no data is read or changed. Safe to re-run.
-- DEPLOY ORDER: ship the application change first (or together), then apply this
-- migration. Applying it first would make /api/scrape fail its usage writes for paid users.

DROP POLICY IF EXISTS "usage_insert_own" ON public.usage;
DROP POLICY IF EXISTS "usage_update_own" ON public.usage;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usage TO authenticated;       -- dashboard/billing/scraper read own usage
GRANT ALL ON public.usage TO service_role;

-- No client code calls increment_usage; server code uses the service role.
REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_usage(uuid, integer) TO service_role;
