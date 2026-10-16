# Legal pages: owner decisions

The three pages are drafts (`LEGAL_DRAFT = true` in `lib/legal.ts`). Each decision below is marked on the page itself in an amber box.
Publishing means: decide each item, replace the box with the final wording, set `LEGAL_DRAFT = false`, add the three paths to `app/sitemap.ts`, and get a lawyer to review the result.

Nothing on the pages invents a company name, address, jurisdiction or refund commitment.

## Terms of Service (/terms)

- **T1** Name the legal entity that contracts with customers (registered name, legal form, registration number, registered address and country), and say whether sales tax applies and how it is shown. Nothing is filled in here because it has not been confirmed.
- **T2** Confirm the minimum age to hold an account, whether business use only is intended, and how long an inactive free account or unclaimed trial is kept before it is deleted.
- **T3** Decide and state: whether businesses you delete from your lists still count toward your quota; how a lifetime free allowance is treated if you delete and recreate an account; what happens when you reach your quota mid-period (stop, or offer an upgrade); how much notice you will give before changing prices or allowances for existing subscribers; and whether currency, taxes and the monthly window follow the calendar month or the billing date.
- **T4** Confirm that the data providers’ own terms allow what ALPA does with their data (storing, exporting to CSV and keeping it after a subscription ends), and whether any attribution or display rule has to be added here.
- **T5** Decide which plans include AI research and any limit on it. The current setup limits AI research to approved accounts while it is being tested, so describe availability only once it is settled.
- **T6** Decide the process and notice for suspension, and whether data can be exported by a suspended or cancelled customer.
- **T7** Have a lawyer confirm the wording for the countries you serve (for example Canada’s anti-spam law, CAN-SPAM in the United States and the GDPR in Europe) and whether ALPA targets customers outside Canada and the United States.
- **T8** Confirm that subscriptions renew automatically until cancelled, the currency charged, and the consumer-law renewal and cancellation notices required in the places you sell to.
- **T9** Decide the notice period for material changes and whether customers may cancel with a refund if they do not accept one.
- **T10** A lawyer must write the limitation of liability, including any cap, the exclusion of indirect loss, and any indemnity from you for misuse. Nothing is invented here.
- **T11** Choose the governing law, the courts or arbitration venue and the language of the contract. Quebec and consumer-protection rules may limit what can be chosen; take advice before filling this in.
- **T12** Provide a monitored contact email for legal and billing matters and the postal address that must appear here. None is invented.

## Privacy Policy (/privacy)

- **P1** Name the legal entity, its address and the person responsible for privacy (required by Quebec’s Law 25 and by privacy laws elsewhere). None is invented here.
- **P2** Confirm this list against what you want to collect, and decide whether IP addresses or server logs are kept and for how long.
- **P3** This is the highest-risk privacy question in the product. A lawyer should confirm the lawful basis for collecting business contact data, whether a notice to the businesses is needed, a removal (opt-out) process and its response time, and the position for individuals in the EU, UK and Quebec.
- **P4** Decide whether you will send product or marketing emails. None are sent today without separate approval, and any such email needs a consent and unsubscribe process. Confirm “we do not sell” is a promise you want to make.
- **P5** Confirm this list is complete and current when you publish, and whether data-processing agreements are in place with each provider. Review whether the AI provider may keep or train on inputs under your account terms.
- **P6** Decide whether a cookie consent notice is required for the visitors you target, and whether analytics should wait for consent. Currently analytics loads whenever an analytics ID is configured.
- **P7** Set the retention periods: account data after cancellation or deletion, an unclaimed trial, saved businesses, billing records (tax law usually requires some to be kept for years), and server logs. No periods are stated because none have been decided.
- **P8** State how requests are made, how identity is checked, the response time, and whether there is a self-service account deletion in the product (there is none today). Add the complaint route for your regulator.
- **P9** Decide the breach-notification commitment, and avoid stating security practices that are not in place.
- **P10** Confirm the actual hosting and database regions, and add the cross-border transfer wording your laws require.
- **P11** Confirm the age threshold (see Terms decision T2).
- **P12** Add the effective date at approval.
- **P13** Provide the privacy contact email and postal address. None is invented here.

## Refund and Cancellation Policy (/refund-policy)

- **R1** Confirm the currency, whether taxes are added to the listed price, and the wording of the automatic-renewal notice required where you sell. Also decide whether and how any introductory offer (such as a discounted first month) is described; none is active today.
- **R2** Decide what happens to saved businesses and exports after a subscription ends: whether they stay accessible in full, become read-only, or are removed after a set time.
- **R3** The refund commitment is a business decision and nothing is promised on this page yet. Choose one and write it in plain words: (a) No refunds for a period already started, because cancellation takes effect at the end of the period; or (b) A full refund of the latest payment if requested within a number of days and the quota has not been used (or only a limited part); or (c) A fixed-period money-back guarantee on the first payment. Also decide: who can approve exceptions, how the refund is sent (to the original card through Stripe), the time it takes, and what statutory refund or withdrawal rights apply in the places you sell to. Consumer law may give rights that this policy cannot remove, so take legal advice before publishing.
- **R4** Decide whether a refund is reduced or denied once businesses have been delivered, and whether a failed or empty search that did not deliver businesses is credited. State it here so refund and quota rules do not conflict.
- **R5** Confirm the retry schedule and the grace period you want, since they are set in Stripe, not in this page, and must match the text.
- **R6** Changing between Starter and Pro from the billing page is switched off in the current build. Decide whether to enable it and how price differences are handled (immediately with proration, or at the next renewal) before describing it here.
- **R7** Give the address that handles billing questions and refund requests, and the time you commit to for replying. None is invented.
