import test from 'node:test'
import assert from 'node:assert/strict'

import { kickResearch } from '../lib/commercial-intelligence/kick-research.ts'

const reply = (body, ok = true) => async () => ({ ok, json: async () => body })

test('does nothing while research is off, without a secret or without an origin', async () => {
  let calls = 0
  const fetcher = async () => { calls += 1; return { ok: true, json: async () => ({}) } }
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: false, fetcher }), { ticks: 0 })
  assert.deepEqual(await kickResearch('https://x.test', { secret: '', enabled: true, fetcher }), { ticks: 0 })
  assert.deepEqual(await kickResearch('', { secret: 's', enabled: true, fetcher }), { ticks: 0 })
  assert.equal(calls, 0)
})

test('exactly one authenticated tick against the worker route, with no waiting or polling', async () => {
  const seen = []
  const fetcher = async (url, init) => { seen.push([url, init.headers.authorization]); return { ok: true, json: async () => ({ claimed: 10, retrying: 5 }) } }
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher }), { ticks: 1 })
  assert.deepEqual(seen, [['https://x.test/api/internal/cron/commercial-intelligence', 'Bearer s']])
})

test('a failing request never throws', async () => {
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher: async () => { throw new Error('network') } }), { ticks: 1 })
})
