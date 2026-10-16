// Page-load measurements for the landing page, on a phone-class device (4x slower CPU, 1.6 Mbps, 150 ms) and on a desktop, median of five.
// Run against a production build:  node tests/landing-demo-perf.mjs http://localhost:3309 "label" [phone|desktop]
import {chromium} from 'playwright'

const [base, label, device = 'phone'] = process.argv.slice(2)
const browser = await chromium.launch({headless: true, channel: 'chrome'})
const config = device === 'phone' ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2} : {viewport: {width: 1366, height: 860}}
const runs = []
for (let i = 0; i < 5; i += 1) {
  const context = await browser.newContext(config)
  const page = await context.newPage()
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()))
  const cdp = await context.newCDPSession(page)
  if (device === 'phone') {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4})
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8})
  }
  await page.addInitScript(() => {
    window.__m = {lcp: 0, cls: 0, fcp: 0, long: 0, lcpEl: ''}
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__m.lcp = e.startTime; window.__m.lcpEl = `${e.element?.tagName || ''}:${(e.element?.textContent || '').trim().slice(0, 30)}` } }).observe({type: 'largest-contentful-paint', buffered: true})
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value }).observe({type: 'layout-shift', buffered: true})
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime }).observe({type: 'paint', buffered: true})
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.long += Math.max(0, e.duration - 50) }).observe({type: 'longtask', buffered: true})
  })
  await page.goto(`${base}/`, {waitUntil: 'load', timeout: 120000})
  await page.waitForTimeout(9000) // through the first two stages of the demonstration
  runs.push(await page.evaluate(() => {
    const scripts = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js'))
    return {...window.__m, jsKB: Math.round(scripts.reduce((t, r) => t + (r.encodedBodySize || 0), 0) / 1024), requests: performance.getEntriesByType('resource').length, nodes: document.querySelectorAll('*').length}
  }))
  await context.close()
}
await browser.close()
const median = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[2]
console.log(JSON.stringify({label, device, LCP_ms: Math.round(median('lcp')), FCP_ms: Math.round(median('fcp')), CLS: +median('cls').toFixed(4), blockingTime_ms: Math.round(median('long')), scriptsKB: median('jsKB'), requests: median('requests'), domNodes: median('nodes'), lcpElement: runs[2].lcpEl}))
