# Frictionless guest discovery

Released from production typography baseline 38da65a in an isolated worktree.

The landing trial calls the existing `/api/scrape` discovery engine in explicit guest mode. It does not sign out existing customers or consult subscription accounting for the guest search. After completion, `/trial/results` immediately shows all returned businesses, available contacts, and expandable website facts. Those facts are extracted from the safe, robots-aware pages already read for email discovery; no extra AI research is scheduled. Missing fields and possible addresses are shown honestly.

Guest results are stored in the new service-only `guest_trials` table before lead events are delivered. A signed HttpOnly, Secure, SameSite cookie selects the trial. Browser storage is a convenience mirror, not an allowance or export authority. Email-only export validates and records an email plus the separate optional marketing consent, then returns an actual CSV attachment. No emails are sent by this feature.

A guest can request up to 25 businesses in total, with at most three searches. A transaction reserves capacity before any provider call; unused capacity is returned after a completed run. Each guest has one active search. A keyed daily hash of Vercel's client IP limits a shared address to six trial search attempts per UTC day. This is reasonable abuse friction, not identity-based prevention. Cookie deletion, new IPs, and shared networks remain limitations. Interrupted runs whose receipt never completes conservatively retain reserved capacity. Expired sessions cannot search or export.

Optional signup imports only server-held businesses and links the trial to the authenticated owner. Guest website facts stay in the isolated guest table and can be returned to on another device for 30 days. Protected commercial-profile fields and research queues are not written. Account-saved business contacts follow the existing repository behavior; the guest snapshot is a 30-day view, not permanent account intelligence.

The additive SQL was applied as exact scripts in `supabase/applied-records/20261012_guest_trial.sql` and `20261012_guest_trial_account_link.sql`, following the repository's manually managed database convention. No bulk migration push, Stripe, checkout, subscription, pricing or BIL2 changes were applied. RLS blocks anon/authenticated table access, and only service_role can execute reservation/receipt functions.

Verification: typecheck, lint (existing warnings), production build, full offline tests, transactional SQL assertions, real route/engine integration with provider/website fixtures, and desktop/mobile browser fixtures with all external browser requests blocked. Production verification must not submit a real search or send email without explicit user approval. There is no production fixture switch or public test bypass.
