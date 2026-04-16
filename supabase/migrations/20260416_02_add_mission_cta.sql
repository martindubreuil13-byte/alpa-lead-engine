ALTER TABLE public.agent_missions
  ADD COLUMN IF NOT EXISTS cta text,
  ADD COLUMN IF NOT EXISTS send_window text;
