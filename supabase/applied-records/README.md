# Applied-by-hand database changes (historical record)

These files are records of SQL that was applied to production by hand. They are **not** in
`supabase/migrations/` on purpose: the project's migration history is not in sync with what was
applied manually, so `supabase db push` must never replay them. Do not execute them again.

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
