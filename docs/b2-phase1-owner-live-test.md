# B2 Phase 1 — the first owner-initiated live search

**Nothing here is run by Claude.** The owner performs the one search; an operator runs the configuration, the manual research
ticks and the checks below. Every step is separately approved. Until each step is approved, production keeps every research
switch OFF and no budget configured.

## Why this test is owner-only and bounded

Research is authorized only for customers on an explicit allow-list (`ci_research_controls.allowed_user_ids`, default: nobody),
checked both when a run is authorized and again at every claim. Everyone else's searches behave exactly as today (their
Discover stage 03 keeps its A2.3 wording). There is no scheduler: the operator runs each research tick by hand, so
nothing can run unattended. All limits are in the database and fail closed.

| Limit | Value for the test | What it guarantees |
|---|---|---|
| `max_leads_per_run` | **10** | at most 10 businesses are authorized, however many are saved |
| `per_job_reserve_usd` | 0.002 | reserved before each attempt (measured AI cost is about 0.0004 to 0.0009) |
| `per_profile_ceiling_usd` | 0.006 | all attempts of one profile (and `max_attempts` is 2, so at most 0.004) |
| `per_run_cap_usd` | **0.05** | the run's budget = min(0.05, 10 x 0.006): worst case 10 jobs x 2 attempts x 0.002 = 0.04 |
| `global_monthly_limit_usd` | **0.25** | the hard ceiling for ALL research this month: at most 125 reserved attempts |
| `per_lead_monthly_usd` | 0.001 | per-customer monthly budget = plan lead limit x this (the global limit binds first) |
| `per_user_concurrency` | 2 | two profiles researched at once |
| `max_attempts`, `run_ttl_hours` | 2, 24 | bounded retries; an unused authorization expires after a day |

Expected real cost of the whole test: about 10 x 0.0005 = **$0.005**; maximum possible research spend: **$0.05** for the run
and **$0.25** for the month. (Discover's own search cost is the same as any search and is separate.)

## Step 0. Before anything (read-only; record the values)

```sql
select count(*) total, count(*) filter (where status='pending') pending, count(*) filter (where worker_eligible) eligible,
       md5(string_agg(q::text, '|' order by q.id)) fingerprint from public.commercial_intelligence_queue q;
-- expected: 156 | 146 | 0 | 50be1c1e9e0f94070a41c88785376966
select u.user_id, u.leads_used, u.leads_limit from public.usage u where u.user_id = '<OWNER_UUID>' order by period_start desc limit 1;   -- note leads_used
select count(*) from public.leads where user_id = '<OWNER_UUID>';                                                                       -- note the count
select count(*) from public.discover_save_receipts;                                                                                   -- expected 0
```
`<OWNER_UUID>` is the owner's user id (the value of `PRIVATE_ALPA_OWNER_USER_ID`).

## Step 1. Configure (operator, SQL Editor; each call is audited in `ci_research_control_log`)

```sql
select set_ci_research_limits(0.002, 0.006, 0.05, 0.001, 0.25, 10, 2, 2, 24, 'owner-test');
select set_ci_research_access(false, ARRAY['<OWNER_UUID>']::uuid[], 'owner-test');
select get_ci_research_status();   -- expect: enabled false, budgets_configured true, access {allow_all false, allowed_customers 1}
```

## Step 2. Turn authorization on, research still OFF

Set `CI_RUN_AUTHORIZATION_ENABLED=true` and `CI_RESEARCH_ENABLED=true` in Vercel (Production) and redeploy. The DATABASE
switch is still OFF, so nothing can be claimed. Verify read-only: `get_ci_research_status()` still says `enabled: false`.

## Step 3. The search (the owner, nobody else)

* Use the normal **Discover** page (`/dashboard/scraper`), **not** the private preview page (the preview page has its own
  older path and does not authorize runs).
* Request **no more than 10** businesses (for example "business consultants", London, 10).
* What the owner should see: results arrive as always, with contact details; Stage 03 reads **"Business Intelligence is not
  currently running — 0 of N profiles ready · N waiting"** (honest: the database switch is still off).

## Step 4. Verify the authorization BEFORE any research (read-only)

```sql
-- the receipt and the exact saved set
select run_id, jsonb_array_length(result->'outcomes') outcomes,
       (select count(*) from jsonb_array_elements(result->'outcomes') o where o->>'status'='saved') saved
from public.discover_save_receipts order by created_at desc limit 1;                                   -- one receipt
-- the authorization covers only the saved leads, at most 10 queued
select saved_count, queued_count, budget_limit_usd, status, expires_at from public.ci_research_runs order by created_at desc limit 1;
select initial_state, count(*) from public.ci_research_run_leads where run_id = '<RUN_ID>' group by 1;
select count(*) from public.ci_research_run_leads rl
 where rl.run_id = '<RUN_ID>' and rl.lead_id::text not in
   (select o->>'id' from public.discover_save_receipts r, jsonb_array_elements(r.result->'outcomes') o where r.run_id = '<RUN_ID>' and o->>'status'='saved');   -- expect 0
select status, count(*) from public.commercial_intelligence_queue where run_id = '<RUN_ID>' group by 1;  -- pending only, count = queued_count
select count(*) from public.commercial_intelligence_queue where worker_eligible;                          -- expect 0
-- lead allowance: consumed once per saved qualifying lead, by the save, not by research
select leads_used from public.usage where user_id = '<OWNER_UUID>' order by period_start desc limit 1;    -- = before + saved
-- history untouched
select md5(string_agg(q::text, '|' order by q.id)) || ':' || count(*) from public.commercial_intelligence_queue q where run_id is null;   -- expect 50be1c1e...:156
select count(*) from public.ci_research_charges;                                                           -- expect 0 (nothing reserved yet)
```
**Stop here if anything differs** (authorization is idle; `disable` script or `POST /api/admin/research-control {"enabled":false}`).

## Step 5. Run the research by hand (operator), watching it

```sql
select set_ci_research_enabled(true, 'owner-test');   -- or: POST /api/admin/research-control {"enabled": true}
```
Then trigger one tick at a time (there is no scheduler); one call can process several profiles within its 4-minute budget:
```
curl -s -H "Authorization: Bearer $CRON_SECRET" https://alpa.mindrasolutions.com/api/internal/cron/commercial-intelligence
```
(`$CRON_SECRET` is the Vercel production value; do not paste it anywhere.) The owner watches Discover: Stage 03 moves to
"Preparing business intelligence" and then "Research in progress — K of N profiles ready", and profiles appear in the rows as they
land; refreshing the page or returning later shows the same state. After each tick, check:

```sql
select status, count(*) from public.commercial_intelligence_queue where run_id = '<RUN_ID>' group by 1;
select count(*) reservations, sum(reserved_usd) reserved, sum(coalesce(actual_usd,0)) actual from public.ci_research_charges;   -- reserved <= 0.05, month <= 0.25
select (get_ci_research_status()->>'month_spent_usd') as month_spent;
```
**Stop immediately** (`set_ci_research_enabled(false, ...)`) if reserved spend passes 0.04, any failure repeats, or any
unexpected row appears.

## Step 6. Close out and verify (read-only)

```sql
select set_ci_research_enabled(false, 'owner-test');        -- switch OFF again
select state, count(*) from public.get_ci_run_progress('<RUN_ID>') group by 1;  -- (run as the owner's session) all resolved
select count(*) from public.leads l join public.ci_research_run_leads rl on rl.lead_id = l.id
 where rl.run_id = '<RUN_ID>' and l.commercial_profile->>'summary' is not null;                       -- profiles persisted
select sum(coalesce(actual_usd, reserved_usd)) from public.ci_research_charges;                         -- total, well under 0.05
select md5(string_agg(q::text, '|' order by q.id)) || ':' || count(*) from public.commercial_intelligence_queue q where run_id is null;  -- still 50be1c1e...:156
select leads_used from public.usage where user_id = '<OWNER_UUID>' order by period_start desc limit 1;  -- unchanged since Step 4
```
Then the owner opens **My Leads**: each business shows its profile (or an accurate state), and the "Profile ready" filter
lists the finished ones; opening My Leads starts nothing.

## Pass criteria (all ten)

1. Discover returns relevant businesses. 2. Contact details are delivered as usual. 3. One receipt exists. 4. `leads_used`
rose by exactly the number of saved qualifying leads and did not move during research. 5. The run covers only receipt-saved
leads (query above returns 0 strays), at most 10. 6. Only that run's jobs were processed (the historical fingerprint is
unchanged). 7. Profiles appeared progressively and survive a refresh. 8. Completed profiles show in My Leads.
9. Total research spend stays under 0.05 (run) and 0.25 (month). 10. The 146 historical jobs are untouched.

## After the test

Leave research OFF (`enabled = false`). To remove access entirely, run `20261016_ci_phase1_run_scoped_disable.sql`. Widening
beyond the owner (`allow_all_customers`), raising limits and creating a scheduler are separate decisions that need their own approval.
