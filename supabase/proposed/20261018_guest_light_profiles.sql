-- PROPOSED. NOT APPLIED. Phase 7: short on-demand business profiles for the free guest trial.
--
-- Additive only: one counter column on guest_trials, one nullable column on leads, three service-role-only functions.
-- No existing column, policy, grant or function is changed, and nothing here touches the paid research queue or its tables.
--
--   * guest_trials.profile_attempts  how many generation attempts this trial has used (successes and failures), capped by the function.
--   * leads.light_profile            the short profile kept when a guest signs up (nullable, no default, catalog-only change).
--   * begin_/finish_/release_guest_profile  claim one business for generation (one at a time per business), store the result on that
--     business inside guest_trials.leads, or release the claim. All three lock the trial row, so concurrent requests are serialised.
--   * the shared daily ceiling lives in the existing guest_trial_rate_limits table under a 'profile-day:<date>' key.
--
-- The application tolerates this migration being absent: profile generation answers "unavailable" and nothing else changes; signup
-- imports businesses exactly as before.
--
-- Rollback: DROP FUNCTION public.begin_guest_profile(uuid,text,uuid,integer,integer,integer);
--           DROP FUNCTION public.finish_guest_profile(uuid,text,uuid,jsonb,integer);
--           DROP FUNCTION public.release_guest_profile(uuid,text,uuid);
--           ALTER TABLE public.guest_trials DROP COLUMN IF EXISTS profile_attempts;
--           ALTER TABLE public.leads DROP COLUMN IF EXISTS light_profile;

begin;

alter table public.guest_trials add column if not exists profile_attempts integer not null default 0;
alter table public.leads add column if not exists light_profile jsonb;
comment on column public.leads.light_profile is
  'Short AI-written profile (summary and service tags) generated from the business''s own website words during a free trial. Separate from commercial_profile (paid Business Intelligence).';

-- Claim one business for profile generation. Returns: claimed | cached | busy | limit | budget | not_found | expired
create or replace function public.begin_guest_profile(
  p_id uuid, p_lead text, p_run uuid, p_max integer default 25, p_max_attempts integer default 40, p_daily_max integer default 1000
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.guest_trials; el jsonb; idx integer; made integer; day_key text; day_used integer;
begin
 if p_lead is null or length(p_lead) > 100 or p_max < 1 or p_max > 25 or p_max_attempts < 1 or p_max_attempts > 100 or p_daily_max < 1 or p_daily_max > 5000 then return 'not_found'; end if;
 select * into t from public.guest_trials where id = p_id for update;
 if not found or t.created_at < now() - interval '30 days' then return 'expired'; end if;
 select x.e, x.ord - 1 into el, idx from jsonb_array_elements(t.leads) with ordinality as x(e, ord) where x.e->>'id' = p_lead limit 1;
 if el is null then return 'not_found'; end if;
 if jsonb_typeof(el->'light_profile') = 'object' then return 'cached'; end if;
 if jsonb_typeof(el->'profile_claim') = 'object' and (el->'profile_claim'->>'until')::timestamptz > now() then return 'busy'; end if;
 select count(*) into made from jsonb_array_elements(t.leads) e where jsonb_typeof(e->'light_profile') = 'object';
 if made >= p_max or t.profile_attempts >= p_max_attempts then return 'limit'; end if;
 day_key := 'profile-day:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
 insert into public.guest_trial_rate_limits(bucket) values (day_key) on conflict do nothing;
 select attempts into day_used from public.guest_trial_rate_limits where bucket = day_key for update;
 if day_used >= p_daily_max then return 'budget'; end if;
 update public.guest_trial_rate_limits set attempts = attempts + 1 where bucket = day_key;
 update public.guest_trials
    set leads = jsonb_set(leads, array[idx::text], el || jsonb_build_object('profile_claim', jsonb_build_object('run', p_run, 'until', now() + interval '45 seconds'))),
        profile_attempts = profile_attempts + 1
  where id = p_id;
 return 'claimed';
end $$;

-- Store a finished profile on the business that this run claimed. False when the claim is not this run's (expired or taken over).
create or replace function public.finish_guest_profile(
  p_id uuid, p_lead text, p_run uuid, p_profile jsonb, p_max integer default 25
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.guest_trials; el jsonb; idx integer; made integer;
begin
 if jsonb_typeof(p_profile) is distinct from 'object' or pg_column_size(p_profile) > 4000 then return false; end if;
 select * into t from public.guest_trials where id = p_id for update;
 if not found then return false; end if;
 select x.e, x.ord - 1 into el, idx from jsonb_array_elements(t.leads) with ordinality as x(e, ord) where x.e->>'id' = p_lead limit 1;
 if el is null or (el->'profile_claim'->>'run') is distinct from p_run::text then return false; end if;
 select count(*) into made from jsonb_array_elements(t.leads) e where jsonb_typeof(e->'light_profile') = 'object';
 if made >= p_max then return false; end if;
 update public.guest_trials set leads = jsonb_set(leads, array[idx::text], (el - 'profile_claim') || jsonb_build_object('light_profile', p_profile)) where id = p_id;
 return true;
end $$;

-- Give up a claim without a result (the attempt stays counted).
create or replace function public.release_guest_profile(p_id uuid, p_lead text, p_run uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.guest_trials; el jsonb; idx integer;
begin
 select * into t from public.guest_trials where id = p_id for update;
 if not found then return false; end if;
 select x.e, x.ord - 1 into el, idx from jsonb_array_elements(t.leads) with ordinality as x(e, ord) where x.e->>'id' = p_lead limit 1;
 if el is null or (el->'profile_claim'->>'run') is distinct from p_run::text then return false; end if;
 update public.guest_trials set leads = jsonb_set(leads, array[idx::text], el - 'profile_claim') where id = p_id;
 return true;
end $$;

revoke all on function public.begin_guest_profile(uuid,text,uuid,integer,integer,integer), public.finish_guest_profile(uuid,text,uuid,jsonb,integer), public.release_guest_profile(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.begin_guest_profile(uuid,text,uuid,integer,integer,integer), public.finish_guest_profile(uuid,text,uuid,jsonb,integer), public.release_guest_profile(uuid,text,uuid) to service_role;

commit;
