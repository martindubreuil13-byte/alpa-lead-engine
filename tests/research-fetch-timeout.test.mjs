import test from 'node:test'
import assert from 'node:assert/strict'

import { RESEARCH_FETCH_TIMEOUT_MS, safeFetchWebsite } from '../lib/commercial-intelligence/safe-website-fetch.ts'

const publicHost = async () => ['93.184.216.34']
// A server that never answers until the request is cancelled.
const hangs = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
const redirectAfter = (ms) => (url, init) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(new Response(null, { status: 302, headers: { location: `${url.origin}/next${Math.random()}` } })), ms)
  init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
})

test('research fetches use a 5 second attempt limit', () => {
  assert.equal(RESEARCH_FETCH_TIMEOUT_MS, 5_000)
})

test('a hanging website is given up on at the per-attempt limit, as a timeout', async () => {
  const started = Date.now()
  await assert.rejects(
    safeFetchWebsite('https://slow.example', { fetchImpl: hangs, resolveHostname: publicHost, timeoutMs: 200, totalTimeoutMs: 200 }),
    (error) => error.failure === 'timeout'
  )
  assert.ok(Date.now() - started < 1500)
})

test('redirect hops share the whole-call limit instead of each getting a fresh one', async () => {
  const started = Date.now()
  // Each hop answers in 120ms; with a 250ms whole-call limit the chain stops after about two hops, not after all four.
  await assert.rejects(
    safeFetchWebsite('https://chain.example', { fetchImpl: redirectAfter(120), resolveHostname: publicHost, timeoutMs: 1000, totalTimeoutMs: 250, maxRedirects: 3 }),
    (error) => error.failure === 'timeout'
  )
  assert.ok(Date.now() - started < 700, `took ${Date.now() - started}ms`)
})

test('without a whole-call limit the existing per-hop behaviour is unchanged', async () => {
  const ok = async () => new Response('<html><body>hi</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
  const page = await safeFetchWebsite('https://fine.example', { fetchImpl: ok, resolveHostname: publicHost })
  assert.match(page.html, /hi/)
})
