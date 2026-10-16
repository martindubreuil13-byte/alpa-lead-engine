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

## Not covered, and why
`e2e/run.mjs` (the October 15 suite) still drives the retired Prospector plan ("Start Prospecting", `plan=prospector`), so its scenarios 2+3, 4+5, 8, 10, 11, P4 and 12 fail on
navigation before reaching any billing code (only 1, 9 and 12x run on the new site, all passing). It needs porting to Starter/Pro or retiring; phase2 and legacy-starter cover its intent
(checkout, activation, duplicate-checkout 409, cancellation) except the signed-out and cross-account session ownership checks (6, 7) and the paid-search refusal during an outage (12), which should be re-run after porting.
Email delivery was not exercised: the test project's built-in sender rate-limits signups, so accounts are created through the admin API with a generated confirmation link.
