-- Run against a disposable local Postgres that has supabase/applied-records/20261012_guest_trial.sql and
-- supabase/proposed/20261018_guest_light_profiles.sql applied. Everything rolls back.
begin;
do $$
declare gid uuid := gen_random_uuid(); r uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); res text; i integer; ls jsonb := '[]';
begin
 for i in 1..25 loop ls := ls || jsonb_build_array(jsonb_build_object('id','b'||i,'company_name','Business '||i)); end loop;
 insert into public.guest_trials(id, leads, used, attempts) values (gid, ls, 25, 3);
 if has_function_privilege('anon','public.begin_guest_profile(uuid,text,uuid,integer,integer,integer)','EXECUTE')
 or has_function_privilege('authenticated','public.finish_guest_profile(uuid,text,uuid,jsonb,integer)','EXECUTE') then raise exception 'exposed to public roles'; end if;
 if public.begin_guest_profile(gid,'forged',r) <> 'not_found' then raise exception 'forged id accepted'; end if;
 if public.begin_guest_profile(gen_random_uuid(),'b1',r) <> 'expired' then raise exception 'unknown trial accepted'; end if;
 if public.begin_guest_profile(gid,'b1',r) <> 'claimed' then raise exception 'claim failed'; end if;
 if public.begin_guest_profile(gid,'b1',r2) <> 'busy' then raise exception 'duplicate generation allowed'; end if;
 if public.finish_guest_profile(gid,'b1',r2,'{"summary":"x"}') then raise exception 'wrong run accepted'; end if;
 if not public.finish_guest_profile(gid,'b1',r,'{"summary":"x"}') then raise exception 'finish failed'; end if;
 if public.begin_guest_profile(gid,'b1',r2) <> 'cached' then raise exception 'not cached'; end if;
 if (select leads->0->'profile_claim' from public.guest_trials where id=gid) is not null then raise exception 'claim left behind'; end if;
 if (select profile_attempts from public.guest_trials where id=gid) <> 1 then raise exception 'attempt not counted'; end if;
 r := gen_random_uuid();
 if public.begin_guest_profile(gid,'b2',r) <> 'claimed' then raise exception 'second claim'; end if;
 if not public.release_guest_profile(gid,'b2',r) then raise exception 'release failed'; end if;
 for i in 2..25 loop
  r := gen_random_uuid(); res := public.begin_guest_profile(gid,'b'||i,r,25,100);
  if res <> 'claimed' then raise exception 'claim % got %', i, res; end if;
  perform public.finish_guest_profile(gid,'b'||i,r,'{"summary":"x"}');
 end loop;
 if public.begin_guest_profile(gid,'b1',gen_random_uuid()) <> 'cached' then raise exception 'cached after 25'; end if;
 update public.guest_trials set leads = (select jsonb_agg(e - 'light_profile') from jsonb_array_elements(leads) e) where id=gid;
 if public.begin_guest_profile(gid,'b1',gen_random_uuid(),25,26) <> 'limit' then raise exception 'attempt cap bypass'; end if;
 -- the daily ceiling is shared by every trial
 gid := gen_random_uuid(); insert into public.guest_trials(id, leads) values (gid, '[{"id":"z"}]');
 delete from public.guest_trial_rate_limits where bucket like 'profile-day:%';
 insert into public.guest_trial_rate_limits(bucket, attempts) values ('profile-day:'||to_char(now() at time zone 'utc','YYYY-MM-DD'), 1000);
 if public.begin_guest_profile(gid,'z',gen_random_uuid()) <> 'budget' then raise exception 'daily ceiling bypass'; end if;
end $$;
rollback;
