# Free-to-paid conversion: the first-month offer

## What exists today (Phase 5, UI only)

- Two different moments, kept apart on purpose:
  1. **After a CSV download** (the visitor still has businesses to explore): a simple thank-you and a quiet link to the plans. No discount.
  2. **When a visitor who has used their free businesses (or free searches) asks for more**: the upgrade moment, `components/conversion/UpgradePanel.tsx`. This is where the offer is previewed, because asking for more is the stronger buying signal.
- Guests: `/trial` shows the panel when the server's own record says the allowance is used (25 businesses, or 3 searches), and when a search is refused for that reason. Shared-network limits are a different refusal and never show the offer.
- Free members: the Discover page shows the same panel in place of the search form (no pop-up) when the free count is reached. Paid subscribers and administrators are never shown it. Members who have had a subscription before see the same page without the discount (it is a *first*-month offer).
- The wording and the rules live in `lib/billing/first-month-offer.ts` (`FIRST_MONTH_OFFER`, `describeOfferEligibility`, `buildConversionCopy`).
- **The discount is not active.** `FIRST_MONTH_OFFER.status` is `'preview'`. Every place that mentions the offer says "not active yet, so nothing is discounted today"; the button goes to the regular plans. Nothing touches Stripe, checkout, prices or subscriptions.

## What activating it requires (a billing release, reviewed separately)

1. **Stripe object.** A 50% coupon with `duration: once` (first invoice only) and a promotion code that is restricted to first-time customers (`restrictions.first_time_transaction: true`), created in test mode first. No price changes.
2. **Applied server-side.** `app/api/checkout/route.ts` (the BIL2 route) attaches the discount when it creates the Checkout Session, only for an eligible, signed-in customer. The browser never supplies a coupon or a percentage.
3. **Eligibility enforced on the server**, not by the page: no existing or previous subscription (the same rule as `describeOfferEligibility`: no `stripe_subscription_id`, no `canceled_at`, no lapsed status), not an administrator, one redemption per customer. The webhook and `syncSubscriptionToDatabase` need no change.
4. **BIL2 first.** Checkout must be the signed-in, duplicate-guarded flow, because a guest has no account to attach the discount to; the panel's button already leads to Plans, where a visitor signs in before paying.
5. **Prove it.** A test-mode purchase that shows the first invoice at 50% off and the second at the regular price; the success page and the Plan & Billing page must say the same thing.
6. **Then, and only then,** set `FIRST_MONTH_OFFER.status` to `'active'` (the panel then drops the "not active yet" notice and shows "The discount is applied at checkout"), update `app/plans/page.tsx` to show the same terms, and extend the tests that currently assert the inactive wording.
7. Legal and copy review of the terms line ("The discount applies to your first month only. Regular pricing resumes afterward.") and of how the discount is shown on receipts.

## Analytics

`conversion_offer_viewed` and `conversion_cta_clicked` carry only the audience (`guest` / `free_member`), the kind (`allowance` / `searches`), eligibility, which button, and the offer status. No email or personal data.
