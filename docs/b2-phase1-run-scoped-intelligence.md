# B2 Phase 1 — run-scoped Business Intelligence

Status: **built, tested locally, not deployed, not activated.** Both switches below default OFF and the database
migration (`supabase/proposed/20261016_ci_phase1_run_scoped.sql`) is not applied.

## 1. How a customer's search becomes research (and nothing else does)

```
Discover search ──► atomic save (save_discover_results, existing)  ──► results sent to the customer (unchanged, fast)
                         │ writes the receipt: discover_save_receipts(run_id, user_id, outcomes[…saved ids…])
                         ▼  (after the results were sent; never throws into the stream)
        authorize_ci_research_run(run_id, user_id, plan_leads_limit)      ← service role only
           • refuses unless a receipt for THIS customer and THIS run exists
           • the lead set = ids the receipt confirms as saved AND owned by this customer (never caller-supplied)
           • idempotent per run_id (a retry returns the same run; no second record, no second job)
           • fails closed if any budget is not configured
           • writes ci_research_runs + ci_research_run_leads (the auditable authorization), and ONE queue job per
             saved lead that has a website (existing commercial_intelligence_queue, run_id set, worker_eligible = false)
                         ▼
 scheduled worker ──► claim_ci_run_items(limit) ──► enrichLeadDirect (existing engine) ──► complete_ci_run_item
   (cron route; one tick)  checks: DB switch, budgets, run authorized+unexpired+uncancelled, same customer,
                           fair across customers, per-customer concurrency; reserves cost; fenced by claim token
```

Historical jobs (the 146 pending rows) have `run_id IS NULL`. No function in this design can select a row without a run
id, so they cannot be claimed however the switches are set. No backfill exists. `worker_eligible` is never written.
The old first-in-first-out claim (`claim_ci_queue_items_worker`) is revoked from the service role by the migration and
no application code calls it. Owner-preview jobs (`worker_eligible = true`, no run id) therefore stay inert too.

## 2. Lifecycle of one profile

`queued → researching → ready`, with `retry_pending` (a failed attempt, within the attempt limit), `failed`
(attempts exhausted, budget exhausted, or interrupted too often), `unavailable` (no website to read), `cancelled`,
and `partial` (declared and mapped; the current engine is all-or-nothing, so it is not produced today).
A job is only marked `ready` when the stored profile has a non-empty summary (checked in the application and again in
`complete_ci_run_item`). One failing profile never blocks the others. Research continues server-side with no browser.

* Attempts: `max_attempts` (default 2, hard range 1–3). Backoff 60 s. Deadline per job 60 s (+5 s grace).
* Stale claims: `recover_ci_run_items` returns the job to the queue (counted as an attempt, billed at the reservation)
  or fails it when attempts are exhausted. It runs at the start of every tick, and only while research is on.
* Cancellation: `cancel_ci_research_run` (the customer's own run, via `POST /api/research/runs/{id}/cancel`): nothing new
  is claimed, jobs not yet started close as `cancelled`, a running job finishes and keeps its profile.
* Expiry: an authorized run is claimable for `run_ttl_hours` (default 24). Work authorized while research was off does
  not become claimable weeks later by accident.

## 3. Budgets (all in the database, all fail closed)

`ci_research_controls` is one row; every limit starts NULL, which means "no research". Operators set them once.

| Control | Meaning |
|---|---|
| `per_job_reserve_usd` | reserved before each attempt (conservative: well above the ~$0.0004–0.0009 measured AI cost) |
| `per_profile_ceiling_usd` | everything spent on one profile across all attempts; the next attempt that would pass it fails the job |
| `per_run_cap_usd` | cap for one Discover run (the run's budget is `min(cap, jobs × per_profile_ceiling_usd)`) |
| `per_lead_monthly_usd` | the customer's monthly research budget = plan lead limit × this; when spent, jobs wait (they do not fail) |
| `global_monthly_limit_usd` | all customers together, per calendar month (UTC); when reached no one claims |
| `max_leads_per_run` | most businesses one run may authorize (the rest are recorded as not authorized, never queued); required |
| `allow_all_customers`, `allowed_user_ids` | who may have research. Default: nobody. Authorization AND claiming both check it. |
| `per_user_concurrency`, `max_attempts`, `run_ttl_hours` | execution bounds |

All limits and the access list are set through audited operator calls (`set_ci_research_limits`, `set_ci_research_access`),
which write to `ci_research_control_log`.

Reservations live in `ci_research_charges`, one row per queue job and attempt (a primary key, so a reservation can never
be duplicated). Completion settles the row with the reported actual cost (capped at 10× the reservation); an interrupted
or timed-out attempt is settled at its reservation because its cost cannot be known. Research never touches
`public.usage` or any lead allowance; the customer is charged only by the existing atomic save.

## 4. The two switches, and the third gate

| Switch | Where | Meaning | Default |
|---|---|---|---|
| `CI_RUN_AUTHORIZATION_ENABLED` | Vercel env | Discover authorizes research for a saved run. OFF = Discover is exactly as before Phase 1 (including the old inert per-lead job). | OFF |
| `CI_RESEARCH_ENABLED` | Vercel env | The worker may start (Phase 0 switch; needs a redeploy to flip). | OFF |
| `ci_research_controls.enabled` | database | Read by `claim_ci_run_items` itself: takes effect at the next claim, **no redeploy**. | OFF |

Research runs only when the environment switch AND the database switch are on AND every budget is configured. A missing
read of the database counts as "not running".

**Operating the database switch** (administrators only; customers have no route to it):

```
GET  /api/admin/research-control                       # read-only: both switches, budgets, month spend, queue counts
POST /api/admin/research-control   {"enabled": false}  # emergency stop: no new claim from the next claim on
POST /api/admin/research-control   {"enabled": true}   # resume (also requires CI_RESEARCH_ENABLED=true and budgets)
-- or directly (service role / SQL editor):  select set_ci_research_enabled(false, 'ops@example.com');
```
Turning it off deletes nothing, keeps every finished profile, lets running jobs finish, and is written to
`ci_research_control_log`. Setting it to `false` is always allowed.

## 5. What the customer sees

* Stage 01 and 02: unchanged. Results arrive exactly as before; authorization happens after they are sent.
* Stage 03: from server-confirmed counts only. "Preparing business intelligence — 0 of 25 profiles ready",
  "Research in progress — 12 of 25 profiles ready", "25 business profiles ready" (shown only when nothing is unresolved),
  "Business Intelligence is not currently running" when research is off (queued profiles are never called researching).
  With no authorized run the stage keeps its A2.3 wording.
* Rows: each business shows its real profile state; a ready profile shows a factual synopsis, what it offers, who it serves
  (only when the website says so), and "How this profile was built": the website facts (pages read, features detected by
  rules, source links) kept apart from the AI-written text, plus its limitations. The competitive-advantage field is not
  shown. Nothing about revenue, employees, customers, partnerships or buying intent exists in the profile or the UI.
* Progress survives refresh or leaving: the page asks the server (`GET /api/research/runs/{id|latest}`), which reads the
  database. The call is read-only, pauses while the tab is hidden, and stops once everything is resolved.
* My Leads: read-only. Each lead shows its profile state (derived from its stored profile and its own run job; historical
  jobs and the `pending` column default mean nothing) and there is a "Profile ready" filter.

## 5b. Speed

Discover's two stages are not slowed: authorization runs after the result event has been sent, takes one database call
(about 8 ms for a 25-lead run on a local database, next to about 7 ms for the existing atomic save; production adds only
network latency), is capped at 4 s and never throws into the stream. Research then runs entirely server-side.

Throughput of one scheduled tick (defaults: 4 jobs at once per customer, up to 8 claim rounds, 240 s budget, 60 s job
deadline): rounds are sized to what can still finish, and a new round starts only while a whole job still fits. At about 20 s per
profile a 25-lead run finishes inside a single tick, roughly two to three minutes after the results appeared, with the
first profiles arriving within the first minute and the page showing each as it lands. With the scheduler at one tick per
minute a run of up to about 12 jobs per tick for several customers is served fairly (one job per customer per round).
Raise `CI_WORKER_CONCURRENCY` (hard cap 4) and `ci_research_controls.per_user_concurrency` only after a soak.

## 6. Deployment sequence (nothing below has been done)

1. Review, then apply `20261016_ci_phase1_run_scoped.sql` through the SQL Editor as a script (not a tracked migration).
   It is additive and idempotent; verify (read-only): the tables exist, `claim_ci_queue_items_worker` is no longer
   executable by `service_role`, customers can execute only `get_ci_run_progress`, `ci_research_controls.enabled = false`
   with NULL limits, and the queue fingerprint is unchanged.
2. Deploy the application with both environment switches still OFF. Verify the read-only smoke checks; Discover must be
   identical (the new code does nothing while `CI_RUN_AUTHORIZATION_ENABLED` is off).
3. Staged enablement, each step separately approved: configure the budgets (SQL) → set `CI_RUN_AUTHORIZATION_ENABLED=true`
   and redeploy (runs are authorized; nothing runs) → create the scheduler (every minute) → owner-only soak with the
   database switch ON and `CI_RESEARCH_ENABLED=true`.

## Emergency stop, undo and rollback

Research records (authorizations, lead sets, the spending ledger, the control log, profiles) are the audit trail of live
use and are **never dropped** after live use. Prefer reversible application changes and forward fixes.

* **Stop at once (no deploy, no SQL):** `POST /api/admin/research-control {"enabled": false}`. Takes effect at the next claim.
* **Stop and remove all access, keep every record:** `supabase/proposed/20261016_ci_phase1_run_scoped_disable.sql`
  (switch off, access list emptied, `allow_all` off; nothing deleted; idempotent; logged).
* **Stop authorizing new runs:** remove `CI_RUN_AUTHORIZATION_ENABLED` and redeploy; Discover reverts to its Phase 0 behaviour.
* **Application:** redeploy `dpl_4ktutLabGAfwt3Dscw5fnE8Yw2HV` (Phase 0). The Phase 1 database objects are inert without the app.
* **A defect in a Phase 1 function:** fix forward with a corrected `CREATE OR REPLACE FUNCTION` through the SQL Editor.
* **Remove an install that was never used:** `20261016_ci_phase1_run_scoped_teardown_unused.sql` refuses as soon as any
  authorization, lead-set, spending, control-log or run-queue record exists. It does not restore the old FIFO claim.
