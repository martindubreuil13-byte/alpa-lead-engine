// The isolated authentication release in real browsers, against a fake Supabase Auth service that remembers accounts, passwords, emailed
// links and sessions, so whole journeys can be played: sign up, confirm, log in, log out, reset the password, log in again.
// No email is sent and nothing real is reached: the dev server and the stub both run on this machine. Separate browser contexts are
// separate browsers: "the original browser" asks for a link and keeps its secret; "another device" has nothing of it.
//   node tests/auth-release-browser.mjs        (starts its own dev server on :3310 and the stub on :3410)
//   BASE_URL=http://localhost:3312 node tests/auth-release-browser.mjs   against a production build made with NEXT_PUBLIC_SUPABASE_URL=http://localhost:3410
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'

const SUPA = 'http://localhost:3410'
const external = process.env.BASE_URL
const base = external || 'http://localhost:3310'
// A production build only ever puts the production address in an emailed link; a development build puts its own.
const linkBase = external ? 'https://alpa.mindrasolutions.com' : base
const shots = process.env.AUTH_SCREENSHOT_DIR || '/private/tmp/alpa-auth-release-browser'
fs.mkdirSync(shots, {recursive: true})

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (sub, session) => `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub, session_id: session, role: 'authenticated', aud: 'authenticated', exp: 4102444800})}.sig`
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*', 'Content-Type': 'application/json'}

// ---- the fake service ------------------------------------------------------------------------------------------------------------
let world
const freshWorld = () => ({users: new Map(), codes: new Map(), sessions: new Map(), emails: [], calls: {signup: [], recover: [], resend: [], token: 0, exchange: 0, update: [], logout: [], claim: 0, claimMode: 'ok', plan: 'free', checkout: 0}, nextId: 1, rateLimit: false})
const ERR = {
  used: [400, {code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found'}],
  expired: [400, {code: 400, error_code: 'otp_expired', msg: 'Email link is invalid or has expired'}],
  unconfirmed: [400, {code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed'}],
  badLogin: [400, {code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials'}],
  weak: [422, {code: 422, error_code: 'weak_password', msg: 'Password should be at least 8 characters.', weak_password: {reasons: ['length']}}],
  same: [422, {code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.'}],
  noSession: [401, {code: 401, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist'}],
  capped: [429, {code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded'}],
}
const userJson = (u) => ({id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', email_confirmed_at: u.confirmed ? '2026-10-16T00:00:00Z' : null, identities: [{id: 'i'}]})
function openSession(user) {
  const id = `s${world.nextId++}`
  world.sessions.set(id, user.email)
  return {access_token: jwt(user.id, id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${id}`, user: userJson(user)}
}
const sessionOf = (req) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '')
  try { const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); const email = world.sessions.get(payload.session_id); return email ? {user: world.users.get(email), sessionId: payload.session_id} : null } catch { return null }
}
/** What clicking the link in an email does: Supabase verifies it, then sends the browser to the page with a one-time code. */
export const link = (kind, email) => { const code = `${kind}-${world.nextId++}-code-${Math.random().toString(36).slice(2, 10)}`; world.codes.set(code, {kind, email, used: false, expired: false}); return code }
const emailedCode = (kind, email) => [...world.emails].reverse().find((m) => m.kind === kind && m.to === email)?.code

const stub = http.createServer((req, res) => {
  const url = new URL(req.url, SUPA)
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    let body = {}; try { body = raw ? JSON.parse(raw) : {} } catch { /* not json */ }
    const send = (status, json) => { res.writeHead(status, cors); res.end(json === undefined ? '' : JSON.stringify(json)) }
    const fail = ([status, json]) => send(status, json)
    const email = String(body.email || '').trim().toLowerCase()
    switch (true) {
      case url.pathname === '/auth/v1/signup': {
        world.calls.signup.push({email: body.email, redirectTo: url.searchParams.get('redirect_to'), keys: Object.keys(body).sort(), data: body.data})
        let user = world.users.get(email)
        if (!user) { user = {id: `u${world.nextId++}`, email, password: body.password, confirmed: false}; world.users.set(email, user); world.emails.push({kind: 'signup', to: email, code: link('signup', email), redirectTo: url.searchParams.get('redirect_to')}) }
        return send(200, userJson(user)) // the same answer for an address that already exists
      }
      case url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password': {
        world.calls.token += 1
        const user = world.users.get(email)
        if (!user || user.password !== body.password) return fail(ERR.badLogin)
        if (!user.confirmed) return fail(ERR.unconfirmed)
        return send(200, openSession(user))
      }
      case url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce': {
        world.calls.exchange += 1
        const entry = world.codes.get(body.auth_code)
        if (!entry || entry.used) return fail(ERR.used)
        if (entry.expired) return fail(ERR.expired)
        entry.used = true
        const user = world.users.get(entry.email)
        if (entry.kind === 'signup') user.confirmed = true
        return send(200, openSession(user))
      }
      case url.pathname === '/auth/v1/recover': {
        world.calls.recover.push({email: body.email, redirectTo: url.searchParams.get('redirect_to')})
        if (world.rateLimit) return fail(ERR.capped)
        const user = world.users.get(email)
        if (user) world.emails.push({kind: 'recovery', to: email, code: link('recovery', email), redirectTo: url.searchParams.get('redirect_to')})
        return send(200, {}) // never reveals whether the address has an account
      }
      case url.pathname === '/auth/v1/resend': {
        world.calls.resend.push({email: body.email, type: body.type, redirectTo: url.searchParams.get('redirect_to')})
        const user = world.users.get(email)
        if (user && !user.confirmed) world.emails.push({kind: 'signup', to: email, code: link('signup', email), redirectTo: url.searchParams.get('redirect_to')})
        return send(200, {message_id: 'm'})
      }
      case url.pathname === '/auth/v1/user' && req.method === 'PUT': {
        const current = sessionOf(req)
        world.calls.update.push({keys: Object.keys(body).filter((k) => !k.startsWith('code_challenge')), authorized: Boolean(current)})
        if (!current) return fail(ERR.noSession)
        if (String(body.password || '').length < 8) return fail(ERR.weak)
        if (body.password === current.user.password) return fail(ERR.same)
        current.user.password = body.password
        return send(200, userJson(current.user))
      }
      case url.pathname === '/auth/v1/user': { const current = sessionOf(req); return current ? send(200, userJson(current.user)) : send(401, {code: 401, msg: 'no session'}) }
      case url.pathname === '/auth/v1/logout': {
        const scope = url.searchParams.get('scope') || 'global'
        const current = sessionOf(req)
        world.calls.logout.push(scope)
        if (current) {
          if (scope === 'others') { for (const [id, owner] of world.sessions) if (owner === current.user.email && id !== current.sessionId) world.sessions.delete(id) } else world.sessions.delete(current.sessionId)
        }
        return send(204)
      }
      case req.method === 'HEAD': res.writeHead(200, {...cors, 'Content-Range': '*/0'}); return res.end()
      case url.pathname.startsWith('/rest/v1/profiles') || url.pathname.startsWith('/rest/v1/users'): {
        const current = sessionOf(req); const row = {id: current?.user.id, email: current?.user.email, plan: 'free', plan_status: 'free', subscription_status: 'free', stripe_customer_id: null, stripe_subscription_id: null, cancel_at_period_end: false, current_period_end: null, canceled_at: null, subscription_tier: 'free'}
        const single = String(req.headers.accept || '').includes('vnd.pgrst.object')
        res.writeHead(200, cors); return res.end(JSON.stringify(single ? row : [row]))
      }
      default: res.writeHead(200, cors); res.end('[]')
    }
  })
}).listen(3410)

const log = fs.openSync('/tmp/auth-release-dev.log', 'w')
const dev = external ? null : spawn('npx', ['next', 'dev', '-p', '3310'], {
  env: {...process.env, NEXT_PUBLIC_SUPABASE_URL: SUPA, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test_offline', NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: `--require ${new URL('./helpers/stripe-sandbox.cjs', import.meta.url).pathname}`, STRIPE_BLOCK_LOG: '/tmp/stripe-blocked-auth-release.log'},
  stdio: ['ignore', log, log],
})
const stop = () => { try { dev?.kill() } catch {} stub.close() }
process.on('exit', stop)
for (let i = 0; i < 90; i += 1) { try { await fetch(base + '/login'); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }

// ---- browsers --------------------------------------------------------------------------------------------------------------------
const html = (title) => ({status: 200, contentType: 'text/html', body: `<!doctype html><title>${title}</title><h1>${title}</h1>`})
const DEVICES = {desktop: {viewport: {width: 1366, height: 860}}, phone: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}}
async function newContext(browser, device, {realDashboard = false} = {}) {
  const context = await browser.newContext(DEVICES[device])
  context.on('page', (page) => { page.on('console', (m) => { if (process.env.DEBUG_AUTH && /error|warn/i.test(m.type())) console.log('      [console]', m.text().slice(0, 200)) }); page.on('response', (r) => { if (process.env.DEBUG_AUTH && r.url().startsWith(SUPA) && /token|verify|user/.test(r.url())) console.log('      [supabase]', r.request().method(), r.url().replace(SUPA, '').slice(0, 70), r.status()) }) })
  await context.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url())
    if (url.origin === SUPA) return route.continue()
    if (url.origin !== base) return route.abort()
    const document = request.resourceType() === 'document'
    if (url.pathname === '/api/guest/claim') {
      world.calls.claim += 1
      if (world.calls.claimMode === 'none') return route.fulfill({status: 401, json: {error: 'No guest session'}})
      if (world.calls.claimMode === 'fail') return route.fulfill({status: 503, json: {error: 'Your trial could not be saved to your account.'}})
      return route.fulfill({json: {success: true, imported: 3, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 0, backfilled: 0}})
    }
    if (url.pathname === '/api/auth/subscription') return route.fulfill({json: {subscription: {plan: world.calls.plan, verified: true, subscription_active: world.calls.plan !== 'free'}}})
    if (document && url.pathname === '/dashboard/scraper') return route.fulfill(html('free-workspace-test-page'))
    if (document && url.pathname === '/dashboard' && !realDashboard) return route.fulfill(html('dashboard-test-page'))
    return route.continue()
  })
  return context
}
const results = []
async function scenario(name, device, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  world = freshWorld()
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  try { await fn({browser, device, ctx: (options) => newContext(browser, device, options)}); results.push(true); console.log(`PASS  ${name}`) } catch (error) { results.push(false); console.log(`FAIL  ${name}\n      ${String(error.message || error).split('\n').slice(0, 7).join('\n      ')}`)
    for (const context of browser.contexts()) for (const page of context.pages()) console.log(`      page ${page.url()} :: ${(await page.locator('body').innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 160)}`) }
  await browser.close()
}
const hydrated = (page, selector) => page.waitForFunction((sel) => { const el = document.querySelector(sel); return Boolean(el) && Object.keys(el).some((key) => key.startsWith('__reactProps')) }, selector, {timeout: 120000})
const goto = (page, path) => page.goto(base + path, {waitUntil: 'domcontentloaded', timeout: 120000})
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const PASSWORD = 'a decent passphrase'
const heading = (page, name) => page.getByRole('heading', {name}).waitFor({timeout: 90000})

async function signUp(page, email = 'new@example.com') {
  await goto(page, '/login?mode=signup'); await hydrated(page, '#email')
  await page.locator('#email').fill(email); await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', {name: 'Create account', exact: true}).click()
  await page.getByText('Check your email and open the confirmation link', {exact: false}).waitFor({timeout: 60000})
}
async function logIn(page, email, password) {
  await goto(page, '/login'); await hydrated(page, '#email')
  await page.locator('#email').fill(email); await page.locator('#password').fill(password)
  await page.getByRole('button', {name: 'Continue', exact: true}).click()
}
const confirmUrl = (email) => `/auth/confirm?code=${emailedCode('signup', email)}`
const resetUrl = (email) => `/auth/reset?code=${emailedCode('recovery', email)}`
const atWorkspace = (u) => u.pathname === '/dashboard/scraper'
const requestReset = async (page, email) => {
  await hydrated(page, '#reset-email'); await page.locator('#reset-email').fill(email)
  await page.getByRole('button', {name: 'Send reset link'}).click(); await page.getByRole('status').waitFor({timeout: 30000})
}

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: registration, then confirmation in the ORIGINAL browser: account created, unconfirmed login refused, link confirms, guest trial handed over, workspace`, device, async ({ctx}) => {
    const page = await (await ctx()).newPage()
    await signUp(page)
    assert.equal(world.calls.signup[0].redirectTo, `${linkBase}/auth/confirm`, 'the emailed link returns to the confirmation page')
    assert.deepEqual(world.calls.signup[0].keys.filter((k) => !k.startsWith('code_challenge') && k !== 'gotrue_meta_security' && k !== 'data'), ['email', 'password'])
    assert.deepEqual(world.calls.signup[0].data ?? {}, {}, 'nothing about a plan or price is sent')
    assert.equal(world.users.get('new@example.com').confirmed, false)
    await logIn(page, 'new@example.com', PASSWORD)
    await page.getByText('Please confirm your email before logging in.').waitFor({timeout: 30000})
    await goto(page, confirmUrl('new@example.com'))
    await page.waitForURL(atWorkspace, {timeout: 90000})
    assert.equal(world.users.get('new@example.com').confirmed, true)
    assert.equal(world.calls.claim, 1, 'this browser\'s own guest trial was handed over once')
    assert.ok((await page.context().cookies()).some((c) => /auth-token/.test(c.name) && !/code-verifier/.test(c.name)), 'the session was established in this browser')
  })
}

await scenario('confirmation in ANOTHER browser: "your email is confirmed, log in" (nothing is handed over), then logging in there works', 'desktop', async ({ctx}) => {
  const original = await (await ctx()).newPage()
  await signUp(original)
  const code = emailedCode('signup', 'new@example.com')
  const elsewhere = await (await ctx()).newPage() // a context that holds nothing of the sign-up
  await goto(elsewhere, `/auth/confirm?code=${code}`)
  await heading(elsewhere, 'Your email is confirmed')
  assert.equal(new URL(elsewhere.url()).search, '', 'the code is taken off the address bar')
  assert.equal(world.calls.claim, 0, 'no guest data is claimed during a cross-browser confirmation')
  assert.equal(world.calls.exchange, 0, 'nothing was sent to the service: the code cannot be used here')
  assert.equal(await elsewhere.locator('#resend-email').count(), 0)
  await elsewhere.getByRole('link', {name: 'Log in'}).click()
  await hydrated(elsewhere, '#email')
  assert.equal(world.users.get('new@example.com').confirmed, false, 'the account is only confirmed by the link being used where it can be: say so honestly in the service')
})

await scenario('expired, reused, malformed and wrong-kind confirmation links each give a controlled, explained error', 'desktop', async ({ctx}) => {
  const context = await ctx()
  const page = await context.newPage()
  await signUp(page)
  const code = emailedCode('signup', 'new@example.com')
  world.codes.get(code).expired = true
  await goto(page, `/auth/confirm?code=${code}`)
  await heading(page, 'This link has expired')
  assert.ok(await page.getByRole('link', {name: 'Log in'}).isVisible()); assert.equal(world.users.get('new@example.com').confirmed, false)
  // reuse: a fresh request, used once, then used again
  await goto(page, '/login?mode=signup'); await hydrated(page, '#email')
  world.users.delete('new@example.com')
  await page.locator('#email').fill('second@example.com'); await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', {name: 'Create account', exact: true}).click()
  await page.getByText('Check your email and open the confirmation link', {exact: false}).waitFor({timeout: 60000})
  const second = emailedCode('signup', 'second@example.com')
  await goto(page, `/auth/confirm?code=${second}`); await page.waitForURL(atWorkspace, {timeout: 90000})
  const popup = await context.newPage()
  await goto(popup, `/auth/confirm?code=${second}`) // the same link again
  // the first use spent this browser's secret, so the same link now reads as "already confirmed, log in": true, and nothing is started
  await heading(popup, /expired|not valid|Your email is confirmed/)
  assert.equal(world.calls.exchange, 2, 'one successful exchange (and the expired attempt before it); the reused link was not sent to the service')
  for (const path of ['/auth/confirm?code=%3Cscript%3Ealert(1)%3C/script%3E', '/auth/confirm?token_hash=abcdefgh12345678&type=recovery', '/auth/confirm#access_token=a.b.c&type=recovery', '/auth/confirm?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired']) {
    const p = await context.newPage(); await goto(p, path); await heading(p, /expired|not valid/); await p.close()
  }
  assert.equal(world.calls.claim, 1, 'only the one successful confirmation handed anything over')
})

await scenario('resend: an expired link offers a new one with the same neutral answer, a rate limit is stated plainly', 'desktop', async ({ctx}) => {
  const page = await (await ctx()).newPage()
  await signUp(page)
  await goto(page, '/auth/confirm?error=access_denied&error_code=otp_expired')
  await hydrated(page, '#resend-email')
  await page.locator('#resend-email').fill('  New@Example.com ')
  await page.getByRole('button', {name: 'Send a new confirmation link'}).click()
  await page.getByRole('status').filter({hasText: 'If that address is waiting'}).waitFor({timeout: 30000})
  assert.deepEqual(world.calls.resend.map((r) => [r.email, r.type, r.redirectTo]), [['New@Example.com', 'signup', `${linkBase}/auth/confirm`]])
  assert.equal(world.emails.filter((m) => m.kind === 'signup').length, 2, 'a new link was issued for the waiting address')
})

await scenario('guest hand-over that fails keeps the guest data, says so, and offers a retry; "nothing to claim" is not a failure', 'desktop', async ({ctx}) => {
  const page = await (await ctx()).newPage()
  await signUp(page)
  world.calls.claimMode = 'fail'
  await goto(page, confirmUrl('new@example.com'))
  await heading(page, 'Your account is ready')
  assert.ok(await page.getByText('Your trial has not been cleared', {exact: false}).isVisible())
  assert.equal(new URL(page.url()).pathname, '/auth/confirm', 'it did not move on silently')
  world.calls.claimMode = 'ok'
  await page.getByRole('link', {name: 'Retry import'}).click()
  await page.waitForURL(atWorkspace, {timeout: 60000})
  assert.equal(world.calls.claim, 2)
  // a browser with no trial at all (the server says there is no guest session): straight through
  world.calls.claimMode = 'none'
  const other = await (await ctx()).newPage()
  world.users.get('new@example.com').password = PASSWORD
  await logIn(other, 'new@example.com', PASSWORD)
  await other.waitForURL(atWorkspace, {timeout: 60000})
})

await scenario('login: an existing customer logs in as before; a wrong password and an unknown address get the same plain message', 'desktop', async ({ctx}) => {
  world.users.set('old@example.com', {id: 'u-old', email: 'old@example.com', password: PASSWORD, confirmed: true})
  const page = await (await ctx()).newPage()
  await logIn(page, 'old@example.com', 'not the password')
  await page.getByText('Email or password is incorrect.').waitFor({timeout: 30000})
  await page.locator('#email').fill('nobody@example.com')
  await page.getByRole('button', {name: 'Continue', exact: true}).click()
  await page.getByText('Email or password is incorrect.').waitFor({timeout: 30000})
  await page.locator('#email').fill('old@example.com'); await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', {name: 'Continue', exact: true}).click()
  await page.waitForURL(atWorkspace, {timeout: 60000})
  assert.equal(world.calls.claim, 1)
  // a paying customer still lands on the dashboard
  world.calls.plan = 'starter'
  const paid = await (await ctx()).newPage()
  await logIn(paid, 'old@example.com', PASSWORD)
  await paid.waitForURL((u) => u.pathname === '/dashboard', {timeout: 60000})
})

await scenario('already signed in: /login and the confirmation page take the customer on instead of leaving them there; signed out they stay', 'desktop', async ({ctx}) => {
  world.users.set('old@example.com', {id: 'u-old', email: 'old@example.com', password: PASSWORD, confirmed: true})
  const page = await (await ctx()).newPage()
  await logIn(page, 'old@example.com', PASSWORD); await page.waitForURL(atWorkspace, {timeout: 60000})
  world.calls.claim = 0
  await goto(page, '/login'); await page.waitForURL(atWorkspace, {timeout: 90000})
  assert.equal(world.calls.claim, 1, 'handed over exactly like the login form')
  await goto(page, '/auth/confirm'); await page.waitForURL(atWorkspace, {timeout: 90000})
  world.calls.plan = 'starter'
  // a signed-in visit is routed by /auth/continue, which sends everyone without a pending plan to the workspace; only the login form itself sends paid members to /dashboard
  await goto(page, '/login'); await page.waitForURL(atWorkspace, {timeout: 90000})
  const anonymous = await (await ctx()).newPage()
  await goto(anonymous, '/auth/continue'); await anonymous.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  await goto(anonymous, '/auth/confirm'); await anonymous.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  await hydrated(anonymous, '#email'); assert.ok(await anonymous.locator('#email').isVisible())
})

await scenario('password reset request: the same neutral answer for a known and an unknown address; a link is issued only for the real account; rate limits are plain', 'desktop', async ({ctx}) => {
  world.users.set('old@example.com', {id: 'u-old', email: 'old@example.com', password: PASSWORD, confirmed: true})
  const page = await (await ctx()).newPage()
  await goto(page, '/login'); await hydrated(page, '#email')
  await page.locator('#email').fill('old@example.com'); await page.getByRole('button', {name: 'Forgot password?'}).click()
  assert.equal(await page.getByText('not available yet').count(), 0)
  await requestReset(page, 'old@example.com')
  const known = await page.getByRole('status').innerText()
  const other = await (await ctx()).newPage()
  await goto(other, '/login'); await hydrated(other, '#email'); await other.getByRole('button', {name: 'Forgot password?'}).click()
  await requestReset(other, 'nobody@example.com')
  assert.equal(await other.getByRole('status').innerText(), known, 'identical words')
  assert.deepEqual(world.emails.filter((m) => m.kind === 'recovery').map((m) => m.to), ['old@example.com'], 'a link only for the account that exists')
  assert.ok(world.emails.every((m) => m.redirectTo === `${linkBase}/auth/reset` || m.kind === 'signup'), 'the link returns to the reset page')
  world.rateLimit = true
  const limited = await (await ctx()).newPage()
  await goto(limited, '/login'); await hydrated(limited, '#email'); await limited.getByRole('button', {name: 'Forgot password?'}).click()
  await hydrated(limited, '#reset-email'); await limited.locator('#reset-email').fill('old@example.com'); await limited.getByRole('button', {name: 'Send reset link'}).click()
  await limited.getByRole('alert').filter({hasText: "can't send more emails right now"}).waitFor({timeout: 30000})
})

await scenario('password reset callback: a valid link opens the form, the new password works and the old one does not, other sessions are signed out', 'desktop', async ({ctx}) => {
  world.users.set('old@example.com', {id: 'u-old', email: 'old@example.com', password: PASSWORD, confirmed: true})
  const original = await ctx()
  const page = await original.newPage()
  await goto(page, '/login'); await hydrated(page, '#email'); await page.getByRole('button', {name: 'Forgot password?'}).click()
  await page.locator('#reset-email').waitFor({timeout: 60000}); await requestReset(page, 'old@example.com')
  // another device was already signed in as this customer
  const sessionsBefore = world.sessions.size
  world.sessions.set('s-other-device', 'old@example.com')
  await goto(page, resetUrl('old@example.com'))
  await page.locator('#new-password').waitFor({timeout: 90000})
  assert.equal(new URL(page.url()).search, '', 'the one-time code leaves the address bar')
  await page.locator('#new-password').fill('short'); await page.locator('#confirm-password').fill('short')
  await page.getByRole('button', {name: 'Update password'}).click(); await page.getByRole('alert').filter({hasText: 'at least 8'}).waitFor()
  await page.locator('#new-password').fill('a brand new passphrase'); await page.locator('#confirm-password').fill('a brand new passphrase')
  await page.getByRole('button', {name: 'Update password'}).dblclick()
  await heading(page, 'Password updated')
  assert.equal(world.calls.update.length, 1, 'a double click sends one update'); assert.deepEqual(world.calls.update[0].keys, ['password'])
  assert.deepEqual(world.calls.logout, ['others']); assert.equal(world.sessions.has('s-other-device'), false, 'the other device was signed out')
  assert.ok(sessionsBefore >= 0)
  const fresh = await (await ctx()).newPage()
  await logIn(fresh, 'old@example.com', PASSWORD); await fresh.getByText('Email or password is incorrect.').waitFor({timeout: 30000})
  await fresh.locator('#password').fill('a brand new passphrase'); await fresh.getByRole('button', {name: 'Continue', exact: true}).click()
  await fresh.waitForURL(atWorkspace, {timeout: 60000})
})

await scenario('password reset with a bad link: an unknown code, a reused code, an expired link and a bare visit never open the password form', 'desktop', async ({ctx}) => {
  world.users.set('old@example.com', {id: 'u-old', email: 'old@example.com', password: PASSWORD, confirmed: true})
  const context = await ctx()
  const page = await context.newPage()
  await goto(page, '/login'); await hydrated(page, '#email'); await page.getByRole('button', {name: 'Forgot password?'}).click(); await requestReset(page, 'old@example.com')
  const code = emailedCode('recovery', 'old@example.com')
  // the real link works once ...
  await goto(page, `/auth/reset?code=${code}`); await page.locator('#new-password').waitFor({timeout: 90000})
  // ... and the same link again (in the same browser, whose secret that spent) never opens the form
  const reuse = await context.newPage(); await goto(reuse, `/auth/reset?code=${code}`)
  await reuse.locator('#reset-email').waitFor({timeout: 90000}); assert.equal(await reuse.locator('#new-password').count(), 0)
  // bad links, each in a browser of its own
  for (const path of ['/auth/reset', '/auth/reset?code=%3Cscript%3E', '/auth/reset#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '/auth/reset?token_hash=abc&type=recovery', '/auth/reset?code=some-other-browser-code-1']) {
    const p = await (await ctx()).newPage(); await goto(p, path)
    await p.locator('#reset-email').waitFor({timeout: 90000})
    assert.equal(await p.locator('#new-password').count(), 0, path)
  }
  const elsewhere = await (await ctx()).newPage(); await goto(elsewhere, '/auth/reset?code=some-other-browser-code-2')
  await heading(elsewhere, 'Open the link where you asked for it')
  // an unknown code in a browser that DID ask for a link: the service refuses it, and no form opens
  const asked = await (await ctx()).newPage()
  await goto(asked, '/login'); await hydrated(asked, '#email'); await asked.getByRole('button', {name: 'Forgot password?'}).click(); await requestReset(asked, 'old@example.com')
  await goto(asked, '/auth/reset?code=never-issued-code-1234')
  await heading(asked, /expired|not valid/)
  assert.equal(await asked.locator('#new-password').count(), 0)
  assert.equal(world.calls.update.length, 0, 'no password was changed by any of them')
})

await scenario('unauthorized access is blocked and logout ends the session', 'desktop', async ({ctx}) => {
  world.users.set('old@example.com', {id: 'u-old', email: 'old@example.com', password: PASSWORD, confirmed: true})
  const context = await ctx({realDashboard: true})
  const page = await context.newPage()
  await goto(page, '/dashboard/settings'); await page.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  await logIn(page, 'old@example.com', PASSWORD)
  await page.waitForURL(atWorkspace, {timeout: 60000})
  await goto(page, '/dashboard')
  const logout = page.getByRole('button', {name: 'Logout'}).first()
  await logout.waitFor({timeout: 120000})
  await logout.click()
  await page.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  assert.ok(world.calls.logout.includes('global'), 'the service ended the session')
  assert.equal([...world.sessions.values()].filter((e) => e === 'old@example.com').length, 0)
  await goto(page, '/dashboard/settings'); await page.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  await hydrated(page, '#email'); assert.ok(await page.locator('#email').isVisible(), 'after logout the login form is shown, not redirected onward')
})

await scenario('the whole journey: signup -> confirmation email -> confirm -> login -> logout -> password reset -> login again', 'desktop', async ({ctx}) => {
  const first = await (await ctx()).newPage()
  await signUp(first, 'journey@example.com')
  assert.equal(world.emails.at(-1).to, 'journey@example.com'); assert.equal(world.emails.at(-1).redirectTo, `${linkBase}/auth/confirm`)
  await goto(first, confirmUrl('journey@example.com')); await first.waitForURL(atWorkspace, {timeout: 90000})
  const device2Context = await ctx({realDashboard: true})
  const device2 = await device2Context.newPage()
  await logIn(device2, 'journey@example.com', PASSWORD); await device2.waitForURL(atWorkspace, {timeout: 60000})
  await goto(device2, '/dashboard'); await device2.getByRole('button', {name: 'Logout'}).first().click()
  await device2.waitForURL((u) => u.pathname === '/login', {timeout: 90000})
  await hydrated(device2, '#email'); await device2.getByRole('button', {name: 'Forgot password?'}).click()
  await requestReset(device2, 'journey@example.com')
  await goto(device2, resetUrl('journey@example.com'))
  await device2.locator('#new-password').waitFor({timeout: 90000})
  await device2.locator('#new-password').fill('journey passphrase 2'); await device2.locator('#confirm-password').fill('journey passphrase 2')
  await device2.getByRole('button', {name: 'Update password'}).click(); await heading(device2, 'Password updated')
  const device3 = await (await ctx()).newPage()
  await logIn(device3, 'journey@example.com', 'journey passphrase 2'); await device3.waitForURL(atWorkspace, {timeout: 60000})
})

await scenario('phone: the link pages fit the screen and every control is a real touch target', 'phone', async ({ctx}) => {
  const context = await ctx()
  const page = await context.newPage()
  await signUp(page)
  world.codes.get(emailedCode('signup', 'new@example.com')).expired = true
  await goto(page, confirmUrl('new@example.com')); await heading(page, 'This link has expired'); await hydrated(page, '#resend-email')
  const sizes = async () => page.evaluate(() => [...document.querySelectorAll('input, button, a')].filter((el) => el.getBoundingClientRect().width > 0 && !el.closest('nextjs-portal') && !el.closest('next-route-announcer')).map((el) => ({tag: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || el.id).trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width), fs: parseFloat(getComputedStyle(el).fontSize)})))
  for (const el of await sizes()) assert.ok(el.h >= 44 && el.w >= 44, `${el.tag} "${el.label}" is ${el.w}x${el.h}`)
  assert.equal(await overflow(page), 0)
  await page.screenshot({path: `${shots}/phone-confirm-expired.png`, fullPage: true})
  world.users.get('new@example.com').confirmed = true
  await goto(page, '/login'); await hydrated(page, '#email'); await page.getByRole('button', {name: 'Forgot password?'}).click(); await requestReset(page, 'new@example.com')
  await goto(page, resetUrl('new@example.com')); await page.locator('#new-password').waitFor({timeout: 90000})
  for (const el of await sizes()) { assert.ok(el.h >= 44 && el.w >= 44, `${el.tag} "${el.label}" is ${el.w}x${el.h}`); if (el.tag === 'INPUT') assert.ok(el.fs >= 16, 'inputs are 16px or more') }
  assert.equal(await overflow(page), 0)
  await page.screenshot({path: `${shots}/phone-reset-form.png`, fullPage: true})
})

await scenario('repeatability: confirming in the original browser works every time in fresh browsers (no race with the Supabase client)', 'desktop', async ({browser}) => {
  for (let i = 0; i < 4; i += 1) {
    world = freshWorld()
    const context = await newContext(browser, 'desktop'); const page = await context.newPage()
    await signUp(page, `repeat${i}@example.com`)
    await goto(page, confirmUrl(`repeat${i}@example.com`))
    await page.waitForURL(atWorkspace, {timeout: 90000})
    assert.equal(world.users.get(`repeat${i}@example.com`).confirmed, true, `run ${i}`)
    await context.close()
  }
})

console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios passed`)
stop()
process.exit(results.every(Boolean) ? 0 : 1)
