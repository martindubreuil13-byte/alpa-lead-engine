ALTER TABLE public.agent_mission_runs
  ADD COLUMN IF NOT EXISTS accepted_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drafts_generated_count integer DEFAULT 0;

ALTER TABLE public.agent_mission_runs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.agent_mission_runs
SET
  accepted_count = COALESCE(accepted_count, 0),
  drafts_generated_count = COALESCE(drafts_generated_count, 0),
  updated_at = COALESCE(updated_at, now());

