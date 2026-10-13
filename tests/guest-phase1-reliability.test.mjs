import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import { safeRandomId } from '../lib/guest/safe-id.ts'
import { safeGetItem, safeRemoveItem, safeSetItem } from '../lib/guest/safe-storage.ts'
import { clearTrialParam, consumeTrialOpenRequest, OPEN_TRIAL_HREF, requestTrialOpen } from '../lib/guest/open-request.ts'
import { recoverGuestSearch } from '../lib/guest/recovery.ts'
import { describeSearchFailure, detectInAppBrowser, parseErrorBody } from '../lib/guest/search-errors.ts'
import { classifyReserveRefusal } from '../lib/guest/reserve-refusal.ts'

const read = (file) => fs.readFileSync(file, 'utf8')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function withGlobals(overrides, run) {
  const saved = new Map()
  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  try { return run() } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

// ---- ids and storage: the silent-failure causes on phones ----

test('a random id is produced where crypto.randomUUID is missing (old iOS, plain-http pages) and where crypto is absent', () => {
  assert.match(safeRandomId(), UUID)
  withGlobals({ crypto: { getRandomValues: (a) => a.fill(7) } }, () => assert.match(safeRandomId(), UUID))
  withGlobals({ crypto: {} }, () => assert.match(safeRandomId(), UUID))
  withGlobals({ crypto: undefined }, () => assert.match(safeRandomId(), UUID))
  withGlobals({ crypto: { randomUUID() { throw new Error('insecure context') } } }, () => assert.match(safeRandomId(), UUID))
  assert.notEqual(safeRandomId(), safeRandomId())
})

test('storage that throws on access (blocked storage) never throws and still holds values for the page view', () => {
  const blocked = {}
  Object.defineProperty(blocked, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } })
  Object.defineProperty(blocked, 'sessionStorage', { get() { throw new DOMException('denied', 'SecurityError') } })
  withGlobals({ window: blocked }, () => {
    assert.equal(safeGetItem('local', 'k'), null)
    assert.equal(safeSetItem('local', 'k', 'v'), false)
    assert.equal(safeGetItem('local', 'k'), 'v')
    assert.equal(safeSetItem('session', 's', '1'), false)
    assert.equal(safeGetItem('session', 's'), '1')
    safeRemoveItem('local', 'k')
    assert.equal(safeGetItem('local', 'k'), null)
  })
})

test('a full storage (setItem throws) and a read that throws fall back to memory', () => {
  const store = { getItem() { throw new Error('read failed') }, setItem() { throw new DOMException('full', 'QuotaExceededError') }, removeItem() { throw new Error('nope') } }
  withGlobals({ window: { localStorage: store, sessionStorage: store } }, () => {
    assert.equal(safeSetItem('local', 'big', 'x'), false)
    assert.equal(safeGetItem('local', 'big'), 'x')
    assert.doesNotThrow(() => safeRemoveItem('local', 'big'))
    assert.equal(safeGetItem('local', 'big'), null)
  })
})

test('working storage is used and read back', () => {
  const data = new Map()
  const store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
  withGlobals({ window: { localStorage: store, sessionStorage: store } }, () => {
    assert.equal(safeSetItem('local', 'a', '1'), true)
    assert.equal(data.get('a'), '1')
    assert.equal(safeGetItem('local', 'a'), '1')
  })
})

test('no guest or analytics code touches browser storage or crypto.randomUUID directly any more', () => {
  for (const file of ['lib/guest-session.ts', 'lib/session/guest-trial-mode.ts']) {
    assert.doesNotMatch(read(file), /window\.(local|session)Storage|crypto\.randomUUID/, file)
  }
  const track = read('lib/track.ts')
  // the only direct storage use left in track.ts is inside try/catch helpers that existed before and cannot stop a search
  assert.doesNotMatch(track, /createAnalyticsSearchId[\s\S]{0,300}window\.crypto\.randomUUID/)
  const flow = read('components/landing/FreeTrialCommandFlow.tsx')
  assert.doesNotMatch(flow, /window\.(local|session)Storage|crypto\.randomUUID|sessionStorage\.setItem/)
})

// ---- the tap is never lost ----

test('a tap before the dialog component mounted is remembered and consumed exactly once', () => {
  const win = new EventTarget()
  win.location = { search: '' }
  requestTrialOpen(win)
  assert.equal(consumeTrialOpenRequest(win), true)
  assert.equal(consumeTrialOpenRequest(win), false)
})

test('following the link (a pre-hydration tap) opens the dialog through ?trial=1, and the parameter is then removed', () => {
  assert.equal(OPEN_TRIAL_HREF, '/?trial=1')
  const win = { location: { search: '?trial=1', href: 'https://alpa.test/?trial=1&utm_source=ig#top' }, history: { state: null, replaceState(_s, _t, url) { this.url = url } } }
  assert.equal(consumeTrialOpenRequest(win), true)
  clearTrialParam(win)
  assert.equal(win.history.url, '/?utm_source=ig#top')
  assert.equal(consumeTrialOpenRequest({ location: { search: '?utm_source=ig' } }), false)
})

test('the landing call to action is a real link that still opens in place when the page is ready', () => {
  const cta = read('components/landing/FreshStartCta.tsx')
  assert.match(cta, /<a href=\{OPEN_TRIAL_HREF\} onClick=\{handleClick\}/)
  assert.match(cta, /event\.preventDefault\(\)/)
  assert.match(cta, /requestTrialOpen\(\)/)
  assert.doesNotMatch(cta, /<button/)
  const flow = read('components/landing/FreeTrialCommandFlow.tsx')
  assert.match(flow, /if \(consumeTrialOpenRequest\(\)\) open\(\)/)
})

// ---- recovery ----

function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms) => { t += ms } }
}
const session = (over) => ({ leads: [], used: 0, attempts: 0, searching: false, ...over })
const sequence = (...snaps) => { let i = 0; return async () => { const s = snaps[Math.min(i, snaps.length - 1)]; i += 1; return s } }

test('recovery waits while the server is still searching, then reports the saved businesses', async () => {
  const c = clock()
  const result = await recoverGuestSearch({
    fetchSession: sequence(session({ attempts: 1, searching: true }), session({ attempts: 1, searching: true }), session({ attempts: 1, used: 2, leads: [{}, {}] })),
    baselineAttempts: 0, baselineLeads: 0, ...c,
  })
  assert.deepEqual(result, { state: 'completed', leads: 2 })
})

test('recovery of a finished search that found nothing reports zero businesses, not an error', async () => {
  const c = clock()
  const result = await recoverGuestSearch({ fetchSession: sequence(session({ attempts: 1 })), baselineAttempts: 0, baselineLeads: 0, ...c })
  assert.deepEqual(result, { state: 'completed', leads: 0 })
})

test('a request that never reached the server is reported as not started, only after a grace period', async () => {
  const c = clock()
  let calls = 0
  const result = await recoverGuestSearch({
    fetchSession: async () => { calls += 1; return session({ attempts: 1, leads: [{}] }) },
    baselineAttempts: 1, baselineLeads: 1, notStartedGraceMs: 6000, intervalMs: 3000, ...c,
  })
  assert.deepEqual(result, { state: 'not_started' })
  assert.ok(calls >= 3, 'it looked more than once before concluding')
})

test('a search that appears on the server during the grace period is not mistaken for "not started"', async () => {
  const c = clock()
  const result = await recoverGuestSearch({
    fetchSession: sequence(session({ attempts: 1 }), session({ attempts: 2, searching: true }), session({ attempts: 2, used: 1, leads: [{}] })),
    baselineAttempts: 1, baselineLeads: 0, ...c,
  })
  assert.deepEqual(result, { state: 'completed', leads: 1 })
})

test('a reload or a "search already running" answer assumes the search started', async () => {
  const c = clock()
  const result = await recoverGuestSearch({ fetchSession: sequence(session({ attempts: 0, leads: [] })), baselineAttempts: null, baselineLeads: null, assumeStarted: true, ...c })
  assert.deepEqual(result, { state: 'completed', leads: 0 })
})

test('an unreachable server is retried and finally reported as pending, never as a finished or failed search', async () => {
  const c = clock()
  let waiting = 0
  const result = await recoverGuestSearch({ fetchSession: async () => { throw new Error('offline') }, baselineAttempts: 0, baselineLeads: 0, timeoutMs: 20_000, onWaiting: () => { waiting += 1 }, ...c })
  assert.deepEqual(result, { state: 'pending' })
  assert.ok(waiting > 0)
})

test('a search the server reports as running past the wait is pending, and the visitor can stop the wait', async () => {
  const c = clock()
  assert.deepEqual(await recoverGuestSearch({ fetchSession: sequence(session({ attempts: 1, searching: true })), baselineAttempts: 0, baselineLeads: 0, timeoutMs: 30_000, ...c }), { state: 'pending' })
  let stop = false
  const result = await recoverGuestSearch({ fetchSession: async () => { stop = true; return session({ searching: true }) }, baselineAttempts: 0, baselineLeads: 0, shouldStop: () => stop, ...clock() })
  assert.deepEqual(result, { state: 'pending' })
})

// ---- messages ----

test('error bodies of every shape are read without throwing', () => {
  assert.deepEqual(parseErrorBody('data: {"type":"log","message":"❌ nope","code":"GUEST_RATE_LIMITED"}\n\n'), { message: '❌ nope', code: 'GUEST_RATE_LIMITED' })
  assert.deepEqual(parseErrorBody('{"error":"bad"}'), { message: 'bad', code: undefined })
  assert.equal(parseErrorBody('<!DOCTYPE html><html>Gateway Timeout</html>'), null)
  assert.equal(parseErrorBody('An error occurred with your deployment'), null)
  assert.equal(parseErrorBody(''), null)
  assert.equal(parseErrorBody(undefined), null)
})

test('each refusal has its own plain message and the right next step', () => {
  const running = describeSearchFailure({ status: 429, code: 'GUEST_RUNNING' })
  assert.equal(running.kind, 'running'); assert.equal(running.resultsAvailable, true)
  const used = describeSearchFailure({ status: 429, code: 'GUEST_ALLOWANCE_USED' })
  assert.equal(used.kind, 'limit'); assert.equal(used.resultsAvailable, true); assert.equal(used.retryable, false)
  assert.match(describeSearchFailure({ status: 429, code: 'GUEST_SEARCHES_USED' }).message, /free searches/i)
  const rate = describeSearchFailure({ status: 429, code: 'GUEST_RATE_LIMITED' })
  assert.equal(rate.kind, 'rate'); assert.doesNotMatch(rate.message, /allowance/i); assert.equal(rate.resultsAvailable, false)
  assert.equal(describeSearchFailure({ status: 503, code: 'GUEST_UNAVAILABLE' }).retryable, true)
  assert.equal(describeSearchFailure({ status: 410, code: 'GUEST_EXPIRED' }).kind, 'expired')
})

test('unexpected failures get human messages, never parser errors or HTML', () => {
  for (const input of [{ status: 504 }, { status: 502 }, { status: 500 }, { status: 0 }, { networkError: true }, { stalled: true }, { offline: true }, { status: 418 }]) {
    const failure = describeSearchFailure(input)
    assert.ok(failure.message.length > 10)
    assert.doesNotMatch(failure.message, /Unexpected token|JSON|<|undefined/)
  }
  assert.equal(describeSearchFailure({ offline: true }).kind, 'offline')
  assert.equal(describeSearchFailure({ status: 504 }).kind, 'timeout')
})

test('browsers embedded in social apps are recognised', () => {
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148 Instagram 300.0'), 'instagram')
  assert.equal(detectInAppBrowser('Mozilla/5.0 (Linux; Android 13) ... [FB_IAB/FB4A;FBAV/450.0]'), 'facebook')
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone) ... musical_ly_30.0.0'), 'tiktok')
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1'), null)
})

test('a refused reservation is explained from the trial row: wait, saved results, or a shared network', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')
  const base = { created_at: '2026-10-12T00:00:00Z', attempts: 1, used: 10, active_until: null }
  assert.equal(classifyReserveRefusal(null, now), 'GUEST_UNAVAILABLE')
  assert.equal(classifyReserveRefusal({ ...base, active_until: '2026-10-13T12:03:00Z' }, now), 'GUEST_RUNNING')
  assert.equal(classifyReserveRefusal({ ...base, active_until: '2026-10-13T11:00:00Z' }, now), 'GUEST_RATE_LIMITED')
  assert.equal(classifyReserveRefusal({ ...base, attempts: 3 }, now), 'GUEST_SEARCHES_USED')
  assert.equal(classifyReserveRefusal({ ...base, used: 25 }, now), 'GUEST_ALLOWANCE_USED')
  assert.equal(classifyReserveRefusal({ ...base, created_at: '2026-08-01T00:00:00Z' }, now), 'GUEST_EXPIRED')
  assert.equal(classifyReserveRefusal(base, now), 'GUEST_RATE_LIMITED')
})

// ---- the server side and the search component are wired to all of it ----

test('the engine route names each guest refusal and keeps guest streams alive', () => {
  const route = read('app/api/scrape/route.ts').replace(/\s+/g, ' ')
  assert.match(route, /classifyReserveRefusal\(row\)/)
  assert.match(route, /refuse\('GUEST_ORIGIN', 403\)/)
  assert.match(route, /refuse\('GUEST_INVALID', 400\)/)
  assert.match(route, /refuse\(code, code === 'GUEST_UNAVAILABLE' \? 503 : code === 'GUEST_EXPIRED' \? 410 : 429\)/)
  assert.match(route, /if \(isGuestMode\) \{ keepAlive = setInterval/)
  assert.match(route, /': ping\\n\\n'/)
  // every stream exit stops the keepalive
  assert.equal((route.match(/controller\.close\(\)/g) || []).length, 1, 'only closeStream closes the stream')
  assert.match(route, /cancel\(\) \{ stopKeepAlive\(\) \}/)
  // a dropped phone must not cancel the search or its save
  assert.doesNotMatch(route, /cancel\(\) \{[^}]*abort/i)
})

test('the session endpoint reports whether a search is running, and never exposes the run id', () => {
  const server = read('lib/guest/server.ts')
  assert.match(server, /active_until/)
  assert.match(server, /searching: Boolean\(active_until && Date\.parse\(active_until\) > Date\.now\(\)\)/)
  assert.doesNotMatch(server, /active_run/)
  assert.match(read('app/api/guest/session/route.ts'), /searching:false/)
})

test('the search component: setup inside the guarded block, stalls detected, recovery on a lost connection, no silent failures', () => {
  const flow = read('components/landing/FreeTrialCommandFlow.tsx')
  const start = flow.slice(flow.indexOf('const startSearch = useCallback'), flow.indexOf('const downloadCsv'))
  // setup (storage, ids, analytics) is inside the try, so an exception becomes a visible error instead of a dead button
  assert.ok(start.indexOf('try {') < start.indexOf('enableGuestTrialMode()'))
  assert.ok(start.indexOf('try {') < start.indexOf('getOrCreateGuestSessionId()'))
  assert.ok(start.indexOf('try {') < start.indexOf('createAnalyticsSearchId()'))
  assert.match(start, /showFailure\(describeSearchFailure\(\{\}\)\)/)
  assert.match(start, /STALL_AFTER_MS/)
  assert.match(start, /runRecovery\(\{ assumeStarted: false, baselineAttempts: baseline\.attempts/)
  assert.match(start, /body\?\.code === 'GUEST_RUNNING'/)
  assert.match(start, /report\('trial_search_failed'/)
  assert.match(start, /searchingRef\.current = false/)
  // the old error parsing that produced "Unexpected token" is gone
  assert.doesNotMatch(flow, /JSON\.parse\(text\.replace/)
  // a search in progress is picked up again after a reload
  assert.match(flow, /data\.searching && !searchingRef\.current/)
  assert.match(flow, /wakeLock/)
})

test('the search is never started twice at once', () => {
  const flow = read('components/landing/FreeTrialCommandFlow.tsx')
  assert.match(flow, /if \(!businessType\.trim\(\) \|\| !location\.trim\(\) \|\| searchingRef\.current\) return/)
})

// ---- Phase 1b: no email collection, immediate CSV, one thank-you ----

test('the guest CSV needs no email: a GET that stores nothing and returns only the cookie holder\'s own results', () => {
  const route = read('app/api/guest/export/route.ts').replace(/^\s*\/\/.*$/gm, '')
  assert.match(route, /export async function GET/)
  assert.doesNotMatch(route, /export async function POST/)
  assert.doesNotMatch(route, /email|marketing|consent|\.update\(|\.insert\(/i)
  assert.match(route, /Content-Disposition/)
  assert.match(route, /guestSession\(\)/)
  assert.doesNotMatch(route, /guestSession\(true\)/, 'a download never creates a trial')
  assert.doesNotMatch(read('lib/guest/server.ts'), /marketing_opt_in|\bemail\b/)
})

test('the results page has no email field, no marketing checkbox and no dialog; it offers the plain download and one thank-you', () => {
  const page = read('components/guest/GuestResults.tsx')
  assert.doesNotMatch(page, /type="email"|type="checkbox"|marketing|saveGuestCaptureEmail|Get my CSV|role="dialog"|exportOpen/i)
  assert.match(page, /href="\/api\/guest\/export" onClick=\{onDownload\}/)
  assert.doesNotMatch(page, /download="/, 'the file name comes from the server header; a download attribute is not needed and can cancel the save')
  assert.match(page, /Your businesses are ready\./)
  assert.match(page, /Thanks for giving ALPA a try\. Now go start some conversations\./)
  assert.match(page, /Explore ALPA plans →/)
  assert.doesNotMatch(page, /50%|discount|off your first month/i, 'no discount at the download moment')
})
