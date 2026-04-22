-- ================================================================
-- Full normalization of agent_mission_runs
--
-- Adds all columns the backend expects, backfills existing rows,
-- hardens NOT NULL constraints, and wires up an updated_at trigger.
-- Every statement is idempotent (IF NOT EXISTS / COALESCE guards)
-- so this file is safe to re-run and safe to run alongside or before
-- the earlier partial fixes (_fix_agent_mission_run_counts,
-- _fix_agent_mission_run_finished_at).
-- ================================================================


-- ── 1. Add missing columns with safe defaults ─────────────────────

ALTER TABLE public.agent_mission_runs
  ADD COLUMN IF NOT EXISTS completed_at            timestamptz          NULL,
  ADD COLUMN IF NOT EXISTS leads_requested         integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_found             integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_accepted          integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leads_deduped           integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drafts_generated        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_count          integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drafts_generated_count  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finished_at             timestamptz          NULL,
  ADD COLUMN IF NOT EXISTS error                   text                 NULL,
  ADD COLUMN IF NOT EXISTS updated_at              timestamptz NOT NULL DEFAULT now();


-- ── 2. Backfill existing rows ──────────────────────────────────────
-- Only touches rows that are actually null so the update is a no-op
-- on a freshly-created table.

UPDATE public.agent_mission_runs
SET
  leads_requested        = COALESCE(leads_requested, requested_leads, 0),
  leads_found            = COALESCE(leads_found,            0),
  leads_accepted         = COALESCE(leads_accepted,         accepted_count, 0),
  leads_deduped          = COALESCE(leads_deduped,          0),
  drafts_generated       = COALESCE(drafts_generated,       drafts_generated_count, 0),
  accepted_count         = COALESCE(accepted_count,         0),
  drafts_generated_count = COALESCE(drafts_generated_count, 0),
  updated_at             = COALESCE(updated_at,             now())
WHERE
     leads_requested        IS NULL
  OR leads_found            IS NULL
  OR leads_accepted         IS NULL
  OR leads_deduped          IS NULL
  OR drafts_generated       IS NULL
  OR accepted_count         IS NULL
  OR drafts_generated_count IS NULL
  OR updated_at             IS NULL;


-- ── 3. Harden constraints post-backfill ───────────────────────────
-- SET NOT NULL is safe because every row now carries a value.
-- PostgreSQL treats these as no-ops if the constraint already exists.
-- finished_at is intentionally left nullable (run may still be live).

ALTER TABLE public.agent_mission_runs
  ALTER COLUMN leads_requested        SET NOT NULL,
  ALTER COLUMN leads_requested        SET DEFAULT 0,
  ALTER COLUMN leads_found            SET NOT NULL,
  ALTER COLUMN leads_found            SET DEFAULT 0,
  ALTER COLUMN leads_accepted         SET NOT NULL,
  ALTER COLUMN leads_accepted         SET DEFAULT 0,
  ALTER COLUMN leads_deduped          SET NOT NULL,
  ALTER COLUMN leads_deduped          SET DEFAULT 0,
  ALTER COLUMN drafts_generated       SET NOT NULL,
  ALTER COLUMN drafts_generated       SET DEFAULT 0,
  ALTER COLUMN accepted_count         SET NOT NULL,
  ALTER COLUMN accepted_count         SET DEFAULT 0,
  ALTER COLUMN drafts_generated_count SET NOT NULL,
  ALTER COLUMN drafts_generated_count SET DEFAULT 0,
  ALTER COLUMN updated_at             SET NOT NULL,
  ALTER COLUMN updated_at             SET DEFAULT now();


-- ── 4. Auto-update updated_at on every row write ──────────────────
-- CREATE OR REPLACE is idempotent; the function is shared-safe
-- (other tables can reuse it).

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_trigger
    WHERE  tgname  = 'agent_mission_runs_set_updated_at'
      AND  tgrelid = 'public.agent_mission_runs'::regclass
  ) THEN
    CREATE TRIGGER agent_mission_runs_set_updated_at
      BEFORE UPDATE ON public.agent_mission_runs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;


-- ================================================================
-- Verification queries — run these manually in the Supabase SQL
-- editor after applying the migration to confirm the schema is clean.
-- ================================================================

-- 1. Confirm every new column is present with the right type/nullability
--
-- SELECT
--   column_name,
--   data_type,
--   is_nullable,
--   column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'agent_mission_runs'
--   AND column_name  IN (
--     'completed_at', 'leads_requested',
--     'leads_found', 'leads_accepted', 'leads_deduped',
--     'drafts_generated',
--     'accepted_count', 'drafts_generated_count',
--     'finished_at', 'error', 'updated_at'
--   )
-- ORDER BY column_name;

-- 2. Spot-check the latest run rows
--
-- SELECT
--   id,
--   status,
--   accepted_count,
--   drafts_generated_count,
--   leads_found,
--   leads_accepted,
--   leads_deduped,
--   drafts_generated,
--   finished_at,
--   updated_at
-- FROM public.agent_mission_runs
-- ORDER BY created_at DESC
-- LIMIT 5;

-- 3. Verify the trigger is wired up
--
-- SELECT tgname, tgenabled
-- FROM   pg_trigger
-- WHERE  tgrelid = 'public.agent_mission_runs'::regclass;
