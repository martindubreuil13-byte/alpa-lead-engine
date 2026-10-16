// Email confirmation and plan persistence in a real browser, phone and desktop, against a fake Supabase Auth service that records every
// request. No email is sent and nothing real is reached. Browsers are separate contexts: "the original browser" signs up and keeps the
// PKCE verifier; "another device" is a fresh context that has nothing of the sign-up.
//   node tests/auth-confirm-browser.mjs        (starts its own dev server on :3306 and the stub on :3401)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'

const SUPA = 'http://localhost:3401'
const base = 'http://localhost:3306'
const shots = process.env.AUTH_SCREENSHOT_DIR || '/private/tmp/alpa-auth-browser'
fs.mkdirSync(shots, {recursive: true})

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (sub) => `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub, role: 'authenticated', aud: 'authenticated', exp: 4102444800})}.sig`
const USER_ID = '33333333-3333-4333-8333-333333333333'
const userJson = (meta) => ({id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'new@example.com', app_metadata: {}, user_metadata: meta ?? {}, created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-10-16T00:00:00Z'})
const sessionJson = (meta) => ({access_token: jwt(USER_ID), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-1', user: userJson(meta)})

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*', 'Content-Type': 'application/json'}
const fresh = () => ({token: 'ok', verify: 'ok', resend: 'ok', password: 'ok', meta: undefined, calls: {signup: [], token: 0, verify: [], resend: [], password: 0, update: [], claim: 0, checkout: []}})
let cfg = fresh()
const ERR = {
  used: [400, {code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found'}],
  expired: [400, {code: 400, error_code: 'otp_expired', msg: 'Email link is invalid or has expired'}],
  capped: [429, {code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded'}],
  unconfirmed: [400, {code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed'}],
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
    if (url.pathname === '/auth/v1/signup') {
      cfg.calls.signup.push({email: body.email, data: body.data, redirectTo: url.searchParams.get('redirect_to'), pkce: Boolean(body.code_challenge)})
      cfg.meta = body.data
      return send(200, {...userJson(body.data), email_confirmed_at: null, identities: [{id: 'i'}]})
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') { cfg.calls.token += 1; return cfg.token === 'ok' ? send(200, sessionJson(cfg.meta)) : fail(ERR[cfg.token]) }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') { cfg.calls.password += 1; return cfg.password === 'ok' ? send(200, sessionJson(cfg.meta)) : fail(ERR[cfg.password]) }
    if (url.pathname === '/auth/v1/verify') { cfg.calls.verify.push(body); return cfg.verify === 'ok' ? send(200, sessionJson(cfg.meta)) : fail(ERR[cfg.verify]) }
    if (url.pathname === '/auth/v1/resend') { cfg.calls.resend.push({email: body.email, type: body.type, redirectTo: url.searchParams.get('redirect_to')}); return cfg.resend === 'ok' ? send(200, {message_id: 'm'}) : fail(ERR[cfg.resend]) }
    if (url.pathname === '/auth/v1/user' && req.method === 'PUT') { cfg.calls.update.push(body.data ?? null); return send(200, userJson(body.data)) }
    if (url.pathname === '/auth/v1/user') return req.headers.authorization ? send(200, userJson(cfg.meta)) : send(401, {code: 401, msg: 'no session'})
    if (url.pathname === '/auth/v1/logout') return send(204)
    if (req.method === 'HEAD') { res.writeHead(200, {...cors, 'Content-Range': '*/0'}); return res.end() }
    res.writeHead(200, cors); res.end('[]')
  })
}).listen(3401)

const log = fs.openSync('/tmp/auth-confirm-dev.log', 'w')
const dev = spawn('npx', ['next', 'dev', '-p', '3306'], {
  env: {...process.env, NEXT_PUBLIC_SUPABASE_URL: SUPA, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test_offline', NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: `--require ${new URL('./helpers/stripe-sandbox.cjs', import.meta.url).pathname}`, STRIPE_BLOCK_LOG: '/tmp/stripe-blocked-confirm-test.log'},
  stdio: ['ignore', log, log],
})
const stop = () => { try { dev.kill() } catch {} stub.close() }
process.on('exit', stop)
for (let i = 0; i < 90; i += 1) { try { await fetch(base + '/login'); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }

const results = []
const html = (title) => ({status: 200, contentType: 'text/html', body: `<!doctype html><title>${title}</title><h1>${title}</h1>`})
// Every browser: the app's own pages are real; the three places a customer ends up, and the two server calls the app makes, are answered here.
async function newBrowserContext(browser, device, {session} = {}) {
  const context = await browser.newContext(device === 'phone' ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2} : {viewport: {width: 1280, height: 900}})
  if (session) await context.addCookies([{name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: base}])
  await context.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url())
    if (url.origin === SUPA) return route.continue()
    if (url.origin !== base) return route.abort()
    const document = request.resourceType() === 'document'
    if (url.pathname === '/api/guest/claim') { cfg.calls.claim += 1; return route.fulfill({json: {success: true, imported: 2, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 0, backfilled: 0}}) }
    if (url.pathname === '/api/auth/subscription') return route.fulfill({json: {subscription: {plan: 'free', verified: true}}})
    if (url.pathname === '/api/checkout' && request.method() === 'POST') { cfg.calls.checkout.push(request.postDataJSON()); return route.fulfill({json: {url: `${base}/__stripe`}}) }
    if (document && url.pathname === '/__stripe') return route.fulfill(html('stripe-checkout-test-page'))
    if (document && url.pathname === '/dashboard/scraper') return route.fulfill(html('free-workspace-test-page'))
    if (document && url.pathname === '/dashboard') return route.fulfill(html('dashboard-test-page'))
    return route.continue()
  })
  return context
}
async function scenario(name, device, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  cfg = fresh()
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  try { await fn({browser, device, open: (options) => newBrowserContext(browser, device, options)}); results.push(true); console.log(`PASS  ${name}`) } catch (error) { results.push(false); console.log(`FAIL  ${name}\n      ${String(error.message || error).split('\n').slice(0, 6).join('\n      ')}`) }
  await browser.close()
}
const hydrated = (page, selector) => page.waitForFunction((sel) => { const el = document.querySelector(sel); return Boolean(el) && Object.keys(el).some((key) => key.startsWith('__reactProps')) }, selector, {timeout: 120000})
const goto = (page, path) => page.goto(base + path, {waitUntil: 'domcontentloaded', timeout: 120000})
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const title = (page) => page.title()

async function signUp(page, {plan} = {}) {
  await goto(page, plan ? `/login?mode=signup&plan=${plan}&source=plans_featured` : '/login?mode=signup')
  await hydrated(page, '#email')
  await page.locator('#email').fill('new@example.com')
  await page.locator('#password').fill('a decent passphrase')
  await page.getByRole('button', {name: 'Create account', exact: true}).click()
  // the stub refuses sign-in until the email is confirmed, as the real service does
  cfg.password = 'unconfirmed'
  await page.getByText('Check your email and open the confirmation link', {exact: false}).waitFor({timeout: 60000})
}

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: signup with a plan -> confirm in the ORIGINAL browser -> straight to checkout, guest trial handed over, saved choice cleared`, device, async ({open}) => {
    const context = await open(); const page = await context.newPage()
    cfg.password = 'unconfirmed'
    await signUp(page, {plan: 'prospector'})
    const signup = cfg.calls.signup[0]
    assert.deepEqual(signup.data, {pending_plan: 'prospector', pending_source: 'plans_featured'}, 'the plan is saved with the account')
    assert.equal(signup.redirectTo, `${base}/auth/confirm`, 'the email link returns to the allow-listed confirmation page')
    assert.deepEqual(Object.keys(signup.data).sort(), ['pending_plan', 'pending_source'], 'no price or entitlement is ever sent')
    cfg.password = 'ok'
    await goto(page, '/auth/confirm?code=valid-code-1234567')
    await page.waitForURL((u) => u.pathname === '/__stripe', {timeout: 90000})
    assert.deepEqual(cfg.calls.checkout, [{source: 'plans_featured', plan: 'prospector'}], 'checkout was started with the plan name only, once')
    assert.equal(cfg.calls.claim, 1, 'this browser\'s own guest trial was handed over once, exactly as after a login')
    assert.equal(cfg.calls.update.length, 1); assert.deepEqual(cfg.calls.update[0], {pending_plan: null, pending_source: null}, 'the saved choice is cleared once checkout has started')
    assert.equal(await title(page), 'stripe-checkout-test-page')
  })
}

await scenario('confirm on ANOTHER device (code link): "your email is confirmed, log in", no guest import, then login continues to the saved plan', 'desktop', async ({open}) => {
  cfg.meta = {pending_plan: 'starter', pending_source: 'plans_featured'}
  const phone = await (await open()).newPage() // a context that has nothing of the sign-up
  await goto(phone, '/auth/confirm?code=other-device-code-12345')
  await phone.getByRole('heading', {name: 'Your email is confirmed'}).waitFor({timeout: 90000})
  assert.equal(new URL(phone.url()).search, '', 'the code is taken off the address bar')
  assert.equal(cfg.calls.claim, 0, 'nothing is claimed during a cross-device confirmation')
  assert.equal(cfg.calls.checkout.length, 0, 'and no checkout starts without a login')
  assert.equal(await phone.locator('#resend-email').count(), 0, 'no resend form: the email is confirmed')
  await phone.getByRole('link', {name: 'Log in'}).click()
  await hydrated(phone, '#email')
  await phone.locator('#email').fill('new@example.com'); await phone.locator('#password').fill('a decent passphrase')
  await phone.getByRole('button', {name: 'Continue', exact: true}).click()
  await phone.waitForURL((u) => u.pathname === '/__stripe', {timeout: 90000})
  assert.deepEqual(cfg.calls.checkout, [{source: 'plans_featured', plan: 'starter'}], 'the plan followed the account to the other device')
})

await scenario('confirm on another device (token link from the email template): signs in there and continues to the saved plan', 'desktop', async ({open}) => {
  cfg.meta = {pending_plan: 'prospector', pending_source: 'plans_featured'}
  const page = await (await open()).newPage()
  await goto(page, '/auth/confirm?token_hash=abcdefgh12345678&type=signup')
  await page.waitForURL((u) => u.pathname === '/__stripe', {timeout: 90000})
  assert.deepEqual(cfg.calls.verify.map((v) => ({type: v.type, token_hash: v.token_hash})), [{type: 'signup', token_hash: 'abcdefgh12345678'}])
  assert.deepEqual(cfg.calls.checkout, [{source: 'plans_featured', plan: 'prospector'}])
  assert.equal(cfg.calls.claim, 1, 'the claim request is made like after any sign-in; with no trial in this browser it finds nothing (the server reads only this browser\'s own cookie)')
})

await scenario('free signup (no plan): confirmation goes to the free workspace, never to checkout', 'desktop', async ({open}) => {
  const page = await (await open()).newPage()
  await signUp(page)
  assert.deepEqual(cfg.calls.signup[0].data ?? {}, {}, 'no plan data is saved when none was chosen')
  cfg.password = 'ok'
  await goto(page, '/auth/confirm?code=free-signup-code-123')
  await page.waitForURL((u) => u.pathname === '/dashboard/scraper', {timeout: 90000})
  assert.equal(cfg.calls.checkout.length, 0); assert.equal(cfg.calls.update.length, 0, 'nothing to clear')
  assert.equal(cfg.calls.claim, 1)
})

await scenario('an unlisted plan in the account\'s metadata never reaches checkout', 'desktop', async ({open}) => {
  cfg.meta = {pending_plan: 'enterprise', price: 0, role: 'admin'}
  const page = await (await open()).newPage()
  await goto(page, '/auth/confirm?token_hash=abcdefgh12345678&type=signup')
  await page.waitForURL((u) => u.pathname === '/dashboard/scraper', {timeout: 90000})
  assert.equal(cfg.calls.checkout.length, 0)
})

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: an expired link says so, offers a new one with the same neutral answer, and a rate limit is stated plainly`, device, async ({open}) => {
    const page = await (await open()).newPage()
    await goto(page, '/auth/confirm?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    await page.getByRole('heading', {name: 'This link has expired'}).waitFor({timeout: 90000})
    assert.equal(new URL(page.url()).search, '', 'the error is taken off the address bar')
    assert.ok(await page.getByRole('link', {name: 'Log in'}).isVisible(), 'someone who already confirmed can log in')
    await hydrated(page, '#resend-email')
    await page.locator('#resend-email').fill('  New@Example.com ')
    await page.getByRole('button', {name: 'Send a new confirmation link'}).click()
    await page.getByRole('status').filter({hasText: 'If that address is waiting'}).waitFor({timeout: 30000})
    assert.deepEqual(cfg.calls.resend, [{email: 'New@Example.com', type: 'signup', redirectTo: `${base}/auth/confirm`}], 'trimmed, and returning only to the allow-listed page')
    if (device === 'phone') {
      assert.equal(await overflow(page), 0)
      const sizes = await page.evaluate(() => [...document.querySelectorAll('input, button, a')].filter((el) => el.getBoundingClientRect().width > 0 && !el.closest('next-route-announcer') && !el.closest('nextjs-portal')).map((el) => ({tag: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || el.id).trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width), fs: parseFloat(getComputedStyle(el).fontSize)})))
      for (const el of sizes) assert.ok(el.h >= 44 && el.w >= 44, `${el.tag} "${el.label}" is ${el.w}x${el.h}: too small to tap`)
      for (const el of sizes.filter((x) => x.tag === 'INPUT')) assert.ok(el.fs >= 16, 'inputs are 16px or more')
      await page.screenshot({path: `${shots}/confirm-expired-phone.png`, fullPage: true})
    }
  })
}

await scenario('resend: a rate limit is stated plainly and does not lock the form', 'desktop', async ({open}) => {
  cfg.resend = 'capped'
  const page = await (await open()).newPage()
  await goto(page, '/auth/confirm?error=access_denied&error_code=otp_expired')
  await hydrated(page, '#resend-email')
  await page.locator('#resend-email').fill('new@example.com')
  await page.getByRole('button', {name: 'Send a new confirmation link'}).click()
  await page.getByRole('alert').filter({hasText: "can't send more emails right now"}).waitFor({timeout: 30000})
  assert.equal(await page.getByRole('button', {name: 'Send a new confirmation link'}).isEnabled(), true)
})

await scenario('a link that was already used, a malformed link and a password-reset link are each refused and explained', 'desktop', async ({open}) => {
  const context = await open()
  cfg.token = 'used'
  let page = await context.newPage()
  // sign-up first so this browser holds the PKCE verifier, as the original browser does
  await signUp(page)
  await goto(page, '/auth/confirm?code=used-code-12345678')
  await page.getByRole('heading', {name: /expired|not valid/}).waitFor({timeout: 90000})
  assert.ok(await page.getByRole('link', {name: 'Log in'}).isVisible())
  assert.equal(cfg.calls.checkout.length + cfg.calls.claim, 0, 'a used link starts nothing')
  for (const path of ['/auth/confirm?code=%3Cscript%3Ealert(1)%3C/script%3E', '/auth/confirm?token_hash=abcdefgh12345678&type=recovery', '/auth/confirm#access_token=a.b.c&type=recovery']) {
    page = await context.newPage(); await goto(page, path)
    await page.getByRole('heading', {name: 'This link is not valid'}).waitFor({timeout: 90000})
    await page.close()
  }
  assert.equal(cfg.calls.checkout.length + cfg.calls.claim, 0)
})

await scenario('already signed in: /login and the confirmation page take the customer on instead of leaving them there', 'desktop', async ({open}) => {
  // with a plan saved with the account -> checkout; without -> the free workspace; nobody signed in -> the login page
  const withPlan = {...sessionJson({pending_plan: 'prospector', pending_source: 'plans_featured'}), access_token: jwt('existing')}
  cfg.meta = {pending_plan: 'prospector', pending_source: 'plans_featured'}
  let page = await (await open({session: withPlan})).newPage()
  await goto(page, '/login')
  await page.waitForURL((u) => u.pathname === '/__stripe', {timeout: 90000})
  assert.deepEqual(cfg.calls.checkout, [{source: 'plans_featured', plan: 'prospector'}])
  assert.equal(cfg.calls.claim, 1)

  cfg = fresh()
  const free = {...sessionJson({}), access_token: jwt('existing')}
  page = await (await open({session: free})).newPage()
  await goto(page, '/login?mode=signup')
  await page.waitForURL((u) => u.pathname === '/dashboard/scraper', {timeout: 90000})
  await goto(page, '/auth/confirm')
  await page.waitForURL((u) => u.pathname === '/dashboard/scraper', {timeout: 90000})
  assert.equal(cfg.calls.checkout.length, 0)

  const anonymous = await (await open()).newPage()
  await goto(anonymous, '/auth/continue')
  await anonymous.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  await goto(anonymous, '/auth/confirm')
  await anonymous.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  await hydrated(anonymous, '#email')
  assert.ok(await anonymous.locator('#email').isVisible(), 'a visitor who is not signed in still gets the login form')
})

await scenario('existing sign-in is unchanged: a customer with no saved plan logs in and lands where they did before; the password-reset form still opens', 'desktop', async ({open}) => {
  cfg.meta = undefined
  const page = await (await open()).newPage()
  await goto(page, '/login'); await hydrated(page, '#email')
  await page.locator('#email').fill('new@example.com'); await page.locator('#password').fill('a decent passphrase')
  await page.getByRole('button', {name: 'Continue', exact: true}).click()
  await page.waitForURL((u) => u.pathname === '/dashboard/scraper', {timeout: 90000})
  assert.equal(cfg.calls.claim, 1); assert.equal(cfg.calls.checkout.length, 0)
  const other = await (await open()).newPage()
  await goto(other, '/login'); await hydrated(other, '#email')
  await other.getByRole('button', {name: 'Forgot password?'}).click()
  await other.locator('#reset-email').waitFor({timeout: 60000})
})

console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios passed`)
stop()
process.exit(results.every(Boolean) ? 0 : 1)
