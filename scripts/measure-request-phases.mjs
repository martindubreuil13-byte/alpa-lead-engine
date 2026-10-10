// Where does the time go in one robots.txt request and one page request?
//
//   node --experimental-strip-types scripts/measure-request-phases.mjs <sites.json> [every-nth=3]
//
// For a small subset of the existing validation sites: one COLD robots.txt request, then one COLD
// homepage request (new connection each), then one homepage request over a connection REUSED from a
// keep-alive robots.txt request. Phases come from the socket's own events. Robots.txt is honoured:
// a site that disallows the homepage is skipped. No forms, no logins, no browser.

import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { performance } from 'node:perf_hooks'

import { isUrlAllowed, parseRobots, selectRobotsRules } from '../lib/commercial-intelligence/robots.ts'
import { DEFAULT_WEBSITE_USER_AGENT } from '../lib/commercial-intelligence/user-agent.ts'

const [sitesPath, nth = '3'] = process.argv.slice(2)
const sites = JSON.parse(fs.readFileSync(sitesPath, 'utf8')).filter((_, index) => index % Number(nth) === 0)
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One GET with per-phase timing. `agent` is false for a cold connection, a keep-alive agent to reuse. */
function timedGet(url, agent) {
  const target = new URL(url)
  const secure = target.protocol === 'https:'
  return new Promise((resolve) => {
    const t = { start: performance.now() }
    const finish = (extra) => resolve({ ...extra, total: performance.now() - t.start })
    const request = (secure ? https : http).request(
      { hostname: target.hostname, port: target.port || (secure ? 443 : 80), path: target.pathname + target.search, method: 'GET', agent, headers: { 'User-Agent': DEFAULT_WEBSITE_USER_AGENT, Accept: '*/*', 'Accept-Encoding': 'identity' }, timeout: 8000 },
      (response) => {
        t.response = performance.now()
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          t.end = performance.now()
          const reused = !t.connect && !t.lookup
          finish({
            status: response.statusCode,
            location: response.headers.location || null,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 300_000),
            reused,
            dns: t.lookup ? t.lookup - t.start : 0,
            tcp: t.connect ? t.connect - (t.lookup ?? t.start) : 0,
            tls: t.secure ? t.secure - t.connect : 0,
            wait: t.response - (t.secure ?? t.connect ?? t.start),
            body_ms: t.end - t.response,
          })
        })
      }
    )
    request.on('socket', (socket) => {
      if (!socket.connecting) return // reused socket
      socket.once('lookup', () => (t.lookup = performance.now()))
      socket.once('connect', () => (t.connect = performance.now()))
      socket.once('secureConnect', () => (t.secure = performance.now()))
    })
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', (error) => finish({ error: error.code || error.message }))
    request.end()
  })
}

const rows = []
for (const [website] of sites) {
  const base = new URL(website)
  const origin = base.origin
  const robots = await timedGet(`${origin}/robots.txt`, false)
  const rules = robots.status === 200 ? selectRobotsRules(parseRobots(robots.body), DEFAULT_WEBSITE_USER_AGENT) : []
  if (!isUrlAllowed(rules, base.href)) { process.stderr.write(`skip ${base.hostname} (robots)\n`); continue }
  await sleep(800)

  const cold = await timedGet(base.href, false)

  // Reuse: robots.txt then the homepage over the same keep-alive socket.
  const agent = new (base.protocol === 'https:' ? https : http).Agent({ keepAlive: true, maxSockets: 1 })
  const robots2 = await timedGet(`${origin}/robots.txt`, agent)
  const reused = await timedGet(base.href, agent)
  agent.destroy()

  rows.push({ host: base.hostname, robots, cold, robots2, reused })
  process.stderr.write(`${base.hostname}: robots ${Math.round(robots.total)}ms (dns ${Math.round(robots.dns)} tcp ${Math.round(robots.tcp)} tls ${Math.round(robots.tls)} wait ${Math.round(robots.wait ?? 0)}) | page cold ${Math.round(cold.total)}ms | page on reused conn ${Math.round(reused.total)}ms${reused.reused ? '' : ' (not reused!)'}\n`)
  await sleep(800)
}

const ok = rows.filter((r) => !r.robots.error && !r.cold.error && !r.reused.error)
const col = (pick) => Math.round(median(ok.map(pick)))
console.log(`\nREQUEST PHASES, ${ok.length} real hosts (median ms; cold = new connection)`)
console.log('                     total   dns   tcp   tls   server-wait   body')
for (const [label, pick] of [['robots.txt (cold)', (r) => r.robots], ['homepage (cold)', (r) => r.cold]]) {
  console.log(`${label.padEnd(20)} ${String(col((r) => pick(r).total)).padStart(5)} ${String(col((r) => pick(r).dns)).padStart(5)} ${String(col((r) => pick(r).tcp)).padStart(5)} ${String(col((r) => pick(r).tls)).padStart(5)} ${String(col((r) => pick(r).wait)).padStart(12)} ${String(col((r) => pick(r).body_ms)).padStart(6)}`)
}
const reusedOk = ok.filter((r) => r.reused.reused)
console.log(`homepage on a reused connection (${reusedOk.length} hosts): median ${Math.round(median(reusedOk.map((r) => r.reused.total)))}ms vs cold ${Math.round(median(reusedOk.map((r) => r.cold.total)))}ms`)
const setup = ok.map((r) => r.robots.dns + r.robots.tcp + r.robots.tls)
console.log(`robots.txt: connection setup (dns+tcp+tls) median ${Math.round(median(setup))}ms of ${col((r) => r.robots.total)}ms total = ${Math.round((median(setup) / median(ok.map((r) => r.robots.total))) * 100)}%`)
const tlsHosts = ok.filter((r) => r.robots.tls > 0).length
console.log(`${tlsHosts}/${ok.length} hosts use TLS; robots.txt status: ${JSON.stringify(ok.reduce((m, r) => ((m[r.robots.status] = (m[r.robots.status] || 0) + 1), m), {}))}`)
