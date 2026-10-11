# B2 Phase 0 — deployment plan

Nothing in this plan turns research on. `CI_RESEARCH_ENABLED` stays unset (OFF) and no scheduler is created.
Each numbered step needs its own approval. Do not skip a verification: stop and use the rollback for that step.

**Release:** branch `release/b2-phase0`, based on `a0e781c` (A2.3 `4007bb7` + the atomic-save record). The change set is
exactly the 19 modified, 21 added and 3 deleted files shown by `git diff --name-status a0e781c`; nothing under
Discover, A2.3, usage accounting, entitlements, billing or the email composer changed.
**Rollback deployment (current production):** `dpl_HufzeQqiyGe86CXAknbFey5JMK46`.

## Invariants (record before step 1, compare after every step)

```sql
-- queue: 156 rows (146 pending + 10 completed), 0 worker-eligible, fingerprint below. Must never change.
select count(*) total, count(*) filter (where status='pending') pending, count(*) filter (where worker_eligible) eligible,
       md5(string_agg(q::text, '|' order by q.id)) fingerprint
from public.commercial_intelligence_queue q;
-- expected on 2026-10-11:  156 | 146 | 0 | 50be1c1e9e0f94070a41c88785376966
select count(*) from cron.job;                       -- expected 0
select count(*) from cron.job_run_details;           -- expected 0
select count(*) from net.http_request_queue;         -- expected 0
```
```
vercel env ls | grep CI_RESEARCH_ENABLED            # expected: no output (switch OFF everywhere)
cat vercel.json                                      # expected: {}  (no Vercel cron)
```
Do not open My Leads in production before step 2 is verified (the currently deployed page still drains the queue).

## 0. Compatibility (already verified; re-run before deploying)

- `node --test tests/b2-phase0-production-contract.test.mjs` — every RPC call and column in the application matches the
  read-only snapshot of production's catalog (`tests/fixtures/production-ci-contract.json`).
- The application sends only parameters that exist in production today. It does **not** need
  `20261013_ci_completion_integrity.sql`, and it is compatible with production both before and after the lockdown.
- Combinations: new app + old DB: works. New app + lockdown: works. Old app + lockdown: the old My Leads loop and manual
  buttons receive errors and stop (nothing is processed). Old app + old DB: today's behaviour.

## 1. Commit (approval required)

```
cd /private/tmp/claude-501/phase0 && git checkout -B release/b2-phase0   # same worktree, same files
git add -A && git commit -m "feat: B2 Phase 0 — research safety and reliability" \
  -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git status --short                                                      # must be empty (a clean tree)
```
Do not push `main`: a push to `main` triggers a Vercel production deployment. Pushing the release branch is optional.

## 2. Deploy the application (approval required)

```
cd /private/tmp/claude-501/phase0 && npm ci && vercel deploy --prod --yes
```
Record the deployment id. The deployment must be `READY`, `target: production`, and `gitDirty` unset.

**Verify (read-only; no browser, no login):**

| Check | Expected |
|---|---|
| `curl -s -o /dev/null -w "%{http_code}" https://alpa.mindrasolutions.com/` and `/login`, `/dashboard/scraper` | 200 |
| `curl -s -X POST …/api/leads/process-ci-queue-batch` | 410 `RETIRED` |
| `curl -s -X POST …/api/leads/00000000-0000-0000-0000-000000000000/enrich-commercial-intelligence` | 410 |
| `curl -s -X POST …/api/admin/process-ci-jobs` | 410 |
| `curl -s …/api/internal/cron/commercial-intelligence` (no secret) | 401 |
| `curl -s …/api/admin/research-status` (no session) | 401 |
| deployed source vs commit: compare `vercel api /v6/deployments/<id>/files` hashes with `git ls-files` | no mismatch |
| the invariants above | unchanged |

If any check fails: roll back (below) and stop.

## 3. Database lockdown (separate approval, after step 2 is verified)

`supabase/proposed/20261015_ci_phase0_lockdown.sql` — independent of the B1.2 migration. Apply it **as a script**, not as a
tracked migration: use the Supabase SQL editor (or `execute_sql` with the exact file text). Do **not** use
`supabase db push` or `apply_migration`: the project's migration history is out of sync with what was applied by hand, and
`apply_migration` would add a history row for a file that is meant to stay a record.

1. Before: run the invariants, then capture the privilege state:
   ```sql
   select p.oid::regprocedure::text fn, has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec,
          has_function_privilege('service_role',p.oid,'EXECUTE') svc_exec
   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
   ('claim_ci_queue_items','complete_ci_enrichment','reset_stale_ci_processing','backfill_missing_ci_queue_entries','audit_ci_queue_consistency');
   -- today: all five auth_exec = true
   ```
2. Apply the file. Its preflight aborts, changing nothing, if a protected column is missing, `auth.role()` is missing or
   `leads` already has another trigger. It holds `lock_timeout = 5s` and takes a brief lock on `leads` (about 930 rows).
3. Verify (read-only):
   ```sql
   -- all five: auth_exec = false, svc_exec = true (every overload)
   -- trigger present and enabled:
   select tgname, tgenabled from pg_trigger where tgrelid='public.leads'::regclass and not tgisinternal;   -- trg_guard_leads_research_columns | O
   select has_function_privilege('authenticated','public.guard_leads_research_columns()','EXECUTE');      -- false
   -- no side effects, rolled back: a customer role must now be refused
   begin; set local role authenticated; select * from public.claim_ci_queue_items(1); rollback;            -- ERROR 42501 permission denied
   -- invariants unchanged (queue fingerprint identical)
   ```
4. Watch for 30 minutes: Postgres logs for `42501` on `leads` (`research state and results cannot be modified directly`,
   `a lead cannot be created with research state`). Any hit during an ordinary customer action means rollback.
5. Ordinary-use smoke (owner, normal UI, no research): move a lead in the pipeline/library and edit a note. These write
   other columns and must succeed.

Expected effect: customers can no longer claim, complete, reset, bulk-queue or audit, nor write `ci_*` / profile columns.
Saved profiles remain readable by their owners. Discover saving, usage accounting and the worker functions are unaffected.

## Rollback

| Layer | Action | Notes |
|---|---|---|
| Database lockdown | run `supabase/proposed/20261015_ci_phase0_lockdown_rollback.sql` | Re-grants customer EXECUTE and removes the trigger. This **re-opens** the exposure; use only for unexpected customer-write failures. No data is changed either way. |
| Application | `vercel rollback dpl_HufzeQqiyGe86CXAknbFey5JMK46` | Restores the old My Leads loop. Do this only with the lockdown applied (the old loop then fails harmlessly) or with a stated instruction not to open My Leads. |
| Both | rollback the application first, then the database only if needed | Never roll back the database alone while the old application is live. |

The 146 historical jobs are never modified by any step or rollback.

## 4. What stays off

`CI_RESEARCH_ENABLED` is not set; no pg_cron job exists (and `configure_alpa_ci_worker_schedule()` cannot run: there are no Vault
secrets); there are no edge functions; `vercel.json` has no crons. Enabling research is Phase 1, after run-scoped claiming.
