-- B1.1 — Commercial Intelligence queue integrity.
--
-- STATUS: PROPOSED. NOT APPLIED. Do not run through `supabase db push` (the migration history on this
-- project is not in sync with what was applied by hand). Review, then apply deliberately.
--
-- What this does, and why (all of it verified against a disposable Postgres 17 copy of production):
--
--   1. Restores the two guarantees the repository migrations already declare but PRODUCTION LACKS
--      (20260704_fix_ci_queue_production_safety.sql, 20260704_add_commercial_intelligence_queue.sql):
--        - idx_ci_queue_unique_active_per_lead: at most one pending/processing job per lead
--        - valid_status: status is one of pending / processing / completed / failed
--      Several functions already assume them (ON CONFLICT DO NOTHING, EXCEPTION WHEN unique_violation,
--      the 23505 branch in queue-manager.ts) and are currently dead code without them.
--
--   2. Adds a nullable run_id (an opaque identifier of one Discover search) plus an index. Existing and
--      future "historical" rows keep run_id = NULL and are never selected by a run.
--
--   3. Stops customers from steering the queue directly:
--        - INSERT must be a plain "please research my lead" request: status pending, no retry
--          counters, no claim token, no timestamps (created_at/updated_at must be the database's own
--          now(), so nobody can jump the FIFO order), not worker_eligible, no run_id, and the lead must
--          be theirs. run_id is assigned by server code only (service role): a customer can never
--          attach a job to a Discover run, their own or anyone else's.
--        - UPDATE and DELETE are revoked (UPDATE was previously allowed on every column).
--      The three user-path functions that used to depend on that UPDATE right
--      (claim_ci_queue_items, complete_ci_enrichment, reset_stale_ci_processing) become SECURITY DEFINER
--      with explicit auth.uid() ownership checks, so they keep working for My Leads unchanged.
--
--   4. Behaviour changes in the user-path functions (the worker functions are untouched):
--        - complete_ci_enrichment now requires the row to be the caller's own and still 'processing',
--          so a second/late completion returns (false, 'claim_lost') instead of overwriting.
--        - reset_stale_ci_processing now counts the interruption as a retry and fails jobs that are out
--          of retries (it used to reset forever and never fail them), and only touches the caller's rows.
--        - claim_ci_queue_items caps one batch at 50 (the largest size the app ever asks for).
--        - All three act ONLY on rows without a worker claim token. A job the service-role worker has
--          claimed belongs to the worker: a customer can no longer complete or reset it.
--
-- Safe to apply BEFORE the B1.2/B1.3 application code: no application path is removed or renamed, the
-- only direct write the app performs is the plain INSERT in enqueueLeadEnrichment, and it still works.
-- Historical rows (60 pending, 10 completed on 2026-10-10) are not modified.
--
-- NOT in this migration (needs the application code first, see the B1.1 report):
--   - an explicit "claim these lead ids / this run" worker function
--   - revoking EXECUTE on the user-path functions once My Leads stops draining the queue
--   - column-level lockdown of leads.ci_* (enrichLeadDirect still writes them with the user's session)
--
-- Rollback: supabase/proposed/20261012_ci_queue_integrity_rollback.sql

-- ---------------------------------------------------------------------------------------------
-- 0. Preflight: stop, changing nothing, if existing data would violate the new rules.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicates integer;
  v_cross_user integer;
  v_bad_status integer;
BEGIN
  SELECT count(*) INTO v_duplicates
  FROM (
    SELECT lead_id FROM public.commercial_intelligence_queue
    WHERE status IN ('pending', 'processing')
    GROUP BY lead_id HAVING count(*) > 1
  ) d;
  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'B1.1 preflight: % lead(s) have more than one active job. Resolve them first (this migration deletes nothing).', v_duplicates;
  END IF;

  SELECT count(*) INTO v_cross_user
  FROM public.commercial_intelligence_queue q
  JOIN public.leads l ON l.id = q.lead_id
  WHERE l.user_id <> q.user_id;
  IF v_cross_user > 0 THEN
    RAISE EXCEPTION 'B1.1 preflight: % queue row(s) point at a lead owned by a different user.', v_cross_user;
  END IF;

  SELECT count(*) INTO v_bad_status
  FROM public.commercial_intelligence_queue
  WHERE status NOT IN ('pending', 'processing', 'completed', 'failed');
  IF v_bad_status > 0 THEN
    RAISE EXCEPTION 'B1.1 preflight: % queue row(s) have an unknown status.', v_bad_status;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Database-enforced guarantees (same names the repository migrations already use)
-- ---------------------------------------------------------------------------------------------

-- A partial unique index, not a full unique constraint: retries keep the SAME row (pending again with
-- retry_count + 1), and a completed/failed job must not block a later re-run of the same lead. Only
-- "active" jobs are unique. A full UNIQUE(lead_id) would forbid history and force every re-run to
-- rewrite a finished row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_queue_unique_active_per_lead
  ON public.commercial_intelligence_queue (lead_id)
  WHERE status IN ('pending', 'processing');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commercial_intelligence_queue'::regclass AND conname = 'valid_status'
  ) THEN
    ALTER TABLE public.commercial_intelligence_queue
      ADD CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Run identity (nullable, opaque, no foreign key: there is no runs table)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.commercial_intelligence_queue ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE INDEX IF NOT EXISTS idx_ci_queue_user_run
  ON public.commercial_intelligence_queue (user_id, run_id)
  WHERE run_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 3. What a customer may write
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_ci_queue_user_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Server code (service role) and the database's own functions (running as their owner) are not
  -- restricted; only direct writes from customer sessions are.
  IF current_user IN ('anon', 'authenticated') AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'research queue rows cannot be modified directly'
        USING ERRCODE = '42501';
    END IF;

    -- INSERT: a plain request to research one of the caller's own leads, nothing else.
    IF NEW.status IS DISTINCT FROM 'pending'
       OR NEW.retry_count IS DISTINCT FROM 0
       OR NEW.max_retries IS DISTINCT FROM 3
       OR NEW.claim_token IS NOT NULL
       OR NEW.worker_eligible IS TRUE
       OR NEW.started_at IS NOT NULL
       OR NEW.completed_at IS NOT NULL
       OR NEW.last_retry_at IS NOT NULL
       OR NEW.last_error IS NOT NULL
       OR NEW.processing_duration_ms IS NOT NULL
       OR COALESCE(NEW.total_cost, 0) <> 0
       -- the database's own clock only: a backdated created_at would jump the FIFO order
       OR NEW.created_at IS DISTINCT FROM now()
       OR NEW.updated_at IS DISTINCT FROM now()
       -- run ids are assigned by trusted server code; a customer cannot join or fake a run
       OR NEW.run_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'research queue rows can only be requested, not preset'
        USING ERRCODE = '42501';
    END IF;

    -- Evaluated with the caller's own row-level security: only the caller's leads are visible.
    IF NOT EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = NEW.lead_id AND l.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'research can only be requested for your own leads'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- New functions in `public` are executable by PUBLIC, anon and authenticated by default in this project.
-- A trigger function is never called directly, so nobody needs EXECUTE (firing a trigger does not check it).
REVOKE EXECUTE ON FUNCTION public.guard_ci_queue_user_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_ci_queue_user_write ON public.commercial_intelligence_queue;
CREATE TRIGGER trg_guard_ci_queue_user_write
  BEFORE INSERT OR UPDATE ON public.commercial_intelligence_queue
  FOR EACH ROW EXECUTE FUNCTION public.guard_ci_queue_user_write();

-- ---------------------------------------------------------------------------------------------
-- 4. User-path functions: SECURITY DEFINER with explicit ownership checks
--    (same names, signatures and return shapes, so no caller changes)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_ci_queue_items(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid, lead_id uuid, retry_count integer, max_retries integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate_rows AS (
    SELECT q.id
    FROM public.commercial_intelligence_queue q
    WHERE q.status = 'pending'
      AND q.user_id = auth.uid()
      AND q.claim_token IS NULL
      AND (q.last_retry_at IS NULL OR NOW() >= q.last_retry_at + INTERVAL '60 seconds')
      AND q.retry_count < q.max_retries
    ORDER BY q.created_at ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
    FOR UPDATE SKIP LOCKED
  ),
  updated_rows AS (
    UPDATE public.commercial_intelligence_queue q
    SET status = 'processing',
        started_at = COALESCE(q.started_at, NOW())
    FROM candidate_rows c
    WHERE q.id = c.id
    RETURNING q.id, q.lead_id, q.retry_count, q.max_retries, q.created_at
  )
  SELECT u.id, u.lead_id, u.retry_count, u.max_retries
  FROM updated_rows u
  ORDER BY u.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ci_enrichment(
  p_queue_id uuid, p_lead_id uuid, p_snapshot jsonb, p_signals jsonb, p_profile jsonb,
  p_success boolean, p_error_msg text
)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retry_count integer;
  v_max_retries integer;
BEGIN
  BEGIN
    -- Only the caller's own job that is still being processed can be completed (a repeat or late
    -- completion cannot overwrite a newer outcome).
    SELECT q.retry_count, q.max_retries
    INTO v_retry_count, v_max_retries
    FROM public.commercial_intelligence_queue q
    WHERE q.id = p_queue_id
      AND q.lead_id = p_lead_id
      AND q.user_id = auth.uid()
      AND q.status = 'processing'
      AND q.claim_token IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'claim_lost'::text;
      RETURN;
    END IF;

    IF p_success THEN
      UPDATE public.commercial_intelligence_queue
      SET status = 'completed', completed_at = NOW(), last_error = NULL, started_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET website_snapshot = p_snapshot, business_signals = p_signals, commercial_profile = p_profile,
          ci_enrichment_status = 'completed', ci_completed_at = NOW(),
          ci_started_at = COALESCE(ci_started_at, NOW()), ci_last_error = NULL, ci_retry_count = 0
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'enrichment_completed'::text;
    ELSIF v_retry_count + 1 < v_max_retries THEN
      UPDATE public.commercial_intelligence_queue
      SET status = 'pending', retry_count = retry_count + 1, last_retry_at = NOW(),
          last_error = p_error_msg, started_at = NULL, completed_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET ci_enrichment_status = 'pending', ci_last_error = p_error_msg,
          ci_retry_count = COALESCE(ci_retry_count, 0) + 1, ci_completed_at = NULL,
          ci_started_at = COALESCE(ci_started_at, NOW())
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'retry_pending'::text;
    ELSE
      UPDATE public.commercial_intelligence_queue
      SET status = 'failed', retry_count = retry_count + 1, last_error = p_error_msg,
          completed_at = NOW(), started_at = NULL
      WHERE id = p_queue_id;

      UPDATE public.leads
      SET ci_enrichment_status = 'failed', ci_last_error = p_error_msg,
          ci_retry_count = COALESCE(ci_retry_count, 0) + 1, ci_completed_at = NULL,
          ci_started_at = COALESCE(ci_started_at, NOW())
      WHERE id = p_lead_id AND user_id = auth.uid();

      RETURN QUERY SELECT true, 'enrichment_failed'::text;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY SELECT false, SQLERRM::text;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_stale_ci_processing(p_timeout_seconds integer DEFAULT 300)
RETURNS TABLE(reset_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reset_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;

  -- An interrupted job is a failed attempt: out of retries means failed, not "reset forever".
  WITH exhausted AS (
    UPDATE public.commercial_intelligence_queue
    SET status = 'failed', retry_count = retry_count + 1, last_retry_at = NOW(),
        completed_at = NOW(), started_at = NULL,
        last_error = 'Processing interrupted and retry limit reached'
    WHERE user_id = auth.uid()
      AND status = 'processing'
      AND claim_token IS NULL
      AND started_at < NOW() - (GREATEST(p_timeout_seconds, 60) || ' seconds')::interval
      AND retry_count + 1 >= max_retries
    RETURNING lead_id
  )
  UPDATE public.leads l
  SET ci_enrichment_status = 'failed',
      ci_last_error = 'Processing interrupted and retry limit reached',
      ci_completed_at = NULL,
      ci_retry_count = COALESCE(l.ci_retry_count, 0) + 1
  WHERE l.user_id = auth.uid() AND l.id IN (SELECT lead_id FROM exhausted);

  UPDATE public.commercial_intelligence_queue
  SET status = 'pending', retry_count = retry_count + 1, last_retry_at = NOW(),
      started_at = NULL, completed_at = NULL,
      last_error = 'Processing interrupted; scheduled for retry'
  WHERE user_id = auth.uid()
    AND status = 'processing'
    AND claim_token IS NULL
    AND started_at < NOW() - (GREATEST(p_timeout_seconds, 60) || ' seconds')::interval
    AND retry_count + 1 < max_retries;
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  RETURN QUERY SELECT v_reset_count;
END;
$$;

-- Function privileges, explicit
REVOKE EXECUTE ON FUNCTION public.claim_ci_queue_items(integer),
  public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ci_queue_items(integer),
  public.complete_ci_enrichment(uuid, uuid, jsonb, jsonb, jsonb, boolean, text),
  public.reset_stale_ci_processing(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Table privileges and policies: customers read their own status and file plain requests
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.commercial_intelligence_queue FROM PUBLIC, anon;
-- MAINTAIN (PostgreSQL 17) also covers LOCK TABLE, VACUUM and REINDEX, which a customer must not have.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.commercial_intelligence_queue FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.commercial_intelligence_queue TO authenticated;

DROP POLICY IF EXISTS "Users can update their own ci queue" ON public.commercial_intelligence_queue;
-- Kept as they are: "Users can view their own ci queue" (SELECT) and "Users can insert their own ci queue".
-- Deleting a lead still removes its queue rows: that is a foreign-key cascade, which runs with the
-- table owner's rights, not the customer's.
