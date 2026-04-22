ALTER TABLE public.agent_missions
  ADD COLUMN IF NOT EXISTS schedule_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS schedule_local_time text NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS starts_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_run_status text NULL,
  ADD COLUMN IF NOT EXISTS last_stop_reason text NULL,
  ADD COLUMN IF NOT EXISTS rotation_cursor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.agent_missions
SET
  status = CASE
    WHEN status IN ('running', 'completed', 'needs_review') THEN 'active'
    WHEN status = 'exhausted' THEN 'paused'
    WHEN status IN ('stopped', 'deleted') THEN 'archived'
    ELSE status
  END,
  starts_at = COALESCE(starts_at, next_run_at, created_at),
  next_run_at = CASE
    WHEN status IN ('active', 'scheduled') THEN COALESCE(next_run_at, now())
    ELSE next_run_at
  END,
  schedule_local_time = COALESCE(
    NULLIF(schedule_local_time, ''),
    TO_CHAR(COALESCE(next_run_at, created_at) AT TIME ZONE 'UTC', 'HH24:MI'),
    '09:00'
  ),
  updated_at = now()
WHERE true;

CREATE INDEX IF NOT EXISTS agent_missions_status_next_run_idx
  ON public.agent_missions (status, next_run_at);

CREATE TABLE IF NOT EXISTS public.agent_mission_icps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.agent_missions (id) ON DELETE CASCADE,
  label text NOT NULL,
  query text NULL,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_mission_icps_mission_position_idx
  ON public.agent_mission_icps (mission_id, position);

CREATE INDEX IF NOT EXISTS agent_mission_icps_mission_active_idx
  ON public.agent_mission_icps (mission_id, is_active, position);

INSERT INTO public.agent_mission_icps (user_id, mission_id, label, query, position)
SELECT
  m.user_id,
  m.id,
  TRIM(v.value) AS label,
  TRIM(v.value) AS query,
  (v.ordinality - 1)::integer AS position
FROM public.agent_missions m
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(m.icp_expanded) = 'array' THEN m.icp_expanded
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS v(value, ordinality)
WHERE TRIM(v.value) <> ''
ON CONFLICT (mission_id, position) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.agent_mission_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.agent_missions (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  trigger_type text NOT NULL DEFAULT 'scheduler',
  scheduled_for timestamptz NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  finished_at timestamptz NULL,
  leads_requested integer NOT NULL DEFAULT 0,
  requested_leads integer NOT NULL DEFAULT 0,
  leads_found integer NOT NULL DEFAULT 0,
  leads_accepted integer NOT NULL DEFAULT 0,
  leads_deduped integer NOT NULL DEFAULT 0,
  drafts_generated integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  drafts_generated_count integer NOT NULL DEFAULT 0,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_mission_runs_mission_created_idx
  ON public.agent_mission_runs (mission_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_mission_runs_status_idx
  ON public.agent_mission_runs (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS agent_mission_runs_active_run_idx
  ON public.agent_mission_runs (mission_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS public.agent_mission_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.agent_missions (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.agent_mission_runs (id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  meta jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_mission_run_logs_run_created_idx
  ON public.agent_mission_run_logs (run_id, created_at ASC);

ALTER TABLE public.agent_lead_queue
  ADD COLUMN IF NOT EXISTS run_id uuid NULL REFERENCES public.agent_mission_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS normalized_business_name text NULL,
  ADD COLUMN IF NOT EXISTS normalized_location text NULL,
  ADD COLUMN IF NOT EXISTS normalized_domain text NULL,
  ADD COLUMN IF NOT EXISTS normalized_phone text NULL,
  ADD COLUMN IF NOT EXISTS normalized_website text NULL;

UPDATE public.agent_lead_queue
SET
  normalized_business_name = NULLIF(
    REGEXP_REPLACE(LOWER(TRIM(COALESCE(business_name, ''))), '\s+', ' ', 'g'),
    ''
  ),
  normalized_location = NULLIF(
    REGEXP_REPLACE(LOWER(TRIM(COALESCE(location, ''))), '\s+', ' ', 'g'),
    ''
  ),
  normalized_phone = NULLIF(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), ''),
  normalized_website = NULLIF(
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(website, ''), '^https?://(www\.)?', ''), '[/?#].*$', '')),
    ''
  ),
  normalized_domain = NULLIF(
    LOWER(
      COALESCE(
        REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(website, ''), '^https?://(www\.)?', ''), '[/?#].*$', ''),
        ''
      )
    ),
    ''
  );

CREATE INDEX IF NOT EXISTS agent_lead_queue_run_id_idx
  ON public.agent_lead_queue (run_id);

CREATE INDEX IF NOT EXISTS agent_lead_queue_mission_run_idx
  ON public.agent_lead_queue (mission_id, run_id);

CREATE INDEX IF NOT EXISTS agent_lead_queue_mission_domain_idx
  ON public.agent_lead_queue (mission_id, normalized_domain);

CREATE INDEX IF NOT EXISTS agent_lead_queue_mission_phone_idx
  ON public.agent_lead_queue (mission_id, normalized_phone);

ALTER TABLE public.outreach_queue
  ADD COLUMN IF NOT EXISTS run_id uuid NULL REFERENCES public.agent_mission_runs (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS outreach_queue_run_id_idx
  ON public.outreach_queue (run_id);

ALTER TABLE public.agent_mission_icps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mission_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mission_run_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_mission_icps'
      AND policyname = 'Users can view their own mission icps'
  ) THEN
    CREATE POLICY "Users can view their own mission icps"
      ON public.agent_mission_icps
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_mission_icps'
      AND policyname = 'Users can insert their own mission icps'
  ) THEN
    CREATE POLICY "Users can insert their own mission icps"
      ON public.agent_mission_icps
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_mission_icps'
      AND policyname = 'Users can update their own mission icps'
  ) THEN
    CREATE POLICY "Users can update their own mission icps"
      ON public.agent_mission_icps
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_mission_runs'
      AND policyname = 'Users can view their own mission runs'
  ) THEN
    CREATE POLICY "Users can view their own mission runs"
      ON public.agent_mission_runs
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_mission_run_logs'
      AND policyname = 'Users can view their own mission run logs'
  ) THEN
    CREATE POLICY "Users can view their own mission run logs"
      ON public.agent_mission_run_logs
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;
