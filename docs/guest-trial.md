# Frictionless guest discovery

Released from production typography baseline 38da65a in an isolated worktree.

The landing trial calls the existing `/api/scrape` discovery engine in explicit guest mode. It does not sign out existing customers or consult subscription accounting for the guest search. After completion, `/trial/results` immediately shows all returned businesses, available contacts, and expandable website facts. Those facts are extracted from the safe, robots-aware pages already read for email discovery; no extra AI research is scheduled. Missing fields and possible addresses are shown honestly.

Guest results are stored in the new service-only `guest_trials` table before lead events are delivered. A signed HttpOnly, Secure, SameSite cookie selects the trial. Browser storage is a convenience mirror, not an allowance or export authority. The CSV is a plain `GET /api/guest/export` that returns the visitor's own businesses as an attachment immediately. No email, account or card is requested, nothing about the download is stored, and no emails are sent. (The `email`, `marketing_opt_in` and `consent_at` columns of `guest_trials` remain from the earlier design and are no longer written or read.)

A guest can request up to 25 businesses in total, with at most three searches. A transaction reserves capacity before any provider call; unused capacity is returned after a completed run. Each guest has one active search. A keyed daily hash of Vercel's client IP limits a shared address to six trial search attempts per UTC day. This is reasonable abuse friction, not identity-based prevention. Cookie deletion, new IPs, and shared networks remain limitations. Interrupted runs whose receipt never completes conservatively retain reserved capacity. Expired sessions cannot search or export.

Optional signup imports only server-held businesses and links the trial to the authenticated owner. Guest website facts stay in the isolated guest table and can be returned to on another device for 30 days. Protected commercial-profile fields and research queues are not written. Account-saved business contacts follow the existing repository behavior; the guest snapshot is a 30-day view, not permanent account intelligence.

The additive SQL was applied as exact scripts in `supabase/applied-records/20261012_guest_trial.sql` and `20261012_guest_trial_account_link.sql`, following the repository's manually managed database convention. No bulk migration push, Stripe, checkout, subscription, pricing or BIL2 changes were applied. RLS blocks anon/authenticated table access, and only service_role can execute reservation/receipt functions.

Verification: typecheck, lint (existing warnings), production build, full offline tests, transactional SQL assertions, real route/engine integration with provider/website fixtures, and desktop/mobile browser fixtures with all external browser requests blocked. Production verification must not submit a real search or send email without explicit user approval. There is no production fixture switch or public test bypass.

## Phase 1: mobile reliability and session recovery

- Browser storage and ids can no longer stop a search: `lib/guest/safe-storage.ts` and `safe-id.ts` tolerate blocked storage, full storage, a missing `crypto.randomUUID` and non-secure pages. Search setup runs inside the guarded block, so any remaining exception shows a message instead of a dead button.
- The landing call to action is a link to `/?trial=1`. A tap before the page is interactive follows the link and the dialog opens on arrival; a tap after opens it in place. The request is also kept as a flag until the dialog mounts.
- A lost connection (screen lock, app switch, network change, a stalled stream) no longer reports a failure. The search continues on the server; the page waits for its real outcome from `GET /api/guest/session` (`searching`, `attempts`, saved businesses) and then opens the results, or says nothing was used. A reload during a search picks it back up. Guest streams send a comment line every 12 seconds, and the page treats 45 seconds of silence as a stall.
- Refusals carry a code (`GUEST_RUNNING`, `GUEST_SEARCHES_USED`, `GUEST_ALLOWANCE_USED`, `GUEST_RATE_LIMITED`, `GUEST_EXPIRED`, `GUEST_UNAVAILABLE`, `GUEST_ORIGIN`, `GUEST_INVALID`) read from the trial row after `reserve_guest_trial` answers 0; no database change was needed.
- `trial_search_failed` and `trial_search_recovered` events carry stage, kind, elapsed time, online state and in-app-browser name.
- Verification: `node --test tests/guest-phase1-reliability.test.mjs`; `BASE_URL=... node tests/guest-phase1-browser.mjs` (mobile Chromium, every request answered locally). It is not a substitute for a real iPhone or Android device.

## Conversion decisions (Phase 1b)

- Guest email capture and the marketing checkbox are removed. After the first CSV download the results page shows one thank-you ("Your businesses are ready." with a link to plans) and no discount.
- Returning visitors are recognised by the existing signed cookie and server-side allowance (25 businesses in total, 3 searches); results are restored from `GET /api/guest/session`. No fingerprinting.
- Not yet built: the 50%-first-month moment when the allowance is exhausted (UI only, no checkout discount), the feedback question, and keeping website facts after signup.

## Phase 2: the /trial route

- `/trial` replaces the landing modal. The landing call to action is a plain link (`FreshStartCta` -> `/trial`); `FreeTrialCommandFlow` and the open-event plumbing are deleted. The route is not indexed.
- It reuses the application's `DiscoverSearchForm` and `DiscoverEngine`. Progress is the engine's own stream (`applyDiscoveryLog`, `applyProgressEvent`, `confirmDiscoveryResult`, `buildEngineView`); nothing is simulated.
- `components/trial/useTrialSearch.ts` owns one run: guarded setup, the stream, stall detection, wake lock, recovery from the server's record, telemetry. `TrialExperience` chooses what to show from `GET /api/guest/session`: a running search (resumed), all free businesses used, welcome back (businesses saved), or the search form.
- Results stay at `/trial/results` (restyled in the visual-parity phase). Back from the results returns to the welcome-back state.
- Verification: `node --test tests/guest-phase2-trial.test.mjs`; `BASE_URL=... node tests/guest-trial-browser.mjs` (16 phone and desktop scenarios); `tests/guest-browser.mjs` (25-business CSV: header plus 25 rows).

## Phase 3: one workspace for guests and members

- `/trial/results` is the My Leads workspace, working on the visitor's (at most 25) businesses in the browser: the same `LeadRow`, `CommandBar`, `MetricStrip` and business profile as members. `GuestWorkspace` replaces the old guest list.
- The business profile is shared: `lib/my-leads/dossier-model.ts` turns a member's saved business or a guest's discovered business into one model (WHO they are, WHAT they do, HOW to reach them) and `DossierView` renders it. Members keep their own intelligence, signals, notes and actions below it. For guests, "what they do" is the description, topics and title the business publishes on its own website, labelled as such; a missing fact is named as missing and never filled in. No additional paid or AI work was added.
- Phones open a business in an accessible bottom sheet (`components/ui/BottomSheet.tsx`: labelled dialog, focus trap, Escape, scroll lock, focus returns to the row); desktops expand inline. Fields are 16px and controls 44px on a phone, and city and industry sit behind "More filters".
- Search, filters (email, phone, website, city, industry) and sorting (discovery order, name, location) run locally (`lib/guest/workspace.ts`). The CSV download and the thank-you are unchanged; account creation is a quiet line at the foot.
- Verification: `node --test tests/guest-phase3-workspace.test.mjs`; `tests/guest-trial-browser.mjs` (23 phone and desktop scenarios); `tests/member-my-leads-browser.mjs` (signed-in My Leads against a local stub of the sign-in service, with an admin profile so no payment service is contacted).

## Phase 4: continuity at signup

- **What is kept.** The claim (`/api/guest/claim`) imports a guest's businesses with their name, location, industry, website, email, phone and the website's own words (title, description, headings, sources, and how well the site could be read) into `leads.website_facts` (`lib/leads/stored-website-facts.ts`). It reads only the server-held trial, so it no longer depends on anything the browser stored (the sign-in page always attempts it; with no trial it is a no-op). The facts live on the saved business, so they outlast the 30-day trial.
- **Kept apart from AI.** `website_facts` is separate from `commercial_profile`, `website_snapshot` and `business_signals`. The member dossier shows the website's words under "From their website" and an AI profile, when one exists, under "AI summary" with its own caveat. Nothing is generated at signup and nothing is invented; a business with no AI profile says why, quietly.
- **Allowance.** Signing up never adds free allowance: one trial per account, and a free account is filled only up to the 25 businesses discovery already counts (leads with an email or phone). Paid and administrator accounts are not held to the free 25.
- **Backfill and order of deployment.** A later sign-in adds facts to businesses imported earlier (never overwriting). If the column does not exist yet, signup imports exactly as before and the facts follow once it does, so the migration and the release can happen in either order.
- **Migration (proposed, not applied).** `supabase/proposed/20261017_leads_website_facts.sql`: one nullable `jsonb` column, no default, no index, no policy or grant change.
- Verification: `tests/guest-signup-continuity.test.mjs` (real search and claim routes, offline), `tests/guest-phase4-storage.test.mjs`, and `tests/member-my-leads-browser.mjs` (guest dossier to member dossier).

## Phase 5: the free-to-paid moment

- Two moments, kept apart: a quiet thank-you after a CSV download (no discount), and the upgrade moment when someone who has used their free businesses (or searches) asks for more. The wording, eligibility and the "not active" rule live in `lib/billing/first-month-offer.ts`; the screen is `components/conversion/UpgradePanel.tsx`. See `docs/free-to-paid-offer.md` for what activating the discount requires.
- The 50% first-month offer is a preview: `FIRST_MONTH_OFFER.status` is `'preview'`, every screen says it is not active yet, and nothing touches Stripe, checkout, prices or subscriptions.
- Guests see it on `/trial` from the server's record of the allowance or a refused search; free members see it in place of the Discover form (the pop-up is gone); paid subscribers never do; former subscribers see the page without the discount.
- After signup, a free account that cannot hold every guest business is told how many were saved, how many were not and where they still are (`lib/guest/claim-notice.ts`, `components/guest/ClaimNotice.tsx`).
- Tests: `tests/guest-phase5-conversion.test.mjs`, the signup cases in `tests/guest-signup-continuity.test.mjs`, `tests/guest-trial-browser.mjs` (29 scenarios) and `tests/member-my-leads-browser.mjs` (15 scenarios; `tests/helpers/stripe-sandbox.cjs` refuses any outbound Stripe request).

## Phase 6: one question of feedback

- At the end of the free-trial results, once the visitor has opened a business, filtered, downloaded, or simply been on the page a short while, a quiet inline question appears: "Did ALPA find what you were looking for?" (Yes / Partly / Not really). Yes shows a thank-you; Partly and Not really offer an optional comment ("What could ALPA have done better?"). It never opens by itself, never blocks the CSV, never leads to a sales screen, and asks for no email or account.
- It is stored server-side, one row per trial, in the existing analytics table (`activity_logs`, event `trial_feedback`); no new table and no migration. See `docs/feedback-analysis.md` for the fields and the read-only queries for the questions we want answered.
- Duplicates and abuse: the signed trial cookie decides which trial it is (nothing in the request names one), one row per trial, the latest answer wins, a trial can send at most 5 times, comments are plain text of at most 500 characters, and a foreign origin is refused.
- Verification: `tests/guest-phase6-feedback.test.mjs` (the real route offline) and the feedback scenarios in `tests/guest-trial-browser.mjs`.
