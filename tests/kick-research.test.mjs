import test from 'node:test'
import assert from 'node:assert/strict'

import { kickResearch } from '../lib/commercial-intelligence/kick-research.ts'

test('does nothing while research is off, without a secret or without an origin', async () => {
  let calls = 0
  const fetcher = async () => { calls += 1; return { status: 202 } }
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: false, fetcher }), { accepted: false })
  assert.deepEqual(await kickResearch('https://x.test', { secret: '', enabled: true, fetcher }), { accepted: false })
  assert.deepEqual(await kickResearch('', { secret: 's', enabled: true, fetcher }), { accepted: false })
  assert.equal(calls, 0)
})

test('one authenticated, acknowledged dispatch of the first tick (depth 0), without waiting for the tick itself', async () => {
  const seen = []
  const fetcher = async (url, init) => { seen.push([url, init.headers.authorization]); return { status: 202 } }
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher }), { accepted: true })
  assert.deepEqual(seen, [['https://x.test/api/internal/cron/commercial-intelligence?async=1&depth=0', 'Bearer s']])
})

test('a refused or failing dispatch never throws and is not counted as accepted', async () => {
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher: async () => ({ status: 401 }) }), { accepted: false })
  assert.deepEqual(await kickResearch('https://x.test', { secret: 's', enabled: true, fetcher: async () => { throw new Error('network') } }), { accepted: false })
})
