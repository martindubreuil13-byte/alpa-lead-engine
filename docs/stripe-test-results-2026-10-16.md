# Stripe test-mode validation on the integration branch (2026-10-16)

Branch `feat/legal-and-db-tests`. Environment: private `.env.stripe-test` (Stripe account test mode; Supabase test project `alpa-billing-test`, ref `xkvr…`),
app built and run locally on :3000, `stripe listen` forwarding to it. Production database, live Stripe, real email and paid providers were not used
(`RESEND_API_KEY` was a dummy; OpenAI, Serper and Google keys unset). No secret appears here.

## Safeguards
- `scripts/test-env/check-isolation.mjs`: 13 of 13 ok before the run. The listener's signing secret equals `STRIPE_WEBHOOK_SECRET` (compared without printing).
- The three migrations on the test project: pricing was already applied (ledger 107 = countable businesses); guest import (with the expired-profile fix) and cost
  intelligence (wrapped in one transaction) were applied now: 7 cost tables, 5 functions, row-level security on all seven, `claim_guest_businesses` present, 6 legacy claims preserved.
- The `NEXT_PUBLIC_APP_URL` in the env file is `:3321`; the runners hard-code `:3000`, so the run overrode it in the process environment (the file is unchanged).

## Results
| Suite | Result |
|---|---|
| `e2e/phase2.mjs` (new Starter $9.99 / Pro $24.99): signup, checkout with first-month 50%, activation, preserved businesses | 2/2 pass (paid $4.99 and $12.49; `starter_100` and `pro`) |
| Renewal on Stripe test clocks, full price, no repeated discount | 2/2 pass ($9.99, $24.99) |
| Promotion reuse refused after cancel/resume; Pro downgrade at renewal, Starter upgrade, schedule-aware cancellation | pass |
| Cancellation reaches Free at period end, data kept | pass |
| `e2e/legacy-starter.mjs` (new): legacy $29.99 subscription via real webhook, 500 allowance, 409 on new-plan checkout, guest import paid vs lapsed, cancellation keeps data | 4/4 pass |
| Outage matrix (free, unverifiable paid, webhook-synced paid, Stripe unreachable) | pass: all fail closed |
| Webhook signature: unsigned, wrong secret, stale timestamp | 400 each; 151 listener deliveries, 150 returned 200, none failed |

## Update 2026-10-17: the three remaining gaps are closed
`e2e/run.mjs` (the October 15 suite, Prospector flows) is retired; its intent is covered by `phase2.mjs`, `legacy-starter.mjs` and the new `billing-security.mjs`.
The tooling now takes the app's port from `NEXT_PUBLIC_APP_URL` (the env file's `:3321` works as is), restarts the app by port instead of `pkill -f 'next start'`,
and keeps its logs outside the repository (`E2E_DIR`, default the system temp folder).

`node scripts/test-env/e2e/billing-security.mjs` (from the repository root, production build running, `stripe listen` forwarding): 4 of 4 pass.
1. Account B cannot look up or activate Account A's checkout session, open or paid: 404, byte-identical to the answer for an unknown id; B stays free with no subscription; A unchanged.
2. Signed out, and with a forged session: 8 billing operations answer 401 (subscription, session lookup, checkout x2, activation, cancel, resume, change-plan); `/checkout/start` lands on the login form; Stripe's checkout sessions and subscriptions are unchanged.
3. Stripe unreachable: the search of a webhook-synced paying customer and of a free customer both answer 503 "could not verify your subscription"; usage, research runs, queue and businesses unchanged; the paying customer's search is accepted once Stripe is back.
4. Webhook unsigned, wrong secret, tampered and stale: 400; signed replay twice: 200 and no change; B cannot read A's business (404, empty under row-level security), change their own plan or call an operator function.
Email delivery is still not exercised (the test project's sender rate-limits signups; accounts are created through the admin API).
