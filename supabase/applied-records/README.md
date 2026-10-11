# Applied-by-hand database changes (historical record)

These files are records of SQL that was applied to production by hand. They are **not** in
`supabase/migrations/` on purpose: the project's migration history is not in sync with what was
applied manually, so `supabase db push` must never replay them. Do not execute them again.

## 20261012_ci_queue_integrity.sql  (B1.1)

Applied to production before 2026-10-11 and verified read-only against project `hnhptrqdirqofkwimapo` on
2026-10-11 and again before the B2 Phase 0 release:

- `guard_ci_queue_user_write`, `claim_ci_queue_items`, `complete_ci_enrichment`, `reset_stale_ci_processing`:
  the md5 of `prosrc` in production equals the md5 of the body in this file (`77e0ee0a`, `5c9bbdf6`, `68506b83`,
  `d5052492`). Production also has `idx_ci_queue_unique_active_per_lead`, `valid_status`, the `run_id` column and
  `idx_ci_queue_user_run`, the `trg_guard_ci_queue_user_write` trigger, and select/insert-only grants for
  `authenticated`.
- Its rollback, `supabase/proposed/20261012_ci_queue_integrity_rollback.sql`, was never applied.

## 20261016_ci_phase1_run_scoped.sql  (B2 Phase 1)

Applied to production by the owner through the SQL Editor on 2026-10-11, verified read-only (all 10 function bodies match the
file). Kept exactly as applied. Evidence: `20261016_ci_phase1_run_scoped.evidence.md`. Never replay it. Its undo scripts
(`disable`, which keeps every record, and `teardown_unused`, which refuses once any record exists) are in `supabase/proposed/`
and were never applied.

## 20261015_ci_phase0_lockdown.sql  (B2 Phase 0)

Applied to production by the owner through the SQL Editor on 2026-10-11 and verified read-only. The file is kept exactly as
applied (its header still reads "PROPOSED. NOT APPLIED."). Verification evidence: `20261015_ci_phase0_lockdown.evidence.md`.
Never replay it; its rollback was never applied.

## 20261014_discover_atomic_saves.sql

Verified read-only against the production database (project `hnhptrqdirqofkwimapo`) on 2026-10-11:

- `public.get_discover_capacity(uuid, integer, boolean)` and
  `public.save_discover_results(uuid, uuid, integer, boolean, jsonb)`: the md5 of `prosrc` in
  production equals the md5 of the function body in this file
  (`05c14a9873ec3bed02464cb3a8dcd40c`, 1820 chars; `aab396c1d1d0691497d82ec6aefd0b9e`, 5754 chars).
  SECURITY DEFINER, `search_path=pg_catalog, public`, `TimeZone=UTC`; EXECUTE granted to
  `service_role` only (anon and authenticated: no).
- `public.discover_save_receipts`: columns match, RLS enabled, no anon/authenticated privileges.
- The migration is absent from `supabase_migrations` history (as expected for a hand application).

Test harness: `tests/sql/discover-atomic-saves.sql`, `tests/sql/discover-atomic-save-concurrency.py`
(run against a disposable database only).
