import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describeSearchShortfall } from '../lib/scraper/discovery-outcome.ts'

const input = { requested: 25, added: 16, outputLimit: 100, stopReason: 'search_limit', duplicates: 0, invalid: 0, failed: 0, withoutContact: 0 }

test('a limited 16-of-25 run explains the actual shortfall without claiming exhausted sources', () => {
  assert.equal(describeSearchShortfall(input), '16 of 25 requested businesses added to your results. The search reached its current limit.')
})

test('quota, duplicates, contact filtering and save failures are distinguished', () => {
  const message = describeSearchShortfall({ ...input, outputLimit: 16, stopReason: 'target_reached', duplicates: 2, invalid: 1, failed: 3, withoutContact: 4 })
  assert.match(message, /remaining lead allowance/)
  assert.match(message, /2 businesses were already saved/)
  assert.match(message, /4 businesses had no usable contact details/)
  assert.match(message, /1 result was missing required details/)
  assert.match(message, /3 businesses could not be saved/)
  assert.doesNotMatch(message, /search reached|source could not/)
})

test('provider and cost stops are not silently labeled ordinary success', () => {
  assert.match(describeSearchShortfall({ ...input, stopReason: 'provider_error' }), /business source could not complete/)
  assert.match(describeSearchShortfall({ ...input, stopReason: 'cost_limit' }), /cost limit/)
})

test('full requested output has no shortfall message even with earlier candidate losses', () => {
  assert.equal(describeSearchShortfall({ ...input, added: 25, withoutContact: 5 }), null)
})

test('the final stream carries the shortfall and Discover renders it from that authoritative result', () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.match(read('app/api/scrape/route.ts'), /shortfallMessage: describeSearchShortfall\(\{[\s\S]*?added: addedCount/)
  assert.match(read('app/dashboard/scraper/page.tsx'), /\[completionResult\.shortfallMessage, describeSettledNote/)
})
