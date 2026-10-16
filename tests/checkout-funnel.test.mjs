// The account-first checkout journey: choose plan -> create or open an account -> guest businesses come across -> straight on to
// Stripe -> back to ALPA -> activated. These tests cover the parts that live in the browser pages and the plan hand-over.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  checkoutStartHref, clearPendingCheckout, destinationAfterAuth, loginForPaymentHref, loginHref, parseCheckoutPlan, parseCheckoutSource,
  PENDING_CHECKOUT_TTL_MS, readPendingCheckout, safeNextPath, savePendingCheckout, signupHref,
} from '../lib/checkout/pending-plan.ts'

const read = (file) => fs.readFileSync(file, 'utf8')
const memory = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), removeItem: (k) => void data.delete(k), data } }

test('the chosen plan survives sign-up and sign-in: in the address and in the browser', () => {
  assert.equal(signupHref('pro', 'plans_featured'), '/login?mode=signup&plan=pro&source=plans_featured')
  assert.equal(loginHref('starter', 'upgrade'), '/login?plan=starter&source=upgrade')
  assert.equal(checkoutStartHref('starter', 'plans_footer'), '/checkout/start?plan=starter&source=plans_footer')
  const storage = memory()
  savePendingCheckout(storage, { plan: 'pro', source: 'plans_featured' }, 1_000)
  assert.deepEqual(readPendingCheckout(storage, 2_000), { plan: 'pro', source: 'plans_featured' }, 'survives the confirm-your-email round trip')
  assert.equal(readPendingCheckout(storage, 1_000 + PENDING_CHECKOUT_TTL_MS + 1), null, 'a day later it is forgotten')
  assert.equal(readPendingCheckout(storage, 1_000 - 120_000), null, 'a date from the future is refused')
  clearPendingCheckout(storage); assert.equal(readPendingCheckout(storage, 2_000), null)
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
  assert.doesNotThrow(() => savePendingCheckout(broken, { plan: 'starter', source: 'x' })); assert.equal(readPendingCheckout(broken), null)
  assert.equal(readPendingCheckout(null), null)
})

test('only real plans and plain labels travel; the return address is limited to finishing a payment', () => {
  assert.equal(parseCheckoutPlan('starter'), 'starter'); assert.equal(parseCheckoutPlan('pro'), 'pro')
  for (const bad of ['admin', 'free', 'prospector', '', null, undefined, 'starter ', 'STARTER', { plan: 'starter' }]) assert.equal(parseCheckoutPlan(bad), null, String(bad))
  assert.equal(parseCheckoutSource('plans_featured'), 'plans_featured')
  for (const bad of ['<script>', 'a b', '../x', 'x'.repeat(61), '', null, 42]) assert.equal(parseCheckoutSource(bad), 'upgrade', String(bad))
  assert.equal(safeNextPath('/post-checkout?session_id=cs_test_a1B2'), '/post-checkout?session_id=cs_test_a1B2')
  for (const bad of ['https://evil.example', '//evil.example', '/dashboard', '/post-checkout?session_id=../x', '/post-checkout?session_id=cs_1&next=//x', 'javascript:alert(1)', null]) assert.equal(safeNextPath(bad), null, String(bad))
  assert.equal(loginForPaymentHref('/post-checkout?session_id=cs_test_a1'), '/login?next=%2Fpost-checkout%3Fsession_id%3Dcs_test_a1')
  assert.equal(loginForPaymentHref('https://evil.example'), '/login')
})

test('after signing in: finish a payment first, else continue to checkout with the chosen plan, else the usual page', () => {
  const pending = { plan: 'pro', source: 'plans_featured' }
  assert.equal(destinationAfterAuth({ next: '/post-checkout?session_id=cs_1', pending, fallback: '/dashboard/scraper' }), '/post-checkout?session_id=cs_1')
  assert.equal(destinationAfterAuth({ next: null, pending, fallback: '/dashboard/scraper' }), '/checkout/start?plan=pro&source=plans_featured')
  assert.equal(destinationAfterAuth({ next: null, pending: null, fallback: '/dashboard' }), '/dashboard')
})

test('wiring: the plan button, the sign-up page, the hand-over page and the return page', () => {
  const button = read('components/checkout/StartCheckoutButton.tsx')
  assert.match(button, /savePendingCheckout\(window\.localStorage/); assert.match(button, /window\.location\.href = signupHref\(plan, source\)/)
  assert.doesNotMatch(button, /'\/login\?mode=signup'/, 'the plan is no longer dropped')
  const login = read('app/login/page.tsx')
  assert.equal((login.match(/destinationAfterAuth\(/g) ?? []).length, 4, 'every way of finishing sign-up or sign-in continues the journey')
  assert.doesNotMatch(login, /router\.push\('\/dashboard/, 'no sign-in path ignores the chosen plan')
  // the guest businesses are claimed BEFORE the visitor moves on to checkout
  const firstClaim = login.indexOf('await claimGuestTrialIfNeeded()'); assert.ok(firstClaim > 0)
  for (const match of login.matchAll(/destinationAfterAuth\(/g)) {
    const before = login.slice(0, match.index)
    assert.ok(before.lastIndexOf('await claimGuestTrialIfNeeded()') > before.lastIndexOf('const handleAuth') - 1 || before.includes('await claimGuestTrialIfNeeded()'), 'claim runs first')
  }
  assert.match(login, /continue to checkout/)
  const start = read('app/checkout/start/page.tsx')
  assert.match(start, /startedRef\.current = true/, 'asks the server once'); assert.match(start, /code === 'already_subscribed'/)
  assert.match(start, /status === 401/); assert.match(start, /clearPendingCheckout/); assert.doesNotMatch(start, /stripe\.com|checkout\.sessions/i, 'the server decides the checkout; the page only follows its address')
  const back = read('components/auth/PostCheckoutAccountForm.tsx')
  assert.match(back, /loginForPaymentHref\(`\/post-checkout\?session_id=\$\{sessionId\}`\)/)
  assert.match(back, /body: JSON\.stringify\(\{ sessionId: currentSessionId \}\)/, 'only the session id is sent to activation')
  assert.doesNotMatch(back, /cleanWorkspace|getGuestLeads/)
})

test('abandoning checkout returns to the plans page and nothing in that path deletes data', () => {
  assert.match(read('lib/stripe.ts'), /cancel_url: `\$\{baseUrl\}\/plans`/)
  const activate = read('app/api/post-checkout/activate/route.ts').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(activate, /\.delete\(|\.insert\(|from\('leads'\)|cleanWorkspace/)
  const claim = read('app/api/guest/claim/route.ts')
  assert.doesNotMatch(claim, /\.delete\(/)
})
