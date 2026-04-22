ALTER TABLE public.agent_mission_runs
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;

ALTER TABLE public.agent_mission_runs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.agent_mission_runs
SET updated_at = COALESCE(updated_at, now());

