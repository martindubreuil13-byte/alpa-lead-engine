create table if not exists public.user_ctas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  type text not null check (type in ('link', 'email', 'calendly', 'none')),
  value text null,
  is_active boolean not null default true,
  priority integer null,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists user_ctas_user_id_idx
  on public.user_ctas (user_id);

create index if not exists user_ctas_user_active_priority_idx
  on public.user_ctas (user_id, is_active, priority, created_at);

alter table public.user_ctas enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'user_ctas' and policyname = 'Users can view their own CTAs'
  ) then
    create policy "Users can view their own CTAs"
      on public.user_ctas
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
    where schemaname = 'public' and tablename = 'user_ctas' and policyname = 'Users can insert their own CTAs'
  ) then
    create policy "Users can insert their own CTAs"
      on public.user_ctas
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
    where schemaname = 'public' and tablename = 'user_ctas' and policyname = 'Users can update their own CTAs'
  ) then
    create policy "Users can update their own CTAs"
      on public.user_ctas
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'user_ctas' and policyname = 'Users can delete their own CTAs'
  ) then
    create policy "Users can delete their own CTAs"
      on public.user_ctas
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

alter table public.outreach_queue
  add column if not exists style text null,
  add column if not exists cta_label text null,
  add column if not exists cta_type text null,
  add column if not exists cta_value text null;
