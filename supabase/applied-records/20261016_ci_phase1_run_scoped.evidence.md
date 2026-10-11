# 20261016_ci_phase1_run_scoped.sql — applied-by-hand evidence

Applied once to production (project `hnhptrqdirqofkwimapo`) by the owner through the Supabase SQL Editor, as a script. No
`schema_migrations` row was created (the table still has its 7 original rows). **Never replay it.** The file is kept exactly as
applied (its header still reads "PROPOSED. NOT APPLIED."; sha256 `94a41e2ff6018ae762adec988f8ead52709df69a6ee7003338cca845b9f1d838`).

Independently verified read-only on 2026-10-11, before the Phase 1 application was deployed:

| Check | Result |
|---|---|
| function bodies | all 10 `md5(prosrc)` values equal the bodies in this file: authorize `c539acf3…`, cancel `47fe4615…`, claim `29a1cee1…`, complete `84372996…`, status `c57ab0c1…`, progress `ddcd90b8…`, recover `5b384f3d…`, access `9d33e812…`, enabled `287c78cb…`, limits `26fe5f34…` |
| execution rights | every function: `authenticated`, `anon`: no; `service_role`: yes. Only `get_ci_run_progress` is executable by `authenticated` (SECURITY INVOKER; the other nine are SECURITY DEFINER) |
| tables | 5 created, row security on for all; `authenticated` has SELECT only on `ci_research_runs` and `ci_research_run_leads` (policies `auth.uid() = user_id`); no `anon` access; nothing else |
| indexes | `idx_ci_queue_run_active`, `idx_ci_run_leads_lead`, `idx_ci_charges_user_month`, `idx_ci_charges_run`, `idx_ci_charges_created` |
| old FIFO claim | `claim_ci_queue_items_worker(integer)`: not executable by `service_role`, `authenticated` or `anon` |
| controls (before configuration) | enabled false, allow_all false, allow-list empty, every limit NULL (fail closed) |
| Phase 0 lockdown | `trg_guard_leads_research_columns` enabled; `guard_leads_research_columns()` md5 `91f61068837d7de3df90a4b5d1382bf0` |
| queue | 156 rows, 146 pending, 0 worker-eligible, 0 run jobs, fingerprint `50be1c1e9e0f94070a41c88785376966` (unchanged) |
| scheduler | `cron.job` 0, `net.http_request_queue` 0, Vault secrets 0, Vercel project crons: no definitions |

Application deployments (commit `b866627`, source hashes identical to the commit): `dpl_3WNjYRZ6FBjqb192riZNj9nhkoF8` (all
switches OFF) and `dpl_63hWnLwvxXzhq6gYEpwwWeLjibMs` (adds `CI_RUN_AUTHORIZATION_ENABLED=true`). `CI_RESEARCH_ENABLED` is not set.

Configuration applied through the audited operator functions (`ci_research_control_log`: `set_limits`, `set_access` by `owner-test`):
10 leads per run, $0.05 per run, $0.25 global monthly, $0.002 per attempt, $0.006 per profile, $0.001 per lead per month
(owner plan limit 10000 gives $10.00, non-binding), 2 attempts, 2 concurrent, 24 hour run expiry; allow-list = the owner account only;
`allow_all_customers` false; database research switch OFF.

Allow-list check (one aborted DO block, nothing persisted): a non-owner customer's authorization is refused with
"Research is not enabled for this customer"; the owner passes the allow-list; a claim returns nothing while the switch is OFF.

Undo (never applied): `supabase/proposed/20261016_ci_phase1_run_scoped_disable.sql` (keeps every record) and
`..._teardown_unused.sql` (refuses once any record exists).
