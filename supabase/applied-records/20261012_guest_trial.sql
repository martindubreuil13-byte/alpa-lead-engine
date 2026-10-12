begin;
create table public.guest_trials (
 id uuid primary key,
 leads jsonb not null default '[]'::jsonb check(jsonb_typeof(leads) = 'array' and jsonb_array_length(leads) <= 25),
 used integer not null default 0 check(used between 0 and 25),
 attempts integer not null default 0,
 active_run uuid,
 active_until timestamptz,
 email text,
 marketing_opt_in boolean not null default false,
 consent_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.guest_trial_rate_limits (
 bucket text primary key,
 attempts integer not null default 0
);
alter table public.guest_trials enable row level security;
alter table public.guest_trial_rate_limits enable row level security;
revoke all on public.guest_trials, public.guest_trial_rate_limits from public, anon, authenticated;
grant select, insert, update on public.guest_trials, public.guest_trial_rate_limits to service_role;

create function public.reserve_guest_trial(p_id uuid, p_bucket text, p_count integer, p_run uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.guest_trials; n integer; a integer;
begin
 if p_count < 1 or p_count > 25 or length(p_bucket) > 100 then return 0; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_bucket, 0));
 select * into t from public.guest_trials where id=p_id for update;
 if not found or t.created_at < now()-interval '30 days' or t.attempts >= 3 or t.used >= 25
 or (t.active_run is not null and t.active_until > now()) then return 0; end if;
 insert into public.guest_trial_rate_limits(bucket) values(p_bucket) on conflict do nothing;
 select attempts into a from public.guest_trial_rate_limits where bucket=p_bucket;
 if a >= 6 then return 0; end if;
 n := least(p_count, 25-t.used);
 update public.guest_trial_rate_limits set attempts=attempts+1 where bucket=p_bucket;
 update public.guest_trials set used=used+n, attempts=attempts+1, active_run=p_run,
 active_until=now()+interval '6 minutes' where id=p_id;
 return n;
end $$;
create function public.finish_guest_trial(p_id uuid, p_run uuid, p_reserved integer, p_leads jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.guest_trials; n integer;
begin
 select * into t from public.guest_trials where id=p_id for update;
 if not found or t.active_run is distinct from p_run then return false; end if;
 n := jsonb_array_length(p_leads);
 if n > p_reserved or p_reserved < 1 or p_reserved > 25 then return false; end if;
 update public.guest_trials set leads=leads || p_leads, used=used-p_reserved+n,
 active_run=null, active_until=null where id=p_id;
 return true;
end $$;
revoke all on function public.reserve_guest_trial(uuid,text,integer,uuid), public.finish_guest_trial(uuid,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_guest_trial(uuid,text,integer,uuid), public.finish_guest_trial(uuid,uuid,integer,jsonb) to service_role;
commit;
