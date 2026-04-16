create table if not exists public.outreach_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid null references public.leads(id) on delete set null,
  source text not null default 'manual', -- 'manual' | 'agent'
  mission_id uuid null,
  company_name text null,
  contact_email text null,
  location text null,
  website text null,
  subject text null,
  hook text null,
  body text null,
  cta text null,
  full_email text null,
  personalization_score integer null,
  quality_score integer null,
  context_status text not null default 'pending', -- 'pending' | 'enriched' | 'basic' | 'failed'
  context_title text null,
  context_description text null,
  context_h1 text null,
  status text not null default 'draft', -- 'draft' | 'approved' | 'rejected'
  review_status text not null default 'pending', -- 'pending' | 'reviewed' | 'edited'
  approved_at timestamptz null,
  rejected_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outreach_queue enable row level security;

create policy "Users can manage their own outreach queue"
  on public.outreach_queue
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists outreach_queue_user_id_idx on public.outreach_queue(user_id);
create index if not exists outreach_queue_status_idx on public.outreach_queue(status);
create index if not exists outreach_queue_lead_id_idx on public.outreach_queue(lead_id);
