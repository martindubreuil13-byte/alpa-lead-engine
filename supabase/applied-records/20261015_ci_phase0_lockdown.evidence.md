# 20261015_ci_phase0_lockdown.sql — applied-by-hand evidence

Applied to production (project `hnhptrqdirqofkwimapo`) by the owner through the Supabase SQL Editor, as a script (no
`schema_migrations` row was created; the table still has its 7 original rows). Do **not** replay it. The file's own header still
says "PROPOSED. NOT APPLIED." because it is kept byte-for-byte as it was applied.

Verified read-only on 2026-10-11, after the application release `dpl_4ktutLabGAfwt3Dscw5fnE8Yw2HV` (commit `0ad05bf`):

| Check | Result |
|---|---|
| `guard_leads_research_columns()` body | md5 `91f61068837d7de3df90a4b5d1382bf0`, 1969 chars: identical to the body in this file; SECURITY INVOKER; `search_path=public, pg_temp` |
| `trg_guard_leads_research_columns` | `BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW`, enabled (`O`) |
| EXECUTE on `claim_ci_queue_items`, `complete_ci_enrichment`, `reset_stale_ci_processing`, `backfill_missing_ci_queue_entries`, `audit_ci_queue_consistency` | ACL `{postgres, service_role}` only: `authenticated`, `anon` and PUBLIC revoked |
| EXECUTE on `guard_leads_research_columns()` | not granted to `authenticated` / `anon` |
| `get_ci_statistics(uuid)` | still executable by `authenticated` (read-only) |
| Queue | 156 rows, 146 pending, 0 `worker_eligible`, fingerprint `50be1c1e9e0f94070a41c88785376966` (unchanged) |
| Scheduler | `cron.job` 0 rows, `cron.job_run_details` 0, `net.http_request_queue` 0, Vault secrets 0, Vercel project crons: no definitions |
| Research switch | `CI_RESEARCH_ENABLED` not set in any Vercel environment |

Rollback (never applied): `supabase/proposed/20261015_ci_phase0_lockdown_rollback.sql`.
