# Billing security and Stripe-outage resilience (prepared, NOT deployed)

Branch `feat/billing-security-prep`, based on the deployed Phase 8 release (`8854d35`). Nothing here has been deployed, no Stripe
setting, price, discount or production budget was changed, and the original unfinished worktree (`/private/tmp/claude-501/phase1`)
was only read.

## 1. Checkout fixes brought over from the unfinished work

Applied as a patch of exactly these files (their base, `a29e1b2`, is identical to the same files on the Phase 8 line, so it applied cleanly):

| File | Change |
|---|---|
| `lib/stripe/checkout-guard.ts` (new) | Pure rules: session ownership, activation, duplicate subscriptions, customer adoption |
| `app/api/post-checkout/activate/route.ts` | Authenticated; session must belong to the caller (metadata user id + the profile's own Stripe customer, no other profile holding it); idempotent; only the session id is accepted; **no lead import and no deletion**; stale or superseded sessions cannot overwrite a newer subscription |
| `app/api/checkout/route.ts` | Authenticated only; account, email and customer come from the session and the caller's own profile, never the request body; duplicate-subscription check (Stripe's view, then the local record) before any Stripe call |
| `app/api/checkout/session/route.ts` | Authenticated; ownership verified; the answer is "not found" for unknown and foreign sessions alike; no email returned |
| `lib/stripe.ts` | A Stripe customer belonging to another user is never adopted or rewritten |
| `components/auth/PostCheckoutAccountForm.tsx`, `components/checkout/StartCheckoutButton.tsx` | The browser sends only what the server needs (no leads, no workspace flag, no identity email); a visitor creates an account first, then chooses a plan |
| `tests/billing-security.test.mjs` (new, 20 tests), `tests/no-unsafe-lead-delete.test.mjs` | Cover all of the above |

**Excluded on purpose:** `app/page.tsx` and `components/site/PublicHeader.tsx` (landing-page work), and everything else in that worktree.

Product change to be aware of: checkout now belongs to an account, so a visitor who is not signed in is sent to create one first
(`/login?mode=signup`) instead of paying first and creating the account afterwards.

## 2. Stripe-outage resilience (new on this branch)

| Rule | Implementation |
|---|---|
| Pages must not fail because Stripe is unreachable | `getUserProfile()` and `GET /api/auth/subscription` use `resolveSubscriptionForNavigation`: Stripe gets 2.5 seconds, then the stored plan is shown |
| The stored plan is display only | The fallback profile carries `plan_verified: false` and `subscription_active: false`; `isPaid()` returns false for it, so no paid feature is granted from a stored plan |
| Paid actions keep live verification | The discovery route still calls `resolveUserSubscription` with no shortcut; if Stripe cannot be reached it answers 503 ("could not verify your subscription, nothing was used") and starts nothing. Automatic research reads the plan from that same live result |
| Fewer Stripe calls on ordinary navigation | A free member never linked to Stripe (no customer, no subscription) triggers no lookup on page loads (previously two customer searches per request). Anyone with a Stripe link, and every paid action, still checks |
| Canceled and stale plans | A canceled or ended subscription shows free whether Stripe is up or down; a stored "active" plan with Stripe down displays but grants nothing |

New files: `lib/auth/stored-subscription.ts` (pure stored-state rules moved out of the resolver), `lib/auth/subscription-display.ts`.
Touched: `lib/auth/resolve-user-subscription.ts` (`navigation` option, `readStoredSubscription`), `lib/auth/get-user-profile.ts`,
`lib/auth/access.ts`, `lib/supabase/types.ts`, `app/api/auth/subscription/route.ts`, `app/api/scrape/route.ts` (friendly 503 only).

Limits: the 2.5 second bound stops the page waiting; the underlying Stripe request may finish in the background. The client-side
dashboard shell already reads the plan from the database only, so it was never affected.

## 3. Guest-to-member claim

`/api/guest/claim` is untouched. The activation route no longer imports or deletes anything, so a claimed business cannot be removed
by checkout. Covered by `guest-flow-integration`, `guest-signup-continuity` and the 20 billing tests (no deletion, no import).

## 4. Not covered / follow-ups

- Stripe test-mode walkthrough of the five checkout scenarios (owner, foreign session, stale session, second checkout, existing account with leads) has not been run; it needs Stripe test mode and a test account.
- The Stripe SDK's own retries (it retried twice in the outage harness) continue in the background after the page has already answered.
- Deploying this branch changes the sign-up-to-pay funnel (account first); confirm that is wanted.

## 5. Account-first journey (final validation)

Approved journey: choose plan, create or open an account, guest businesses come across, straight on to the selected Stripe checkout,
pay, return to ALPA, activate, paid features.

Gaps found by tracing the real code, and fixed (only what the journey needs):

| Gap | Fix |
|---|---|
| The plan was dropped: a signed-out click on a plan went to `/login?mode=signup` with nothing else | The plan and source travel in the address and in the browser for a day (`lib/checkout/pending-plan.ts`) |
| After sign-up or sign-in the visitor always landed on the dashboard, never on checkout | Every way of finishing sign-up or sign-in (including the confirm-your-email round trip) now continues to `/checkout/start`, after the guest businesses have been claimed |
| No step existed between "account ready" and Stripe | `app/checkout/start/page.tsx` asks the server once for the checkout address (the server verifies the account); 401 goes back to sign-in, "already subscribed" goes to billing, any error shows a calm message and one link back to plans |
| Coming back from payment while signed out sent the customer to a plain login, losing the payment | The login link carries the payment page (`?next=/post-checkout?session_id=...`), limited to exactly that path shape |

Verification: `tests/checkout-funnel.test.mjs` (5), `tests/billing-journey.test.mjs` (9, the real routes against an offline model of Stripe and the
database; mutation-checked: breaking the ownership check or the duplicate-subscription check makes tests 3 and 5 fail), and 4 new member browser scenarios.
**Not Stripe test mode**: no test-mode credentials, products or isolated database exist in this environment (see the release report).
