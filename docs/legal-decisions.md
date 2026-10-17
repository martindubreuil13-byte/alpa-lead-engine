# Legal pages: decisions applied and points still open (2026-10-17)

The three pages (`/terms`, `/privacy`, `/refund-policy`) are published in the release code: no draft notice, no noindex, in the sitemap, linked from the
footer and the plans page. Entity details are exactly as supplied by the owner (`lib/legal.ts`).

## Owner decisions applied
Entity MINDRA (AI) Solutions OÜ Ltd, Narva mnt 5, 10117 Tallinn, Estonia; contact info@mindrasolutions.com (support, privacy requests, account deletion, refunds, billing).
Governing law Estonia, subject to mandatory consumer protections. Monthly recurring billing in advance. Cancel anytime, paid access to the end of the paid period.
Generally non-refundable except where the law requires or MINDRA expressly approves; statutory rights are not waived. Deletion on request, subject to legal retention.
Account and saved data kept while the account is open; payment and accounting records as the law requires. Reasonable SaaS liability limitation that does not exclude non-excludable rights.

## Unverified
- The Estonian Business Register could not be queried from the build machine (HTTP 403) and no public page lists the company, so the **registry code 17236155**, the
  **registration number Ä 50282131** and the address are shown exactly as supplied, **unverified**. "Ä 50282131" does not look like a standard 8-digit Estonian registry code.
- The legal name was not changed. "OÜ Ltd" is redundant ("OÜ" is already the Estonian limited-company form); the registered name may be "MINDRA (AI) Solutions OÜ". Stripe's
  live account shows the same string "MINDRA (AI) Solutions OÜ Ltd" (country EE, type company), so the site is at least consistent with Stripe. Confirm against the register extract.

## Legally material points left open (not invented in the text)
1. **Analytics cookie consent.** Google Analytics loads whenever `NEXT_PUBLIC_GA_ID` is set (it is, in Vercel). Under the ePrivacy rules analytics cookies of visitors in the EU generally need
   consent first. The policy discloses Google Analytics and lists consent as the basis, but there is no consent banner. Either add consent, or switch analytics off for EU visitors, or remove the ID.
2. **Tax.** The pages say tax, if it applies, is shown at checkout. Stripe Tax / VAT registration is not configured in the code; confirm whether VAT must be charged on sales to EU customers.
3. **International transfers.** The pages say transfers outside the EEA rely on an adequacy decision or standard contractual clauses (the database is in the United States). Confirm the data-processing
   agreements and clauses are in place with Supabase, Vercel, Stripe, Resend, OpenAI, Google and Serper.
4. **Lawful basis for business contact data.** Written as legitimate interests with a right to object and a removal request by email. A lawyer should confirm, especially for individuals in the EU/UK.
5. **Inactive accounts and unclaimed trials.** No retention period is stated. Accounts are kept while open; unclaimed trials "only as long as needed". Nothing purges inactive accounts or old trials today.
6. **Account deletion is manual.** Described as a support request by email; there is no self-service deletion.
7. **Liability cap.** Limited to the amount paid in the twelve months before the event, within what the law allows. A lawyer should confirm this and the Estonian-law and consumer wording.
8. **No consent line at signup/checkout.** The plans page links the three documents; there is no "I agree" step at signup or in Stripe Checkout.
