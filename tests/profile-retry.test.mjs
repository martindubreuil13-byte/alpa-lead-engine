import test from 'node:test'
import assert from 'node:assert/strict'

import { retryVerdict } from '../lib/intelligence/retry-eligibility.ts'
import { requeueFailedItem } from '../lib/commercial-intelligence/retry-run-item.ts'

const base = {
  jobStatus: 'failed', lastError: 'x', retryCount: 1, maxRetries: 2, claimed: false, runStatus: 'active',
  runExpiresAt: '2999-01-01T00:00:00Z', allowed: true, perJobReserve: 0.002, profileCeiling: 0.006,
  spent: { profile: 0.002, run: 0.01, customerMonth: 0.01, globalMonth: 0.01 }, limits: { run: 0.05, customerMonth: 10, globalMonth: 0.25 },
}
const verdict = (patch) => retryVerdict({ ...base, ...patch, spent: { ...base.spent, ...(patch.spent ?? {}) } })

test('a failed profile with an attempt left and budget available may be retried', () => {
  assert.deepEqual(verdict({}), { ok: true })
})

test('never for queued, running or retrying jobs, cancelled or expired runs, or other customers', () => {
  for (const jobStatus of ['pending', 'processing', 'completed']) assert.equal(verdict({ jobStatus }).reason, 'not_failed')
  assert.equal(verdict({ claimed: true }).reason, 'not_failed')
  assert.equal(verdict({ runStatus: 'cancelled' }).reason, 'cancelled')
  assert.equal(verdict({ lastError: 'cancelled by customer' }).reason, 'cancelled')
  assert.equal(verdict({ runExpiresAt: '2000-01-01T00:00:00Z' }).reason, 'expired')
  assert.equal(verdict({ allowed: false }).reason, 'not_allowed')
})

test('the two-attempt allowance and every budget are respected, never bypassed', () => {
  assert.equal(verdict({ retryCount: 2 }).reason, 'attempts') // both attempts used: exhausted jobs are not retryable
  assert.equal(verdict({ spent: { profile: 0.005 } }).reason, 'budget')
  assert.equal(verdict({ spent: { run: 0.049 } }).reason, 'budget')
  assert.equal(verdict({ spent: { customerMonth: 9.999 } }).reason, 'budget')
  assert.equal(verdict({ spent: { globalMonth: 0.249 } }).reason, 'budget')
  assert.equal(verdict({ perJobReserve: null }).reason, 'budget')
})

function fakeAdmin(rowsAffected) {
  const calls = []
  const chain = { update(v) { calls.push(['update', v]); return chain }, eq(c, v) { calls.push(['eq', c, v]); return chain }, is(c, v) { calls.push(['is', c, v]); return chain }, select: async () => ({ data: rowsAffected, error: null }) }
  return { calls, from: (t) => { calls.push(['from', t]); return chain } }
}

test('the re-queue is one guarded update: same job, still failed, same attempt count, unclaimed; counters untouched', async () => {
  const admin = fakeAdmin([{ id: 'q1' }])
  assert.equal(await requeueFailedItem(admin, { runId: 'r', leadId: 'l', userId: 'u', queueId: 'q1', retryCount: 1 }), true)
  const update = admin.calls.find((c) => c[0] === 'update')[1]
  assert.equal(update.status, 'pending')
  assert.ok(!('retry_count' in update) && !('max_retries' in update))
  const guards = admin.calls.filter((c) => c[0] === 'eq' || c[0] === 'is').map((c) => `${c[1]}=${c[2]}`)
  for (const guard of ['id=q1', 'run_id=r', 'lead_id=l', 'user_id=u', 'status=failed', 'retry_count=1', 'claim_token=null']) assert.ok(guards.includes(guard), guard)
})

test('a duplicate request changes nothing: no row matches the second time', async () => {
  assert.equal(await requeueFailedItem(fakeAdmin([]), { runId: 'r', leadId: 'l', userId: 'u', queueId: 'q1', retryCount: 1 }), false)
})
