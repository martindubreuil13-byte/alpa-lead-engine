alter table public.agent_lead_queue
  add column if not exists location text;
