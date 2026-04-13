create table if not exists public.agent_missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  icp_id uuid not null references public.agent_icp (id) on delete cascade,
  name text,
  status text not null default 'draft',
  leads_per_day integer not null default 10,
  contact_mode text not null default 'email',
  require_email boolean not null default true,
  require_phone boolean not null default false,
  require_website boolean not null default true,
  location text not null default 'Global',
  outreach_mode text not null default 'draft_only',
  created_at timestamptz not null default now()
);

create table if not exists public.agent_lead_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid not null references public.agent_missions (id) on delete cascade,
  icp_id uuid not null references public.agent_icp (id) on delete cascade,
  business_name text,
  website text,
  email text,
  phone text,
  qualification_status text not null default 'pending',
  context_status text not null default 'pending',
  draft_status text not null default 'pending',
  draft_email text,
  created_at timestamptz not null default now()
);

create index if not exists agent_missions_user_id_idx
  on public.agent_missions (user_id);

create index if not exists agent_lead_queue_mission_id_idx
  on public.agent_lead_queue (mission_id);

alter table public.agent_missions enable row level security;
alter table public.agent_lead_queue enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'agent_missions' and policyname = 'Users can view their own agent missions'
  ) then
    create policy "Users can view their own agent missions"
      on public.agent_missions
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'agent_missions' and policyname = 'Users can insert their own agent missions'
  ) then
    create policy "Users can insert their own agent missions"
      on public.agent_missions
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'agent_lead_queue' and policyname = 'Users can view their own agent lead queue'
  ) then
    create policy "Users can view their own agent lead queue"
      on public.agent_lead_queue
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'agent_lead_queue' and policyname = 'Users can insert their own agent lead queue'
  ) then
    create policy "Users can insert their own agent lead queue"
      on public.agent_lead_queue
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end
$$;
