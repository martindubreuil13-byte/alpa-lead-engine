create table if not exists public.email_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  emails_sent integer not null default 0 check (emails_sent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create index if not exists email_usage_user_id_usage_date_idx
  on public.email_usage (user_id, usage_date desc);

alter table public.email_usage enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public' and tablename = 'email_usage' and policyname = 'Users can view their own email usage'
  ) then
    create policy "Users can view their own email usage"
      on public.email_usage
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
    where schemaname = 'public' and tablename = 'email_usage' and policyname = 'Users can insert their own email usage'
  ) then
    create policy "Users can insert their own email usage"
      on public.email_usage
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
    where schemaname = 'public' and tablename = 'email_usage' and policyname = 'Users can update their own email usage'
  ) then
    create policy "Users can update their own email usage"
      on public.email_usage
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

create or replace function public.increment_email_usage(
  target_user_id uuid,
  target_date date,
  increment_by integer default 1
)
returns table (
  user_id uuid,
  usage_date date,
  emails_sent integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is distinct from target_user_id then
    raise exception 'not allowed';
  end if;

  if increment_by < 1 then
    raise exception 'increment_by must be positive';
  end if;

  return query
  insert into public.email_usage (user_id, usage_date, emails_sent)
  values (target_user_id, target_date, increment_by)
  on conflict (user_id, usage_date)
  do update
    set emails_sent = public.email_usage.emails_sent + excluded.emails_sent,
        updated_at = now()
  returning
    public.email_usage.user_id,
    public.email_usage.usage_date,
    public.email_usage.emails_sent,
    public.email_usage.created_at,
    public.email_usage.updated_at;
end;
$$;

grant execute on function public.increment_email_usage(uuid, date, integer) to authenticated;
