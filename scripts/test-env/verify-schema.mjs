#!/usr/bin/env node
// Loads supabase/test-env/schema.sql into an EMPTY in-process Postgres (PGlite, no network, no Supabase) and checks it:
//   1. it initialises an empty database with no error (with the Supabase-managed pieces stubbed: auth schema and the three roles),
//   2. the catalog fingerprint can be printed and compared with production's (scripts/test-env/catalog-fingerprint.sql),
//   3. behaviour checks: the sign-up trigger creates a profile; row-level security hides one customer's rows from another and from
//      anonymous callers; service-role-only functions refuse customers.
// Usage: node scripts/test-env/verify-schema.mjs [--fingerprint]      (needs: npm i --no-save @electric-sql/pglite@0.2.17)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { PGlite } = await import('@electric-sql/pglite').catch(() => { console.error('PGlite is not installed: npm i --no-save @electric-sql/pglite@0.2.17'); process.exit(2) })

const db = new PGlite()
// What a Supabase project already provides.
await db.exec(`
  create schema if not exists auth;
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`)
// PGlite is PostgreSQL 16 without extensions: MAINTAIN is a 17-only privilege, and pgcrypto / uuid-ossp are not needed (gen_random_uuid is built in).
const sql = fs.readFileSync(path.join(root, 'supabase/test-env/schema.sql'), 'utf8').replace(/^CREATE EXTENSION.*$/gm, '').replace(/MAINTAIN, /g, '').replace(/, MAINTAIN/g, '').replace(/GRANT MAINTAIN, SELECT/g, 'GRANT SELECT')
let step = 'load'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`) }

try {
  await db.exec(sql)
  check('schema.sql initialises an empty database without error', true)
} catch (error) {
  check('schema.sql initialises an empty database without error', false, String(error.message))
  process.exit(1)
}

if (process.argv.includes('--fingerprint')) {
  const fingerprint = fs.readFileSync(path.join(root, 'scripts/test-env/catalog-fingerprint.sql'), 'utf8')
  await db.exec('set search_path = public')
  for (const row of (await db.query(fingerprint.replace(/;\s*$/, ''))).rows) console.log(`FP ${row.part} ${row.value}`)
}

const count = async (text) => Number((await db.query(text)).rows[0].n)
check('34 public tables', (await count("select count(*) n from pg_tables where schemaname='public'")) === 34)
check('35 functions', (await count("select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')")) === 35)
check('42 row-level-security policies', (await count("select count(*) n from pg_policies where schemaname='public'")) === 42)
check('92 constraints', (await count("select count(*) n from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'")) === 92)
check('every table has row-level security on', (await count("select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")) === 0)
check('the research controls start OFF with no limits and nobody allowed', (await count("select count(*) n from public.ci_research_controls where enabled = false and allow_all_customers = false and cardinality(allowed_user_ids) = 0 and global_monthly_limit_usd is null")) === 1)
check('no data was copied: every table except the controls row is empty', (await count("select (select count(*) from public.profiles) + (select count(*) from public.leads) + (select count(*) from public.guest_trials) + (select count(*) from public.subscriptions) + (select count(*) from public.users) as n")) === 0)

const as = async (role, sub, text) => { await db.exec(`select set_config('request.jwt.claim.role','${role}',false); select set_config('request.jwt.claim.sub','${sub ?? ''}',false); set role ${role === 'service_role' ? 'service_role' : role}`); try { return await db.query(text) } finally { await db.exec('reset role') } }
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
await db.exec(`insert into auth.users(id, email) values ('${A}', 'a@test.example'), ('${B}', 'b@test.example')`)
check('signing up creates a free profile through the trigger', (await count(`select count(*) n from public.profiles where id in ('${A}','${B}') and plan = 'free'`)) === 2)
await db.exec(`insert into public.leads(user_id, company_name, email, status) values ('${A}', 'A Corp', 'a@x.test', 'inbox'), ('${B}', 'B Corp', 'b@x.test', 'inbox')`)
check('a customer sees only their own leads', (await as('authenticated', A, 'select company_name from public.leads')).rows.map((r) => r.company_name).join() === 'A Corp')
check('a customer sees only their own profile', (await as('authenticated', A, 'select id from public.profiles')).rows.map((r) => r.id).join() === A)
check('an anonymous caller sees nothing', (await as('anon', null, 'select 1 from public.leads limit 1').catch(() => ({ rows: [] }))).rows.length === 0)
let denied = false
try { await as('authenticated', A, 'select * from public.guest_trials') } catch { denied = true }
check('guest trials are not readable by customers', denied)
denied = false
try { await as('authenticated', A, "update public.profiles set plan = 'starter' where id = '" + A + "'") } catch { denied = true }
check('a customer cannot upgrade their own plan', denied)
denied = false
try { await as('authenticated', A, "select public.set_ci_research_enabled(true, 'x')") } catch { denied = true }
check('operator functions refuse customers', denied)
check('the service role can read profiles', (await as('service_role', null, 'select id from public.profiles')).rows.length === 2)

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n${failed.length} check(s) failed.` : `\nAll ${results.length} checks passed.`)
process.exit(failed.length ? 1 : 0)
