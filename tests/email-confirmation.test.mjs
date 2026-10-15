// Email confirmation and the plan chosen before the account existed: the rules behind the screens, with a fake Supabase client.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  CONFIRM_PROBLEMS, CONFIRM_PATH, FREE_DESTINATION, confirmRedirectUrl, destinationAfterConfirmation, parseConfirmationLink, pendingFromUserMetadata,
  requestConfirmationResend, signupOptions,
} from '../lib/auth/email-confirmation.ts'
import { CANONICAL_ORIGIN, establishSessionFromLink, parseRecoveryLink } from '../lib/auth/password-reset.ts'

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

test('sign-up: a chosen plan is saved with the account, validated against the allow-list; nothing else is ever saved', () => {
  assert.deepEqual(signupOptions({ plan: 'starter', source: 'plans_featured', emailRedirectTo: REDIRECT }), { emailRedirectTo: REDIRECT, data: { pending_plan: 'starter', pending_source: 'plans_featured' } })
  assert.deepEqual(signupOptions({ plan: 'prospector', source: 'x y<script>', emailRedirectTo: REDIRECT }).data, { pending_plan: 'prospector', pending_source: 'upgrade' }, 'the source label is sanitised')
  for (const plan of [undefined, null, '', 'free', 'pro', 'admin', 'enterprise', '<script>', 'STARTER', 1, {}, ['starter']]) {
    assert.deepEqual(signupOptions({ plan, source: 'plans', emailRedirectTo: REDIRECT }), { emailRedirectTo: REDIRECT }, `${JSON.stringify(plan)} is not stored`)
  }
  const keys = Object.keys(signupOptions({ plan: 'starter', source: 'a', emailRedirectTo: REDIRECT }).data).sort()
  assert.deepEqual(keys, ['pending_plan', 'pending_source'], 'no price, entitlement or role is ever written')
})

test('metadata: only a named plan is read back; the rest of the (customer-editable) metadata is ignored', () => {
  assert.deepEqual(pendingFromUserMetadata({ pending_plan: 'starter', pending_source: 'plans' }), { plan: 'starter', source: 'plans' })
  assert.deepEqual(pendingFromUserMetadata({ pending_plan: 'prospector' }), { plan: 'prospector', source: 'upgrade' })
  for (const meta of [null, undefined, 'x', 42, [], {}, { pending_plan: 'admin' }, { pending_plan: 'free' }, { pending_plan: 'starter ' }, { plan: 'starter' }, { price: 0, pending_plan: 99 }, { pending_plan: { plan: 'starter' } }]) {
    assert.equal(pendingFromUserMetadata(meta), null, JSON.stringify(meta))
  }
  assert.deepEqual(pendingFromUserMetadata({ pending_plan: 'starter', price_id: 'price_free', plan_status: 'active', role: 'admin', subscription_active: true }), { plan: 'starter', source: 'upgrade' }, 'extra fields change nothing')
})

test('destination: finishing a payment, then a plan chosen in this browser, then the plan saved with the account, then the free workspace', () => {
  const dest = (over) => destinationAfterConfirmation({ next: null, browserPending: null, userMetadata: null, ...over })
  assert.equal(dest({}), FREE_DESTINATION); assert.equal(FREE_DESTINATION, '/dashboard/scraper')
  assert.equal(dest({ userMetadata: { pending_plan: 'prospector', pending_source: 'plans_featured' } }), '/checkout/start?plan=prospector&source=plans_featured', 'confirmed on another device: the account\'s plan continues')
  assert.equal(dest({ browserPending: { plan: 'starter', source: 'plans' }, userMetadata: { pending_plan: 'prospector' } }), '/checkout/start?plan=starter&source=plans', 'a choice made in this browser is the more recent')
  assert.equal(dest({ next: '/post-checkout?session_id=cs_test_123', userMetadata: { pending_plan: 'prospector' } }), '/post-checkout?session_id=cs_test_123', 'finishing a payment comes first')
  for (const next of ['https://evil.example', '//evil.example', '/dashboard', 'javascript:alert(1)', '/post-checkout?session_id=<x>']) assert.equal(dest({ next }), FREE_DESTINATION, `${next} is not an allowed place to go`)
  assert.equal(dest({ userMetadata: { pending_plan: 'enterprise' } }), FREE_DESTINATION, 'an unknown plan never reaches checkout')
  for (const d of [dest({}), dest({ userMetadata: { pending_plan: 'starter' } })]) assert.match(d, /^\/(dashboard|checkout)\//, 'only addresses built here are returned')
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
  // and the reset page still reads reset links exactly as before, and refuses confirmation links
  assert.deepEqual(parseRecoveryLink({ search: '?token_hash=abcdefgh12345678&type=recovery', hash: '' }), { kind: 'token_hash', tokenHash: 'abcdefgh12345678' })
  assert.deepEqual(parseRecoveryLink({ search: '?token_hash=abcdefgh12345678&type=signup', hash: '' }), { kind: 'error', reason: 'invalid' })
})

// A fake of the pieces of the Supabase client the page uses.
function fakeClient({ before = null, autoDetect = false, exchange, verify } = {}) {
  let session = before ? { access_token: before } : null
  const calls = { exchange: 0, verify: [] }
  const set = (token) => { session = { access_token: token } }
  const client = { calls, auth: {
    getSession: async () => ({ data: { session } }),
    exchangeCodeForSession: async (code) => { calls.exchange += 1; return exchange ? exchange(code, set) : { error: null } },
    verifyOtp: async (params) => { calls.verify.push(params); return verify ? verify(params, set) : { error: null } },
  } }
  if (autoDetect) setTimeout(() => set('confirmed-session'), 100)
  return client
}
const fast = { timeoutMs: 800, pollMs: 20, manualAfterMs: 300 }

test('session, original browser: the code from the email becomes a session (by itself or by hand)', async () => {
  assert.equal(await establishSessionFromLink(fakeClient({ autoDetect: true }), { kind: 'code', code: 'abcd1234' }, fast), 'ready')
  const manual = fakeClient({ exchange: async (code, set) => { assert.equal(code, 'abcd1234'); set('from-code'); return { error: null } } })
  assert.equal(await establishSessionFromLink(manual, { kind: 'code', code: 'abcd1234' }, fast), 'ready')
})

test('session, different browser: the link can still sign the customer in (token form), or says the email is confirmed and asks them to log in (code form)', async () => {
  const phone = fakeClient({ verify: async (p, set) => { set('phone-session'); return { error: null } } })
  assert.equal(await establishSessionFromLink(phone, { kind: 'token_hash', tokenHash: 'abcdefgh12345678', otpType: 'signup' }, fast), 'ready')
  assert.deepEqual(phone.calls.verify, [{ type: 'signup', token_hash: 'abcdefgh12345678' }], 'the link names its own kind')
  assert.equal(phone.calls.exchange, 0)
  const noVerifier = fakeClient({ exchange: async () => ({ error: err({ name: 'AuthPKCECodeVerifierMissingError', message: 'PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device' }) }) })
  assert.equal(await establishSessionFromLink(noVerifier, { kind: 'code', code: 'abcd1234' }, fast), 'other_browser')
  assert.match(CONFIRM_PROBLEMS.other_browser.title, /confirmed/i); assert.match(CONFIRM_PROBLEMS.other_browser.text, /log in/i)
  assert.match(CONFIRM_PROBLEMS.other_browser.text, /plan choice is saved with your account/i)
})

test('session: expired, already used and malformed links are explained and never accepted; someone already signed in does not make them look valid', async () => {
  const expired = fakeClient({ verify: async () => ({ error: err({ code: 'otp_expired', message: 'Email link is invalid or has expired' }) }) })
  assert.equal(await establishSessionFromLink(expired, { kind: 'token_hash', tokenHash: 'abcdefgh12345678', otpType: 'signup' }, fast), 'expired')
  const used = fakeClient({ exchange: async () => ({ error: err({ code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found' }) }) })
  assert.equal(await establishSessionFromLink(used, { kind: 'code', code: 'abcd1234' }, fast), 'expired')
  assert.equal(await establishSessionFromLink(fakeClient(), { kind: 'error', reason: 'expired' }, fast), 'expired')
  assert.equal(await establishSessionFromLink(fakeClient(), { kind: 'error', reason: 'invalid' }, fast), 'invalid')
  const signedIn = fakeClient({ before: 'existing-login', exchange: async () => ({ error: err({ code: 'otp_expired', message: 'expired' }) }) })
  assert.equal(await establishSessionFromLink(signedIn, { kind: 'code', code: 'abcd1234' }, fast), 'expired', 'the existing login is not the link\'s session')
  const none = fakeClient()
  assert.equal(await establishSessionFromLink(none, { kind: 'none' }, fast), 'none')
  assert.deepEqual([none.calls.exchange, none.calls.verify.length], [0, 0], 'no link, no request')
  assert.match(CONFIRM_PROBLEMS.expired.text, /log in/i); assert.match(CONFIRM_PROBLEMS.expired.text, /new link/i)
})

test('resend: a new link answers the same way whether or not the address is waiting, trims the address and returns only to the allow-listed page', async () => {
  const calls = []
  const client = (error) => ({ auth: { resend: async (params) => { calls.push(params); return { error } }, signUp: () => assert.fail('no sign-up') } })
  assert.deepEqual(await requestConfirmationResend(client(null), '  Jo@Example.com ', REDIRECT), { kind: 'sent' })
  assert.deepEqual(calls, [{ type: 'signup', email: 'Jo@Example.com', options: { emailRedirectTo: REDIRECT } }])
  assert.deepEqual(await requestConfirmationResend(client(err({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 30 seconds.' })), 'a@b.co', REDIRECT), { kind: 'sent' }, 'the per-address wait is not shown')
  assert.deepEqual(await requestConfirmationResend(client(err({ status: 500, message: 'Error sending confirmation email' })), 'a@b.co', REDIRECT), { kind: 'sent' }, 'a failed send is not shown')
  assert.deepEqual(await requestConfirmationResend(client(err({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })), 'a@b.co', REDIRECT), { kind: 'rate_limited' })
  const before = calls.length
  assert.deepEqual(await requestConfirmationResend(client(null), 'not-an-email', REDIRECT), { kind: 'invalid_email' })
  assert.equal(calls.length, before, 'an invalid address never reaches the service')
  assert.deepEqual(await requestConfirmationResend({ auth: { resend: async () => { throw err({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }) } } }, 'a@b.co', REDIRECT), { kind: 'unavailable' })
})

test('wiring: sign-up saves the plan and the confirmation address; sign-in and checkout use the plan saved with the account', () => {
  const login = read('app/login/page.tsx')
  assert.match(login, /options: signupOptions\(\{\s*plan: pending\?\.plan,\s*source: pending\?\.source,\s*emailRedirectTo: confirmRedirectUrl\(/)
  const signIn = login.slice(login.indexOf('const { data: signInData, error }'))
  assert.match(signIn, /pending: pending \?\? pendingFromUserMetadata\(signInData\.user\?\.user_metadata\)/, 'logging in on another device continues to checkout')
  assert.match(login, /router\.replace\('\/auth\/continue'\)/, 'a signed-in visitor is not left on the login page')
  const start = read('app/checkout/start/page.tsx')
  assert.match(start, /pendingFromUserMetadata\(user\?\.user_metadata\)/); assert.match(start, /pending_plan: null/, 'the saved choice is cleared once checkout has started')
  assert.match(start, /body: JSON\.stringify\(\{ source, plan \}\)/, 'the server still receives only the plan name')
})

test('wiring: the confirmation page reads the link once, cleans the address, hands over this browser\'s own guest trial only, and never invents a destination', () => {
  const page = read('app/auth/confirm/page.tsx')
  assert.match(page, /replaceState\(null, '', CONFIRM_PATH\)/); assert.match(page, /establishSessionFromLink\(supabase, link\)/)
  assert.doesNotMatch(page, /console\.|trackEvent|localStorage\.setItem|sessionStorage\.setItem/)
  const client = read('lib/auth/continue-client.ts')
  assert.match(client, /finishGuestHandOver\(\)/); assert.match(client, /destinationAfterConfirmation\(/)
  const claim = read('lib/guest/claim-client.ts')
  assert.match(claim, /fetch\('\/api\/guest\/claim', \{ method: 'POST', headers: \{ 'Content-Type': 'application\/json' \} \}\)/, 'the same request the login form makes: no body, nothing from the browser')
  assert.doesNotMatch(claim, /body:|localStorage|leads/i, 'the browser sends and moves nothing; the server reads this browser\'s own signed cookie')
  assert.match(read('app/auth/layout.tsx'), /referrer: 'no-referrer'/, 'covers the confirmation page too')
})

test('nothing in this change touches billing, pricing, usage allowances, research access or the database', () => {
  for (const file of ['lib/auth/email-confirmation.ts', 'lib/auth/continue-client.ts', 'lib/guest/claim-client.ts', 'app/auth/confirm/page.tsx', 'app/auth/continue/page.tsx', 'components/auth/ResendConfirmationForm.tsx']) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '')
    assert.doesNotMatch(code, /stripe|price|entitle|research|supabase\.from\(|\.rpc\(|createAdminClient|service_role/i, file)
  }
  assert.equal(fs.existsSync(new URL('../supabase/migrations/20261021_email_confirmation.sql', import.meta.url)), false)
})
