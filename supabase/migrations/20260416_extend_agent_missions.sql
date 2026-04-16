-- Make icp_id nullable to support new conversational setup flow
ALTER TABLE public.agent_missions
  ALTER COLUMN icp_id DROP NOT NULL;

-- Add new columns for conversational setup
ALTER TABLE public.agent_missions
  ADD COLUMN IF NOT EXISTS offer_input text,
  ADD COLUMN IF NOT EXISTS audience_input text,
  ADD COLUMN IF NOT EXISTS location_input text,
  ADD COLUMN IF NOT EXISTS offer_context jsonb,
  ADD COLUMN IF NOT EXISTS icp_expanded jsonb,
  ADD COLUMN IF NOT EXISTS search_patterns jsonb,
  ADD COLUMN IF NOT EXISTS daily_target integer not null default 10;
