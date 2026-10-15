# Cost intelligence (admin → Costs)

Branch `feat/admin-cost-intelligence`, built on the deployed Phase 8 code (8854d35). Not merged, not deployed, no migration applied.

## What is recorded, and how
Every provider request is recorded where it is made, with a fire-and-forget write that can never fail a request:

| Provider | Where | One row is | Measured | Estimated |
|---|---|---|---|---|
| Serper | `lib/sources/serper.ts` `searchOneTile` | one HTTP request (one geo tile) | request, HTTP status, results returned, run id | credits (1 per map search), USD |
| Google Places | `lib/sources/google.ts` `fetchPlaces` / `fetchPlaceDetails` | one text-search page, or one details request | request, status, results returned, run id | USD from list price + the data SKUs the requested fields generate |
| OpenAI | profile, guest profile, outreach, ICP, setup call sites via `recordOpenAiCompletion` | one chat completion | the provider's own token counts, model | USD at list price |

A Place Details request is **one** row listing the SKUs it generated (`place_details`, `contact_data`); SKUs are never separate requests. Rejected requests are recorded with cost 0. A search that returns nothing is still recorded and still costs. Run id, customer id and purpose come from an `AsyncLocalStorage` context set around `runScraper`; nothing else in the pipeline's signatures changed.
`api_usage_runs` stores what a run delivered (saved), skipped as duplicates and rejected (relevance, no contact info, invalid).

Everything is labelled **estimated** (`cost_basis = 'estimate'`). Prices are list prices dated in `lib/costs/pricing.ts` (`PRICING_AS_OF`). Nothing reads a provider's billing. Not stored: keys, query text, request/response bodies, business names, emails, phone numbers.

## Not done on purpose
- No Google Cloud billing sync (lags, needs more permissions). Reconcile against invoices later.
- No enforcement. `api_cost_limits` holds ceilings and alert percentages; the dashboard alerts; `enforce` is ignored and defaults false.
- No gross contribution: no reliable revenue figure is connected, so the card says so.
- Guest-claim, agent missions and the CI worker's own per-lead cost fields are unchanged; agent-mission discovery is recorded without a run id.

## Historical data
Nothing is reconstructed. The only earlier evidence is the research billing records (`ci_research_charges`, settled rows, token-based estimates): the page shows them for days before call-level tracking begins, labelled as such. Serper and Google spending before the first recorded request is unknown.

## Migration (proposed, not applied)
`supabase/proposed/20261017_api_cost_intelligence.sql` (+ `_rollback.sql`): three tables, two read functions, all service-role only, RLS on, no customer access, additive. Verified in PGlite (`tests/cost-intelligence-sql.test.mjs`). Until applied, recording is silently dropped and the page says tracking is not switched on.

## Before production
1. Review and apply the migration (owner approval). 2. Deploy. 3. Confirm rows appear after one discovery. 4. Confirm the Google project, plan and SKU list prices in `pricing.ts` (the Serper credit price depends on the pack bought). 5. Optionally insert ceilings into `api_cost_limits`.

## Conflicts with other work
- `components/dashboard/DashboardShell.tsx`: one nav item (shared file).
- `app/api/scrape/route.ts`: `runScraper` becomes a thin wrapper around `runScraperCore` plus one `recordDiscoveryRun` call; the billing branch edits the same file (entitlement check near the top of POST), so expect a textual merge, not a logical one.
- `lib/sources/{serper,google}.ts`: instrumentation plus `import type` for type-only imports.
- Tests: `customer-navigation.test.mjs` (nav list, admin page list), `b2-phase0-production-contract.test.mjs` and `production-ci-contract.json` (proposed RPC names).
- No Stripe, pricing, checkout, entitlement, spending-limit or research-access change.
