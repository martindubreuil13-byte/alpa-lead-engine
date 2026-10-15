// The password-reset journey in a real browser, phone and desktop, against a fake Supabase Auth service that records every request.
// No email is sent and nothing real is reached: the dev server and the stub both run on this machine.
//   node tests/auth-reset-browser.mjs        (starts its own dev server on :3305 and the stub on :3400)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'

const SUPA = 'http://localhost:3400'
const base = 'http://localhost:3305'
const shots = process.env.AUTH_SCREENSHOT_DIR || '/private/tmp/alpa-auth-browser'
fs.mkdirSync(shots, {recursive: true})

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (sub) => `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub, role: 'authenticated', aud: 'authenticated', exp: 4102444800})}.sig`
const USER = {id: '22222222-2222-4222-8222-222222222222', aud: 'authenticated', role: 'authenticated', email: 'jo@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'}
const sessionJson = () => ({access_token: jwt(USER.id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-1', user: USER})

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*', 'Content-Type': 'application/json'}
const fresh = () => ({recover: 'ok', token: 'ok', update: 'ok', calls: {recover: [], token: [], verify: [], update: [], logout: []}})
let cfg = fresh()
const ERR = {
  projectCap: [429, {code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded'}],
  perUser: [429, {code: 429, error_code: 'over_email_send_rate_limit', msg: 'For security purposes, you can only request this after 42 seconds.'}],
  used: [400, {code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found'}],
  expired: [400, {code: 400, error_code: 'otp_expired', msg: 'Email link is invalid or has expired'}],
  weak: [422, {code: 422, error_code: 'weak_password', msg: 'Password should be at least 8 characters.', weak_password: {reasons: ['length']}}],
  same: [422, {code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.'}],
  noSession: [401, {code: 401, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist'}],
}
const stub = http.createServer((req, res) => {
  const url = new URL(req.url, SUPA)
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    let body = {}; try { body = raw ? JSON.parse(raw) : {} } catch { /* not json */ }
    const send = (status, json) => { res.writeHead(status, cors); res.end(json === undefined ? '' : JSON.stringify(json)) }
    const fail = ([status, json]) => send(status, json)
    if (url.pathname === '/auth/v1/recover') {
      cfg.calls.recover.push({email: body.email, redirectTo: url.searchParams.get('redirect_to'), keys: Object.keys(body).sort()})
      if (cfg.recover === 'network') return req.socket.destroy()
      if (cfg.recover === 'serverError') return send(500, {code: 500, error_code: 'unexpected_failure', msg: 'Error sending recovery email'})
      if (cfg.recover === 'ok') return send(200, {})
      return fail(ERR[cfg.recover])
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      cfg.calls.token.push({keys: Object.keys(body).sort()})
      return cfg.token === 'ok' ? send(200, sessionJson()) : fail(ERR[cfg.token])
    }
    if (url.pathname === '/auth/v1/verify') {
      cfg.calls.verify.push(body)
      return cfg.token === 'ok' ? send(200, sessionJson()) : fail(ERR[cfg.token])
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
      cfg.calls.update.push({keys: Object.keys(body), password: body.password, authorized: Boolean(req.headers.authorization)})
      return cfg.update === 'ok' ? send(200, USER) : fail(ERR[cfg.update])
    }
    if (url.pathname === '/auth/v1/user') return req.headers.authorization ? send(200, USER) : send(401, {code: 401, msg: 'no session'})
    if (url.pathname === '/auth/v1/logout') { cfg.calls.logout.push(url.searchParams.get('scope')); return send(204) }
    if (req.method === 'HEAD') { res.writeHead(200, {...cors, 'Content-Range': '*/0'}); return res.end() }
    res.writeHead(200, cors); res.end('[]')
  })
}).listen(3400)

const log = fs.openSync('/tmp/auth-dev.log', 'w')
const dev = spawn('npx', ['next', 'dev', '-p', '3305'], {
  env: {...process.env, NEXT_PUBLIC_SUPABASE_URL: SUPA, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test_offline', NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: `--require ${new URL('./helpers/stripe-sandbox.cjs', import.meta.url).pathname}`, STRIPE_BLOCK_LOG: '/tmp/stripe-blocked-auth-test.log'},
  stdio: ['ignore', log, log],
})
const stop = () => { try { dev.kill() } catch {} stub.close() }
process.on('exit', stop)
for (let i = 0; i < 90; i += 1) { try { await fetch(base + '/login'); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }

const results = []
async function scenario(name, device, fn, {signedIn = false} = {}) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  cfg = fresh()
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext(device === 'phone' ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2} : {viewport: {width: 1280, height: 900}})
  if (signedIn) {
    const session = {...sessionJson(), access_token: jwt('existing-user')}
    await context.addCookies([{name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: base}])
  }
  await context.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin
    if (origin === SUPA || origin === base) return route.continue()
    return route.abort()
  })
  const page = await context.newPage()
  try { await fn(page, context); results.push(true); console.log(`PASS  ${name}`) } catch (error) { results.push(false); console.log(`FAIL  ${name}\n      ${String(error.message || error).split('\n').slice(0, 6).join('\n      ')}`) }
  await browser.close()
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
// React must have taken over the page before anything is typed, or the typed text is lost when it does.
const hydrated = (page, selector) => page.waitForFunction((sel) => { const el = document.querySelector(sel); return Boolean(el) && Object.keys(el).some((key) => key.startsWith('__reactProps')) }, selector, {timeout: 120000})
const goto = (page, path) => page.goto(base + path, {waitUntil: 'domcontentloaded', timeout: 120000})
const realAlerts = (page) => page.getByRole('alert').filter({hasText: /\S/})
const openForgot = async (page, email = '') => {
  await goto(page, '/login')
  await hydrated(page, '#email')
  if (email) await page.locator('#email').fill(email)
  await page.getByRole('button', {name: 'Forgot password?'}).click()
  await page.locator('#reset-email').waitFor({timeout: 60000})
}
const bodyText = (page) => page.locator('body').innerText()

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: Forgot password? opens a working form; the answer is neutral and identical for a known and an unknown address`, device, async (page) => {
    await openForgot(page, '  Jo@Example.com ')
    assert.equal(await page.locator('#reset-email').inputValue(), 'Jo@Example.com', 'the typed address carries over (the browser itself strips the spaces from an email field)')
    assert.equal((await bodyText(page)).includes('not available yet'), false, 'the dead-end message is gone')
    await page.getByRole('button', {name: 'Send reset link'}).click()
    await page.getByRole('status').waitFor({timeout: 30000})
    const known = await page.getByRole('status').innerText()
    assert.match(known, /If an account exists/)
    assert.deepEqual(cfg.calls.recover.map((c) => c.email), ['Jo@Example.com'], 'the address was trimmed')
    assert.equal(cfg.calls.recover[0].redirectTo, `${base}/auth/reset`, 'the link returns to the allow-listed reset page only')
    // the button is on a cooldown, the resend works after it, and an unknown address gets exactly the same words
    assert.match(await page.getByRole('button', {name: /Send again in \d+s/}).innerText(), /Send again in \d+s/)
    assert.equal(await page.getByRole('button', {name: /Send again in/}).isDisabled(), true)
    await page.locator('#reset-email').fill('nobody-here@example.org')
    cfg.calls.recover.length = 0
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)))
    // (cooldown is 60s; a second request needs a fresh page, as a visitor would after reloading)
    await openForgot(page, 'nobody-here@example.org')
    await page.getByRole('button', {name: 'Send reset link'}).click()
    await page.getByRole('status').waitFor({timeout: 30000})
    assert.equal(await page.getByRole('status').innerText(), known, 'an unknown address is told exactly the same thing')
    if (device === 'phone') assert.equal(await overflow(page), 0)
    await page.getByRole('button', {name: 'Back to log in'}).click()
    await page.locator('#password').waitFor({timeout: 30000})
    await page.screenshot({path: `${shots}/forgot-${device}.png`})
  })
}

await scenario('request: a bad address is stopped before the service; limits, a lost connection and a failed send are each handled without revealing accounts', 'desktop', async (page) => {
  await openForgot(page, 'not-an-email')
  await page.getByRole('button', {name: 'Send reset link'}).click()
  await page.getByRole('alert').filter({hasText: 'valid email'}).waitFor()
  assert.equal(cfg.calls.recover.length, 0, 'nothing was sent for an invalid address')
  const submit = async (email) => { await page.locator('#reset-email').fill(email); await page.getByRole('button', {name: /Send reset link|Send again|Send the link again/}).click() }

  cfg.recover = 'projectCap'
  await submit('a@example.com')
  await page.getByRole('alert').filter({hasText: "can't send more emails right now"}).waitFor({timeout: 30000})
  assert.ok((await bodyText(page)).includes('info@mindrasolutions.com'), 'the way to get help is given')
  assert.equal(await page.getByRole('button', {name: 'Send reset link'}).isEnabled(), true, 'a rate limit does not lock the form')

  cfg.recover = 'network'
  await submit('a@example.com')
  await page.getByRole('alert').filter({hasText: 'could not reach the service'}).waitFor({timeout: 30000})

  cfg.recover = 'serverError'
  await submit('a@example.com')
  await page.getByRole('status').filter({hasText: 'If an account exists'}).waitFor({timeout: 30000})
  assert.equal(await realAlerts(page).count(), 0, 'a failed send looks like a success: it would otherwise reveal a registered address')
})

await scenario('request: the per-address "wait N seconds" answer is shown as the same neutral message', 'desktop', async (page) => {
  await openForgot(page, 'a@example.com')
  cfg.recover = 'perUser'
  await page.getByRole('button', {name: 'Send reset link'}).click()
  await page.getByRole('status').waitFor({timeout: 30000})
  assert.match(await page.getByRole('status').innerText(), /If an account exists/)
  assert.equal((await bodyText(page)).includes('42 seconds'), false, 'the service wording, which would reveal an account, never reaches the page')
})

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: a valid link opens the form, the address is cleaned, the password is updated once, other sessions are signed out`, device, async (page) => {
    await openForgot(page, 'jo@example.com')
    await page.getByRole('button', {name: 'Send reset link'}).click()
    await page.getByRole('status').waitFor({timeout: 30000}) // the browser now holds the PKCE verifier, as after a real request
    await goto(page, '/auth/reset?code=valid-code-1234567')
    await page.locator('#new-password').waitFor({timeout: 60000})
    assert.equal(new URL(page.url()).search + new URL(page.url()).hash, '', 'the one-time code is taken off the address bar')
    assert.equal(cfg.calls.token.length >= 1, true, 'the code was exchanged')
    await page.screenshot({path: `${shots}/reset-form-${device}.png`})
    if (device === 'phone') {
      assert.equal(await overflow(page), 0, 'no horizontal scroll on a phone')
      const sizes = await page.evaluate(() => [...document.querySelectorAll('input, button, a.btn-primary-gold')].map((el) => ({tag: el.tagName, id: el.id, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width), fs: parseFloat(getComputedStyle(el).fontSize)})))
      for (const el of sizes.filter((x) => x.tag === 'INPUT')) assert.ok(el.fs >= 16, `input ${el.id} is ${el.fs}px: iOS would zoom`)
      for (const el of sizes) assert.ok(el.h >= 44 && el.w >= 44, `${el.tag} "${el.label}" is ${el.w}x${el.h}: too small to tap`)
    }
    // checks before the service is asked
    await page.locator('#new-password').fill('short'); await page.locator('#confirm-password').fill('short')
    await page.getByRole('button', {name: 'Update password'}).click()
    await page.getByRole('alert').filter({hasText: 'at least 8'}).waitFor()
    await page.locator('#new-password').fill('correct horse battery'); await page.locator('#confirm-password').fill('correct horse batterz')
    await page.getByRole('button', {name: 'Update password'}).click()
    await page.getByRole('alert').filter({hasText: 'do not match'}).waitFor()
    assert.equal(cfg.calls.update.length, 0, 'nothing was sent while the form was invalid')
    // show/hide
    await page.getByRole('button', {name: 'Show password'}).click()
    assert.equal(await page.locator('#new-password').getAttribute('type'), 'text')
    await page.locator('#confirm-password').fill('correct horse battery')
    await page.getByRole('button', {name: 'Update password'}).dblclick()
    await page.getByRole('heading', {name: 'Password updated'}).waitFor({timeout: 30000})
    assert.equal(cfg.calls.update.length, 1, 'a double click sends one update')
    const update = cfg.calls.update[0]
    assert.deepEqual(update.keys.filter((k) => !k.startsWith('code_challenge')), ['password'], 'only the password is changed (the client adds its own PKCE fields; never an email or profile change)')
    assert.deepEqual([update.password, update.authorized], ['correct horse battery', true], 'with the link\'s session')
    assert.deepEqual(cfg.calls.logout, ['others'], 'every other session was signed out')
    assert.equal(await page.locator('input').count(), 0, 'the password is gone from the page')
    await page.screenshot({path: `${shots}/reset-done-${device}.png`})
    await page.getByRole('link', {name: 'Continue'}).click()
    await page.waitForURL((u) => u.pathname.startsWith('/dashboard'), {timeout: 60000})
  })
}

await scenario('an expired link says so and offers a new one that works', 'desktop', async (page) => {
  await goto(page, '/auth/reset#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  await page.getByRole('heading', {name: 'This link has expired'}).waitFor({timeout: 60000})
  assert.equal(await page.locator('#new-password').count(), 0, 'no password form for an expired link')
  assert.equal(new URL(page.url()).hash, '', 'the error is taken off the address bar too')
  await page.locator('#reset-email').fill('jo@example.com')
  await page.getByRole('button', {name: 'Send reset link'}).click()
  await page.getByRole('status').waitFor({timeout: 30000})
  assert.equal(cfg.calls.recover.length, 1)
  assert.equal(cfg.calls.update.length + cfg.calls.token.length, 0, 'an expired link asks the service for nothing')
})

await scenario('a link that was already used is refused and explained', 'desktop', async (page) => {
  await openForgot(page, 'jo@example.com'); await page.getByRole('button', {name: 'Send reset link'}).click(); await page.getByRole('status').waitFor({timeout: 30000})
  cfg.token = 'used'
  await goto(page, '/auth/reset?code=used-code-12345678')
  await page.getByRole('heading', {name: /expired|not valid/}).waitFor({timeout: 60000})
  assert.equal(await page.locator('#new-password').count(), 0)
  assert.ok(await page.locator('#reset-email').isVisible(), 'a new link can be requested right here')
})

await scenario('a link opened in a browser that did not ask for it says to use the original browser or ask again', 'desktop', async (page) => {
  await goto(page, '/auth/reset?code=other-browser-code-123')
  await page.getByRole('heading', {name: 'Open the link where you asked for it'}).waitFor({timeout: 60000})
  assert.equal(await page.locator('#new-password').count(), 0)
  assert.equal(cfg.calls.token.length, 0, 'there is nothing to exchange without the verifier')
})

await scenario('malformed links and bare visits never show the password form', 'desktop', async (page) => {
  for (const path of ['/auth/reset', '/auth/reset?code=%3Cscript%3Ealert(1)%3C/script%3E', '/auth/reset?token_hash=abc&type=recovery', '/auth/reset#access_token=a.b.c&type=signup']) {
    await goto(page, path)
    await page.locator('#reset-email').waitFor({timeout: 60000})
    assert.equal(await page.locator('#new-password').count(), 0, path)
  }
  assert.equal(cfg.calls.update.length, 0)
})

await scenario('someone already signed in cannot change a password through this page without a link', 'desktop', async (page) => {
  await goto(page, '/auth/reset')
  await page.locator('#reset-email').waitFor({timeout: 60000})
  assert.equal(await page.locator('#new-password').count(), 0)
}, {signedIn: true})

await scenario('the service refuses the new password: a weak one, the same one, or a session that has since ended', 'desktop', async (page) => {
  await openForgot(page, 'jo@example.com'); await page.getByRole('button', {name: 'Send reset link'}).click(); await page.getByRole('status').waitFor({timeout: 30000})
  await goto(page, '/auth/reset?code=valid-code-7654321')
  await page.locator('#new-password').waitFor({timeout: 60000})
  const submit = async () => { await page.locator('#new-password').fill('a decent passphrase'); await page.locator('#confirm-password').fill('a decent passphrase'); await page.getByRole('button', {name: 'Update password'}).click() }
  cfg.update = 'weak'; await submit()
  await page.getByRole('alert').filter({hasText: 'stronger password'}).waitFor({timeout: 30000})
  assert.ok(await page.locator('#new-password').isVisible(), 'the form stays so the visitor can try again')
  cfg.update = 'same'; await submit()
  await page.getByRole('alert').filter({hasText: 'different from your current one'}).waitFor({timeout: 30000})
  cfg.update = 'noSession'; await submit()
  await page.getByRole('heading', {name: /expired|not valid/}).waitFor({timeout: 30000})
  assert.equal(await page.locator('#new-password').count(), 0, 'no form once the link\'s session is gone')
  assert.ok(await page.locator('#reset-email').isVisible())
  assert.deepEqual(cfg.calls.logout, [], 'a refused password never signs other sessions out')
})

await scenario('the page is private: not indexed, and the address is never sent on to another site', 'desktop', async (page) => {
  await goto(page, '/auth/reset')
  await page.locator('#reset-email').waitFor({timeout: 60000})
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/)
  assert.equal(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer')
})

console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios passed`)
stop()
process.exit(results.every(Boolean) ? 0 : 1)
