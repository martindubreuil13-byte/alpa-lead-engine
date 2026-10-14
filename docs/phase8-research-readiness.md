# Phase 8: paid Business Intelligence, controlled-pilot readiness

Status: implemented locally and tested; **not deployed, nothing applied to production.** Research stays restricted to the
operator's allow-list (`allow_all_customers = false`) until the second-account pilot below has passed.

## What changed

| Area | Change |
|---|---|
| Invalid AI output | A thin website (under 150 words of readable text) may have a 25-60 word synopsis; richer sites still need 45-90. Figures, web addresses and email addresses in the synopsis must appear in the website text (any number format). One internal repair call per attempt, only for an answer that failed validation, only on the same fetched text, only while two calls fit under $0.0015. Both calls are added into the one cost reported to the spend ledger. Diagnostics hold a reason code and word count only (`profile_rejected:too_short:20w:calls=2`). |
| Customer retry | The run keeps `max_attempts = 1` (no automatic retry). After a failed attempt the customer gets **one** more, only for a failure a retry could fix (timeouts, network, interruption, unusable AI answer), never for a blocked, missing, oversized or unreadable website or a spent budget. It is reserved, ledgered and budget-checked like any attempt, costs no lead allowance, and clears the 60-second cool-down so the worker tick it starts can claim it. A second manual retry is refused. |
| Customer states | Plan-aware wording for the third stage and for a business without a profile: guests "Ready to explore"; free members "Included with paid plans"; paying members "Follows your search" then "Included in your plan, not active on your account yet"; never "available separately" for a plan that includes it. New honest reasons: run expired (unavailable, not failed) and unreadable website. |
| Entitlement | Automatic research is authorized only for a paying plan (resolved from the live subscription; a lapsed subscription resolves to free). Saved businesses and profiles are never removed by a plan change. |
| Expired runs | `reconcileExpiredRuns` closes jobs that never started in runs past their expiry (`run expired`). It leaves running jobs, finished jobs, leads, profiles, spend and allowances untouched. Dry run unless `{"confirm": true}`; admin only; **not scheduled**. |
| Budget alerts | `evaluateBudget` reports the 50% and 80% levels and which are due; `GET /api/admin/research-budget` shows this month's use. Read-only: nothing is sent or scheduled. |
| Pilot limits | `supabase/proposed/20261019_phase8_pilot_limits.sql` (operator script, not applied). |

No database migration is needed.

## Emergency disable runbook (fastest first)

1. **Database switch (immediate, no deploy):** `select set_config('request.jwt.claim.role','service_role',false); select set_ci_research_enabled(false,'<name>');`
   The next claim returns nothing. Queued jobs, running jobs and stored profiles stay as they are; a job already running finishes.
2. **Stop new authorizations:** remove `CI_RUN_AUTHORIZATION_ENABLED` in Vercel (Production) and redeploy. Discover then saves businesses and does not queue research.
3. **Stop the worker entirely:** remove `CI_RESEARCH_ENABLED` and redeploy; the cron route answers `disabled` before touching the database.
4. **Narrow access:** `select set_ci_research_access(false, ARRAY[]::uuid[], '<name>');` (nobody) or the single account to keep.
5. **Cap spend without stopping:** lower `global_monthly_limit_usd` with `set_ci_research_limits` (pass every other value unchanged; see the script).
6. **Check state:** `select get_ci_research_status();`, `GET /api/admin/research-status` (switches) and `GET /api/admin/research-budget` (spend and alert level), both as an admin.

Vercel shows the CI variables as write-only, so confirm the switches through the admin status route, not through `vercel env pull`.

## Budget alerts (to wire up later)

`evaluateBudget({spentUsd, limitUsd, notified})` returns `due: [50]` or `[80]` when a level is newly crossed. Delivery (email or a
dashboard banner) and any schedule are deliberately not built. Suggested first wiring after the pilot: read the route daily and notify on `due`.

## Second-account pilot plan (not executed)

Purpose: prove, with one real paying account and at most 10 businesses, that research runs automatically, is budgeted and settled
correctly, fails and retries honestly, survives a downgrade, and is closed to everyone else.

**Prerequisites (each needs approval)**
1. A dedicated test account with an **active paid subscription** created through the normal checkout in the sandbox/test mode. It must not be the owner's account and must hold nothing of value.
2. The Phase 8 release deployed (no migration).
3. `CI_RUN_AUTHORIZATION_ENABLED=true` and `CI_RESEARCH_ENABLED=true` in Production (verify through the admin status route afterwards).
4. The pilot limits script applied; `allow_all_customers` still `false`.
5. The allow-list set to the test account only (`set_ci_research_access(false, ARRAY['<test uuid>']::uuid[], 'pilot')`). The owner is off the list during the pilot and is restored afterwards.
6. Baseline recorded: charges this month, queue counts, `get_ci_research_status()`.

**Steps**
1. *Unauthorized account:* with another signed-in account (free or paid, not allow-listed), run a 3-business Discover. Expect: businesses saved, no `ci_research_runs` row, no queue rows, no charges, honest wording ("Included in your plan / not active on your account yet" for a paid account, "Included with paid plans" for a free one).
2. *Pilot discovery:* the test account runs one Discover for 10 businesses. Expect: an authorized run (`saved` = 10, `queued` = those with websites), the worker kicked automatically, profiles appearing within about a minute, the stage reading "Research in progress" then "N business profiles generated".
3. *Ledger:* one `ci_research_charges` row per attempt, all `settled`, `actual_usd` about $0.0003-0.0006, total about $0.005; run spend under the $0.05 cap; the month total moves by the same amount; `GET /api/admin/research-budget` agrees.
4. *Stored results:* `commercial_profile`, `website_snapshot` and `business_signals` filled for completed leads; My Leads shows "Business profile ready"; no lead allowance used beyond the 10 discovered.
5. *Controlled failure and retry:* before research claims (or on one lead after the run), set one pilot lead's `website` to an unresolvable host (`https://pilot-unreachable.invalid/`). Expect `failed`, "Business profile couldn't be completed", a Retry offer. Retry once: expect a new reservation, a second failure, and **no** further Retry. Then correct that lead's website and confirm a new search is the way forward (no third attempt). Allowance unchanged by the retry.
6. *Unrecoverable failure:* if one of the 10 returns a blocked or oversized site, expect "ALPA can't read this website" and no Retry offer.
7. *Downgrade:* cancel the test subscription (sandbox) or set the profile to free. Expect: all 10 businesses and profiles still open in My Leads; the Discover stage reads "Included with paid plans"; a new 3-business search is saved but **not** authorized.
8. *Expired-run reconciliation (dry run):* `POST /api/admin/research-reconcile` with `{}`; expect counts only. Confirm only after reviewing.
9. *Close out:* restore the owner to the allow-list, review `ci_research_control_log`, record totals.

**Expected cost:** about $0.005-0.01 in AI spend. **Risk:** low and bounded: one allow-listed account, 10 businesses, run cap $0.05, global stop $10, and a one-command disable (runbook step 1).

**Stop conditions:** any charge over $0.01 for the run, any profile for a non-allow-listed account, any lead removed, or a retry offered twice. Disable research (step 1) and report.

## Notes from the pre-deployment gate

- **Offline member harness:** for any non-admin profile the server page resolves the plan through Stripe (`getUserProfile` -> `resolveUserSubscription`). `tests/member-my-leads-browser.mjs` refuses every Stripe request, so My Leads answers 500 for a free or paid profile there (evidence: `StripeConnectionError ... ECONNREFUSED 127.0.0.1:1` in the dev log). The harness therefore uses its admin profile for My Leads scenarios; the free-plan scraper-page scenarios do not hit this because that page resolves the plan on the client.
- **Production consequence worth knowing:** the same dependency means a Stripe outage can make My Leads and other server-rendered dashboard pages fail for non-admin members. Not changed here (Stripe-adjacent); recommended for a separate review with a database-backed fallback.
