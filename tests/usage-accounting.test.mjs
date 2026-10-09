import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync(new URL('../app/api/scrape/route.ts', import.meta.url), 'utf8')

test('usage helpers are called with the service-role client, never the user session', () => {
  assert.match(route, /getOrCreateCurrentUsageRow\(createAdminClient\(\),/)
  assert.match(route, /incrementUsageRow\(\s*createAdminClient\(\),/)
  assert.doesNotMatch(route, /getOrCreateCurrentUsageRow\(supabase,/)
  assert.doesNotMatch(route, /incrementUsageRow\(\s*supabase,/)
})

test('every usage write in the scrape route lives inside the two admin-client helpers', () => {
  const writes = [...route.matchAll(/\.from\('usage'\)\s*\.(insert|update|upsert|delete)/g)]
  assert.equal(writes.length, 3) // limit sync, period creation, increment
  const helperStart = route.indexOf('async function getOrCreateCurrentUsageRow')
  const helperEnd = route.indexOf('function normalizePhoneKey')
  for (const w of writes) assert.ok(w.index > helperStart && w.index < helperEnd)
})

test('usage is only incremented from a completed scrape result (failed searches do not consume quota)', () => {
  const idx = route.indexOf('await incrementUsageRow(')
  const guard = route.lastIndexOf('if (completedResult)', idx)
  assert.ok(guard > -1 && idx - guard < 600)
  assert.match(route, /onResult\(result\) \{\s*latestResult = result/)
})
