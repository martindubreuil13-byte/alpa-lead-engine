"""Only the disposable localhost PostgreSQL fixture, never Supabase."""
import concurrent.futures, json, subprocess
PSQL='/opt/homebrew/opt/libpq/bin/psql'
ARGS=[PSQL,'-h','127.0.0.1','-p','55439','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
def sql(query):
    return subprocess.run(ARGS+['-c',query],capture_output=True,text=True,check=True).stdout.strip()
assert sql('SHOW data_directory') == '/private/tmp/alpa-issue5-pg/data', 'not the disposable test cluster'
for owner, monthly in [('44444444-4444-4444-4444-444444444444',True),('55555555-5555-5555-5555-555555555555',False)]:
    def save(index):
        run=f'00000000-0000-0000-0000-{(4 if monthly else 5)*10+index:012d}'
        payload=json.dumps([{'company_name':f'Concurrent {index}','phone':str(index)}])
        raw=sql(f"SET request.jwt.claim.role='service_role'; SELECT public.save_discover_results('{run}','{owner}',1,{str(monthly).lower()},'{payload}'::jsonb)")
        return json.loads(raw.splitlines()[-1])
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(save,[1,2]))
    assert sum(o['status']=='saved' for r in results for o in r['outcomes'])==1,results
    assert sql(f"SELECT count(*) FROM leads WHERE user_id='{owner}'")=='1'
    if monthly:
        assert sql(f"SELECT count(*),sum(leads_used) FROM usage WHERE user_id='{owner}'")=='1|1'
    else:
        assert sql(f"SELECT count(*) FROM usage WHERE user_id='{owner}'")=='0'
    print('PASS: overlapping '+('monthly' if monthly else 'free')+' batches stay within capacity')
owner='33333333-3333-3333-3333-333333333333'
def repeat(_):
    raw=sql("SET request.jwt.claim.role='service_role'; SELECT public.save_discover_results('dddddddd-dddd-dddd-dddd-dddddddddddd','"+owner+"',5,true,'[{\"company_name\":\"Same batch\",\"phone\":\"123\"}]')")
    return json.loads(raw.splitlines()[-1])
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(repeat,[1,2]))
assert results[0]==results[1]
assert sql(f"SELECT count(*) FROM leads WHERE user_id='{owner}'")=='1'
assert sql(f"SELECT leads_used FROM usage WHERE user_id='{owner}'")=='1'
print('PASS: overlapping retries of the same batch save and account exactly once')
