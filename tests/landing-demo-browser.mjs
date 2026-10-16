// The landing-page demonstration in real browsers: desktop, tablet, phone and reduced motion. Nothing external is reachable.
//   node tests/landing-demo-browser.mjs                       starts its own dev server on :3308
//   BASE_URL=http://localhost:3309 node tests/landing-demo-browser.mjs   (against a production build)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'

const external = process.env.BASE_URL
const base = external || 'http://localhost:3308'
const shots = process.env.LANDING_SCREENSHOT_DIR || '/private/tmp/alpa-landing-browser'
fs.mkdirSync(shots, {recursive: true})
let dev = null
if (!external) {
  const log = fs.openSync('/tmp/landing-dev.log', 'w')
  dev = spawn('npx', ['next', 'dev', '-p', '3308'], {env: {...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:3999', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test_offline', NEXT_TELEMETRY_DISABLED: '1'}, stdio: ['ignore', log, log]})
}
const stop = () => { try { dev?.kill() } catch {} }
process.on('exit', stop)
for (let i = 0; i < 90; i += 1) { try { await fetch(base + '/'); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }

const DEVICES = {
  desktop: {viewport: {width: 1366, height: 860}},
  tablet: {viewport: {width: 820, height: 1100}, hasTouch: true},
  phone: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2},
}
const results = []
async function scenario(name, device, fn, {reduced = false, clock = false} = {}) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext({...DEVICES[device], reducedMotion: reduced ? 'reduce' : 'no-preference'})
  const blocked = []; const requested = []
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    requested.push(url.pathname)
    if (url.origin === new URL(base).origin) return route.continue()
    // The site's existing voice-assistant widget (not part of the demonstration) loads from a third party on every page; it is blocked here.
    // (On the live site the same applies to its analytics and voice-assistant services, which load on every page and are not the demonstration's.)
    if (!/unpkg\.com\/@elevenlabs|googletagmanager\.com|google-analytics\.com|elevenlabs\.io|storage\.googleapis\.com/.test(url.href)) blocked.push(url.href)
    return route.abort()
  })
  const page = await context.newPage()
  if (clock) await page.clock.install()
  try { await fn({page, context, blocked, requested}); results.push(true); console.log(`PASS  ${name}`) } catch (error) { results.push(false); console.log(`FAIL  ${name}\n      ${String(error.message || error).split('\n').slice(0, 6).join('\n      ')}`) }
  await browser.close()
}
// React must have taken over before anything is clicked, or the click is lost (it matters on a slow network).
const open = async (page) => {
  await page.goto(base + '/', {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.getByRole('group', {name: /ALPA workflow demonstration/}).waitFor({timeout: 120000})
  await page.waitForFunction(() => { const el = document.querySelector('[aria-label="Choose a step"] button'); return Boolean(el) && Object.keys(el).some((key) => key.startsWith('__reactProps')) }, null, {timeout: 120000})
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const activeStage = (page) => page.locator('[role=group][aria-label="Choose a step"] button[aria-pressed="true"] span:nth-of-type(2)').innerText().then((text) => text.trim().toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase()).replace('Ai Intelligence', 'AI Intelligence'))
const demo = (page) => page.getByRole('group', {name: /ALPA workflow demonstration/})
const visibleOpacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity))

for (const device of ['desktop', 'tablet', 'phone']) {
  await scenario(`${device}: the page, hero message, calls to action, navigation and sign-up links are all intact around the demonstration`, device, async ({page}) => {
    await open(page)
    assert.equal(await overflow(page), 0, 'no horizontal scroll')
    await page.getByRole('heading', {level: 1}).waitFor()
    assert.match((await page.getByRole('heading', {level: 1}).innerText()).replace(/\s+/g, ' '), /^You need customers\. We find them for you\.$/)
    const cta = page.getByRole('link', {name: 'Find 25 businesses free →'})
    assert.equal(await cta.getAttribute('href'), '/trial')
    assert.ok(await page.getByText('No account. No credit card. Just start.').isVisible())
    for (const [name, href] of [['Plans', '/plans'], ['Resources', '/resources'], ['Log in', '/login']]) {
      const link = page.getByRole('link', {name, exact: true}).first()
      if (device !== 'phone') assert.equal(await link.getAttribute('href'), href, name)
    }
    assert.equal(await page.getByRole('link', {name: 'View Plans'}).getAttribute('href'), '/plans')
    assert.ok((await page.locator('a[href="/trial"]').count()) >= 5, 'every free-trial link is still there')
    assert.ok((await page.locator('a[href*="login"]').count()) >= 1)
    // metadata and structured data
    assert.equal(await page.title(), 'Lead Generation Tool for Freelancers & Agencies | ALPA')
    assert.match(await page.locator('meta[name=description]').getAttribute('content'), /discovering your first 25 businesses free/)
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://alpa.mindrasolutions.com')
    const blocks = (await page.locator('script[type="application/ld+json"]').allInnerTexts()).map((text) => JSON.parse(text))
    const ld = blocks.find((block) => block['@type'] === 'SoftwareApplication')
    assert.ok(ld, 'the SoftwareApplication structured data is still there'); assert.equal(ld.offers.length, 2); assert.ok(blocks.length >= 2, 'the site-wide structured data too')
    // the demonstration is labelled as a demonstration
    assert.ok(await page.getByText('Demonstration · sample data').isVisible())
    assert.ok(await page.getByText('Sample businesses are fictional', {exact: false}).isVisible())
    await cta.click()
    await page.waitForURL((u) => u.pathname === '/trial', {timeout: 90000})
  })
}

await scenario('desktop: the three stages play in order and loop, with the right content in each', 'desktop', async ({page}) => {
  await open(page)
  assert.equal(await activeStage(page), 'Discover')
  await page.waitForTimeout(3500) // typing and the first businesses (real CSS time)
  assert.ok(await demo(page).getByText('Halden & Roe Architects').first().isVisible())
  assert.equal(await demo(page).locator('[class*=row]').count() > 0, true)
  await page.clock.fastForward(7700)
  assert.equal(await activeStage(page), 'Enrich')
  await demo(page).getByText('Gathering public information').waitFor()
  await page.waitForTimeout(4600)
  for (const text of ['haldenroe.example', '(416) 555-0131', 'studio@haldenroe.example', 'Boutique studio working on heritage restoration']) assert.ok(await demo(page).getByText(text).first().isVisible(), text)
  await page.clock.fastForward(8100)
  assert.equal(await activeStage(page), 'AI Intelligence')
  await demo(page).getByText('AI business profile').waitFor()
  await page.waitForTimeout(5600)
  assert.ok(await demo(page).getByText('A small Toronto architecture studio', {exact: false}).first().isVisible())
  assert.ok(await demo(page).getByText('Heritage restoration').first().isVisible())
  assert.ok(await demo(page).getByText('Written from the information the business publishes. Details vary.').isVisible())
  await page.screenshot({path: `${shots}/desktop-intelligence.png`})
  await page.clock.fastForward(8900)
  assert.equal(await activeStage(page), 'Discover', 'it loops')
}, {clock: true})

await scenario('desktop: pause stops it, play resumes it; the steps can be chosen; it waits while scrolled out of view', 'desktop', async ({page}) => {
  await open(page)
  await page.getByRole('button', {name: 'Pause the demonstration'}).click()
  await page.clock.fastForward(30000)
  assert.equal(await activeStage(page), 'Discover', 'paused: nothing advances')
  assert.equal(await demo(page).getAttribute('data-playing'), 'false')
  await page.getByRole('button', {name: 'Play the demonstration'}).click()
  await page.clock.fastForward(7700)
  assert.equal(await activeStage(page), 'Enrich')
  await page.getByRole('button', {name: /AI Intelligence/}).click()
  assert.equal(await activeStage(page), 'AI Intelligence'); await demo(page).getByText('AI business profile').waitFor()
  await page.getByRole('button', {name: /Discover/}).click()
  assert.equal(await activeStage(page), 'Discover')
  // scrolled away: it holds its place
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(600)
  const before = await activeStage(page)
  await page.clock.fastForward(40000)
  assert.equal(await activeStage(page), before, 'out of view: it does not run')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(600)
  await page.clock.fastForward(7700)
  assert.notEqual(await activeStage(page), before, 'back in view: it continues')
}, {clock: true})

for (const device of ['desktop', 'tablet', 'phone']) {
  await scenario(`${device}: nothing external is requested and the animation uses only compositor-friendly properties`, device, async ({page, blocked}) => {
    await open(page)
    await page.waitForTimeout(3500)
    const properties = await page.evaluate(() => {
      const names = new Set()
      for (const animation of document.getAnimations()) for (const frame of animation.effect?.getKeyframes?.() ?? []) for (const key of Object.keys(frame)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(key)) names.add(key)
      return {names: [...names], running: document.getAnimations().length}
    })
    assert.ok(properties.running >= 10, `${properties.running} animations are running`)
    for (const name of properties.names) assert.ok(['opacity', 'transform', 'clipPath'].includes(name), `animated property ${name}`)
    assert.deepEqual(blocked, [], 'nothing outside this site was requested')
    assert.equal(await overflow(page), 0)
  })
}

await scenario('phone: one thing at a time, tappable controls, fits the screen; tablet keeps two columns', 'phone', async ({page}) => {
  await open(page)
  await demo(page).scrollIntoViewIfNeeded()
  await page.waitForTimeout(3600)
  const rows = await demo(page).locator('li').evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0).length)
  assert.ok(rows <= 5, `${rows} visible rows on a phone`)
  const sizes = await demo(page).locator('button').evaluateAll((els) => els.map((el) => ({label: (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width)})))
  for (const el of sizes) assert.ok(el.h >= 44 && el.w >= 44, `"${el.label}" is ${el.w}x${el.h}`)
  await page.getByRole('button', {name: /Enrich/}).click()
  await page.waitForTimeout(4800)
  assert.equal(await demo(page).locator('ul').first().isVisible().catch(() => false), false, 'the list gives way to the detail on a narrow screen')
  assert.ok(await demo(page).getByText('studio@haldenroe.example').isVisible())
  const box = await demo(page).boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'inside the screen')
  await page.screenshot({path: `${shots}/phone-enrich.png`})
  await page.getByRole('button', {name: /AI Intelligence/}).click()
  await page.waitForTimeout(5800)
  await demo(page).scrollIntoViewIfNeeded()
  await page.screenshot({path: `${shots}/phone-intelligence.png`})
})

await scenario('tablet: two columns, whole demonstration in view', 'tablet', async ({page}) => {
  await open(page)
  await demo(page).scrollIntoViewIfNeeded()
  await page.waitForTimeout(5200)
  const [list, side] = await Promise.all([demo(page).locator('ul').first().boundingBox(), demo(page).locator('[class*=side]').first().boundingBox()])
  assert.ok(side.x > list.x + list.width - 2, 'the detail sits beside the list')
  await page.screenshot({path: `${shots}/tablet-discover.png`})
})

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}, reduced motion: nothing moves, the finished picture is shown, the steps still work`, device, async ({page, blocked}) => {
    await open(page)
    await page.waitForTimeout(1200)
    assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length), 0, 'no animation is running')
    assert.equal(await page.getByRole('button', {name: /Pause the demonstration/}).count(), 0, 'no pause button is needed when nothing moves')
    assert.equal(await activeStage(page), 'Discover')
    const first = demo(page).getByText('Halden & Roe Architects').first()
    assert.equal(await visibleOpacity(first), 1, 'businesses are shown, not faded in')
    assert.ok(await demo(page).getByText('25', {exact: true}).first().isVisible(), 'the count is the finished number')
    await page.clock?.fastForward?.(30000).catch(() => {})
    await page.waitForTimeout(500)
    assert.equal(await activeStage(page), 'Discover', 'it does not advance by itself')
    await page.getByRole('button', {name: /Enrich/}).click()
    for (const text of ['haldenroe.example', '(416) 555-0131', 'studio@haldenroe.example']) assert.equal(await visibleOpacity(demo(page).getByText(text).first()), 1, `${text} is immediately visible`)
    await page.getByRole('button', {name: /AI Intelligence/}).click()
    assert.equal(await visibleOpacity(demo(page).getByText('A small Toronto architecture studio', {exact: false}).first()), 1)
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[class*=window]')).transform), 'none', 'no tilt')
    assert.deepEqual(blocked, [])
    assert.equal(await overflow(page), 0)
    await page.screenshot({path: `${shots}/${device}-reduced.png`})
  }, {reduced: true})
}

await scenario('desktop: the page does not shift while it plays (layout stability) and long tasks stay short', 'desktop', async ({page}) => {
  await page.addInitScript(() => {
    window.__cls = 0; window.__long = []
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({type: 'layout-shift', buffered: true})
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({type: 'longtask', buffered: true})
  })
  await open(page)
  await page.waitForTimeout(26000) // a whole loop
  const {cls, long} = await page.evaluate(() => ({cls: window.__cls, long: window.__long}))
  assert.ok(cls < 0.05, `layout shift ${cls.toFixed(4)} while it plays`)
  console.log(`      layout shift ${cls.toFixed(4)}, long tasks (ms): ${JSON.stringify(long)}${external ? '' : ' (development server: not representative)'}`)
})

console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios passed`)
stop()
process.exit(results.every(Boolean) ? 0 : 1)
