import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import test from 'node:test'
const url=process.env.ALPA_TEST_DB_URL ? new URL(process.env.ALPA_TEST_DB_URL) : null
if(url && (!['127.0.0.1','localhost','::1'].includes(url.hostname)||/supabase/i.test(url.href))) throw new Error('Disposable loopback database required')
const PSQL=process.env.PSQL || '/opt/homebrew/opt/libpq/bin/psql'
const db=`pricing_${process.pid}`
const args=(database)=>['-X','-q','-A','-t','-h',url.hostname,'-p',url.port,'-U',url.username,'-d',database,'-v','ON_ERROR_STOP=1']
function sql(query,database=db){return execFileSync(PSQL,args(database),{input:"SET timezone='UTC';\n"+query,encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)},stdio:['pipe','pipe','pipe']}).trim()}
const A='11111111-1111-1111-1111-111111111111',B='22222222-2222-2222-2222-222222222222'
const capacity=(owner,limit,monthly)=>JSON.parse(sql(`SET request.jwt.claim.role='service_role'; SELECT get_discover_capacity('${owner}',${limit},${monthly});`))
const saveQuery=(run,owner,limit,monthly,leads)=>`SET request.jwt.claim.role='service_role'; SELECT save_discover_results('${run}','${owner}',${limit},${monthly},'${JSON.stringify(leads)}');`
const run=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const lead=(n)=>({company_name:`Company ${n}`,phone:`1555${n}`})
test('real SQL: lifetime Free, monthly upgrades/downgrades/renewal, replay, concurrency and owner isolation', {skip: !url && 'Requires disposable ALPA_TEST_DB_URL'}, async()=>{
  sql(`CREATE DATABASE ${db}`,'postgres')
  try {
    let fixture=fs.readFileSync('tests/sql/discover-atomic-saves.sql','utf8').split('INSERT INTO auth.users')[0].replace(/CREATE ROLE \w+;/g,'')
    fixture+=`CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE public.users(id uuid PRIMARY KEY, plan text CONSTRAINT users_plan_check CHECK(plan IN ('free','starter')));
      INSERT INTO auth.users VALUES('${A}'),('${B}'); INSERT INTO profiles VALUES('${A}'),('${B}');
      GRANT USAGE ON SCHEMA auth TO authenticated,service_role; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      INSERT INTO leads(user_id,company_name,phone) VALUES('${A}','Existing','1');`
    sql(fixture)
    sql(fs.readFileSync('supabase/applied-records/20261014_discover_atomic_saves.sql','utf8'))
    sql(fs.readFileSync('supabase/proposed/20261015_phase1_pricing.sql','utf8'))
    assert.equal(capacity(A,25,false).leads_used,1,'backfills existing countable businesses')
    const leads=Array.from({length:30},(_,i)=>lead(i+1))
    const query=saveQuery(run(1),A,25,false,leads)
    const result=JSON.parse(sql(query))
    assert.equal(result.outcomes.filter(x=>x.status==='saved').length,24)
    assert.equal(result.leads_used,25)
    assert.deepEqual(JSON.parse(sql(query)),result,'replay is idempotent')
    sql(`DELETE FROM leads WHERE user_id='${A}'`)
    assert.equal(capacity(A,25,false).leads_used,25,'deletion never restores free allowance')
    const blocked=JSON.parse(sql(saveQuery(run(2),A,25,false,[lead(99)])))
    assert.equal(blocked.outcomes[0].status,'limit')
    assert.equal(capacity(A,100,true).leads_used,0,'paid period has independent usage')
    const paid=JSON.parse(sql(saveQuery(run(3),A,100,true,[lead(101),lead(102)])))
    assert.equal(paid.leads_used,2)
    assert.equal(capacity(A,500,true).leads_used,2,'upgrade retains used count')
    assert.equal(capacity(A,100,true).leads_used,2,'downgrade retains used count')
    const duplicates=JSON.parse(sql(saveQuery(run(4),A,100,true,[lead(101),{company_name:'Invalid'}])))
    assert.deepEqual(duplicates.outcomes.map(x=>x.status),['duplicate','invalid'])
    assert.equal(duplicates.leads_used,2)
    sql(`UPDATE usage SET period_end=now()-interval '1 second',period_start=now()-interval '1 month' WHERE user_id='${A}'`)
    assert.equal(capacity(A,100,true).leads_used,0,'expired monthly period renews')
    assert.ok(capacity(A,25,false).leads_used>=25,'returning to free never creates another allowance')
    assert.equal(capacity(B,25,false).leads_used,0)
    assert.equal(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${B}'; SELECT count(*) FROM business_allowance_ledger`),'0')
    assert.throws(()=>sql(`SET ROLE authenticated; DELETE FROM business_allowance_ledger`),/Command failed/)
    const asyncSql=(query)=>new Promise((resolve,reject)=>{const child=spawn(PSQL,args(db));let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('close',code=>code?reject(new Error(err)):resolve(JSON.parse(out.trim())));child.stdin.end(query)})
    const results=await Promise.all([5,6].map(n=>asyncSql(saveQuery(run(n),B,1,false,[lead(n+100)]))))
    assert.equal(results.flatMap(x=>x.outcomes).filter(x=>x.status==='saved').length,1,'concurrent free saves cannot exceed capacity')
  } finally {sql(`DROP DATABASE ${db} WITH (FORCE)`,'postgres')}
})
