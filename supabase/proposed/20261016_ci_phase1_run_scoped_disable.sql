BEGIN;
SET LOCAL lock_timeout='5s';
-- PROPOSED. NOT APPLIED. The undo to use after live use: it STOPS research and removes access, and keeps every record.
--
-- It sets the database research switch OFF and clears the access list (nobody, allow_all off), so the claim function can
-- neither start nor continue research for anyone. It deletes and modifies nothing else: authorization records, the lead
-- sets, the spending ledger, queue rows, profiles and the control log all stay exactly as they are, and the action is logged.
-- Running it twice changes nothing. Re-enabling later is a deliberate, separate step (set_ci_research_access + set_ci_research_enabled).
-- A faster stop that needs no SQL: POST /api/admin/research-control {"enabled": false}.
--
-- Anything else that goes wrong after live use is fixed forward (a corrected function through the same SQL-Editor
-- process), not by dropping tables. The old first-in-first-out claim stays revoked on purpose.
UPDATE public.ci_research_controls
SET enabled = false, allow_all_customers = false, allowed_user_ids = '{}', updated_at = now(), updated_by = 'disable script'
WHERE id;
INSERT INTO public.ci_research_control_log (operator, action, detail)
VALUES ('disable script', 'disable_all', jsonb_build_object('enabled', false, 'allowed_customers', 0));
COMMIT;
