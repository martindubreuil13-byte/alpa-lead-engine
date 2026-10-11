# B2 Phase 0 — Business Intelligence research safety

Phase 0 makes research **impossible to start by accident**. It does not turn research on. Nothing in this
change activates the worker, the scheduler, or the third stage of Discover.

## 1. The kill switch

One server-side environment variable controls every research path:

| `CI_RESEARCH_ENABLED` | Effect |
|---|---|
| unset, empty, anything except the exact text `true` | **OFF** (the default) |
| `true` (surrounding spaces ignored) | research may start |

Only the exact value `true` enables it: `1`, `yes`, `TRUE`, `on` all mean OFF. It is read from the server's
environment at each check. No request, cookie, header, database row or browser value can change it, so a
customer cannot enable it.

**What OFF does:** the scheduled worker route answers `{"ok":true,"disabled":true,"claimed":0}` without
touching the database; the worker core returns before recovering or claiming anything; manual (admin)
research answers 503. Queued jobs, running jobs and stored profiles are not deleted, reset or changed. A job
that was already running when the switch is turned off is allowed to finish and be recorded.

**What OFF does not do:** it does not cancel running research, and it does not stop customers from *filing*
a request row (an inert pending row that nothing can claim). Those rows are harmless while research is off.

### Operating it (Vercel)

```
# check (read-only, admin session): is it on, and what are the effective limits?
GET /api/admin/research-status

# turn ON (production) — only after the Phase 1 review, never as part of Phase 0
vercel env add CI_RESEARCH_ENABLED production      # enter: true
vercel deploy --prod                                # environment changes apply to the next deployment

# turn OFF immediately
vercel env rm CI_RESEARCH_ENABLED production        # or set it to: false
vercel deploy --prod  (or redeploy the current production deployment)
```

Because Vercel applies environment changes to *new* deployments, redeploying is part of both steps. The
scheduler (pg_cron → the worker route) can also be stopped independently with `SELECT cron.unschedule('alpa-private-ci-worker')`
if it has ever been scheduled; it is **not** scheduled today.

## 2. Execution limits (all hard-capped; configuration can only lower them)

| Setting | Default | Hard ceiling |
|---|---|---|
| `CI_WORKER_BATCH_SIZE` — jobs claimed per tick | 2 | 20 |
| `CI_WORKER_CONCURRENCY` — jobs researched at once | 1 | 4 |
| `CI_WORKER_STALE_SECONDS` — claim considered stale | 600 | 3600 (minimum 60) |
| per-job research deadline | 60 s (+5 s grace) | fixed in code |
| one tick's budget | 240 s | fixed in code |
| website fetch | 8 s, 1 MB, 3 redirects | fixed in code |
| AI request | 30 s, no SDK retries | fixed in code |
| retries per job | 3 (`max_retries`) | database |

A tick never claims more jobs than it can finish inside its budget, so a claimed job is not left "processing"
until stale recovery.

## 3. What customers can and cannot do

- **My Leads is read-only.** Opening, refreshing, filtering or sorting it never starts research; the
  browser-driven queue loop and the manual "Start / Re-analyze" buttons are gone. It still shows saved leads and
  any completed profile.
- `/api/leads/process-ci-queue-batch`, `/api/leads/[id]/enrich-commercial-intelligence` and
  `/api/admin/process-ci-jobs` answer `410 Gone` and do nothing.
- Customer-session claim, completion and reset functions were removed from the application. The database
  proposal `supabase/proposed/20261015_ci_phase0_lockdown.sql` revokes the matching RPCs from customers and
  blocks customer writes to `leads.ci_*`, `commercial_profile`, `website_snapshot` and `business_signals`.
  **Until that proposal is applied, those database-level exposures still exist** (the application no longer
  uses them).

## 4. Cost and fairness controls — what exists and what does not

Exists: the hard limits above; per-job cost recorded in `ci_cost_estimate` and returned per tick; failed
attempts bounded by `max_retries`; research code cannot touch the lead allowance.

Does not exist yet (Phase 1): per-user monthly research budget, per-run budget, a global spend ceiling,
per-customer fairness in claiming (claims are first-in, first-out across all customers), and an automatic stop
when a tick's cost exceeds a ceiling. The kill switch is the only emergency stop.

## 5. The historical backlog (146 pending jobs at the time of the audit)

They are inert and must stay so. A job is claimable by the worker only when `worker_eligible = true`, and only the
service role can set that (guard trigger from B1.1). The historical rows are `worker_eligible = false`. Phase 0
leaves them untouched: not drained, deleted, backfilled, reset, re-queued or re-labelled.

### How Phase 1 tells a newly authorized Discover run from history

1. `commercial_intelligence_queue.run_id` already exists (B1.1) and is assigned by server code only; customers
   cannot set it (guard trigger). Historical rows have `run_id IS NULL`.
2. Phase 1 adds a service-role claim function that takes a `run_id` (or an explicit list of lead ids) and claims
   only `status = 'pending' AND worker_eligible = true AND run_id = $1`. A row with a `NULL run_id` can never match,
   so history cannot be selected, even by mistake.
3. The Discover save path (service role) creates the queue rows for that run's saved leads with
   `worker_eligible = true` and the run's `run_id` — only for the leads that save actually inserted, and only
   after an explicit per-run authorization. Rows are unique per active lead already (B1.1 index).
4. The worker never scans the table by status alone; every claim names its run.
5. History stays reachable only through a deliberate, operator-run, per-batch action that is written down and
   approved; it is never an automatic effect of enabling research.

## 6. Order of changes for deployment review

1. Deploy the Phase 0 application code (safe on its own: it removes execution paths and adds the switch, which defaults OFF; it sends only RPC arguments that exist in production today).
2. Apply `20261015_ci_phase0_lockdown.sql` (after `20261013_ci_completion_integrity.sql` if that proposal is also being applied).
3. Do **not** set `CI_RESEARCH_ENABLED=true` until Phase 1 is reviewed.
