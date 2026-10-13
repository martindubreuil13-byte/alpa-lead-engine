-- PROPOSED. NOT APPLIED.
--
-- Keeps what ALPA read from a business's own website during a free-trial search once the visitor creates an account.
--
-- One additive, nullable column. No default, no backfill, no index, no change to any policy, grant or function:
--   * On Postgres 11+ adding a nullable column without a default is a catalog-only change (no table rewrite), so it is instant.
--   * `authenticated` already holds table-level SELECT/INSERT/UPDATE on public.leads and the existing row-level policies
--     (own rows only) apply to the new column automatically; `anon` has no access.
--   * Nothing reads it except My Leads' business profile and CSV export, both through the customer's own session.
--   * It is separate from `commercial_profile`, `website_snapshot` and `business_signals` (the AI business-intelligence
--     columns), so website facts are never mistaken for, or overwritten by, AI-generated intelligence.
--
-- The application tolerates the column being absent (sign-up imports the businesses as before and the facts are added on the
-- next sign-in once the column exists), so the order of "apply this" and "deploy the release" cannot break anyone.
--
-- Rollback (kept as a record; nothing depends on it existing): ALTER TABLE public.leads DROP COLUMN IF EXISTS website_facts;

BEGIN;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS website_facts jsonb;

COMMENT ON COLUMN public.leads.website_facts IS
  'The business''s own website words (title, description, headings, sources) read by rules during a free-trial search. Not AI-written. Shape: lib/leads/stored-website-facts.ts.';

COMMIT;
