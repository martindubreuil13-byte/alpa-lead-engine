# Stripe test-mode end-to-end results (2026-10-15)

Branch `feat/billing-security-prep` at `23e251f` plus the new runner `scripts/test-env/e2e/` (committed with this file). Nothing deployed;
production was not contacted. Environment: the private `.env.stripe-test` (Stripe account `acct_1Ry8juAhk7C2xF8e`, test mode; Supabase project
`alpa-billing-test`, ref `xkvraadbvfjlcohdpspg`), the app built and started locally from the billing worktree, and `stripe listen` forwarding
to `localhost:3000/api/stripe/webhook`.

## Isolation (verified before anything ran)
- Guard `scripts/test-env/check-isolation.mjs`: all 11 checks ok, "Isolated test environment confirmed".
- Stripe: the key's account is `acct_1Ry8juAhk7C2xF8e`; both prices are `livemode: false`, USD, monthly, active: Starter 2999, Prospector 999.
- The listener's signing secret equals the configured one (compared without printing).
- Supabase: URL ref is `xkvraadbvfjlcohdpspg`, not production; 34 tables visible; email provider on, auto-confirm off.
- No OpenAI, Serper or Google key present; no live Stripe key loaded; the worktree has no `.env.local`.

## Scenarios (`node scripts/test-env/e2e/run.mjs`, retired on 2026-10-17: see stripe-test-results-2026-10-16.md; one run, dedicated `alpa-billing-*@example.com` accounts)
| # | Result | Evidence |
|---|---|---|
| 1 Guest experience | PASS | 8 seeded businesses, contacts, website facts and one saved AI profile shown (with the website-information disclosure) |
| 2 Account creation / guest transfer | PASS* | 8 businesses, the AI profile and all website facts transferred; the trial row is linked to the account |
| 3 Plan survives sign-up, confirmation, sign-in | PASS* | Prospector chosen signed out; kept through an unconfirmed sign-in refusal, the confirmation link and the password sign-in; landed on Stripe checkout |
| 4 Stripe checkout | PASS | Session shows "ALPA Prospector $9.99 per month", price id = the configured Prospector test price; paid with 4242 on Stripe's hosted page |
| 5 Activation | PASS | Session stamped with the account's id; profile free until paid; then plan prospector, status active, one subscription; 27 webhook deliveries, all 200 |
| 6 Session ownership | PASS | Another account: lookup and activation 404, identical to an unknown id; nothing modified; signed out: 401 |
| 7 Duplicate activation | PASS | 3 repeats, with `cleanWorkspace:true` and an injected lead: 200 each, one subscription, 8 leads and the profile byte-identical |
| 8 Existing customer data | PASS | 5 leads and a saved profile; paid Starter ($29.99); everything byte-identical |
| 9 Abandoned checkout | PASS | Profile free, no Stripe subscription, 3 leads intact, activating the unpaid session refused (409), retry produced a new checkout |
| 10 Stale session | PASS | Pay, cancel at Stripe, pay again; the old session refused (`session_expired`); the newer subscription untouched |
| 11 Second subscription | PASS | 409 `already_subscribed` for both plans; no new Stripe session; one active subscription |
| 12 Stripe outage | **FAIL** (partly) | See below |
| P4 Security | PASS | Webhook: unsigned, wrong secret, tampered body and stale timestamp all 400; correctly signed replay x2: 200 and no change; another customer's lead 404 and empty under row-level security; a customer cannot change their own plan or call an operator function; research controls unchanged |

\* Sign-up: the app's own sign-up call reached Supabase and was refused with HTTP 429 `over_email_send_rate_limit` (the test project's built-in email
sender), so the account was created through the admin API, unconfirmed, and the confirmation link was generated and followed, exactly what the email
button does. Everything after that ran through the app.

Webhook delivery over the whole run: 67 deliveries, all `[200]` (checkout, customer, subscription, invoice, payment events; unhandled types are acknowledged).

## Defect found (scenario 12)
Outage matrix (`ONLY=14`), with every Stripe request refused, one account of each kind:
| Account | My Leads | Plan shown | Stripe asked on the page | A search |
|---|---|---|---|---|
| free | 200 | free | 0 | **503**, nothing started (fails closed) |
| paid, no Stripe ids on the profile (cannot be confirmed locally) | 200 | starter, `verified:false`, not active | 3, refused | **503**, nothing started (fails closed) |
| paid, subscription id already synced by webhooks | 200 | starter, `verified:true`, active | 0 | **200: the search starts**; Stripe is never asked |

Cause: `resolveUserSubscription` only asks Stripe when the stored profile is free, has no Stripe ids, or has an ended cancel-at-period-end
(`shouldRefreshStripe`). For a paying account whose subscription id was synced, it answers from the database and nobody asks Stripe, so during an outage
a paid action (and automatic research authorization, once switched on) proceeds on the stored plan. If a cancellation webhook was ever missed the stored
plan stays "active" until the period end. This is how the code behaved before this branch; the branch's offline model of the outage (which always called
Stripe) did not reflect it, which is why the offline tests passed.

Smallest safe fix (not applied): before AUTHORIZING research (and, if you want it stricter, before starting a search) call
`resolveUserSubscription(user.id, { email, forceRefresh: true })`; if Stripe cannot be reached, skip the authorization (leads saved, no research queued).
One extra Stripe call per search; no migration; the page and My Leads behaviour is unchanged. Requires a test change to model the real resolver.

## Regression (clean shell: no test or production keys loaded)
TypeScript 0 errors; ESLint 0 errors (21 existing warnings); Node suite 980 tests, 897 pass, 0 fail, 83 skipped (they need a disposable Postgres);
production build passes; guest browser suite 54 of 54; member browser suite 22 of 22.
