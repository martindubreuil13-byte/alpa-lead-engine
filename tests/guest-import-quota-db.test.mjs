import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync,spawn} from 'node:child_process'
import test from 'node:test'
const url=process.env.ALPA_TEST_DB_URL?new URL(process.env.ALPA_TEST_DB_URL):null
if(url&&(!['localhost','127.0.0.1','::1'].includes(url.hostname)||/supabase/i.test(url.href)))throw new Error('Disposable loopback database only')
const db=`guest_quota_${process.pid}`,psql=process.env.PSQL||'/opt/homebrew/opt/libpq/bin/psql'
const args=(name=db)=>['-X','-q','-A','-t','-h',url.hostname,'-p',url.port,'-U',url.username,'-d',name,'-v','ON_ERROR_STOP=1']
const options={encoding:'utf8',stdio:['pipe','pipe','pipe']}
const sql=(query,name=db)=>execFileSync(psql,args(name),{...options,input:"SET timezone='UTC';\n"+query}).trim()
const literal=x=>"'"+String(x).replaceAll("'","''")+"'"
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const lead=n=>({company_name:`Business ${n}`,phone:`1555${n}`,website:null,city:null,website_facts:{version:1,title:'Original website'},light_profile:{version:1,summary:'Saved guest profile'}})
const claim=(user,trial,leads)=>`SET request.jwt.claim.role='service_role'; SELECT claim_guest_businesses('${user}','${trial}',${literal(JSON.stringify(leads))});`
const get=(u,t,leads)=>JSON.parse(sql(claim(u,t,leads)))
function seed(n,used=0,plan='free'){
 const user=id(n),trial=id(n+1000)
 sql(`INSERT INTO auth.users VALUES('${user}');INSERT INTO profiles(id,plan,plan_status,stripe_subscription_id) VALUES('${user}','${plan}','${plan==='free'?'free':'active'}',${plan==='free'?'NULL':"'sub_test'"});INSERT INTO guest_trials(id) VALUES('${trial}');`)
 if(used)sql(`INSERT INTO leads(user_id,company_name,phone) SELECT '${user}','Existing '||n,'old'||n FROM generate_series(1,${used}) n;`)
 return {user,trial}
}
const count=(table,user)=>Number(sql(`SELECT count(*) FROM ${table} WHERE user_id='${user}'`))
const asyncSql=query=>new Promise(resolve=>{const child=spawn(psql,args());let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('close',code=>resolve({code,out:out.trim(),err}));child.stdin.end(query)})
test('guest-import transaction against real PostgreSQL', {skip:!url&&'Disposable ALPA_TEST_DB_URL required'},async t=>{
 sql(`CREATE DATABASE ${db}`,'postgres')
 try{
  let fixture=fs.readFileSync('tests/sql/discover-atomic-saves.sql','utf8').split('INSERT INTO auth.users')[0].replace(/CREATE ROLE \w+;/g,'')
  fixture+=`CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE TABLE public.users(id uuid PRIMARY KEY,plan text CONSTRAINT users_plan_check CHECK(plan IN ('free','starter')));
   ALTER TABLE profiles ADD COLUMN plan text DEFAULT 'free',ADD COLUMN plan_status text,ADD COLUMN subscription_status text,ADD COLUMN current_period_end timestamptz,ADD COLUMN stripe_subscription_id text;
   ALTER TABLE leads ADD COLUMN website_facts jsonb,ADD COLUMN light_profile jsonb;
   CREATE TABLE guest_trials(id uuid PRIMARY KEY,owner_user_id uuid,leads jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now());`
  sql(fixture);sql(fs.readFileSync('supabase/applied-records/20261014_discover_atomic_saves.sql','utf8'))
  sql(fs.readFileSync('supabase/proposed/20261015_phase1_pricing.sql','utf8'))
  const legacy=seed(1);sql(`UPDATE guest_trials SET owner_user_id='${legacy.user}',leads=${literal(JSON.stringify([lead(1)]))} WHERE id='${legacy.trial}';INSERT INTO leads(user_id,company_name,phone) VALUES('${legacy.user}','Business 1','15551');`)
  sql(fs.readFileSync('supabase/proposed/20261019_guest_import_lifetime_quota.sql','utf8'))
  await t.test('legitimate import preserves facts/profiles; duplicate and invalid rows do not spend capacity',()=>{
   const {user,trial}=seed(2,23);const result=get(user,trial,[lead(2),lead(2),{},lead(3),lead(4)])
   assert.deepEqual([result.imported,result.skipped_duplicate,result.skipped_invalid,result.skipped_allowance],[2,1,1,1]);assert.equal(count('leads',user),25);assert.equal(count('business_allowance_ledger',user),25)
   assert.equal(sql(`SELECT light_profile->>'summary' FROM leads WHERE user_id='${user}' AND company_name='Business 2'`),'Saved guest profile')
   assert.equal(sql(`SELECT website_facts->>'title' FROM leads WHERE user_id='${user}' AND company_name='Business 2'`),'Original website')
  })
  await t.test('deleting 25 discovered businesses does not restore guest import capacity',()=>{
   const {user,trial}=seed(3,25);sql(`DELETE FROM leads WHERE user_id='${user}'`)
   assert.equal(get(user,trial,[lead(3)]).skipped_allowance,1);assert.equal(count('leads',user),0);assert.equal(count('business_allowance_ledger',user),25)
  })
  await t.test('replayed imports stay consumed after deletion, even while the account is paid',()=>{
   const {user,trial}=seed(4,0,'pro');assert.equal(get(user,trial,[lead(4)]).imported,1);sql(`DELETE FROM leads WHERE user_id='${user}'`)
   assert.equal(get(user,trial,[lead(4)]).skipped_duplicate,1);assert.equal(count('leads',user),0)
   sql(`UPDATE profiles SET plan='free',plan_status='free' WHERE id='${user}'`);assert.equal(get(user,trial,[lead(4)]).imported,0)
  })
  await t.test('an expired or never-linked paid profile gets the Free quota; a backed paid profile does not',()=>{
   // The shapes found in production: plan starter, status active, no Stripe subscription, paid-through date long past.
   const lapsed=seed(60,25,'starter');sql(`UPDATE profiles SET stripe_subscription_id=NULL,current_period_end='2026-05-04' WHERE id='${lapsed.user}'`)
   const result=get(lapsed.user,lapsed.trial,[lead(60)]);assert.deepEqual([result.imported,result.skipped_allowance],[0,1],'expired: Free lifetime quota applies')
   assert.equal(count('leads',lapsed.user),25,'existing businesses are untouched');assert.equal(sql(`SELECT plan||'/'||plan_status FROM profiles WHERE id='${lapsed.user}'`),'starter/active','the profile is not modified')
   const unlinked=seed(61,25,'starter');sql(`UPDATE profiles SET stripe_subscription_id=NULL,current_period_end=NULL WHERE id='${unlinked.user}'`)
   assert.equal(get(unlinked.user,unlinked.trial,[lead(61)]).skipped_allowance,1,'never linked and no date: Free quota applies')
   const current=seed(62,25,'pro');sql(`UPDATE profiles SET current_period_end=now()+interval '10 days' WHERE id='${current.user}'`)
   assert.equal(get(current.user,current.trial,[lead(62)]).imported,1,'paid through a future date: paid allowance')
   const linked=seed(63,25,'pro');sql(`UPDATE profiles SET current_period_end=NULL WHERE id='${linked.user}'`)
   assert.equal(get(linked.user,linked.trial,[lead(63)]).imported,1,'linked subscription with the date not yet recorded: still paid')
  })
  await t.test('legacy ownership and import receipts survive deletion without overwriting saved facts',()=>{
   sql(`UPDATE leads SET website_facts='{"title":"Keep me"}',light_profile='{"summary":"Keep profile"}' WHERE user_id='${legacy.user}'`)
   assert.equal(get(legacy.user,legacy.trial,[lead(1)]).imported,0)
   assert.equal(sql(`SELECT website_facts->>'title'||'/'||(light_profile->>'summary') FROM leads WHERE user_id='${legacy.user}'`),'Keep me/Keep profile')
   sql(`DELETE FROM leads WHERE user_id='${legacy.user}'`);assert.equal(get(legacy.user,legacy.trial,[lead(1)]).imported,0)
  })
  await t.test('same-trial concurrent imports commit only once',async()=>{
   const {user,trial}=seed(5);const results=await Promise.all([asyncSql(claim(user,trial,[lead(5)])),asyncSql(claim(user,trial,[lead(5)]))]);assert.ok(results.every(x=>x.code===0));assert.equal(results.reduce((n,x)=>n+JSON.parse(x.out).imported,0),1);assert.equal(count('leads',user),1)
  })
  await t.test('different trials on the same account cannot stack allowances',async()=>{
   const {user,trial}=seed(6,24),second=id(2006);sql(`INSERT INTO guest_trials(id) VALUES('${second}')`)
   const results=await Promise.all([asyncSql(claim(user,trial,[lead(6)])),asyncSql(claim(user,second,[lead(7)]))]);assert.ok(results.every(x=>x.code===0));assert.equal(count('leads',user),25);assert.equal(count('guest_import_claims',user),1)
  })
  await t.test('discovery and guest import cannot both spend the final lifetime slot',async()=>{
   const {user,trial}=seed(7,24)
   const discover=`SET request.jwt.claim.role='service_role';SELECT save_discover_results('${id(4007)}','${user}',25,false,${literal(JSON.stringify([lead(70)]))});`
   const results=await Promise.all([asyncSql(claim(user,trial,[lead(71)])),asyncSql(discover)]);assert.ok(results.every(x=>x.code===0));assert.equal(count('leads',user),25);assert.equal(count('business_allowance_ledger',user),25)
  })
  await t.test('one guest trial cannot be transferred between accounts, including simultaneous claims',async()=>{
   const a=seed(8),b=seed(9);const results=await Promise.all([asyncSql(claim(a.user,a.trial,[lead(8)])),asyncSql(claim(b.user,a.trial,[lead(8)]))]);assert.equal(results.filter(x=>x.code===0).length,1);assert.equal(count('leads',a.user)+count('leads',b.user),1)
   const owner=sql(`SELECT user_id FROM guest_import_claims WHERE trial_id='${a.trial}'`);const other=owner===a.user?b.user:a.user
   sql(`DELETE FROM guest_trials WHERE id='${a.trial}';INSERT INTO guest_trials(id) VALUES('${a.trial}')`);assert.throws(()=>get(other,a.trial,[lead(8)]));assert.equal(sql(`SELECT user_id FROM guest_import_claims WHERE trial_id='${a.trial}'`),owner)
  })
  await t.test('paid allowances are unchanged and a return to Free does not grant new lifetime capacity',()=>{
   for(const [n,plan] of [[10,'starter_100'],[11,'pro'],[12,'admin']]){const {user,trial}=seed(n,40,plan);assert.equal(get(user,trial,[lead(n)]).imported,1);sql(`UPDATE profiles SET plan='free',plan_status='free' WHERE id='${user}'`);assert.equal(get(user,trial,[lead(n+100)]).skipped_allowance,1);assert.equal(count('leads',user),41)}
  })
  await t.test('a failed import rolls back trial ownership, receipts, businesses and lifetime accounting',()=>{
   const {user,trial}=seed(13)
   sql(`CREATE FUNCTION fail_guest_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_name='Broken' THEN RAISE EXCEPTION 'fixture failure';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_guest_fixture BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION fail_guest_fixture();`)
   assert.throws(()=>get(user,trial,[lead(13),{...lead(14),company_name:'Broken'}]));assert.equal(count('leads',user),0);assert.equal(count('business_allowance_ledger',user),0);assert.equal(count('guest_import_claims',user),0);assert.equal(sql(`SELECT owner_user_id IS NULL FROM guest_trials WHERE id='${trial}'`),'t')
   sql('DROP TRIGGER fail_guest_fixture ON leads');assert.equal(get(user,trial,[lead(13)]).imported,1)
  })
  await t.test('missing optional storage columns do not discard the guest profile or block an import',()=>{
   const {user,trial}=seed(15);sql(`UPDATE guest_trials SET leads=${literal(JSON.stringify([lead(15)]))} WHERE id='${trial}';ALTER TABLE leads DROP COLUMN website_facts,DROP COLUMN light_profile;`)
   assert.equal(get(user,trial,[lead(15)]).imported,1);assert.equal(count('business_allowance_ledger',user),1)
   assert.equal(sql(`SELECT leads->0->'light_profile'->>'summary' FROM guest_trials WHERE id='${trial}'`),'Saved guest profile')
  })
  await t.test('clients cannot call the import RPC or erase its durable receipts; expired trials are refused',()=>{
   const {user,trial}=seed(14);sql(`UPDATE guest_trials SET created_at=now()-interval '31 days' WHERE id='${trial}'`);assert.throws(()=>get(user,trial,[lead(14)]))
   assert.throws(()=>sql(`SET ROLE authenticated;SELECT claim_guest_businesses('${user}','${trial}','[]')`));assert.throws(()=>sql('SET ROLE authenticated;DELETE FROM guest_import_claims'));assert.throws(()=>sql('SET ROLE authenticated;DELETE FROM guest_import_items'))
  })
 }finally{sql(`DROP DATABASE ${db} WITH (FORCE)`,'postgres')}
})
