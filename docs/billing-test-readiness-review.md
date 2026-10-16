# ALPA billing readiness review

15 October 2026 · Continued from `c46c374` · **Stripe TEST configuration complete; production activation remains blocked.**

Work is isolated on branch `billing/test-readiness` in this chat's `work/alpa-phase1` clone. No deployment, live Stripe mutation, production migration, production data write, budget change or expansion of research access occurred. The unfinished billing worktree was not modified.

## Stripe test configuration

Account: `acct_1Ry8juAhk7C2xF8e`. Every created product, price, coupon, promotion and tested subscription was verified in test mode.

| Plan | Regular price | Monthly businesses | Product | Recurring price |
|---|---:|---:|---|---|
| ALPA Starter | USD $9.99 | 100 | `prod_VRiEsNl56c3Cil` | `price_1UQonwAhk7C2xF8eRg2Pi6Q1` |
| ALPA Pro | USD $24.99 | 500 | `prod_VRiEeNSe6ZaJao` | `price_1UQonxAhk7C2xF8eq0iBuoC8` |

- Coupon: `ALPA_FIRST_MONTH_50_TEST_V1` — **50%, duration `once`**, restricted to the two new products.
- Promotion ID: `promo_1UQoobAhk7C2xF8e12BrDDnG`.
- Test code: `ALPAFIRST50TEST` — restricted to the customer's first transaction.
- Stripe's rounding gives **$4.99 Starter / $12.49 Pro** on the first invoice. The discounts are $5.00 / $12.50. Renewals charge $9.99 / $24.99. Displaying $5.00 / $12.50 as the amount charged would be inaccurate for this literal 50% promotion.

The configuration script is repeatable and preserves legacy products/prices. Its private test environment retains the old test price mappings for legacy subscription compatibility. No existing price was archived or deleted.

## Real Stripe test results

The local app connected only to `alpa-billing-test` (`xkvraadbvfjlcohdpspg`) and Stripe TEST mode. No Google, Serper, OpenAI or other paid-provider key was loaded. Stripe's CLI forwarded actual test webhook events to the local app.

| Scenario | Result | Evidence |
|---|---|---|
| Starter hosted checkout → test-card payment → activation | PASS | First invoice paid 499 cents; profile became `starter_100`; existing business and saved profile unchanged |
| Pro hosted checkout → test-card payment → activation | PASS | First invoice paid 1249 cents; profile became `pro`; existing business and saved profile unchanged |
| Starter renewal | PASS | Test clock produced a paid renewal invoice for 999 cents; introductory discount did not recur |
| Pro renewal | PASS | Test clock produced a paid renewal invoice for 2499 cents; introductory discount did not recur |
| Cancel/resume and promotion reuse | PASS | App cancel/resume succeeded; after cancellation Stripe rejected forced reuse of the promotion for the same customer; ALPA's returning-customer checkout was full-price |
| Pro → Starter → Pro and scheduled cancellation | PASS | Pro retained until renewal; scheduled Starter then activated; paid upgrade to Pro succeeded; canceling removed the pending downgrade schedule; saved data unchanged |
| Cancellation at the billing-period end | PASS | App scheduled cancellation; test clock advanced; real `customer.subscription.deleted` delivery returned 200; profile became Free; business and saved profile retained |
| Coupon applied to an unrelated legacy product | PASS | Stripe rejected it: the coupon did not apply to anything in that order |
| Actual public signup using the supplied controlled address | **BLOCKED** | Supabase returned `over_email_send_rate_limit` for `martin@mindrasolutions.com` |

**Signup qualification:** the first lifecycle runs used reserved example.com test addresses, which Supabase rejected as invalid. Their accounts were created unconfirmed with the isolated test admin API; real generated confirmation links were followed before checkout. That fallback is not counted as a public-signup pass. A subsequent real signup with the user-supplied controlled address reached the email rate limit. Inbox delivery and an uninterrupted public signup → confirmation → checkout journey still require verification.

No existing account password was reset. The blocked signup was not replaced with an admin-created account for the supplied address.

Test clocks were advanced in steps to prove renewal and cancellation; no real payment card or live charge was used. A local receiver interruption caused one initial cancellation delivery to fail; after the receiver was kept in a persistent terminal, a dedicated full-price test subscription completed the entire app-scheduled cancellation with actual Stripe delivery. The final successful result supersedes the interrupted run; webhook retries/reconciliation remain an operational activation requirement.

## Application changes and defects fixed

- Added a **test-only** introductory-promotion integration. It requires `ALPA_TEST_INTRO_OFFER_ENABLED=true` and a test secret key; a live key is explicitly refused. Production's preview/inactive discount display is unchanged.
- Eligibility is derived server-side from the account's stored subscription history and Stripe's customer subscription history. The app applies the restricted **promotion code**, not a raw reusable coupon. Stripe performs its own first-transaction restriction check. Canceling does not erase account/customer history.
- A customer with prior subscriptions gets a regular-price checkout. Test coverage rejects recurring, unrestricted, inactive, live and incorrect-percentage promotions.
- Corrected schedule creation: Stripe rejects metadata together with `from_subscription`. The schedule is created first; ownership metadata is set with the phase update. A retry can recover an interrupted creation through its exact idempotency request and cannot adopt an unrelated schedule.
- An upgrade from the applied downgrade releases ALPA's own schedule before changing the existing subscription. A scheduled cancellation also releases ALPA's pending downgrade. No saved-business or usage reset is performed.
- Updated invoice webhook handling for modern Stripe invoice subscription references under `parent.subscription_details`.
- Added reusable test configuration, lifecycle, public-signup and promotion-scope scripts plus regression coverage.

A promotion restricted to a first transaction prevents repeated redemption by the same Stripe customer. It does not establish a person's identity across deliberately separate accounts/customers. Stripe also treats some attempted payments and canceled trials as prior history; failed-payment eligibility and checkout retry messaging should be included in the final commercial acceptance review. [Stripe's promotion restrictions](https://docs.stripe.com/billing/subscriptions/coupons#limit-by-first-time-order)

## Database proposal and preservation

Applied `supabase/proposed/20261015_phase1_pricing.sql` **only to the isolated test project**. Production still has no lifetime allowance ledger.

Before and after application, the original **105 test businesses** had the identical business-ID fingerprint. After all billing lifecycle tests, excluding only the two newly created lifecycle accounts, the original 105 IDs were still identical. Research-control fingerprints also remained identical. The ledger held 107 rows after adding the two seeded billing businesses.

The proposal adds the versioned Starter entitlement, backfills retained valid businesses into a durable allowance ledger and changes Free capacity to use it. It does not rewrite subscriber plans or delete customer data. The full disposable SQL tests cover deletion not restoring Free allowance, replay, duplicates/invalid results, monthly renewal, preserved usage across limit changes, permissions and concurrent saving.

**Additional gap found:** `/api/guest/claim` still derives free import capacity from the current saved library. A member who used Free through another path, deleted records and never claimed a trial could regain capacity through their first guest import. The migration's ledger alone does not close that path. The import needs lifetime accounting and an atomic quota check, with deletion/import and concurrency tests, before production activation. This investigation did not expand that route or alter production data.

**Monthly window:** the existing usage period is independent of the Stripe billing period. Stripe's renewal invoices were verified; that is not evidence that ALPA's usage reset occurs on the same date. An explicit billing-window/usage-window policy and migration must be reviewed, especially for downgrades with usage already above the new allowance.

## Legacy subscriber reconciliation — read only

Audited eight production profiles, current authenticated identity records, 95 existing Stripe customers and eight Stripe subscriptions. Requests were GET-only. No unmatched active subscription was found.

- One linked legacy Starter subscription remains active at **$29.99/month**, with its 500-business entitlement preserved.
- One profile still says canceling Prospector although Stripe says canceled.
- Two profiles say active Starter and contain customer references but have no subscription ID. No existing live customer/subscription matched their stored references, authenticated email or user metadata. They require a human decision about manual/legacy access; they were not downgraded, relinked or charged.
- The other canceled subscription and Free/admin profiles were preserved.

Anonymized audit references for the two unresolved profiles: `445cae3c0c` and `fcb0d4ee84`. Existing customer identities and live subscription IDs are omitted from deliverables.

## Historical deleted-business usage

Production currently contains **1,117 valid saved businesses across eight profiles**, including 341 in the administrator's library. Fifteen retained save receipts cover **11–12 October 2026** and identify 185 successfully saved business IDs. All 185 still exist: **zero proven deletions within that recorded subset**.

This is not evidence that no business was ever deleted. The receipts do not cover all history or all creation paths, and the old counters do not reconstruct exact lifetime use. Backfilling only retained businesses cannot reliably account for older deleted records. A documented grandfathering/baseline policy is required; no historical totals were invented or written to production.

## Starter AI Research decision — investigated, unchanged

The new internal plan is `starter_100`. The existing application predicate permits `admin`, `prospector`, legacy `starter` and `pro`, but excludes `starter_100`. Billing activation therefore works for Starter while automatic research remains unavailable.

Eligibility is only one gate. Automatic research also depends on application switches, the database allow-list, authorization and spend controls. The production controls inspected read-only were:

| Protection | Current value |
|---|---:|
| Allow all customers | false |
| Allow-listed accounts | 1 |
| Global monthly cap | $2.00 |
| Per-run cap | $0.10 |
| Reservation per attempt | $0.002 |
| Per-profile ceiling | $0.006 |
| Proposed run-scoped monthly per-user formula | plan allowance × $0.001 |
| Customer concurrency / attempts | 2 / 1 |

With that formula, Starter would have $0.10 of monthly research budget and Pro $0.50 if they were otherwise authorized. Those limits do not promise an AI profile for every business. Adding the plan name alone would not authorize the customer cohort or establish the intended product promise.

The recommendation to include Starter research is recorded as a **pending access and budget decision**. No plan predicate, allow-list, research switch, queue implementation or budget was changed. Any pilot/cohort expansion and its cost expectations need explicit approval first.

## Verification

- **997 automated tests passed; 0 failed; 0 skipped**, including disposable PostgreSQL and optional research regression tests.
- Production build and TypeScript checks passed.
- ESLint: 0 errors, 21 existing warnings.
- Seven successful real Stripe test billing scenarios, plus the negative product-scope check.
- Actual public signup remains blocked as described above; it is not included in the passing billing count.
- The Phase 1 guest/member browser suites had passed 54/54 and 22/22. This continuation used the real hosted Stripe browser journeys rather than rerunning unrelated UI suites.
- Research/budget implementation files match `c46c374`; no production migration or deployment took place.

## Production activation checklist

1. [ ] Resolve the isolated project's email sending limit/SMTP configuration, then finish public signup with the supplied controlled mailbox, verify inbox delivery, confirmation, guest transfer, chosen plan, payment and activation without admin-user creation.
2. [ ] Review the new first-month **charge amounts $4.99/$12.49**, regular prices, wording and first-time eligibility. Exercise declined/SCA payments, abandoned/retried checkout and concurrent checkout before commercial sign-off.
3. [ ] Decide the two unresolved legacy access records and the stale canceled Prospector record. Preserve saved data and existing contracts; any relinking, entitlement change or price migration requires an explicit reviewed action.
4. [ ] Approve a historical-usage baseline/grandfathering policy. Close the guest-import lifetime-quota gap and test concurrent import/discovery before treating Free as strictly one-time across every path.
5. [ ] Decide whether monthly usage follows Stripe billing dates, including upgrade/downgrade treatment. Prepare and test that policy without erasing usage or deleting businesses.
6. [ ] Approve or reject Starter AI Research separately, including the customer cohort, monthly budget and what happens when research budget is exhausted. Keep current access/cost protections until approved.
7. [ ] Review the production SQL proposal, backup/rollback approach and catalog preflight; apply only after explicit production-migration authorization. The test application must not be released ahead of its required schema.
8. [ ] Obtain explicit live-Stripe authorization. Create separate LIVE products, prices and once-only first-purchase promotion; never copy test IDs or keys into live configuration. Preserve all legacy price mappings.
9. [ ] Prepare an independently reviewed production promotion activation path. The current test-only flag deliberately refuses live keys; production offer copy remains inactive until real configuration is ready.
10. [ ] Verify production webhook signing, invoice/subscription API compatibility, missed-event replay/reconciliation, test/live environment separation, monitoring and recovery. Enable plan switching only after the reviewed live settings are ready.
11. [ ] Obtain deployment authorization, verify a controlled production purchase after release, and monitor entitlements, charges, quota use and cancellation while keeping a rollback path.

**Readiness conclusion:** the requested Stripe TEST configuration and downstream billing milestone are complete. Production activation is not approved or ready; the checklist above remains open.
