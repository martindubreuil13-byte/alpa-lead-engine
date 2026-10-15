# ALPA Phase 1 — pricing and entitlements

Prepared locally on 15 October 2026. **Not deployed; not ready for production activation.**

Source: `feat/billing-security-prep` at `e9839d8` from the ALPA repository. Implementation branch: `phase1/pricing-entitlements`, in an independent clone under this chat's `work/alpa-phase1`. The protected unfinished worktree was not modified. No remote branch was pushed.

## Implemented

| Public plan | Regular monthly price (USD) | Business allowance |
|---|---:|---:|
| ALPA Free | $0 | 25, one time |
| ALPA Starter | $9.99 | 100/month |
| ALPA Pro | $24.99 | 500/month |

- Replaced the old pricing cards, metadata and landing-page structured price. Updated checkout selection, sign-up/sign-in continuity, analytics amounts and billing labels.
- Added shared plan definitions. New Starter uses the internal entitlement `starter_100`, avoiding a destructive reinterpretation of existing `starter` subscribers, who retain 500. Legacy `prospector` retains 120.
- New checkout settings are `STRIPE_ALPA_STARTER_PRICE_ID` and `STRIPE_ALPA_PRO_PRICE_ID`. Checkout checks that each configured price is distinct from legacy prices, active, USD, licensed, monthly and exactly 999 or 2499 cents. Missing/mismatched settings block checkout. Unknown subscription price IDs fail closed instead of silently granting Starter access.
- Preserved existing account ownership, duplicate-subscription prevention and saved-business protections. Discovery now explicitly requests live subscription verification, addressing the release branch's documented stale-paid-state gap.
- Prepared an authenticated, same-origin plan-change endpoint and billing buttons. Downgrade retries reuse the account's existing schedule; canceling removes an ALPA-created pending downgrade before ending renewal. Upgrades update the existing subscription with prorated invoicing and wait for payment; downgrades schedule Starter for the next billing date. Plan changes never delete businesses or reset the used count. Legacy contract changes are refused pending reviewed migration. `ALPA_PLAN_CHANGES_ENABLED` defaults to false.
- Paid allowances continue using the existing monthly usage window, shown in the account; unused capacity does not roll over. This release does not silently realign existing usage windows with Stripe billing dates. The proposed quota function clamps calendar-month advancement and uses an exclusive period end.
- Prepared `supabase/proposed/20261015_phase1_pricing.sql`, deliberately outside automatic migrations. It adds the versioned plan to the users constraint, introduces a durable allowance ledger, backfills retained countable businesses, and counts future inserted/claimed businesses once per owner/business ID. Deleting a business, paying, canceling or returning to Free cannot replenish Free capacity. Monthly counters remain separate and retain usage across plan changes.
- Updated Free usage displays to read the durable ledger. The matching database proposal must be applied before this application is released.
- The 50% first-month offer is display-only, explicitly **not active yet**. No coupon is attached by this change. Regular prices remain visible; eligibility copy elsewhere remains intact.

Business counting retains ALPA's existing valid-business rule: a saved record must contain email or phone. Duplicate or invalid results consume no additional capacity. Guest businesses claimed into an account also enter the durable allowance ledger.

## Read-only subscriber audit

Read all eight production profile subscription summaries and retrieved the three referenced Stripe subscriptions. No audit result was written back to production; no customer identities, secrets or raw subscription IDs are included here.

| Finding | Result |
|---|---|
| Linked legacy Starter | One active live USD $29.99/month subscription; retain its 500-business entitlement |
| Linked Prospector | Profile says canceling; live Stripe subscription is already canceled, at its legacy USD $9.99 price |
| Linked Free profile | Referenced legacy Starter subscription is canceled |
| Unlinked Starter profiles | Two profiles say active Starter but have no subscription ID; require reconciliation |
| Other profiles | Two Free and one administrator |

The three referenced prices matched their legacy configured mappings. This audit did not enumerate every Stripe customer or search for orphaned subscriptions. The two unlinked paid profiles remain unresolved; no automatic conversion or destructive migration is included.

## Verification

- Final Node suite: **991 passed, 0 failed, 0 skipped**. Includes disposable PostgreSQL tests and all ten optional PGlite research regressions.
- Proposed pricing SQL exercised against a disposable PostgreSQL 17 instance: existing-business backfill, lifetime limit after deletion, replay, duplicate/invalid results, paid period creation, upgrade/downgrade retaining usage, renewal, row isolation, denied client writes and concurrent capacity enforcement all passed.
- Guest browser suite: **54/54** scenarios passed.
- Signed-in member browser suite: **22/22** scenarios passed. Its old Prospector checkout fixture was updated to Pro.
- Additional desktop/mobile checks passed for all three pricing cards, allowances, the inactive offer notice, no horizontal overflow and both account-first checkout selections.
- Immediate guest journey also passed on desktop and mobile: discovery, business profiles, CSV and return/sign-up continuity.
- Final production build: passed with offline placeholder service credentials.
- TypeScript: passed with no errors. ESLint: no errors; **21 existing warnings**.
- Final diff whitespace check passed. Research/budget implementation files remain byte-identical to the base branch.

Early verification attempts hit sandbox socket restrictions, a dependency-copy race and low local disk space. Those runs were superseded by the clean sequential final run above.

The tests use offline provider fixtures, disposable PostgreSQL and locally blocked Stripe traffic. They do **not** constitute a real Stripe test-mode purchase of the new prices or plan schedules. Existing historical test-mode results on the source branch cover the old plans only.

## Release blockers and limits

1. Create/configure the new Stripe prices in a separate authorized Stripe phase, then verify both full checkout journeys, webhook activation, renewal, proration/payment failure, scheduled downgrade, cancellation/resumption and retry recovery in isolated test mode. This phase did not create or change prices, products, coupons or subscriptions.
2. Reconcile the two unlinked Starter profiles and the stale canceled Prospector record before considering legacy subscriber migration. Existing contracts are preserved in this patch.
3. Review and explicitly apply the proposed database change before releasing the matching application. The lifetime backfill cannot reconstruct businesses deleted before this ledger existed; historical usage needs a reviewed policy before activation. No production SQL was executed.
4. Plan switching remains off until those checks pass. The scheduling implementation is prepared but has not been exercised against Stripe; retry recovery and schedule-aware cancellation have offline regression coverage and still require test-mode validation before enabling it.
5. Research allow-lists were preserved exactly as requested. The unchanged plan predicate does not recognize `starter_100`, so the new Starter will not be authorized for automatic research. Any decision to extend that predicate belongs to a separately authorized change. Discovery and saved-business access have the new entitlements.
6. Existing monthly usage windows can differ from Stripe billing dates. A scheduled downgrade changes the limit at billing renewal while retaining usage in the active usage window. Aligning old windows requires an explicit migration policy; none was imposed here.

## Scope preserved

No deployments, live Stripe mutations, production database mutations, budget changes or research allow-list changes. Google Cloud organization, service renaming, admin cost tracking and OpenAI removal were not included.

## Review and handoff

`ALPA-Phase-1.patch` contains the application changes, proposed SQL, tests and this report. Apply it to the exact source commit above using `git apply --index`; inspect the proposed database file separately. Do not run database deployment tooling on this patch as an activation step.
