begin;
do $$
declare gid uuid := gen_random_uuid(); r uuid := gen_random_uuid(); n integer; i integer;
begin
 if has_table_privilege('anon','public.guest_trials','SELECT') or has_table_privilege('authenticated','public.guest_trials','UPDATE')
 or has_function_privilege('anon','public.reserve_guest_trial(uuid,text,integer,uuid)','EXECUTE')
 then raise exception 'Guest trial exposed to public roles'; end if;
 insert into public.guest_trials(id) values(gid);
 n := public.reserve_guest_trial(gid,'guest-test-bucket',10,r);
 if n <> 10 then raise exception 'Wrong reservation'; end if;
 if public.reserve_guest_trial(gid,'guest-test-bucket',10,gen_random_uuid()) <> 0 then raise exception 'Concurrent search allowed'; end if;
 if public.finish_guest_trial(gid,gen_random_uuid(),10,'[]') then raise exception 'Stale completion accepted'; end if;
 if not public.finish_guest_trial(gid,r,10,'[{"company_name":"Fixture business"}]') then raise exception 'Finish failed'; end if;
 if (select used from public.guest_trials t where t.id=gid) <> 1 then raise exception 'Reservation not refunded'; end if;
 r := gen_random_uuid();
 n := public.reserve_guest_trial(gid,'guest-test-bucket',25,r);
 if n <> 24 then raise exception 'Allowance not capped'; end if;
 if public.reserve_guest_trial(gid,'another-ip',25,gen_random_uuid()) <> 0 then raise exception 'Session quota bypass'; end if;
 if not public.finish_guest_trial(gid,r,24,'[]') then raise exception 'Empty finish failed'; end if;
 r := gen_random_uuid();
 n := public.reserve_guest_trial(gid,'guest-test-bucket',1,r);
 perform public.finish_guest_trial(gid,r,n,'[]');
 if public.reserve_guest_trial(gid,'guest-test-bucket',1,gen_random_uuid()) <> 0 then raise exception 'Attempt cap bypass'; end if;
 for i in 1..6 loop
  gid := gen_random_uuid();r := gen_random_uuid();insert into public.guest_trials(id) values(gid);
  n := public.reserve_guest_trial(gid,'shared-ip-test',1,r);
  if n <> 1 then raise exception 'IP rate too strict'; end if;
  perform public.finish_guest_trial(gid,r,n,'[]');
 end loop;
 gid := gen_random_uuid();insert into public.guest_trials(id) values(gid);
 if public.reserve_guest_trial(gid,'shared-ip-test',25,gen_random_uuid()) <> 0 then raise exception 'IP rate bypass'; end if;
end $$;
rollback;
