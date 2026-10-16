// Password reset: the rules behind the screens. A fake Supabase client stands in for the service; nothing is sent anywhere.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  CANONICAL_ORIGIN, MAX_PASSWORD_LENGTH, MESSAGES, MIN_PASSWORD_LENGTH, UPDATE_MESSAGES, classifyResetResponse, classifyUpdateError, establishRecoverySession,
  isPlausibleEmail, parseRecoveryLink, requestPasswordReset, resetRedirectUrl, setNewPassword, validateNewPassword,
} from '../lib/auth/password-reset.ts'

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const err = (extra) => Object.assign(new Error(extra.message ?? 'x'), extra)

// ---- where the emailed link may return to
test('redirect: only an allow-listed origin is ever used, everything else becomes the production site', () => {
  const url = (o, extra = {}) => resetRedirectUrl({ origin: o, production: true, ...extra })
  assert.equal(url(CANONICAL_ORIGIN), `${CANONICAL_ORIGIN}/auth/reset`)
  assert.equal(url('https://evil.example'), `${CANONICAL_ORIGIN}/auth/reset`)
  assert.equal(url('https://alpa.mindrasolutions.com.evil.example'), `${CANONICAL_ORIGIN}/auth/reset`, 'a look-alike host is not the site')
  assert.equal(url('http://alpa.mindrasolutions.com'), `${CANONICAL_ORIGIN}/auth/reset`, 'plain http is not the site')
  assert.equal(url('javascript:alert(1)'), `${CANONICAL_ORIGIN}/auth/reset`)
  assert.equal(url(null), `${CANONICAL_ORIGIN}/auth/reset`)
  assert.equal(url('http://localhost:3000'), `${CANONICAL_ORIGIN}/auth/reset`, 'localhost is not allowed in production')
  assert.equal(url('https://app.example.com', { appUrl: 'https://app.example.com/anything?x=1' }), 'https://app.example.com/auth/reset', 'the origin the app is configured with is allowed, never its path')
  assert.equal(url('https://app.example.com', { appUrl: 'http://app.example.com' }), `${CANONICAL_ORIGIN}/auth/reset`, 'a configured address must be https in production')
  assert.equal(resetRedirectUrl({ origin: 'http://localhost:3000', production: false }), 'http://localhost:3000/auth/reset')
  assert.equal(resetRedirectUrl({ origin: 'http://127.0.0.1:3305', production: false }), 'http://127.0.0.1:3305/auth/reset')
  assert.equal(resetRedirectUrl({ origin: 'https://preview-123.vercel.app', production: false }), `${CANONICAL_ORIGIN}/auth/reset`, 'a preview address is not allowed')
  for (const o of ['https://evil.example', 'https://x.test/?a=b#c', null]) assert.match(url(o), /^https:\/\/alpa\.mindrasolutions\.com\/auth\/reset$/, 'no query or fragment is ever added')
})

// ---- asking for a link
test('request: the answer is the same whether or not the address has an account', () => {
  const same = { kind: 'sent' }
  assert.deepEqual(classifyResetResponse(null), same, 'success')
  assert.deepEqual(classifyResetResponse(err({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' })), same, 'the per-address wait would reveal an account, so it is answered as sent')
  assert.deepEqual(classifyResetResponse(err({ status: 500, code: 'unexpected_failure', message: 'Error sending recovery email' })), same, 'a failed send only happens for a real account, so it is answered as sent')
  assert.deepEqual(classifyResetResponse(err({ status: 502, message: 'bad gateway' })), same)
  assert.equal(MESSAGES.sent.includes('If an account exists'), true)
  assert.doesNotMatch(MESSAGES.sent, /no account|not found|not registered|does not exist|unknown/i)
})

test('request: rate limits that hit everyone are stated plainly; bad input and a lost connection are explicit', () => {
  assert.deepEqual(classifyResetResponse(err({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })), { kind: 'rate_limited' })
  assert.deepEqual(classifyResetResponse(err({ status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' })), { kind: 'rate_limited' })
  assert.deepEqual(classifyResetResponse(err({ status: 400, code: 'validation_failed', message: 'Unable to validate email address: invalid format' })), { kind: 'invalid_email' })
  assert.deepEqual(classifyResetResponse(err({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })), { kind: 'unavailable' })
  assert.deepEqual(classifyResetResponse(err({ message: 'TypeError: fetch failed' })), { kind: 'unavailable' })
  assert.deepEqual(classifyResetResponse(err({ status: 401, message: 'Invalid API key' })), { kind: 'unavailable' })
  assert.match(MESSAGES.rateLimited, /try again in a few minutes/); assert.match(MESSAGES.rateLimited, /info@mindrasolutions\.com/)
})

test('request: the address is trimmed and checked, only the allow-listed return address is sent, and nothing else is called', async () => {
  const calls = []
  const client = { auth: { resetPasswordForEmail: async (email, options) => { calls.push({ email, options }); return { error: null } }, signUp: () => assert.fail('no sign-up'), signInWithPassword: () => assert.fail('no sign-in') } }
  const redirectTo = resetRedirectUrl({ origin: 'https://evil.example', production: true })
  assert.deepEqual(await requestPasswordReset(client, '  Jo@Example.com \n', redirectTo), { kind: 'sent' })
  assert.deepEqual(calls, [{ email: 'Jo@Example.com', options: { redirectTo: 'https://alpa.mindrasolutions.com/auth/reset' } }])
  for (const bad of ['', '   ', 'no-at-sign', 'a@b', 'a b@c.com', `${'x'.repeat(250)}@e.com`]) {
    assert.deepEqual(await requestPasswordReset(client, bad, redirectTo), { kind: 'invalid_email' }, bad)
  }
  assert.equal(calls.length, 1, 'an invalid address never reaches the service')
  const down = { auth: { resetPasswordForEmail: async () => { throw err({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }) } } }
  assert.deepEqual(await requestPasswordReset(down, 'a@b.co', redirectTo), { kind: 'unavailable' }, 'a thrown network error is handled')
  assert.equal(isPlausibleEmail('a@b.co'), true)
})

// ---- coming back from the email
test('link: every shape Supabase can return is read, malformed or unknown values are "invalid", and nothing is trusted', () => {
  const link = (search = '', hash = '') => parseRecoveryLink({ search, hash })
  assert.deepEqual(link('?code=abcd1234-efgh'), { kind: 'code', code: 'abcd1234-efgh' })
  assert.deepEqual(link('?token_hash=abcdefgh12345678&type=recovery'), { kind: 'token_hash', tokenHash: 'abcdefgh12345678' })
  assert.deepEqual(link('', '#access_token=aaa.bbb.ccc&refresh_token=r&type=recovery&expires_in=3600'), { kind: 'implicit' })
  assert.deepEqual(link('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), { kind: 'error', reason: 'expired' })
  assert.deepEqual(link('?error=access_denied&error_code=otp_expired'), { kind: 'error', reason: 'expired' })
  assert.deepEqual(link('?error=server_error&error_description=Something+broke'), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(link('?error=access_denied&error_description=Token+has+already+been+used'), { kind: 'error', reason: 'expired' })
  assert.deepEqual(link('', ''), { kind: 'none' })
  assert.deepEqual(link('?foo=bar', '#section'), { kind: 'none' })
  assert.deepEqual(link('?token_hash=abcdefgh12345678&type=signup'), { kind: 'error', reason: 'invalid' }, 'a link of another kind is not a recovery link')
  assert.deepEqual(link('?token_hash=short&type=recovery'), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(link('?code=<script>alert(1)</script>'), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(link('?code=' + 'a'.repeat(5000)), { kind: 'error', reason: 'invalid' })
  assert.deepEqual(link('', '#access_token=aaa.bbb.ccc&type=signup'), { kind: 'error', reason: 'invalid' })
  assert.equal(link('?error=access_denied&code=abcd1234efgh').kind, 'error', 'an error beats a code')
})

// A fake of the pieces of the Supabase client the pages use. `initialize` models the client finishing its own reading of the address;
// `verify` models verifyOtp. The session in an answer is the proof that a link worked.
function fakeClient({ initializeError = null, sessionAfter = 'link-session', verify } = {}) {
  let session = null
  const calls = { initialize: 0, verify: [] }
  return {
    calls,
    auth: {
      initialize: async () => { calls.initialize += 1; if (!initializeError) session = sessionAfter ? { access_token: sessionAfter } : null; return { error: initializeError } },
      getSession: async () => ({ data: { session } }),
      verifyOtp: async (params) => { calls.verify.push(params); return verify ? verify(params) : { data: { session: { access_token: 'otp-session' } }, error: null } },
    },
  }
}

test('session: a valid code link becomes a session once the client has read it; a bare success without a session is not a success', async () => {
  const ok = fakeClient()
  assert.equal(await establishRecoverySession(ok, { kind: 'code', code: 'abcd1234' }), 'ready')
  assert.equal(ok.calls.initialize, 1)
  assert.equal(await establishRecoverySession(fakeClient({ sessionAfter: null }), { kind: 'code', code: 'abcd1234' }), 'invalid', 'no session, no success')
  assert.equal(await establishRecoverySession(fakeClient(), { kind: 'implicit' }), 'ready')
})

test('session: a used, expired or foreign link is explained and never accepted', async () => {
  const fail = (error) => fakeClient({ initializeError: Object.assign(new Error(error.message), error) })
  assert.equal(await establishRecoverySession(fail({ code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found' }), { kind: 'code', code: 'abcd1234' }), 'expired', 'reuse')
  assert.equal(await establishRecoverySession(fail({ code: 'otp_expired', message: 'Email link is invalid or has expired' }), { kind: 'code', code: 'abcd1234' }), 'expired')
  assert.equal(await establishRecoverySession(fail({ name: 'AuthPKCECodeVerifierMissingError', message: 'PKCE code verifier not found in storage' }), { kind: 'code', code: 'abcd1234' }), 'other_browser')
  assert.equal(await establishRecoverySession(fail({ message: 'something else' }), { kind: 'code', code: 'abcd1234' }), 'invalid')
  assert.equal(await establishRecoverySession(fakeClient(), { kind: 'error', reason: 'expired' }), 'expired')
  assert.equal(await establishRecoverySession(fakeClient(), { kind: 'error', reason: 'invalid' }), 'invalid')
  assert.equal(await establishRecoverySession(fakeClient(), { kind: 'none' }), 'none')
  const idle = fakeClient()
  await establishRecoverySession(idle, { kind: 'none' }); await establishRecoverySession(idle, { kind: 'error', reason: 'expired' })
  assert.deepEqual([idle.calls.initialize, idle.calls.verify.length], [0, 0], 'a link that cannot work asks the service for nothing')
})

test('session: a code opened in a browser that did not ask for it is told so without trying (the client would not exchange it)', async () => {
  const client = fakeClient()
  assert.equal(await establishRecoverySession(client, { kind: 'code', code: 'abcd1234' }, { hasVerifier: false }), 'other_browser')
  assert.equal(client.calls.initialize, 0)
  assert.equal(await establishRecoverySession(fakeClient(), { kind: 'code', code: 'abcd1234' }, { hasVerifier: true }), 'ready')
})

test('session: a failed link is a failure even for someone already signed in: only the session the link produced counts', async () => {
  // The client reports the link's own error; a login that was already there changes nothing about the answer.
  const signedIn = fakeClient({ initializeError: Object.assign(new Error('expired'), { code: 'otp_expired' }), sessionAfter: 'existing-login' })
  assert.equal(await establishRecoverySession(signedIn, { kind: 'code', code: 'abcd1234' }), 'expired')
})

test('session: the token-hash form (an email template can use it) is verified here and the session it returns is the proof', async () => {
  const ok = fakeClient()
  assert.equal(await establishRecoverySession(ok, { kind: 'token_hash', tokenHash: 'abcdefgh12345678' }), 'ready')
  assert.deepEqual(ok.calls.verify, [{ type: 'recovery', token_hash: 'abcdefgh12345678' }])
  const expired = fakeClient({ verify: async () => ({ data: null, error: Object.assign(new Error('Token has expired or is invalid'), { code: 'otp_expired' }) }) })
  assert.equal(await establishRecoverySession(expired, { kind: 'token_hash', tokenHash: 'abcdefgh12345678' }), 'expired')
  const noSession = fakeClient({ verify: async () => ({ data: { session: null }, error: null }) })
  assert.equal(await establishRecoverySession(noSession, { kind: 'token_hash', tokenHash: 'abcdefgh12345678' }), 'invalid')
})

// ---- choosing the new password
test('password: length, match and the 72-character limit', () => {
  assert.equal(validateNewPassword('a-long-enough-one', 'a-long-enough-one'), null)
  assert.match(validateNewPassword('short', 'short'), new RegExp(`at least ${MIN_PASSWORD_LENGTH}`))
  assert.match(validateNewPassword('a-long-enough-one', 'a-long-enough-two'), /do not match/)
  assert.match(validateNewPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1), 'x'.repeat(MAX_PASSWORD_LENGTH + 1)), /at most 72/)
  assert.equal(validateNewPassword('x'.repeat(MAX_PASSWORD_LENGTH), 'x'.repeat(MAX_PASSWORD_LENGTH)), null)
  assert.equal(validateNewPassword('        ', '        '), null, 'spaces are legal characters (length is what counts)')
})

test('password: the service\'s refusals are explained in plain words', () => {
  assert.equal(classifyUpdateError(err({ status: 422, code: 'weak_password', message: 'Password should be at least 8 characters' })), 'weak')
  assert.equal(classifyUpdateError(err({ status: 422, code: 'same_password', message: 'New password should be different from the old password.' })), 'same')
  assert.equal(classifyUpdateError(err({ name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' })), 'expired')
  assert.equal(classifyUpdateError(err({ status: 401, message: 'invalid JWT' })), 'expired')
  assert.equal(classifyUpdateError(err({ status: 429, code: 'over_request_rate_limit', message: 'rate limit' })), 'rate_limited')
  assert.equal(classifyUpdateError(err({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })), 'unavailable')
  assert.equal(classifyUpdateError(err({ status: 500, message: 'boom' })), 'unavailable')
  for (const text of Object.values(UPDATE_MESSAGES)) assert.ok(text.length > 20 && !/undefined|\[object/.test(text))
})

test('password: it is set once, the other sessions are signed out, and a refusal signs nobody out', async () => {
  const log = []
  const client = (result) => ({ auth: { updateUser: async (a) => { log.push(['update', Object.keys(a)]); return result }, signOut: async (o) => { log.push(['signOut', o]) } } })
  assert.equal(await setNewPassword(client({ error: null }), 'a-long-enough-one'), 'updated')
  assert.deepEqual(log, [['update', ['password']], ['signOut', { scope: 'others' }]])
  log.length = 0
  assert.equal(await setNewPassword(client({ error: err({ code: 'weak_password', message: 'weak' }) }), 'password'), 'weak')
  assert.deepEqual(log, [['update', ['password']]], 'no sign-out after a refusal')
  const failingSignOut = { auth: { updateUser: async () => ({ error: null }), signOut: async () => { throw new Error('network') } } }
  assert.equal(await setNewPassword(failingSignOut, 'a-long-enough-one'), 'updated', 'the password is changed even if the extra sign-out fails')
  const throwing = { auth: { updateUser: async () => { throw err({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }) }, signOut: async () => {} } }
  assert.equal(await setNewPassword(throwing, 'a-long-enough-one'), 'unavailable')
})

// ---- the wiring
test('wiring: the login page opens the real form, the dead-end message is gone, and the reset page never leaks or keeps the link', () => {
  const login = read('app/login/page.tsx')
  assert.doesNotMatch(login, /Password reset is not available/); assert.match(login, /ForgotPasswordForm/); assert.match(login, /setIsForgot\(true\)/)
  const page = read('app/auth/reset/page.tsx')
  assert.match(page, /replaceState\(null, '', cleanedPath\(\)\)/, 'the one-time values leave the address bar')
  assert.match(page, /takeInitialAuthUrl\(\)/); assert.match(page, /establishRecoverySession\(supabase, link, \{ hasVerifier: arrived\.hasVerifier \}\)/); assert.match(page, /setNewPassword\(supabase, password\)/)
  assert.doesNotMatch(page + read('components/auth/ForgotPasswordForm.tsx') + read('lib/auth/password-reset.ts'), /console\.(log|info|error|warn)|trackEvent|localStorage\.setItem|sessionStorage\.setItem/, 'no logging, analytics or storage of emails, links or passwords')
  const layout = read('app/auth/layout.tsx')
  assert.match(layout, /index: false/); assert.match(layout, /referrer: 'no-referrer'/)
  const form = read('components/auth/ForgotPasswordForm.tsx')
  assert.match(form, /resetRedirectUrl\(/); assert.doesNotMatch(form, /redirectTo:\s*window|redirectTo:\s*`/, 'the return address is never built from the page address directly')
  const lib = read('lib/auth/password-reset.ts')
  assert.doesNotMatch(lib, /router\.|location\.href|window\./, 'the rules touch no browser state')
})

test('wiring: controls are made for phones - 16px text, targets of at least 44px, the right keyboard and autofill hints', () => {
  const shell = read('components/auth/AuthShell.tsx'); const form = read('components/auth/ForgotPasswordForm.tsx'); const page = read('app/auth/reset/page.tsx')
  const inputLine = shell.split('\n').find((line) => line.includes('export const inputClass') || line.trimStart().startsWith("'h-14")) + shell.split('\n').find((line) => line.trimStart().startsWith("'h-14"))
  assert.match(inputLine, /text-base/); assert.doesNotMatch(inputLine, /text-\[1[0-5]px\]|text-sm/, 'inputs are never below 16px (iOS would zoom)')
  assert.match(shell, /h-14/); assert.match(shell, /min-h-12/)
  assert.match(form, /inputMode="email"/); assert.match(form, /autoCapitalize="none"/); assert.match(form, /autoComplete="email"/)
  assert.match(page, /autoComplete="new-password"/); assert.match(page, /h-12 w-12/, 'the show-password button is 48px')
  assert.match(read('app/login/page.tsx'), /min-h-11 items-center/, 'the Forgot password? link is a real touch target')
  assert.match(shell, /min-h-\[100dvh\]/, 'the card fits a phone with the browser bar showing')
})

test('nothing in this change touches billing, checkout or migrations', () => {
  const login = read('app/login/page.tsx')
  assert.doesNotMatch(login.slice(login.indexOf('async function handleAuth'), login.indexOf('function switchMode')), /resetPassword|ForgotPassword/, 'sign-in and sign-up logic holds no reset code')
  assert.equal(fs.existsSync(new URL('../supabase/migrations/20261020_password_reset.sql', import.meta.url)), false)
})
