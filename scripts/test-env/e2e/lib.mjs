// Helpers for the Stripe TEST-mode end-to-end run. Everything reads its configuration from the process environment (sourced from
// the private .env.stripe-test file) and refuses to run unless the isolation checks hold. Nothing here prints a credential.
import crypto from 'node:crypto'
import fs from 'node:fs'

const env = process.env
export const BASE = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
export const PORT = Number(new URL(BASE).port || 3000)
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
export const REF = new URL(SUPABASE_URL).hostname.split('.')[0]
export const PROD_REF = 'hnhptrqdirqofkwimapo'
export const PRICES = { starter: env.STRIPE_STARTER_PRICE_ID, prospector: env.STRIPE_PROSPECTOR_PRICE_ID }

export function assertIsolated() {
  const problems = []
  if (!String(env.STRIPE_SECRET_KEY).startsWith('sk_test_')) problems.push('Stripe key is not a test key')
  if (REF === PROD_REF) problems.push('Supabase project is production')
  if (REF !== 'xkvraadbvfjlcohdpspg') problems.push('Supabase project is not alpa-billing-test')
  if (!/^http:\/\/localhost:\d+$/.test(BASE)) problems.push('app URL is not local')
  for (const k of ['OPENAI_API_KEY', 'SERPER_API_KEY', 'GOOGLE_PLACES_API_KEY']) if (env[k]) problems.push(`${k} is set`)
  if (Object.entries(env).some(([k, v]) => k.startsWith('STRIPE_') && /(sk|rk)_live_/.test(String(v)))) problems.push('a live Stripe key is loaded')
  if (problems.length) throw new Error('ISOLATION FAILED: ' + problems.join('; '))
}

const svc = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...svc, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST ${method} ${path.split('?')[0]} -> ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}
export const rows = (table, query = '') => rest(`${table}?${query}`)

export async function authAdmin(path, body, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, { method, headers: { ...svc, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`auth admin ${path} -> ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}
export const PASSWORD = 'Billing-Test-Pass-1!'
export async function createUser(email, { confirm = true } = {}) {
  return authAdmin('users', { email, password: PASSWORD, email_confirm: confirm })
}
export async function deleteUser(id) { return authAdmin(`users/${id}`, null, 'DELETE').catch(() => null) }
export async function signIn(email, password = PASSWORD) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const data = await res.json()
  if (!res.ok) throw new Error(`sign-in failed ${res.status}: ${data.error_description || data.msg || ''}`)
  return data
}
// The cookie the app's server reads for a signed-in browser (chunked at 3180 characters like @supabase/ssr).
export function sessionCookies(session) {
  const name = `sb-${REF}-auth-token`
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  const base = { domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' }
  if (value.length <= 3180) return [{ name, value, ...base }]
  const parts = value.match(/.{1,3180}/g)
  return parts.map((v, i) => ({ name: `${name}.${i}`, value: v, ...base }))
}
export const guestCookie = (id) => ({ name: 'alpa_guest_trial', value: `${id}.${crypto.createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update(`guest-session:${id}`).digest('hex')}`, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })

export async function stripe(path, params = {}, method = 'GET') {
  const form = new URLSearchParams()
  const add = (k, v) => { if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) add(`${k}[${kk}]`, vv); else form.append(k, String(v)) }
  for (const [k, v] of Object.entries(params)) add(k, v)
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && form.size ? `?${form}` : ''}`
  const res = await fetch(url, { method, headers: { Authorization: `Basic ${Buffer.from(env.STRIPE_SECRET_KEY + ':').toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : form })
  const data = await res.json()
  if (!res.ok) throw new Error(`Stripe ${method} ${path} -> ${res.status} ${data.error?.message}`)
  return data
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function waitFor(fn, { timeout = 60000, every = 1000, what = 'condition' } = {}) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { try { last = await fn(); if (last) return last } catch (e) { last = e } await sleep(every) }
  throw new Error(`timed out waiting for ${what}`)
}

export const profileOf = async (id) => (await rows('profiles', `id=eq.${id}&select=id,plan,plan_status,subscription_tier,stripe_customer_id,stripe_subscription_id,cancel_at_period_end`))[0] ?? null
export const leadsOf = (id) => rows('leads', `user_id=eq.${id}&select=id,company_name,email,phone,website,city,light_profile,website_facts&order=company_name`)

// ---- the results table
export const results = []
export async function scenario(name, fn) {
  const started = Date.now()
  try { const detail = await fn(); results.push({ name, ok: true, detail }); console.log(`PASS  ${name}${detail ? `\n        ${detail}` : ''}`) }
  catch (error) { results.push({ name, ok: false, detail: String(error.message).slice(0, 400) }); console.log(`FAIL  ${name}\n        ${String(error.message).slice(0, 400)}`) }
  void started
}
export function check(cond, message) { if (!cond) throw new Error(message) }
// Where the runner keeps its app log and the file that records refused Stripe attempts (never inside the repository).
import os from 'node:os'
import path from 'node:path'
import { execSync, spawn } from 'node:child_process'
export const E2E_DIR = process.env.E2E_DIR || path.join(os.tmpdir(), 'alpa-e2e')
fs.mkdirSync(E2E_DIR, { recursive: true })
export const listenLog = path.join(E2E_DIR, 'listen.log')
export const blockedLog = path.join(E2E_DIR, 'blocked.log')
/** Stops whatever listens on the app's port and starts `next start` there from the current directory, optionally with every Stripe request refused. */
export async function restartApp({ blockStripe = false } = {}) {
  try { execSync(`kill $(lsof -ti tcp:${PORT} -sTCP:LISTEN) 2>/dev/null || true`, { shell: '/bin/sh' }) } catch { /* nothing was listening */ }
  await sleep(2500)
  fs.writeFileSync(blockedLog, '')
  const log = fs.openSync(path.join(E2E_DIR, 'app.log'), 'a')
  const child = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: process.cwd(), detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, ...(blockStripe ? { NODE_OPTIONS: `--require ${process.cwd()}/tests/helpers/stripe-sandbox.cjs`, STRIPE_BLOCK_LOG: blockedLog } : {}) },
  })
  child.unref()
  await waitFor(async () => (await fetch(`${BASE}/login`)).status === 200, { timeout: 60000, what: 'app restart' })
}
export const refusedStripeAttempts = () => fs.readFileSync(blockedLog, 'utf8').trim().split('\n').filter(Boolean).length
export function webhookDeliveries() {
  if (!fs.existsSync(listenLog)) return []
  const text = fs.readFileSync(listenLog, 'utf8')
  const out = []
  for (const m of text.matchAll(/<--\s+\[(\d+)\] POST [^\s]+ \[(evt_[A-Za-z0-9]+)\]/g)) out.push({ status: Number(m[1]), id: m[2] })
  const typeOf = new Map([...text.matchAll(/-->\s+([a-z_.]+) \[(evt_[A-Za-z0-9]+)\]/g)].map((m) => [m[2], m[1]]))
  return out.map((d) => ({ ...d, type: typeOf.get(d.id) }))
}
