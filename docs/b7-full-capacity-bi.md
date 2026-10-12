# B7: full-capacity Business Intelligence (up to 50 profiles per search)

Status: code complete locally, not deployed. Nothing below has been applied to production.

## Processing architecture
1. Discover saves leads atomically; `authorize_ci_research_run` authorizes exactly the saved businesses that have a website
   (once per run, idempotent), up to `max_leads_per_run`.
2. After the results are sent, Discover dispatches tick 0: `GET /api/internal/cron/commercial-intelligence?async=1&depth=0`
   (secret-authenticated). The route checks the secret and the kill switch, answers **202** at once, and runs the tick after the
   response in its own invocation (300 s limit; the tick stops itself at 240 s and starts no round it cannot finish).
3. A tick recovers stale claims (180 s), then claims up to 2 jobs per round for up to 25 rounds, two at a time. The database claim
   enforces switch, allow-list, run scope, budgets, two running per customer and one claim per job, so overlapping ticks cannot
   double-process or exceed the concurrency.
4. If the tick stopped on its own limits while jobs were still being claimed, it dispatches the next tick one link deeper and
   waits only for the 202. The chain is capped at 1 + 6 ticks (capacity far above 50) and ends the moment a claim comes back
   empty (nothing eligible: done, or a budget/limit stopped the claim).

A dispatch is tried up to three times for a transient failure (network, timeout, 5xx, 429) and never for a refusal (401, research
off). The secret is sent only to an https origin. If a link is still lost, nothing retries: jobs stay queued and untouched, and the
next tick (a new search, the daily backstop below, or an operator call) recovers interrupted claims and continues.

## Platform facts (verified)
Vercel Hobby, Fluid Compute on: default and maximum function duration 300 s. `after()` runs after the response via `waitUntil`, up
to the route's `maxDuration`. Hobby cron: once per day, imprecise (anywhere in the scheduled hour, +-59 min).

## Recovery (smallest reliable mechanism)
1. Dispatch retries (done, in code).
2. Daily backstop on the existing worker route, in `vercel.json` (needs approval; none is configured today):
   `{ "crons": [{ "path": "/api/internal/cron/commercial-intelligence?async=1", "schedule": "0 9 * * *" }] }`
   Vercel sends the existing `CRON_SECRET` as the Bearer token. It runs the same tick: same kill switch, allow-list, budgets and
   run-scoped claim, so it cannot activate a legacy job or exceed a budget.
3. Because Hobby cron can fire up to ~25 hours after a lost chain, set `run_ttl_hours` to 48 (it is 24 now) so a run cannot expire
   before the backstop reaches it. Claims refuse expired runs.

## Capacity, cost, time (measured: 95 settled attempts)
| Search | OpenAI avg ($0.00035) | OpenAI worst ($0.00061) | Time at 2 workers (2-5 s/profile) |
|---|---|---|---|
| 10 | $0.0035 | $0.0061 | 20-50 s |
| 25 | $0.0088 | $0.0153 | 50-125 s |
| 50 | $0.0177 | $0.0305 | 105-245 s (one or two ticks) |

Other operating costs are not metered per profile: Vercel function time (about 2-4 minutes per 50-profile search), Supabase
queries (a few per job), website fetch bandwidth. Check Vercel and Supabase usage after the validation run.

## Budget settings required (NOT applied)
| Setting | Now | Recommended | Why |
|---|---|---|---|
| `max_leads_per_run` | 10 | **50** | Discover's largest search; authorization still never exceeds the saved set |
| `per_run_cap_usd` | 0.05 | **0.10** | worst 50 actual $0.031 + 2 in-flight reservations $0.004; equals 50 x $0.002 |
| `global_monthly_limit_usd` | 0.25 | **2.00** (owner-only phase) | 0.25 allows only ~14 full searches; 2.00 allows ~110 (~65 at worst case) |
| `per_job_reserve_usd`, `per_profile_ceiling_usd`, `per_lead_monthly_usd` | 0.002 / 0.006 / 0.001 | unchanged | all exceed the observed maximum $0.00061 |
| `run_ttl_hours` | 24 | **48** (needs your approval; not among the three you approved) | the daily backstop can fire ~25 h after a lost chain |
| `per_user_concurrency`, `max_attempts` | 2 / 1 | unchanged | |
| allow-list, `allow_all_customers` | owner only / false | unchanged | opening to customers is a separate decision |

Operator call (audited in `ci_research_control_log`), to run only after approval:

```sql
select set_config('request.jwt.claim.role','service_role', false);
select set_ci_research_limits(0.002, 0.006, 0.10, 0.001, 2.00, 50, 2, 1, 48, 'b7-capacity');
select get_ci_research_status();  -- expect max_leads_per_run 50, per_run_cap 0.10, month 2.00; all else unchanged
```
