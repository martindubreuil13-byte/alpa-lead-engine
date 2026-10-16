# Cost intelligence (admin → Costs)

Branch `feat/admin-cost-intelligence`, built on the deployed Phase 8 code (8854d35). Not merged, not deployed, no migration applied.

The page answers three questions: what ALPA costs today and this month (estimated), what it costs to deliver one business, and how close the estimates were to the bills at month end (monthly reconciliation).

## What is recorded, and how
Every provider request is recorded where it is made, in ALPA's own database. The dashboard reads only that database (refreshed every 60 seconds while the tab is visible) and never calls a provider.

| Provider | Where | One row is | Measured | Estimated |
|---|---|---|---|---|
| Serper | `lib/sources/serper.ts` | one HTTP request (one geo tile) | request, status, results, credits when Serper reports them | credits (3 per map search when not reported), USD at $0.001 per credit |
| Google Places | `lib/sources/google.ts` | one text-search page or one details request | request, status, results returned | USD at published SKU list prices, before free allowances |
| OpenAI | profile, guest profile, outreach, ICP, setup call sites | one chat completion | the provider's own token counts and completion id | USD at list price |

- **Serper** pricing is in `SERPER_PACKAGES` and `SERPER_CREDITS_PER_OPERATION` (`lib/costs/pricing.ts`): 50,000 credits for $50, 3 credits per Maps request. Requests and credits are stored separately, with whether the credits were `reported` or `configured`. An operation that is not configured has unknown credits and no invented cost. To change prices, add a package or edit a value; events keep the estimate that applied when they happened.
- **Google** bills events, not just requests. One Text Search (Legacy) request is billed as Text Search + Basic + Contact + Atmosphere Data; one Place Details request as Place Details + Basic (+ Contact when phone/website are requested). The row stores one request and lists its SKUs; the dashboard shows SKU events separately ("470 events" never means 470 requests). The numbers reproduce Google's report for the shared project (38 text searches + 225 details = 263 Contact and 38 Atmosphere events). Estimated usage cost is before free allowances; ALPA never computes Google's remaining free allowance, because the project is shared.
- **OpenAI** unknown models are recorded with tokens and no cost.

Everything is labelled **estimated**. Not stored: keys, query text, bodies, business names, emails, phone numbers.

## Reliability of recording
- Each event has a unique `event_key` (OpenAI: the completion id; others: a random id made once per request) and is written with insert-ignore-duplicates, so a retried or repeated write counts once.
- A write is tried twice inside a 2-second budget, never throws, and never changes the customer's response. The OpenAI call sites `await` it so a serverless function stays alive long enough; the discovery run flushes at its end.
- If the cost tables do not exist, the first write notices and later writes are skipped for 5 minutes.
- **Remaining limits:** a record is lost if the database is unreachable for the whole budget, or if a function is killed between a provider call and its write (the window is a few milliseconds for OpenAI, longer for Serper/Google, which are flushed at the end of the run: a run killed mid-way loses its unflushed rows). A genuinely repeated call to a provider is a new billed response and is counted again, as it should be. Agent-mission discovery has no run id. Losses are logged as a count (`[costs] a usage record was not written`), not alerted on. Reconciliation is the safety net that shows the size of any gap.

## Monthly reconciliation
- An administrator enters the verified billed amount per provider and month: original amount, currency, exchange rate to USD (required for any non-USD amount; USD is rate 1, and the USD figure is derived by the database), date reconciled, optional note, and for Serper the credits used per its dashboard. No amount means the month is **Pending**; the bill shows **Not reconciled**.
- Shown per provider: estimated cost, actual billed cost, difference (actual − estimated) and status. If usage is recorded after a month was reconciled, the page flags that the estimate moved.
- Reconciliation writes only its own table; request-level usage is never modified.
- **Serper is prepaid.** Credit purchases are recorded in a separate table and list, with their own credits and amount (also with currency and rate). They are never added to an estimate or reconciliation. For Serper, enter the value of credits consumed that month, not the purchase price.
- Writes (including purchase edits) require an administrator, JSON from this site, and pass server-side validation; the browser cannot set `billed_usd`, `updated_by` or the status.

## Prepaid purchases: corrections and audit trail
- A purchase can be corrected (date, amount, currency and rate, credits, note) but never deleted. The database refuses `DELETE`/`TRUNCATE` (trigger, and the service role is not granted them); there is no delete route (the handler answers 405).
- Edits go through `admin_edit_prepaid_purchase`, one transaction that locks the row, keeps the values being replaced in the append-only `api_prepaid_purchase_history` (with who, their email, and when), then updates and bumps `version`. A direct update outside the function is refused by a trigger, so the audit trail cannot be skipped.
- Double submissions: every form opening carries a request key. A new purchase with a key already stored is ignored; an edit whose key was already applied returns "duplicate" and changes nothing. An edit built on an older version is refused (409) and the page reloads.
- The function reads and writes only the purchase and its history. Usage events, estimates and reconciliations cannot change (proved in the SQL tests by comparing them byte for byte before and after).

## Tracking health
The panel at the top of the page says Healthy, Degraded or Unknown, from facts the database reports (`admin_tracking_health`) and a pure verdict (`lib/costs/health.ts`):
- **Unknown**: tracking is not switched on; the check could not be read; nothing has been recorded yet; or there was no member discovery run to compare with. No failure records on their own never make it healthy, because a broken tracker also has none.
- **Degraded**: usage-write failures were recorded in the last 7 days, or more than 5% of recent member discovery runs (saved results, older than 15 minutes, after tracking began) have no cost record.
- **Healthy** only with positive evidence: events recorded, activity that was expected, and that activity recorded.
- Failed writes are counted in memory and written to `api_tracking_failures` as one batch (count, first/last time, `write_failed`/`timeout`/`mixed`, a short error code; never a message) as soon as the database accepts a write again. Reporting is fire-and-forget and bounded; it can never interrupt a search or AI research.
- **Cannot be seen**: a failure while the database is unreachable is held in memory until it is back (lost if that instance is stopped first); a function killed mid-request leaves no trace; the cross-check covers member discovery only, not guest searches or AI profile calls. The panel always says so.

## Not done on purpose
No Google Cloud billing sync or provider billing APIs; no enforcement (`api_cost_limits` alerts only, `enforce` is ignored); no gross contribution (no reliable revenue figure is connected).

## Historical data
Nothing is reconstructed. The only earlier evidence is settled research charges (`ci_research_charges`, token-based estimates), shown for days before tracking begins and labelled as such.

## Migration (proposed, not applied)
`supabase/proposed/20261017_api_cost_intelligence.sql` (+ `_rollback.sql`): seven tables (usage events, runs, limits, reconciliations, prepaid purchases, purchase history, tracking failures) and five functions (three read, one audited edit, one health), plus two guard triggers; it needs `discover_save_receipts` and `ci_research_charges` (existing baseline tables), all service-role only, RLS on, additive. Verified in PGlite (`tests/cost-intelligence-sql.test.mjs`). Until applied, recording is dropped quietly and both dashboard sections say they are not switched on.

## Before production
1. Review and apply the migration (owner approval). 2. Deploy. 3. Confirm rows appear after one discovery and that Serper responses include `credits` (the page shows which basis was used; if not, configured credits apply). 4. Enter the October Serper purchase (50,000 credits, $50) in Prepaid credit purchases. 5. Reconcile the first full month.

## Conflicts with other work
- `components/dashboard/DashboardShell.tsx`: one nav item.
- `app/api/scrape/route.ts`: `runScraper` becomes a thin wrapper around the original function plus one `recordDiscoveryRun` call; the billing branch edits the same file (entitlement check near the top of POST): a textual merge, not a logical one.
- `lib/sources/{serper,google}.ts`: instrumentation and `import type` for type-only imports.
- Tests: `customer-navigation.test.mjs` (nav and admin-page lists), `b2-phase0-production-contract.test.mjs` and `production-ci-contract.json` (proposed function names).
- No Stripe, pricing, checkout, entitlement, spending-limit or research-access change.


### Release-candidate integration (Chunk 5)

Integrated source `7518a38` into `release/billing-auth-rc` after billing/auth `968f939`. The RPC contract registry keeps both proposed billing imports and proposed cost functions separate from the production snapshot. No database changes were applied.

Before production activation, verify both baseline dependencies, review atomic execution of `20261017_api_cost_intelligence.sql` (no enclosing transaction), and approve a data-preserving recovery procedure. The supplied rollback drops cost tables and audit history; it is unsuitable after recording begins without an explicit export/retention decision. Billing lifetime-ledger and guest-import migrations remain separate prerequisites for commercial quota enforcement.

Recording failures cannot reject provider results; outstanding writes may add up to the two-second write budget. Missing tables pause recording, so the feature can be present while disabled; dashboard figures are estimates with possible telemetry gaps, not provider invoices. Focused tests cover successful discovery with throwing and hanging recording destinations. Browser checks use local fake authentication/data, including actual API denials for members and signed-out callers. Production authentication, invoice reconciliation, and schema activation still require a separately authorized rollout review.
