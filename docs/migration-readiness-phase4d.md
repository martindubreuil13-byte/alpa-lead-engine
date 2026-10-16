# Production migration readiness (Phase 4D) — read-only audit, 2026-10-16

Project `quebec-outreach-desk` (hnhptrqdirqofkwimapo), PostgreSQL 17.6, 51 MB. Only read-only queries were run. Customer identifiers below are
shortened; no emails, keys or row contents were extracted.

## Verdict: GO for a preflight-complete, backed-up, owner-approved migration. NO-GO for running anything until the approvals below are given.

## What production has now
- Baseline present: `get_discover_capacity`, `save_discover_results`, `discover_save_receipts` (15), `guest_trials` (3, none linked), `ci_research_*`
  tables, `leads.website_facts` and `leads.light_profile`. Roles anon/authenticated/service_role exist. RLS on every public table.
- Absent (so no name conflicts): `business_allowance_ledger`, `guest_import_claims/items`, `claim_guest_businesses`, `guest_import_key`,
  `record_business_allowance`, all `api_*` cost tables and `admin_*` cost functions.
- `public.users` (0 rows) has `plan IN ('free','starter')`; the pricing migration widens it (validated against 0 rows).
- Supabase's migration list is incomplete (9 entries; the rest were applied by hand, see `supabase/applied-records/`). Do not rely on it as proof of state.

## Data findings
| Check | Result |
|---|---|
| Malformed discovery receipts (blocks pricing migration) | 0 |
| Leads whose owner is missing in auth (would break the ledger FK) | 0 (no ownerless leads either) |
| Usage rows with bad values or overlapping periods | 0 |
| Ledger rows the backfill would create | 1,117 (all retained countable businesses; receipts add none) |
| Linked trials / trials over 25 businesses | 0 / 0 |
| Profiles / auth users | 8 / 14 (six auth users have no profile, harmless to these migrations) |
| Writes in flight during the audit | 0 |

Profiles (shortened id, plan / status, Stripe customer / subscription, businesses retained, lifetime lower bound):
- `35d2cccf` admin, 341 retained (usage 6,944 in total; current period 341 of 10,000).
- `8f87a001` and `bca8fa4c` **starter / active, Stripe customer but no subscription, period ended 2026-05-04** — the two unlinked paid profiles.
- `f6b4f337` starter / active with subscription, 53 retained, usage limit 300 (legacy Starter is 500).
- `6216135e` free / canceled, 621 retained, usage 599 against 500.
- `f1428a18` prospector / canceling, subscription, no period end, 10 retained.
- `b8f53731` free, 23 retained (2 Free businesses left). `ff48687e` free, 6 retained (19 left).

## Conflicts and risks
1. **Free quota rule changes, no customer loses anything today.** Free capacity moves from "businesses currently retained" to a lifetime ledger.
   Only `6216135e` is above 25 and was already blocked. History before the ledger is a lower bound: deleted businesses are unknowable, so
   free accounts below 25 can get a few more than a strict lifetime count (`b8f53731`, `ff48687e`, and `f1428a18` if it ends up on Free). Owner decision Q2.
2. **The two unlinked paid profiles are inconsistent between SQL and the app.** The app (strict check) asks Stripe and, finding no subscription,
   treats the account as Free; the SQL guest import treats `plan='starter'` with status `active` as paid, so those two could import a guest trial beyond 25.
   Exposure is two accounts, one with 9 businesses and one with 0. The app's non-strict path can also write `free/canceled` onto such a profile when its owner browses,
   so a login could change the record without anyone deciding to. Recommendation: change nothing now; see Q3.
3. `f6b4f337` has a current-period usage limit of 300 against the 500 legacy allowance; the new `get_discover_capacity` rewrites `leads_limit` on first call.
   Counters stay untouched. Confirm the intended allowance (Q4).
4. The new `get_discover_capacity` also changes period handling: `period_end > now` (was `>=`) and a new period of `now + 1 month`. Harmless, but note it.
5. `20261017_api_cost_intelligence.sql` has no enclosing transaction. Run it inside `BEGIN; ... COMMIT;`; it has no concurrent index builds.
6. Locking: pricing and guest import each take SHARE ROW EXCLUSIVE on `leads` (+ receipts or trials) for well under a second with 1,249 leads; `lock_timeout` is 5 s and aborts safely.
7. Forward compatibility: the live app keeps working with the new `get_discover_capacity` (same signature). The release-candidate app needs all three migrations first,
   otherwise guest import fails closed. So migrations go before the app deploy, never after.

## Exact order
0. Approvals Q1–Q6. Choose a quiet window (about 15 minutes; actual SQL time is under a minute).
1. Backup: confirm a Supabase backup/PITR point exists, **and** take a manual data dump of `profiles, usage, leads, discover_save_receipts, guest_trials, ci_research_*` plus the schema
   (`supabase db dump`, run by the owner; about 51 MB). Store it outside the repo.
2. Re-run `20261020_billing_quota_preflight.sql` (read-only) immediately before; the counts above must be unchanged or explained.
3. `20261015_phase1_pricing.sql` (own transaction). Verify: ledger rows = 1,117, trigger enabled, capacity function returns for the free profiles.
4. `20261019_guest_import_lifetime_quota.sql` (own transaction). Verify: claim function exists, service-role only.
5. `20261017_api_cost_intelligence.sql` wrapped in one transaction. Verify: seven tables, five functions, RLS on, nothing readable by customers.
6. Smoke checks with test accounts only, then deploy the release-candidate app to a Vercel **preview** against production data with Stripe in test mode.

## Rollback and recovery
- Stop point: any step fails -> its transaction rolls back; stop and do not continue.
- Pricing/guest import are additive and data-preserving. Operational pause: `20261020_billing_quota_rollback.sql` revokes execute on the three functions (the app then fails closed).
  Old behaviour of the capacity function: `20261015_phase1_pricing_restore_capacity.sql` (saved from production today; it re-enables "delete to free capacity", so use only with approval).
- Cost migration: `20261017_api_cost_intelligence_rollback.sql` drops only its objects (loses recorded cost rows).
- Data loss beyond that: restore from the step-1 dump/PITR into a new project, not over production.
- Tested: all three migrations, their rollbacks and the quota logic pass in a disposable PostgreSQL 17 (1,160 tests, Phase 4C).

## Estimated impact
Seconds of write blocking on `leads`; no downtime for reads or sign-in. Ask for no discovery runs or CI research during the window.

## Decisions needed before execution
- Q1. Approve the maintenance window and the backup method.
- Q2. Grandfathering: accept the lifetime-ledger baseline (lower bound) for existing free accounts, or set explicit baselines per account.
- Q3. The two unlinked paid profiles (`8f87a001`, `bca8fa4c`): are they your own or test accounts? Allow a read-only Stripe lookup of their customers? Then choose: leave as is, or a separately approved, backed-up update to free/canceled.
- Q4. Legacy Starter allowance (500) versus the usage limit of 300 on `f6b4f337`; and whether `6216135e` (621 businesses on Free) keeps access to them.
- Q5. Approve wrapping the cost migration in one transaction.
- Q6. Decide whether the pilot-limits script (`20261019_phase8_pilot_limits.sql`, not part of these three) is in this window; it is not needed.

## Update: legacy Starter profiles (owner decision)
`8f87a001` (a former customer) and `bca8fa4c` (the owner's paid test) are historical, expired accounts. They are preserved as they are, with their
businesses; no production record is changed and no Stripe reconciliation or customer-recovery work is done. If either person returns, they register a new account.
Q3 is closed. The only change is in `20261019_guest_import_lifetime_quota.sql`: a stored paid plan counts as paid in `claim_guest_businesses` only while a paid-through
date is in the future, or a Stripe subscription is linked and its date is not yet recorded. Both profiles now get the Free lifetime quota there. Regression test:
`an expired or never-linked paid profile gets the Free quota...` in `tests/guest-import-quota-db.test.mjs` (fails on the old migration, passes on the new).
