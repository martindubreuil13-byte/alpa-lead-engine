// Email confirmation in the isolated authentication release: the rules behind /auth/confirm and /auth/continue, with a fake Supabase client.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import test from 'node:test'

import {
  CONFIRM_PATH, CONFIRM_PROBLEMS, FREE_DESTINATION, PAID_DESTINATION, confirmRedirectUrl, destinationForPlan, parseConfirmationLink, requestConfirmationResend, signupOptions,
} from '../lib/auth/email-confirmation.ts'
import { CANONICAL_ORIGIN, establishSessionFromLink, parseRecoveryLink } from '../lib/auth/password-reset.ts'

const here = new URL('..', import.meta.url).pathname
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const err = (extra) => Object.assign(new Error(extra.message ?? 'x'), extra)
const REDIRECT = `${CANONICAL_ORIGIN}/auth/confirm`

test('redirect: the confirmation link returns only to our own confirmation page on an allow-listed origin', () => {
  const url = (o, extra = {}) => confirmRedirectUrl({ origin: o, production: true, ...extra })
  assert.equal(url(CANONICAL_ORIGIN), REDIRECT)
  for (const bad of ['https://evil.example', 'https://alpa.mindrasolutions.com.evil.example', 'http://alpa.mindrasolutions.com', 'javascript:alert(1)', null]) assert.equal(url(bad), REDIRECT, String(bad))
  assert.equal(url('http://localhost:3000'), REDIRECT, 'localhost is not allowed in production')
  assert.equal(confirmRedirectUrl({ origin: 'http://localhost:3305', production: false }), 'http://localhost:3305/auth/confirm')
  assert.equal(CONFIRM_PATH, '/auth/confirm')
})

test('sign-up passes Supabase only the address the link returns to: no plan, no price, nothing about the customer', () => {
  assert.deepEqual(signupOptions({ emailRedirectTo: REDIRECT }), { emailRedirectTo: REDIRECT })
  assert.deepEqual(Object.keys(signupOptions({ emailRedirectTo: REDIRECT })), ['emailRedirectTo'])
})

test('destination: the workspace, or the dashboard for a paid plan, exactly as after the login form; nothing else is ever returned', () => {
  assert.equal(FREE_DESTINATION, '/dashboard/scraper'); assert.equal(PAID_DESTINATION, '/dashboard')
  for (const plan of ['prospector', 'starter', 'pro', 'admin']) assert.equal(destinationForPlan(plan), '/dashboard', plan)
  for (const plan of ['free', '', null, undefined, 'enterprise', '<script>', 42, {}, ['starter']]) assert.equal(destinationForPlan(plan), '/dashboard/scraper', JSON.stringify(plan))
})

test('link: a confirmation link is read in each shape, and a password-reset link is not a confirmation link', () => {
  const link = (search = '', hash = '') => parseConfirmationLink({ search, hash })
  assert.deepEqual(link('?code=abcd1234-efgh'), { kind: 'code', code: 'abcd1234-efgh' })
  assert.deepEqual(link('?token_hash=abcdefgh12345678&type=signup'), { kind: 'token_hash', tokenHash: 'abcdefgh12345678', otpType: 'signup' })
  assert.deepEqual(link('?token_hash=abcdefgh12345678&type=email'), { kind: 'token_hash', tokenHash: 'abcdefgh12345678', otpType: 'email' })
  assert.deepEqual(link('', '#access_token=a.b.c&refresh_token=r&type=signup'), { kind: 'implicit' })
  assert.deepEqual(link('?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), { kind: 'error', reason: 'expired' })
  assert.deepEqual(link('', '#error=access_denied&error_code=otp_expired'), { kind: 'error', reason: 'expired' })
  assert.deepEqual(link('?error=server_error'), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(link(), { kind: 'none' })
  assert.deepEqual(link('?token_hash=abcdefgh12345678&type=recovery'), { kind: 'error', reason: 'invalid' }, 'a reset link cannot be used to confirm')
  assert.deepEqual(link('?token_hash=abcdefgh12345678&type=magiclink'), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(link('?code=<script>'), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(link('', '#access_token=a.b.c&type=recovery'), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(parseRecoveryLink({ search: '?token_hash=abcdefgh12345678&type=recovery', hash: '' }), { kind: 'token_hash', tokenHash: 'abcdefgh12345678' })
  assert.deepEqual(parseRecoveryLink({ search: '?token_hash=abcdefgh12345678&type=signup', hash: '' }), { kind: 'error', reason: 'invalid' }, 'and the reset page refuses a confirmation link')
})

function fakeClient({ initializeError = null, sessionAfter = 'confirmed-session', verify } = {}) {
  let session = null
  const calls = { initialize: 0, verify: [] }
  return { calls, auth: {
    initialize: async () => { calls.initialize += 1; if (!initializeError) session = sessionAfter ? { access_token: sessionAfter } : null; return { error: initializeError } },
    getSession: async () => ({ data: { session } }),
    verifyOtp: async (params) => { calls.verify.push(params); return verify ? verify(params) : { data: { session: { access_token: 'otp-session' } }, error: null } },
  } }
}

test('session, original browser: the code from the email becomes a session once the client has read it', async () => {
  assert.equal(await establishSessionFromLink(fakeClient(), { kind: 'code', code: 'abcd1234' }, { hasVerifier: true }), 'ready')
})

test('session, different browser: a code link says the email is confirmed and asks the customer to log in; a token link signs them in there', async () => {
  const client = fakeClient()
  assert.equal(await establishSessionFromLink(client, { kind: 'code', code: 'abcd1234' }, { hasVerifier: false }), 'other_browser')
  assert.equal(client.calls.initialize, 0)
  assert.match(CONFIRM_PROBLEMS.other_browser.title, /confirmed/i); assert.match(CONFIRM_PROBLEMS.other_browser.text, /log in/i)
  const phone = fakeClient()
  assert.equal(await establishSessionFromLink(phone, { kind: 'token_hash', tokenHash: 'abcdefgh12345678', otpType: 'signup' }), 'ready')
  assert.deepEqual(phone.calls.verify, [{ type: 'signup', token_hash: 'abcdefgh12345678' }], 'the link names its own kind')
})

test('session: expired, already used and malformed links are explained and never accepted, whoever is signed in', async () => {
  const fail = (e) => fakeClient({ initializeError: err(e), sessionAfter: 'existing-login' })
  assert.equal(await establishSessionFromLink(fail({ code: 'otp_expired', message: 'Email link is invalid or has expired' }), { kind: 'code', code: 'abcd1234' }), 'expired')
  assert.equal(await establishSessionFromLink(fail({ code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found' }), { kind: 'code', code: 'abcd1234' }), 'expired')
  const expired = fakeClient({ verify: async () => ({ data: null, error: err({ code: 'otp_expired', message: 'Email link is invalid or has expired' }) }) })
  assert.equal(await establishSessionFromLink(expired, { kind: 'token_hash', tokenHash: 'abcdefgh12345678', otpType: 'signup' }), 'expired')
  assert.equal(await establishSessionFromLink(fakeClient(), { kind: 'error', reason: 'expired' }), 'expired')
  assert.equal(await establishSessionFromLink(fakeClient(), { kind: 'error', reason: 'invalid' }), 'invalid')
  const none = fakeClient()
  assert.equal(await establishSessionFromLink(none, { kind: 'none' }), 'none')
  assert.deepEqual([none.calls.initialize, none.calls.verify.length], [0, 0], 'no link, no request')
  assert.match(CONFIRM_PROBLEMS.expired.text, /log in/i); assert.match(CONFIRM_PROBLEMS.expired.text, /new link/i)
})

test('resend: a new link answers the same way whether or not the address is waiting, trims the address and returns only to the allow-listed page', async () => {
  const calls = []
  const client = (error) => ({ auth: { resend: async (params) => { calls.push(params); return { error } }, signUp: () => assert.fail('no sign-up') } })
  assert.deepEqual(await requestConfirmationResend(client(null), '  Jo@Example.com ', REDIRECT), { kind: 'sent' })
  assert.deepEqual(calls, [{ type: 'signup', email: 'Jo@Example.com', options: { emailRedirectTo: REDIRECT } }])
  assert.deepEqual(await requestConfirmationResend(client(err({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 30 seconds.' })), 'a@b.co', REDIRECT), { kind: 'sent' })
  assert.deepEqual(await requestConfirmationResend(client(err({ status: 500, message: 'Error sending confirmation email' })), 'a@b.co', REDIRECT), { kind: 'sent' })
  assert.deepEqual(await requestConfirmationResend(client(err({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })), 'a@b.co', REDIRECT), { kind: 'rate_limited' })
  const before = calls.length
  assert.deepEqual(await requestConfirmationResend(client(null), 'not-an-email', REDIRECT), { kind: 'invalid_email' })
  assert.equal(calls.length, before, 'an invalid address never reaches the service')
})

test('wiring: the Supabase client is started after the address is saved; both link pages read the saved address and clean the bar', () => {
  const supabase = read('lib/supabase.ts')
  assert.ok(supabase.indexOf("import '@/lib/auth/initial-url'") < supabase.indexOf('createBrowserClient('), 'the address is saved before the client can remove the one-time code')
  for (const file of ['app/auth/confirm/page.tsx', 'app/auth/reset/page.tsx']) {
    const page = read(file)
    assert.match(page, /takeInitialAuthUrl\(\)/, file); assert.match(page, /replaceState\(null, '', /, file)
    assert.ok(page.indexOf('establishSessionFromLink(') < page.indexOf('replaceState(') || page.indexOf('establishRecoverySession(') < page.indexOf('replaceState('), `${file}: the address is cleaned only after the client has finished reading it (cleaning it first hides the code from the client)`)
    assert.doesNotMatch(page, /console\.|trackEvent|localStorage\.setItem|sessionStorage\.setItem/, file)
  }
  assert.match(read('lib/auth/initial-url.ts'), /code-verifier/)
})

test('wiring: sign-up names the confirmation page, a signed-in visitor on /login is taken on, and the guest hand-over is the login form\'s own request', () => {
  const login = read('app/login/page.tsx')
  assert.match(login, /options: signupOptions\(\{ emailRedirectTo: confirmRedirectUrl\(/)
  assert.match(login, /router\.replace\('\/auth\/continue'\)/)
  const claim = read('lib/guest/claim-client.ts')
  assert.match(claim, /fetch\('\/api\/guest\/claim', \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \} \}\)/, 'no body: nothing from the browser')
  assert.doesNotMatch(claim, /body:|localStorage|leads/i)
})

test('guest hand-over: a failure keeps everything and offers a retry; "nothing to claim" is not a failure; guest state is cleared only after a non-failure', () => {
  const claim = read('lib/guest/claim-client.ts')
  assert.match(claim, /res\.status === 401 \|\| res\.status === 410\) return 'nothing'/)
  assert.match(claim, /if \(!res\.ok\) return 'failed'/); assert.match(claim, /catch \{\s*return 'failed'/)
  assert.match(claim, /if \(status !== 'failed'\) clearGuestTrialMode\(\)/)
  const panel = read('components/auth/HandOverPanel.tsx')
  assert.match(panel, /Try again/); assert.match(panel, /still saved in this browser/); assert.match(panel, /role="alert"/)
  assert.match(panel, /if \(status === 'failed'\) return void setFailed\(true\)/, 'it does not move on silently')
})

test('the release is isolated: no billing, checkout, pricing, Stripe, migration or research change, and no new dependency', () => {
  const changed = execFileSync('git', ['diff', '--name-only', '7712ed3', 'HEAD'], { encoding: 'utf8', cwd: here }).split('\n').filter(Boolean)
  const staged = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: here }).split('\n').filter(Boolean).map((line) => line.slice(3))
  for (const file of [...changed, ...staged]) {
    assert.doesNotMatch(file, /stripe|checkout|billing|pricing|plans|migrations|supabase\/|package(-lock)?\.json|\.env|api\/scrape|commercial-intelligence|research|resolve-user-subscription/i, `${file} is outside the authentication release`)
  }
  const code = ['lib/auth/email-confirmation.ts', 'lib/auth/continue-client.ts', 'lib/auth/password-reset.ts', 'app/auth/confirm/page.tsx', 'app/auth/continue/page.tsx', 'app/auth/reset/page.tsx', 'components/auth/ResendConfirmationForm.tsx', 'components/auth/ForgotPasswordForm.tsx', 'components/auth/HandOverPanel.tsx']
    .map((file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '')).join('\n')
  assert.doesNotMatch(code, /stripe|entitle|pending-plan|checkout\/start|supabase\.from\(|\.rpc\(|createAdminClient|service_role/i)
  assert.equal(fs.readdirSync(new URL('../supabase/migrations', import.meta.url)).includes('20261023_auth.sql'), false)
})
