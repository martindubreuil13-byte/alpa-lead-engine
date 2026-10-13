# Frictionless guest discovery

Released from production typography baseline 38da65a in an isolated worktree.

The landing trial calls the existing `/api/scrape` discovery engine in explicit guest mode. It does not sign out existing customers or consult subscription accounting for the guest search. After completion, `/trial/results` immediately shows all returned businesses, available contacts, and expandable website facts. Those facts are extracted from the safe, robots-aware pages already read for email discovery; no extra AI research is scheduled. Missing fields and possible addresses are shown honestly.

Guest results are stored in the new service-only `guest_trials` table before lead events are delivered. A signed HttpOnly, Secure, SameSite cookie selects the trial. Browser storage is a convenience mirror, not an allowance or export authority. Email-only export validates and records an email plus the separate optional marketing consent, then returns an actual CSV attachment. No emails are sent by this feature.

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
