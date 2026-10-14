# Commercial-launch blockers (found 2026-10-14, before inviting customers to pay)

Status: documented only. **No checkout, Stripe, billing or database change has been made.** Found by read-only audit while
verifying Phase 8. Items 1 and 2 were checked against the unfinished billing-security work and are already addressed there; see
"Overlap with the unfinished billing security work".

## Blocker 1: checkout activation trusts the client (High to Medium)

`app/api/post-checkout/activate/route.ts` (and the pages that call it).

| Problem | Evidence | Severity |
|---|---|---|
| **Session ownership is never verified.** Any signed-in user who holds a completed subscription checkout session id can attach that subscription to their own account (`syncSubscriptionToDatabase` is called with the caller's user id; nothing compares the session's customer or metadata with the caller). | The route only checks that the Stripe session is complete. Session ids are secret and unguessable, but they appear in the post-checkout URL (history, referrers, logs, screenshots). It matters more now: the Phase 8 paid-research entitlement reads the plan this sync sets. | High (leak-dependent) |
| **`cleanWorkspace: true` deletes the caller's whole library.** The flag is read from the request body; the route then runs `leads.delete().eq('user_id', caller)` through the service-role client. | Set to true only by `PostCheckoutAccountForm.handleCreateAccount` (new account creation after checkout). No confirmation. Cascades to the caller's queue rows and `lead_activity_events`; guest-imported leads are deleted too and re-imported only from the browser's local copy (up to 25). A repeat call deletes whatever accumulated since. A `pipeline` delete also runs against a table that does not exist. Not needed by the product any more (server-side guest claim replaced it). | Medium (self-inflicted data loss) |
| **The browser sends leads to import.** Up to 25 leads from local storage are inserted under the caller's id. | Bypasses the server-held trial that the claim route uses. | Low to Medium |

Not confirmed: whether an existing member can reach the delete through the post-checkout form with their own email (depends on
how Supabase answers a repeat sign-up).

## Blocker 2: checkout creation and lookup trust an email address (High)

- `POST /api/checkout` is callable without signing in and takes an `email` from the body. `resolveCheckoutUserId` looks that email up in `users` and then **upserts `profiles.stripe_customer_id` for that user**, so a caller can rewrite another member's Stripe customer link by naming their email. There is no duplicate-subscription guard before the Stripe calls.
- `GET /api/checkout/session?session_id=...` needs no sign-in and returns whether the session is verified **and the payer's email**.

## Blocker 3: every non-admin page depends on Stripe being up (Medium, reliability)

`getUserProfile()` resolves the plan through Stripe (`resolveUserSubscription`) for every non-admin request. The offline test harness, which refuses all Stripe requests, makes My Leads answer 500 for a free or paid profile (`StripeConnectionError ... ECONNREFUSED`). A Stripe outage can therefore make My Leads and other server-rendered dashboard pages fail for paying members. The plan is already stored on the profile by webhooks; the page should fall back to it when Stripe cannot be reached.

## Overlap with the unfinished billing security work

An uncommitted change set exists in the worktree `/private/tmp/claude-501/phase1` (branch `release/b2-phase1`, base `a29e1b2`, files dated 2026-10-12). It was only read, never run against production or edited.

| It contains | Covers |
|---|---|
| `lib/stripe/checkout-guard.ts` (new) | Session ownership (`metadata.user_id`, profile customer match, no other profile holding the customer, "not found" for strangers), stale-session reuse, duplicate-subscription rules |
| `app/api/post-checkout/activate/route.ts` (rewritten) | Authenticated, ownership-checked, session id only; **no lead import, no workspace deletion**, no service-role writes of client data |
| `app/api/checkout/route.ts`, `app/api/checkout/session/route.ts`, `lib/stripe.ts` | Checkout creation authenticated only, identity from the session not the email, duplicate guard before any Stripe call; session lookup authenticated, ownership verified, no email returned |
| `components/auth/PostCheckoutAccountForm.tsx`, `components/checkout/StartCheckoutButton.tsx` | The browser sends only what the server needs; no leads, no workspace flag, no email for identity |
| `tests/billing-security.test.mjs` (new, 20 tests) | All of the above. Run read-only: 20 of 20 pass. `tests/no-unsafe-lead-delete.test.mjs` is adjusted to match |

It does **not** cover Blocker 3 (the Stripe dependency in `getUserProfile`).

Its base `a29e1b2` is an ancestor of the Phase 8 line, and the Phase 8 line has not touched the checkout, activate, Stripe or form
files, so those files should apply cleanly. Two other files in that change set (`app/page.tsx`, `components/site/PublicHeader.tsx`) look
like landing-page work, not security; the Phase 8 line also changed them, so they would conflict and should be left out.

## Proposed remediation plan (no code changed yet)

1. **Do not re-implement.** Review the existing change set, then land it as its own reviewed release, separate from Phase 8: commit it on its own branch, drop `app/page.tsx` and `PublicHeader.tsx` from it, rebase the remaining files onto the Phase 8 line.
2. **Verify before shipping:** run `billing-security.test.mjs` plus the full suite on the combined line; sandbox-mode Stripe checks for (a) an owner completing checkout, (b) another account using the session id, (c) a stale session, (d) a second checkout while subscribed, (e) post-checkout with an existing account that has leads (nothing deleted).
3. **Add the missing piece (Blocker 3):** let `getUserProfile` fall back to the stored profile plan when Stripe is unreachable, with a short timeout, so a Stripe outage degrades to "last known plan" instead of an error. Small change, but Stripe-adjacent, so it needs its own approval.
4. **Order:** the checkout fixes before any customer is invited to pay and before the second-account research pilot (the pilot account is created through checkout). Phase 8 itself does not depend on them, but its paid-research entitlement is only as trustworthy as the plan it reads, so launch both together.
5. **Rollback:** each fix is a code deploy with no migration; revert the deployment.
