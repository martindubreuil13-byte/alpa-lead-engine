create table if not exists public.agent_icp (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  raw_input text not null,
  structured_output jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_icp_user_id_created_at_idx
  on public.agent_icp (user_id, created_at desc);

alter table public.agent_icp enable row level security;

create policy "Users can view their own agent icp rows"
  on public.agent_icp
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own agent icp rows"
  on public.agent_icp
  for insert
  to authenticated
  with check (auth.uid() = user_id);
