-- PREPARED ONLY: data-preserving operational rollback, NOT schema teardown.
-- Keep the current fail-closed application. Do not restore the old non-atomic guest route.
-- Pauses discovery saves/capacity and guest imports, including service-role calls.
-- Retain ledger trigger, all customer data, claims and receipts so rollback cannot reset quotas.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE ALL ON FUNCTION public.claim_guest_businesses(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_discover_results(uuid,uuid,integer,boolean,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_discover_capacity(uuid,integer,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
-- This prevents NEW calls; drain in-flight requests before running it.
-- Recovery after review: re-grant EXECUTE on these three functions to service_role only.
-- Do not drop additive tables or restore the old retained-lead capacity function.
