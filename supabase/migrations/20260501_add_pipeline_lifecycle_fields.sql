alter table public.leads
  add column if not exists followup_sent_at timestamptz,
  add column if not exists final_attempt_sent_at timestamptz,
  add column if not exists outreach_attempts integer not null default 0,
  add column if not exists next_action_status text,
  add column if not exists closed_at timestamptz;

update public.leads
set outreach_attempts = 0
where outreach_attempts is null;

create index if not exists leads_pipeline_lifecycle_idx
  on public.leads (user_id, pipeline_stage, first_contact_at, followup_sent_at);

create index if not exists leads_next_action_status_idx
  on public.leads (user_id, next_action_status);
