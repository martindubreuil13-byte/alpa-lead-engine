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

test('one authenticated tick against the worker route; no second tick when nothing awaits a retry', async () => {
  const seen = []
  const fetcher = async (url, init) => { seen.push([url, init.headers.authorization]); return { ok: true, json: async () => ({ claimed: 10, retrying: 0 }) } }
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher }), { ticks: 1 })
  assert.deepEqual(seen, [['https://x.test/api/internal/cron/commercial-intelligence', 'Bearer s']])
})

test('a second tick only for retry-pending jobs, never more than two, and failures never throw', async () => {
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher: reply({ retrying: 2 }) }), { ticks: 2 })
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher: reply({ disabled: true, retrying: 5 }) }), { ticks: 1 })
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher: async () => { throw new Error('network') } }), { ticks: 1 })
})
