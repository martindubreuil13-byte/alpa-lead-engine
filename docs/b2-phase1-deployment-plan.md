# B2 Phase 1 — controlled deployment plan

Nothing here has been done. Each numbered step needs its own approval and is followed by a verification; stop at the first
mismatch. Production today: Phase 0 application `dpl_4ktutLabGAfwt3Dscw5fnE8Yw2HV` (commit `0ad05bf`), Phase 0 lockdown applied,
no research switch, no scheduler, no budgets, queue fingerprint `50be1c1e9e0f94070a41c88785376966` (156 rows, 146 pending).

## Invariants (check before every step and after it)

```sql
select count(*) total, count(*) filter (where status='pending') pending, count(*) filter (where worker_eligible) eligible,
       md5(string_agg(q::text, '|' order by q.id)) fingerprint from public.commercial_intelligence_queue q;
-- 156 | 146 | 0 | 50be1c1e9e0f94070a41c88785376966
select (select count(*) from cron.job) cron_jobs, (select count(*) from cron.job_run_details) cron_runs,
       (select count(*) from net.http_request_queue) pg_net, (select count(*) from vault.secrets) vault;     -- 0 0 0 0
select count(*) from supabase_migrations.schema_migrations;                                                 -- 7 (scripts, not tracked migrations)
select tgname, tgenabled from pg_trigger where tgrelid='public.leads'::regclass and not tgisinternal;       -- trg_guard_leads_research_columns | O
```
```
vercel env ls | grep -E "CI_RESEARCH_ENABLED|CI_RUN_AUTHORIZATION_ENABLED|CI_WORKER"     # no output
vercel api /v9/projects/prj_zrbYDivpto8X4EgVW3rdj0wuhaTa | jq .crons.definitions         # []
cat vercel.json                                                                          # {}
```

## 1. Release commit (approval)

`release/b2-phase1` is a local branch with one commit on top of `0ad05bf`. Do not push `main` (a push to `main` triggers a
production deployment). Verify the tree is clean and equals the validated tree.

## 2. Database migration (separate approval; SQL Editor, as a script: not `supabase db push`, not `apply_migration`)

Apply `supabase/proposed/20261016_ci_phase1_run_scoped.sql` exactly. It is additive and idempotent. It stops, changing nothing,
if the schema is not what it expects. After it, the application that is live today (Phase 0) is unaffected: it calls none
of these functions, and its research route returns before any database call while `CI_RESEARCH_ENABLED` is unset.

**Verification queries (all read-only):**

```sql
-- (a) the objects: 5 tables, 10 functions
select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'ci\_research%' order by 1;   -- 5 rows, rowsecurity = true
select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p where p.pronamespace='public'::regnamespace
 and p.proname in ('authorize_ci_research_run','claim_ci_run_items','complete_ci_run_item','recover_ci_run_items','cancel_ci_research_run',
 'set_ci_research_enabled','set_ci_research_access','set_ci_research_limits','get_ci_research_status','get_ci_run_progress') order by 1;   -- 10 functions
-- (b) privileges: service role only, except the customer's own progress read
select p.proname, has_function_privilege('authenticated',p.oid,'EXECUTE') auth, has_function_privilege('anon',p.oid,'EXECUTE') anon,
       has_function_privilege('service_role',p.oid,'EXECUTE') svc
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('authorize_ci_research_run','claim_ci_run_items','complete_ci_run_item',
 'recover_ci_run_items','cancel_ci_research_run','set_ci_research_enabled','set_ci_research_access','set_ci_research_limits','get_ci_research_status','get_ci_run_progress');
--    expected: get_ci_run_progress auth=true; every other function auth=false anon=false svc=true
select has_function_privilege('service_role','claim_ci_queue_items_worker(integer)','EXECUTE');   -- false (the old FIFO claim is gone)
select has_function_privilege('authenticated','claim_ci_queue_items(integer)','EXECUTE');          -- false (Phase 0 lockdown intact)
-- (c) tables: customers read only their own run, write nothing
select c.relname, r.rolname, string_agg(p.priv, ',' order by p.priv)
from pg_class c cross join pg_roles r cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv)
where c.oid in ('public.ci_research_controls'::regclass,'public.ci_research_control_log'::regclass,'public.ci_research_runs'::regclass,
                'public.ci_research_run_leads'::regclass,'public.ci_research_charges'::regclass)
  and r.rolname in ('anon','authenticated') and has_table_privilege(r.oid,c.oid,p.priv) group by 1,2;   -- only authenticated SELECT on ci_research_runs and ci_research_run_leads
-- (d) the controls row is in its fail-closed default
select enabled, allow_all_customers, cardinality(allowed_user_ids) allowed, per_job_reserve_usd, per_profile_ceiling_usd, per_run_cap_usd,
       per_lead_monthly_usd, global_monthly_limit_usd, max_leads_per_run from public.ci_research_controls;   -- false false 0 NULL NULL NULL NULL NULL NULL
select count(*) from public.ci_research_runs; select count(*) from public.ci_research_charges;                  -- 0, 0
-- (e) customers cannot run anything (no side effects: a refused call changes nothing; run only if the role switch is available)
begin; set local role authenticated; select * from public.claim_ci_run_items(1); rollback;                     -- ERROR: permission denied
-- (f) invariants unchanged (the queue fingerprint above)
```

## 3. Application deployment (separate approval)

From the clean release worktree: `vercel deploy --prod --yes`. With every switch still OFF the application is inert: Discover
is byte-for-byte its Phase 0 behaviour (the new code runs only when `CI_RUN_AUTHORIZATION_ENABLED=true`), the worker route
returns "disabled" before any database call, and My Leads is read-only. The new routes answer 401 to anonymous callers.

**Read-only smoke checklist (no login, no browser, no search):**

| Check | Expected |
|---|---|
| deployment `READY`, target production, `gitDirty` unset; deployed source hashes equal the release commit | no mismatch |
| `GET /`, `/login`, `/dashboard/scraper` | 200 |
| `GET /dashboard/discover-replay`, `/dashboard/intelligence-preview` | 404 (development-only pages) |
| `GET /api/research/runs/latest` (no session) | 401 |
| `POST /api/research/runs/<uuid>/cancel` (no session) | 401 |
| `GET /api/admin/research-control` (no session) | 401 |
| `GET /api/internal/cron/commercial-intelligence` (no secret) | 401 |
| `POST /api/leads/process-ci-queue-batch` and the other two retired routes | 410 |
| the invariants above | unchanged |

## 4. Owner-only live test (separate approval)

Follow `docs/b2-phase1-owner-live-test.md` exactly: configure the limits and the owner-only access list, set the two environment
switches (database switch still OFF), the owner runs ONE search of at most 10 businesses on the normal Discover page, verify the
authorization before any research, then run the research by hand, tick by tick, with the database switch ON only for that window.

## Emergency stop and undo

| Need | Action | Effect |
|---|---|---|
| Stop research now | `POST /api/admin/research-control {"enabled": false}` or `select set_ci_research_enabled(false,'<name>')` | no new claim from the next claim on; running jobs finish; nothing deleted |
| Stop and remove all access | `20261016_ci_phase1_run_scoped_disable.sql` | switch off, access list emptied, `allow_all` off; **every record kept**; logged; idempotent |
| Stop authorizing runs | remove `CI_RUN_AUTHORIZATION_ENABLED`, redeploy | Discover is back to its Phase 0 behaviour |
| Stop the worker route | remove `CI_RESEARCH_ENABLED`, redeploy | the route answers "disabled" before any database call |
| Application regression | redeploy `dpl_4ktutLabGAfwt3Dscw5fnE8Yw2HV` | Phase 0 application; the Phase 1 database objects are inert without it |
| A defect in a Phase 1 function | corrected `CREATE OR REPLACE FUNCTION` through the SQL Editor | fix forward; records are untouched |
| Remove an install that was never used | `20261016_ci_phase1_run_scoped_teardown_unused.sql` | refuses while any authorization, spending, control-log or run-queue record exists; never restores the old FIFO claim |

After live use the authorization records and the spending ledger are an audit trail: they are not dropped. The old FIFO claim is
never restored by any undo; putting it back is a separate, explicit decision.

## Compatibility matrix

| Database | Application | Result |
|---|---|---|
| Phase 0 (today) | Phase 0 (today) | as now |
| Phase 1 applied, switches OFF, no budgets | Phase 0 | inert; nothing calls the new objects |
| Phase 1 applied, switches OFF | Phase 1 | inert; Discover identical to Phase 0 |
| Phase 0 | Phase 1, switches OFF | inert; the new routes answer 503 if called with a run id (the function does not exist) and Discover is identical |
| Phase 1 applied, owner-only access | Phase 1, owner switches ON | the owner test |
