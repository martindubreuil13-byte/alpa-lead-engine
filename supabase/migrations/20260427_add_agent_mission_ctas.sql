alter table public.agent_missions
  add column if not exists ctas jsonb not null default '[]'::jsonb;
