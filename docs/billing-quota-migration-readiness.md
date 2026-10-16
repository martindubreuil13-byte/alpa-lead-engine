# Billing quota migration readiness — Chunk 2

Prepared on `billing/test-readiness`, continuing from `1f0be1c`. Local preparation only: no production queries or writes, remote migration application, Stripe changes, deployment, merge or protected-worktree edits in this chunk. Authentication is outside this task.

## Execution order and dependencies

These files are reviewed SQL proposals outside automatic migration history. Do not run `supabase db push` or replay the contents of `applied-records`. The production catalog snapshot and the applied records are evidence of prerequisites, not instructions to recreate production.

| Order | Required action | Dependencies / effect |
|---|---|---|
| 0 | Inspect actual target catalog, back up data and function definitions, and review historical/subscriber findings | `auth.users`, `auth.uid()`, `auth.role()`, `anon`, `authenticated`, `service_role`; existing `public.users`, `profiles`, `leads`, `usage`, `subscriptions`, `user_usage` |
| 1 | Run `supabase/proposed/20261020_billing_quota_preflight.sql` read-only | Existing atomic discovery receipt schema/RPCs and guest trials with `owner_user_id`. Missing dependencies or malformed evidence block the process; resolve findings explicitly |
| 2 | Decide historical usage treatment and reconcile unresolved manual/legacy subscriber access before activation | No automatic plan changes, zeroing, guessed consumption, invented business IDs or implicit grant of a fresh Free allowance |
| 3 | In a separately approved write window, apply `supabase/proposed/20261015_phase1_pricing.sql` once | Requires atomic discovery baseline. Widens `users.plan` constraint, creates/backfills lifetime ledger and recording trigger, then replaces capacity RPC |
| 4 | Apply `supabase/proposed/20261019_guest_import_lifetime_quota.sql` once | Requires the preceding ledger and enabled recording trigger; guest trials must have account ownership. Creates durable claim/import receipts and service-only atomic import RPC |
| 5 | Verify counts, grants, function definitions and application compatibility before enabling the matching app | Compare pre/post snapshots; ensure only planned additive objects/constraint/function changes occurred. Application imports fail closed if RPC unavailable |

Baseline references: `supabase/applied-records/20261014_discover_atomic_saves.sql` defines `discover_save_receipts`, `get_discover_capacity(uuid,integer,boolean)` and `save_discover_results(uuid,uuid,integer,boolean,jsonb)`. Guest prerequisites are recorded in `20261012_guest_trial.sql` and `20261012_guest_trial_account_link.sql`. The saved `supabase/test-env/schema.sql` includes these foundational objects. Optional `leads.website_facts` and `light_profile` are supported but not required by the import RPC; absent optional columns leave guest copies intact. No research migration is a dependency of these quota proposals.

The proposals are intentionally single-application scripts: rerunning them fails transactionally rather than truncating/reinitializing a ledger. Use an audited applied-change record and inspect the catalog after any interrupted connection. A connection loss at commit requires checking state before retrying.

## Preservation and initialization

The lifetime baseline is the distinct union of:

1. Every retained business with an owner and a non-null email or phone, using the existing countability rule.
2. Every explicit business UUID recorded with outcome `saved` in a discovery save receipt, attributed to that receipt's owner. Include IDs absent from the current library; deduplicate overlaps and repeat receipts by `(user_id, lead_id)`.

Only exact saved IDs qualify. `duplicate`, `invalid` and `limit` outcomes do not create ledger rows. A missing/malformed outcomes array or saved UUID aborts the migration for review. The ledger's initial `created_at` is the recording/backfill time, not a claimed historical discovery time.

All existing leads, including accounts already over 25, remain intact. Guest trials, saved website facts, light profiles, subscription references, profile entitlements, `usage` periods/counters, legacy `user_usage` rows and discovery receipts are not rewritten. The import migration adds claim ownership for known linked trials and item receipts only where a retained same-owner lead matches; it does not claim every guest result was successfully imported. Expired linked trials retain their history too.

`starter_100` remains the new 100/month plan; legacy `starter` retains 500 and `prospector` 120. Pro remains 500/month. No subscriber is converted or downgraded by migration. The monthly RPC can subsequently update the active limit when the authenticated application requests the resolved plan; it preserves the existing used count. Monthly windows are not realigned to Stripe renewal dates. Usage already above a downgraded limit blocks further saving and never deletes businesses.

The pricing migration now takes a source-table write lock through backfill and trigger installation. The guest migration similarly locks its legacy sources through receipt creation. Both have a five-second lock timeout and a five-minute statement timeout: contention or a larger-than-tested dataset aborts cleanly. Schedule a quiet/drained write window and measure on a representative copy; do not blindly increase timeouts or remove locks in production.

## Historical data recommendation — release blocker

The result is a **proven lower bound**, not a reconstructed complete lifetime total. An unrecorded deletion cannot be counted merely because a monthly aggregate or guest `used` value is higher. Monthly counters may overlap receipt/retained evidence, cover different plan periods, or have legacy semantics. Linked guest JSON establishes discovery/ownership but does not prove which results were imported, skipped or deleted. Missing receipt IDs prove the business is absent from that owner's library, not necessarily why it is absent (deletion or reassignment).

Recommended treatment:

- Preserve all source evidence and recorded counters. Initialize only the exact union above; do not subtract, overwrite counters or synthesize entries.
- Accounts with a proven count at or above 25 have no further Free capacity, while retaining all existing businesses.
- For legacy accounts below 25 with incomplete history, keep production activation blocked until the owner approves a per-account evidence correction or an explicit documented grandfathering baseline. If activation must proceed beforehand, an account-level hold on additional Free allocation is a separate required implementation; these proposals do not implement such a hold.
- If no further evidence exists, exact historical lifetime consumption is unknowable. A grandfathering decision is a business exception and must not be described as proof of a strict historical 25-business maximum.
- New post-migration accounts have complete recording from their first saved business. Unknown legacy data should never be silently described as zero lifetime use.

The earlier readiness review recorded 1,117 retained countable businesses across eight profiles and 15 discovery receipts containing 185 saved IDs, all retained at that time. That is prior audit evidence, **not a fresh production audit in this chunk**. It neither proves that no earlier deletions occurred nor resolves incomplete paths/history. Two unlinked paid profiles and stale subscriber state were also previously unresolved; this chunk preserves their records and makes no new Stripe claims.

The read-only preflight lists malformed receipts, per-account proven counts, receipt IDs absent from the library, linked trials, aggregate usage explicitly labeled as non-additive evidence, missing owners, anomalous/overlapping monthly periods and paid profiles missing subscription references. It is an operator review aid, not a full subscriber reconciliation or a certificate of complete history. Keep its customer-level output private.

## Rollback and recovery

Two forms were tested:

1. **Failed application:** both forward scripts run in a transaction. Failure after their final DDL/backfill statement rolls back schema, function, constraint and backfill changes together. Existing customer data and prior function definitions remain intact. Malformed evidence, wrong order and a disabled ledger trigger also abort without partial installation.
2. **After successful application:** `supabase/proposed/20261020_billing_quota_rollback.sql` is a non-destructive operational rollback. Drain in-flight requests first, then revoke capacity/save/import execution from normal service and client roles. Discovery and guest import become unavailable. Keep the current fail-closed application, the ledger trigger and every source/ledger/claim/item/receipt row. Privileged database owners remain able to administer the database.

Do not restore the old retained-count function or old non-atomic guest route: that would reopen the loophole. Do not drop the ledger or receipt tables: that would discard usage accrued since migration. This rollback deliberately retains additive schema and the widened plan constraint. If a table-level writing path remains outside the paused RPCs, the trigger continues recording it; operator-owned SQL remains privileged and must be controlled during a pause.

After correcting the issue and reviewing state, restore `EXECUTE` to **service_role only** for the three RPC signatures in the rollback file. No reinitialization/backfill replay is needed, and lifetime use remains unchanged. Full schema teardown/restoring an old application is not approved or supplied as a safe operational rollback.

## Focused verification

Disposable PostgreSQL 17, synthetic data only. The test loads the entire saved production-shaped catalog (tables, constraints, triggers, functions, policies and grants), omitting only extension creation unavailable/irrelevant to the fixture. Supabase-managed auth functions/users and roles are local stubs; no hosted auth or payment call occurs.

Representative data includes Free, over-limit Free, new Starter/Pro, legacy Starter/Prospector, admin and unresolved manual access; archived and active usage; subscriptions; retained/deleted businesses; duplicate/invalid receipt evidence; linked expired and unclaimed guest trials with profiles.

- Final database run: **26 passed, zero failed, zero skipped**. Includes 12 migration safety checks/parent, 13 guest-import checks/parent, and the existing Phase 1 accounting test.
- Preservation: full row snapshots of `auth.users`, `profiles`, `users`, `leads`, `guest_trials`, `usage`, `user_usage`, `subscriptions`, `discover_save_receipts`, and `ci_research_controls` match before/after forward application.
- Exact evidence: ten retained + five receipt-only business IDs becomes fifteen; overlapping/repeated receipt IDs counted once; a separately deleted business lacking evidence is not invented.
- Failures: malformed receipt shapes/UUIDs, wrong dependency order, disabled trigger, lock timeout, late pricing failure and late guest failure all roll back atomically. Duplicate application fails without reset or source changes.
- Concurrency: an insert queued during backfill is recorded by the installed trigger, with no gap.
- Quotas: Free stops at 25 after deletion; over-limit libraries remain; Starter stops at 100 and Pro at 500 while preserving existing monthly consumption and legacy allowances. Upgrade/downgrade retain used counts.
- Operational rollback preserves every source and ledger/claim/item row, blocks all three RPCs for service-role calls, keeps recording enabled and recovers without resetting usage. Client import execution remains denied after recovery.
- Targeted ESLint and diff whitespace checks passed. No full application/browser suite was needed for this SQL-only change; existing focused quota tests were rerun.

Reproduce only on a disposable loopback database with the required local fixture roles:

```sh
ALPA_TEST_DB_URL=postgresql://postgres@127.0.0.1:55448/postgres \
  node --experimental-strip-types --test tests/billing-migration-safety-db.test.mjs \
  tests/phase1-pricing-db.test.mjs tests/guest-import-quota-db.test.mjs
```

## Changed files

- `supabase/proposed/20261015_phase1_pricing.sql`: stable-source locks, baseline/evidence checks, receipt-based historical backfill.
- `supabase/proposed/20261019_guest_import_lifetime_quota.sql`: stable-source locks and enabled-trigger prerequisite.
- `supabase/proposed/20261020_billing_quota_preflight.sql`: read-only evidence and anomaly review.
- `supabase/proposed/20261020_billing_quota_rollback.sql`: preserve data/history while pausing quota entry points.
- `tests/billing-migration-safety-db.test.mjs`: production-shaped migration/preservation/rollback regressions.
- `docs/billing-quota-migration-readiness.md`: this review and execution guidance.

No application route, plan definition, research access/budget, Stripe configuration or applied historical schema record changed. Chunk 3 was not started.
