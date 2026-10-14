#!/usr/bin/env node
// Refuses to continue unless the environment is an isolated billing TEST environment. Reads the variables from the process environment
// (for example `set -a; . ./.env.stripe-test; set +a; node scripts/test-env/check-isolation.mjs`). It prints only yes/no results and
// the first characters of public identifiers; it never prints a key.
const PRODUCTION_PROJECT_REF = 'hnhptrqdirqofkwimapo' // the production Supabase project: must never be the test database

const env = process.env
const results = []
const check = (name, ok, hint) => results.push({ name, ok: Boolean(ok), hint })

const stripeKey = env.STRIPE_SECRET_KEY || ''
check('STRIPE_SECRET_KEY is a TEST-mode key (sk_test_...)', stripeKey.startsWith('sk_test_'), 'a live or missing key is refused')
check('no live Stripe key anywhere (STRIPE_*)', !Object.entries(env).some(([k, v]) => k.startsWith('STRIPE_') && /(sk|rk)_live_/.test(String(v))), 'remove it from this environment')
check('STRIPE_WEBHOOK_SECRET is set (whsec_...)', /^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || ''), 'from `stripe listen` or the test-mode endpoint')
check('STRIPE_STARTER_PRICE_ID is set', /^price_/.test(env.STRIPE_STARTER_PRICE_ID || ''), 'a TEST-mode price')
check('STRIPE_PROSPECTOR_PRICE_ID is set', /^price_/.test(env.STRIPE_PROSPECTOR_PRICE_ID || ''), 'a TEST-mode price')
check('the two prices differ', env.STRIPE_STARTER_PRICE_ID && env.STRIPE_STARTER_PRICE_ID !== env.STRIPE_PROSPECTOR_PRICE_ID, 'plans are told apart by price id')

let ref = ''
try { ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.split('.')[0] } catch { /* checked below */ }
check('NEXT_PUBLIC_SUPABASE_URL is a Supabase project', /^[a-z0-9]{20}$/.test(ref), 'https://<project-ref>.supabase.co')
check('the Supabase project is NOT production', ref && ref !== PRODUCTION_PROJECT_REF, 'a separate test project is required')
check('SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY are set', env.SUPABASE_SERVICE_ROLE_KEY && env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'from the TEST project')
check('NEXT_PUBLIC_APP_URL points at this machine', /^http:\/\/localhost:\d+$/.test(env.NEXT_PUBLIC_APP_URL || ''), 'http://localhost:3000, so Stripe returns here')
check('no paid-provider keys are configured (OPENAI/SERPER/GOOGLE)', !env.OPENAI_API_KEY && !env.SERPER_API_KEY && !env.GOOGLE_PLACES_API_KEY, 'the billing tests seed guest data instead of running paid discovery')

const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${r.hint}`}`)
if (ref) console.log(`\nSupabase project: ${ref.slice(0, 4)}…  Stripe mode: ${stripeKey.startsWith('sk_test_') ? 'test' : 'NOT test'}`)
console.log(failed.length ? `\n${failed.length} check(s) failed: this is not a safe billing test environment.` : '\nIsolated test environment confirmed.')
process.exit(failed.length ? 1 : 0)
