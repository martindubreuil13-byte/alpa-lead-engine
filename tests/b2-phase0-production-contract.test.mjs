// B2 Phase 0 — the application against the exact production database contract.
//
// tests/fixtures/production-ci-contract.json is a read-only snapshot of production's catalog (function
// parameter names and result columns, table columns). These tests fail if any RPC call in the application
// names a parameter, function or column that production does not have, so the Phase 0 code can never be
// deployed against an incompatible schema. No network and no database are used.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const contract = JSON.parse(read('tests/fixtures/production-ci-contract.json'))

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(relative, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(relative)
  }
  return out
}
const sources = [...walk('app'), ...walk('lib'), ...walk('components')].map((file) => [file, read(file)])

test('every RPC the application calls exists in production, with exactly the parameter names production has', () => {
  const seen = new Set()
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/\.rpc\(\s*'([a-z_]+)'\s*(?:,\s*(\{[^}]*\}|[a-zA-Z_]+))?/g)) {
      const [, name, argument] = match
      seen.add(name)
      if (contract.outOfScope.includes(name)) continue
      const known = contract.functions[name]
      assert.ok(known, `${file} calls ${name}, which is not in the production contract`)
      if (argument?.startsWith('{')) {
        const keys = [...argument.matchAll(/\b(p_[a-z_]+)\b\s*[:,}]/g)].map((entry) => entry[1])
        assert.deepEqual([...new Set(keys)].sort(), [...known.params].sort(), `${file}: ${name} parameters`)
      }
    }
  }
  // the execution path the worker uses is fully present
  for (const required of ['claim_ci_queue_items_worker', 'reset_stale_ci_processing_worker', 'complete_ci_enrichment_worker', 'enqueue_private_preview_ci_worker', 'get_ci_statistics']) {
    assert.ok(seen.has(required), `${required} is called by the application`)
  }
})

test('the application reads only result fields that production returns', () => {
  const manager = read('lib/commercial-intelligence/queue-manager.ts')
  const reset = contract.functions.reset_stale_ci_processing_worker.returns
  for (const field of ['reset_count', 'failed_count']) assert.ok(reset.includes(field) && manager.includes(field))
  const complete = contract.functions.complete_ci_enrichment_worker.returns
  assert.ok(complete.includes('success') && complete.includes('message'))
  assert.match(manager, /result\?\.success/)
  assert.match(manager, /result\?\.message/)
  // the worker core only relies on fields the claim returns
  const claim = contract.functions.claim_ci_queue_items_worker.returns
  const core = read('lib/commercial-intelligence/background-worker-core.ts')
  for (const field of ['item.id', 'item.lead_id']) assert.ok(core.includes(field), field)
  assert.ok(manager.includes('item.claim_token'), 'the completion sends the claim token the claim returned')
  for (const field of ['id', 'lead_id', 'claim_token']) assert.ok(claim.includes(field))
})

test('queue and lead columns the application names exist in production', () => {
  const manager = read('lib/commercial-intelligence/queue-manager.ts')
  const payload = manager.slice(manager.indexOf('const payload = {'), manager.indexOf('}', manager.indexOf('const payload = {')))
  for (const key of ['lead_id', 'user_id', 'status']) {
    assert.ok(payload.includes(key) && contract.queueColumns.includes(key), key)
  }
  for (const column of manager.match(/\.select\('([^']+)'\)/g) ?? []) {
    for (const name of column.slice(9, -2).split(',').map((value) => value.trim())) {
      assert.ok(contract.queueColumns.includes(name) || contract.leadsColumns.includes(name), `unknown column ${name}`)
    }
  }
  const direct = read('lib/commercial-intelligence/enrich-lead-direct.ts')
  for (const name of direct.match(/select\('([^']+)'\)/)[1].split(',').map((value) => value.trim())) {
    assert.ok(contract.leadsColumns.includes(name), `unknown lead column ${name}`)
  }
  // every protected column the lockdown names exists in production
  const lock = read('supabase/proposed/20261015_ci_phase0_lockdown.sql')
  for (const name of new Set([...lock.matchAll(/NEW\.([a-z_]+) IS DISTINCT FROM OLD\./g)].map((entry) => entry[1]))) {
    assert.ok(contract.leadsColumns.includes(name), `lockdown names ${name}`)
  }
})

test('the only research RPC a customer session may still call is the read-only statistics function', () => {
  assert.deepEqual(contract.customerExecutable, ['get_ci_statistics'])
  for (const [file, source] of sources) {
    if (/ci-stats\/route\.ts$/.test(file)) continue
    assert.ok(!/rpc\(\s*'get_ci_statistics'/.test(source), `${file} calls the statistics RPC`)
  }
})
