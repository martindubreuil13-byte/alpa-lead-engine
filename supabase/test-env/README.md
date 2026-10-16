# Billing TEST database (schema only)

`schema.sql` rebuilds ALPA's foundational database structure in an EMPTY Supabase TEST project. It was reconstructed read-only from the
production catalog on 2026-10-15. It contains **no data**: no customers, leads, subscriptions, guest trials, credentials or auth records.
`parts/` holds the same content in sections (types and tables, constraints and indexes, functions, triggers/RLS/policies, grants, seed).

## Never apply it to production
It creates tables and functions that already exist there. Apply it only to a project whose URL is not `hnhptrqdirqofkwimapo`
(`scripts/test-env/check-isolation.mjs` refuses that project).

## How to apply (owner, dashboard)
1. Create a new Supabase project for testing (name it clearly, e.g. `alpa-billing-test`). Region does not matter.
2. Authentication, URL Configuration: Site URL `http://localhost:3000`; Redirect URLs `http://localhost:3000/**`.
3. Authentication, Providers, Email: keep "Confirm email" ON.
4. SQL Editor: paste the whole of `schema.sql` and run it once, as the default `postgres` role. It must finish without error.
5. Project Settings, API: copy the project URL, the anon key and the service-role key into `.env.stripe-test` (git-ignored). Never into chat.
6. Run `set -a; . ./.env.stripe-test; set +a; node scripts/test-env/check-isolation.mjs` and confirm "Isolated test environment confirmed".

## What was verified (no Supabase needed)
`node scripts/test-env/verify-schema.mjs [--fingerprint]` (needs `npm i --no-save @electric-sql/pglite@0.2.17`) loads `schema.sql` into an empty
in-process PostgreSQL 16 with only Supabase's `auth` schema and the three roles stubbed, and checks:
- it initialises with no error, with 34 tables, 35 functions, 42 policies, 92 constraints and row-level security on every table;
- sign-up creates a free profile through the trigger; a customer sees only their own leads and profile; an anonymous caller sees nothing;
  guest trials are unreadable by customers; a customer cannot change their own plan; operator functions refuse customers; the service role
  can read; the research controls start OFF with nothing allowed; nothing but that one row exists.

`scripts/test-env/catalog-fingerprint.sql` was run against production (read-only) and against a database built from `schema.sql`:

| Part | Result |
|---|---|
| tables (34), columns, functions (all 35), triggers, row-level-security flags, policies, table and sequence grants | **identical hashes** |
| constraints | 91 of 92 identical; `commercial_intelligence_queue.valid_status` differs in rendering only |
| indexes | 108 of 113 identical; 5 partial indexes differ in rendering only |

The six differences are the same construct, `status = ANY (ARRAY['pending','processing'])`: production prints it as `(ARRAY[...])::text[]`,
PostgreSQL 16 prints the identical expression with a cast on each element. They are the same condition. Re-run the fingerprint on the real
test project (PostgreSQL 17) to confirm all hashes match.

## Known production quirks reproduced faithfully (not fixed here)
- `leads.status` defaults to `'new'` but the `leads_status_check` constraint does not allow `'new'`: inserts must name a status.
- `anon` and `authenticated` hold SELECT/UPDATE/USAGE on `ci_research_control_log_id_seq`.
- `users.plan` only allows `free` and `starter` (the `profiles` table is the plan of record).
