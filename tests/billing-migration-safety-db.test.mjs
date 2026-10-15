import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import test from 'node:test'
import { PLANS } from '../lib/billing/plans.ts'

const url = process.env.ALPA_TEST_DB_URL ? new URL(process.env.ALPA_TEST_DB_URL) : null
if (url && (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || /supabase/i.test(url.href))) throw new Error('Disposable loopback database only')
const db = `billing_migration_${process.pid}`
const psql = process.env.PSQL || '/opt/homebrew/opt/libpq/bin/psql'
const args = (name = db) => ['-X', '-q', '-A', '-t', '-h', url.hostname, '-p', url.port, '-U', url.username, '-d', name, '-v', 'ON_ERROR_STOP=1']
const opts = { encoding: 'utf8', env: { ...process.env, PGPASSWORD: url ? decodeURIComponent(url.password) : '' }, stdio: ['pipe', 'pipe', 'pipe'] }
const sql = (query, name = db) => execFileSync(psql, args(name), { ...opts, input: "SET timezone='UTC';\n" + query }).trim()
const read = name => fs.readFileSync(`supabase/proposed/${name}.sql`, 'utf8')
const pricing = read('20261015_phase1_pricing')
const guest = read('20261019_guest_import_lifetime_quota')
const pause = read('20261020_billing_quota_rollback')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const literal = x => "'" + String(x).replaceAll("'", "''") + "'"
const lead = n => ({ company_name: `Legacy business ${n}`, phone: `1555${n}` })
const tables = ['auth.users', 'profiles', 'users', 'leads', 'guest_trials', 'usage', 'user_usage', 'subscriptions', 'discover_save_receipts', 'ci_research_controls']
const snapshot = () => tables.map(table => sql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM ${table} t`))
const count = (table, user) => Number(sql(`SELECT count(*) FROM ${table} WHERE user_id='${id(user)}'`))
const capacity = (user, limit, monthly) => JSON.parse(sql(`SET request.jwt.claim.role='service_role';SELECT get_discover_capacity('${id(user)}',${limit},${monthly})`))
const save = (run, user, limit, monthly, rows) => JSON.parse(sql(`SET request.jwt.claim.role='service_role';SELECT save_discover_results('${id(run)}','${id(user)}',${limit},${monthly},${literal(JSON.stringify(rows))})`))

const asyncSql = query => new Promise(resolve => {
  const child = spawn(psql, args(), { env: opts.env }); let out = '', err = ''
  child.stdout.on('data', v => { out += v }); child.stderr.on('data', v => { err += v })
  child.on('close', code => resolve({ code, out: out.trim(), err })); child.stdin.end(query)
})
async function waitForSleep(application) {
  const end = Date.now() + 3000
  while (Date.now() < end) {
    if (sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${application}' AND wait_event='PgSleep'`) === '1') return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Fixture did not reach transaction barrier')
}

test('billing migration application and safe rollback on the production-shaped legacy schema', { skip: !url && 'Requires disposable ALPA_TEST_DB_URL' }, async t => {
  sql(`CREATE DATABASE ${db}`, 'postgres')
  try {
    sql(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;`)
    // Entire catalog snapshot; only unavailable extension creation is omitted, not tables/triggers/grants.
    sql(fs.readFileSync('supabase/test-env/schema.sql', 'utf8').replace(/^CREATE EXTENSION.*$/gm, ''))
    sql(`INSERT INTO auth.users(id,email) VALUES ${Array.from({ length: 8 }, (_, i) => `('${id(i+1)}','legacy${i+1}@fixture.invalid')`).join(',')}`)
    sql(`SET request.jwt.claim.role='service_role';
      UPDATE profiles SET plan=CASE right(id::text,1) WHEN '3' THEN 'starter_100' WHEN '4' THEN 'pro' WHEN '5' THEN 'starter' WHEN '6' THEN 'prospector' WHEN '7' THEN 'admin' WHEN '8' THEN 'starter' ELSE 'free' END,
        plan_status=CASE WHEN right(id::text,1) IN ('1','2') THEN 'free' ELSE 'active' END,
        subscription_status=CASE WHEN right(id::text,1) IN ('1','2') THEN 'free' ELSE 'active' END,
        stripe_subscription_id=CASE WHEN right(id::text,1) IN ('3','4','5','6') THEN 'sub_fixture_'||right(id::text,1) END;
      INSERT INTO public.users(id,plan) SELECT id,'free' FROM profiles;
      INSERT INTO leads(id,user_id,company_name,phone,status,website_facts,light_profile)
        SELECT ('00000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','Legacy business '||n,'1555'||n,'inbox','{"title":"Preserve"}','{"summary":"Preserve guest intelligence"}' FROM generate_series(1,10) n;
      INSERT INTO leads(user_id,company_name,phone,status) SELECT '${id(2)}','Over limit '||n,'200'||n,'inbox' FROM generate_series(1,28) n;
      INSERT INTO leads(user_id,company_name,phone,status) SELECT id,'Paid retained','300','inbox' FROM profiles WHERE right(id::text,1) IN ('3','4','5','6');
      INSERT INTO leads(id,user_id,company_name,phone,status) VALUES('${id(500)}','${id(1)}','Unrecorded deleted business','500','inbox');DELETE FROM leads WHERE id='${id(500)}';
      INSERT INTO guest_trials(id,owner_user_id,leads,used,created_at) VALUES('${id(101)}','${id(1)}','[{"company_name":"Legacy business 1","phone":"15551","light_profile":{"summary":"Guest original"},"website_facts":{"title":"Guest original"}}]',1,now()-interval '40 days'),
        ('${id(102)}',NULL,'[{"company_name":"Unclaimed guest","phone":"guest","light_profile":{"summary":"Unclaimed original"}}]',1,now());
      INSERT INTO subscriptions(user_id,stripe_subscription_id,status,price_id) SELECT id,stripe_subscription_id,'active','price_fixture_legacy' FROM profiles WHERE stripe_subscription_id IS NOT NULL;
      INSERT INTO usage(user_id,leads_used,leads_limit,period_start,period_end) VALUES
        ('${id(3)}',99,100,now()-interval '3 days',now()+interval '20 days'),
        ('${id(4)}',499,500,now()-interval '3 days',now()+interval '20 days'),
        ('${id(5)}',450,500,now()-interval '3 days',now()+interval '20 days'),
        ('${id(6)}',119,120,now()-interval '3 days',now()+interval '20 days'),
        ('${id(1)}',20,25,now()-interval '2 months',now()-interval '1 month');
      INSERT INTO user_usage(user_id,leads_used,leads_limit) VALUES('${id(1)}',20,25);`)
    const outcomes = [1, 11, 12, 13, 14, 15].map(n => ({ status: 'saved', id: `00000000-0000-4000-8001-${String(n).padStart(12, '0')}` }))
    outcomes.push({ status: 'duplicate', id: id(999) }, { status: 'invalid', id: null }, { status: 'limit', id: null })
    sql(`INSERT INTO discover_save_receipts(run_id,user_id,request_hash,result) VALUES('${id(201)}','${id(1)}','fixture',${literal(JSON.stringify({ outcomes, leads_used: 6 }))}),('${id(202)}','${id(1)}','fixture-repeat',${literal(JSON.stringify({ outcomes: [outcomes[0]] }))});`)
    const before = snapshot()
    await t.test('read-only preflight distinguishes proven usage from aggregates and incomplete history', () => {
      const result = sql(read('20261020_billing_quota_preflight'))
      assert.match(result, /incomplete history: explicit baseline decision required/)
      assert.match(result, /manual\/legacy entitlement review/)
      assert.deepEqual(snapshot(), before)
    })
    await t.test('wrong order and malformed evidence abort without partial migration or data loss', () => {
      assert.throws(() => sql(guest), /Command failed/)
      assert.equal(sql("SELECT to_regclass('public.guest_import_claims') IS NULL"), 't')
      for (const result of [{}, { outcomes: [{ status: 'saved', id: 'not-a-uuid' }] }]) {
        sql(`UPDATE discover_save_receipts SET result=${literal(JSON.stringify(result))} WHERE run_id='${id(202)}'`)
        assert.throws(() => sql(pricing), /Command failed/)
        assert.equal(sql("SELECT to_regclass('public.business_allowance_ledger') IS NULL"), 't')
        assert.equal(sql("SELECT count(*) FROM pg_constraint WHERE conname='users_plan_check' AND pg_get_constraintdef(oid) LIKE '%starter_100%'"), '0')
      }
      sql(`UPDATE discover_save_receipts SET result=${literal(JSON.stringify({ outcomes: [outcomes[0]] }))} WHERE run_id='${id(202)}'`)
      assert.deepEqual(snapshot(), before)
    })
    await t.test('busy legacy writers cause a bounded atomic abort, not an unlocked backfill', async () => {
      const writer = asyncSql("SET application_name='quota_busy_fixture';BEGIN;LOCK TABLE leads IN ROW EXCLUSIVE MODE;SELECT pg_sleep(0.5);COMMIT;")
      await waitForSleep('quota_busy_fixture')
      assert.throws(() => sql(pricing.replace("lock_timeout = '5s'", "lock_timeout = '50ms'")), /Command failed/)
      assert.equal((await writer).code, 0)
      assert.equal(sql("SELECT to_regclass('public.business_allowance_ledger') IS NULL"), 't')
      assert.deepEqual(snapshot(), before)
    })
    await t.test('failure at pricing commit rolls back schema, backfill and function changes', () => {
      const priorCapacity = sql("SELECT pg_get_functiondef('get_discover_capacity(uuid,integer,boolean)'::regprocedure)")
      assert.throws(() => sql(pricing.replace('COMMIT;', 'SELECT 1/0;COMMIT;')), /Command failed/)
      assert.equal(sql("SELECT to_regclass('public.business_allowance_ledger') IS NULL"), 't')
      assert.equal(sql("SELECT pg_get_functiondef('get_discover_capacity(uuid,integer,boolean)'::regprocedure)"), priorCapacity)
      assert.deepEqual(snapshot(), before)
    })
    await t.test('locked pricing backfill recovers proven IDs and catches a write queued before trigger installation', async () => {
      const migration = asyncSql("SET application_name='quota_backfill_fixture';" + pricing.replace('CREATE FUNCTION public.record_business_allowance()', 'SELECT pg_sleep(0.5);CREATE FUNCTION public.record_business_allowance()'))
      await waitForSleep('quota_backfill_fixture')
      const writer = asyncSql(`SET request.jwt.claim.role='service_role';INSERT INTO leads(id,user_id,company_name,phone,status) VALUES('${id(600)}','${id(8)}','Concurrent retained','600','inbox')`)
      assert.equal((await migration).code, 0)
      assert.equal((await writer).code, 0)
      assert.equal(count('business_allowance_ledger', 1), 15)
      assert.equal(sql(`SELECT count(*) FROM business_allowance_ledger WHERE lead_id='${id(500)}'`), '0')
      assert.equal(sql(`SELECT count(*) FROM business_allowance_ledger WHERE lead_id='${id(600)}'`), '1')
      sql(`DELETE FROM leads WHERE id='${id(600)}'`)
      assert.deepEqual(snapshot(), before)
    })
    await t.test('failure at guest commit rolls back claims, backfill and RPC creation', () => {
      const ledger = sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,lead_id) FROM business_allowance_ledger t')
      assert.throws(() => sql(guest.replace('COMMIT;', 'SELECT 1/0;COMMIT;')), /Command failed/)
      assert.equal(sql("SELECT to_regclass('public.guest_import_claims') IS NULL"), 't')
      assert.equal(sql("SELECT to_regprocedure('claim_guest_businesses(uuid,uuid,jsonb)') IS NULL"), 't')
      assert.equal(sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,lead_id) FROM business_allowance_ledger t'), ledger)
      assert.deepEqual(snapshot(), before)
    })
    await t.test('guest migration refuses an inactive lifetime recording trigger', () => {
      sql('ALTER TABLE leads DISABLE TRIGGER record_business_allowance')
      assert.throws(() => sql(guest), /Command failed/)
      assert.equal(sql("SELECT to_regclass('public.guest_import_claims') IS NULL"), 't')
      sql('ALTER TABLE leads ENABLE TRIGGER record_business_allowance')
      assert.deepEqual(snapshot(), before)
    })
    await t.test('guest backfill preserves all legacy records, ownership, facts and profiles', () => {
      sql(guest)
      assert.equal(sql(`SELECT count(*) FROM guest_import_claims WHERE trial_id='${id(101)}' AND user_id='${id(1)}'`), '1')
      assert.equal(sql(`SELECT count(*) FROM guest_import_items WHERE trial_id='${id(101)}'`), '1')
      assert.deepEqual(snapshot(), before)
      assert.throws(() => sql(pricing), /Command failed/)
      assert.throws(() => sql(guest), /Command failed/)
      assert.deepEqual(snapshot(), before)
    })
    await t.test('Free enforces 25 proven lifetime businesses; existing over-limit libraries remain untouched', () => {
      assert.equal(capacity(1, PLANS.free.businesses, false).leads_used, 15)
      const result = save(301, 1, 25, false, Array.from({ length: 12 }, (_, n) => lead(1000 + n)))
      assert.equal(result.outcomes.filter(x => x.status === 'saved').length, 10)
      assert.equal(capacity(1, 25, false).leads_used, 25)
      sql(`SET request.jwt.claim.role='service_role';DELETE FROM leads WHERE user_id='${id(1)}'`)
      assert.equal(capacity(1, 25, false).leads_used, 25)
      assert.equal(save(302, 1, 25, false, [lead(1100)]).outcomes[0].status, 'limit')
      assert.equal(save(303, 2, 25, false, [lead(1101)]).outcomes[0].status, 'limit')
      assert.equal(count('leads', 2), 28)
    })
    await t.test('Starter 100 and Pro 500 enforce remaining capacity without resetting legacy monthly usage', () => {
      for (const [user, plan] of [[3, 'starter_100'], [4, 'pro']]) {
        const limit = PLANS[plan].businesses
        assert.equal(capacity(user, limit, true).leads_used, limit - 1)
        const r = save(310 + user, user, limit, true, [lead(user * 100), lead(user * 100 + 1)])
        assert.deepEqual(r.outcomes.map(x => x.status), ['saved', 'limit'])
        assert.equal(r.leads_used, limit)
      }
      assert.equal(capacity(5, PLANS.starter.businesses, true).leads_used, 450)
      assert.equal(capacity(6, PLANS.prospector.businesses, true).leads_used, 119)
      assert.equal(capacity(4, 100, true).leads_used, 500, 'downgrade retains already-used count')
      assert.equal(save(320, 4, 100, true, [lead(420)]).outcomes[0].status, 'limit')
      assert.equal(capacity(3, 500, true).leads_used, 100, 'upgrade retains count')
    })
    await t.test('operational rollback pauses all quota entry points while retaining every row and the recording trigger', () => {
      const existing = snapshot()
      const ledger = sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,lead_id) FROM business_allowance_ledger t')
      const claims = sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY trial_id) FROM guest_import_claims t')
      const items = sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY trial_id,item_key) FROM guest_import_items t')
      sql(pause)
      assert.deepEqual(snapshot(), existing)
      assert.equal(sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,lead_id) FROM business_allowance_ledger t'), ledger)
      assert.equal(sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY trial_id) FROM guest_import_claims t'), claims)
      assert.equal(sql('SELECT jsonb_agg(to_jsonb(t) ORDER BY trial_id,item_key) FROM guest_import_items t'), items)
      for (const query of ["get_discover_capacity('" + id(1) + "',25,false)", `save_discover_results('${id(390)}','${id(1)}',25,false,'[]')`, `claim_guest_businesses('${id(1)}','${id(101)}','[]')`]) {
        assert.throws(() => sql(`SET ROLE service_role;SET request.jwt.claim.role='service_role';SELECT ${query}`), /Command failed/)
      }
      assert.equal(sql("SELECT tgenabled FROM pg_trigger WHERE tgname='record_business_allowance'"), 'O')
      sql('GRANT EXECUTE ON FUNCTION get_discover_capacity(uuid,integer,boolean),save_discover_results(uuid,uuid,integer,boolean,jsonb),claim_guest_businesses(uuid,uuid,jsonb) TO service_role')
      assert.equal(capacity(1, 25, false).leads_used, 25)
      assert.equal(sql("SELECT has_function_privilege('authenticated','claim_guest_businesses(uuid,uuid,jsonb)','EXECUTE')"), 'f')
    })
  } finally { sql(`DROP DATABASE ${db} WITH (FORCE)`, 'postgres') }
})
