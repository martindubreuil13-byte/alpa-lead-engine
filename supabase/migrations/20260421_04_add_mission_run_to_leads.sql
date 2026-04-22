-- Add mission_id and run_id to the main leads table so every lead can be
-- traced back to the agent run that produced it.  Both columns are nullable
-- so existing rows are unaffected.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS mission_id uuid NULL REFERENCES public.agent_missions (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_id     uuid NULL REFERENCES public.agent_mission_runs (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_mission_id_idx ON public.leads (mission_id);
CREATE INDEX IF NOT EXISTS leads_run_id_idx     ON public.leads (run_id);
