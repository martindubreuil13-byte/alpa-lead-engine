# Billing and authentication release candidate — Chunk 4

Prepared 16 October 2026.

Scope: production baseline `8854d35`, billing through `fefb3d0`, authentication through `7f0b591` (including `ef35217` live verification and `2ed8026` password recovery). Branch: `release/billing-auth-rc`, isolated worktree `work/alpa-release-candidate` in the Codex workspace.

Billing and authentication were merged locally into this candidate. No production branch was merged, no branch pushed, and no deployment performed. Cost Intelligence and Claude's animated landing-page work were not integrated. The original ALPA main checkout, source feature worktrees and protected unfinished billing worktree were not edited.

## Conflicts and compatibility

- `app/api/scrape/route.ts`: retained the strict `requireFresh` resolver plus bounded live-entitlement verification, and billing's durable Free/monthly accounting. A Stripe outage returns 503 before accounting, search or research authorization.
- `tests/stripe-resilience.test.mjs`: asserts the strict integrated verification path.
- Webhook changes merged without textual conflict: both modern invoice subscription references and payment-event duplicate lookup remain. Their regression tests pass; this does not establish database-enforced exactly-once analytics under concurrent deliveries.
- Public checkout choices remain Starter and Pro. Starter maps to `starter_100`, $9.99/month and 100 businesses; Pro remains $24.99/month and 500; Free remains 25 lifetime businesses. Existing legacy Starter/Prospector mappings and allowances are retained for old subscribers. Authentication's plan-persistence tests and browser scenarios now use the current public choices, not Prospector.
- Authentication redirects, email confirmation, password reset and metadata-based cross-device plan persistence are included. Customer-controlled metadata selects a plan only; it never supplies prices, account ownership or entitlements.

## Guest-import correction

Login, confirmation and signed-in continuation use the same handover client. It accepts an import only when the server returns explicit success and valid nonnegative counters. Failed requests, missing RPCs, unauthorized/expired trials and malformed responses do not clear guest mode or write a successful import notice. Only the server's explicit `No guest session` response is a safe no-op on another device.

Failures show a visible error, stop checkout/navigation and offer retry on confirmation/continuation. The login form shows the import error and can be retried. A lost response after database commit is safe to retry against the existing atomic import RPC; duplicate results are accepted without adding another business. All source guest businesses/profiles stay server-side; no browser lead payload is sent. Completed imports with allowance skips retain the existing explicit skipped-allowance notice.

Cross-device persistence carries the chosen plan, not the original browser's private guest cookie. Importing that original unclaimed trial still requires its browser. An expired or wrong-owner trial remains an error; this integration does not extend expiry, reassign ownership or bypass quota.

## Fast link-exchange correction

Supabase can finish a valid URL exchange and remove its URL parameters before the page effect starts. The original callback is captured before SDK initialization and handed to its own page once; a later bare visit cannot reuse it. The candidate now keeps a page-local witness of the SDK's matching sign-in event, requiring a PKCE verifier present before initialization for code links. Stored-login/initial-session events without a verifier do not qualify, and PKCE recovery additionally requires the recovery marker in that verifier (the installed SDK emits SIGNED_IN for PKCE recovery). Implicit recovery requires PASSWORD_RECOVERY. Token-hash links continue to be verified explicitly. No token is logged or persisted by this witness.

A failed automatic exchange can consume the verifier too. The page now distinguishes that situation from a genuinely different browser, showing an expired/invalid-link path instead of incorrectly claiming that email confirmation succeeded. Regression checks cover prior logins, wrong links/tokens, missing verifiers and ordinary sign-ins during recovery.

## Verification

The connected offline integration test runs real confirmation rules and session establishment, the guest handover client, and claim/checkout/activation routes against local fake authentication, Stripe and database boundaries. Both paid plans activate, preserving the imported businesses. It separately exercises the real discovery route and real subscription resolver during a Stripe outage, proving zero provider calls and no allowance operation. No live Stripe behavior is claimed by these mocks.

- Complete automated suite: 971 passed, 0 failed, 86 database-dependent checks skipped with `ALPA_TEST_DB_URL` unset. No persistent database or migration was used.
- Connected billing/authentication tests: 4 passed (included in the complete suite).
- Focused handover/confirmation/checkout tests: 22 passed (included in the complete suite).
- TypeScript: passed, including the production build. ESLint: no errors, 21 pre-existing warnings. Production build: passed with offline placeholders, including a dummy Resend key required by the existing admin mail route; no email was sent.
- Browser confirmation/guest handover: 15/15 passed. Browser password recovery: 13/13 passed. These run the real screens and SDK against local fake services; no email was sent. All 28 browser scenarios passed on the final code.

Intermediate failures exposed stale source assertions/old plan expectations, sandbox restrictions on local fixture sockets, callback timing issues and a missing import/helper option caught by browser/type checks. Those failures were corrected; no final check remains failing. The clean results above supersede those intermediate runs. A highly concurrent run was stopped after resource contention; the completed run used two workers. Browser harnesses use webpack, launch Next directly with an open stdin pipe, warm the auth routes, and wait for server shutdown. This avoids dependency-symlink and development-reload interference with one-time links. Recovery checks verify the final Continue link without compiling unrelated dashboard screens mid-test. All browser network boundaries are local mocks, and Stripe transport is blocked.

## Remaining release blockers

- The prepared lifetime/guest-import migrations remain unapplied. Preserve the reviewed dependency order and historical-data decision from Chunk 2 before deployment. SQL proposals are unchanged by this integration; database tests from that chunk are not claimed as rerun here.
- Historical deleted-business uncertainty, manual/legacy subscriber reconciliation and monthly-window/Stripe-renewal alignment still need explicit decisions. This candidate does not repair production records or reset usage.
- Real SMTP delivery, Supabase redirect/confirmation configuration and hosted signup remain unverified here; no emails were sent.
- Production Stripe prices, first-month offer activation, webhook configuration and plan-change enablement remain separate authorized activation work. Test IDs/keys must never become live configuration.
- Starter AI Research eligibility, allow-lists and budgets are unchanged and require separate approval before expansion.
- Cost Intelligence and the animated landing page remain separate workstreams. Stop here for review before another integration chunk.
