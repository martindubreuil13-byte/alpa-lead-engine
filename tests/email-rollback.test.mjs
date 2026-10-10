import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { enrichEmail, selectEmailIntelligenceVersion } from '../lib/scraper/email-enrichment.ts'

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const ENTRY_POINTS = ['app/api/scrape/route.ts', 'lib/scraper/run-scraper-shared.ts']

function withEnv(value, run) {
  const previous = process.env.EMAIL_INTELLIGENCE_VERSION
  if (value === undefined) delete process.env.EMAIL_INTELLIGENCE_VERSION
  else process.env.EMAIL_INTELLIGENCE_VERSION = value
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env.EMAIL_INTELLIGENCE_VERSION
    else process.env.EMAIL_INTELLIGENCE_VERSION = previous
  })
}

function spies() {
  const calls = []
  return {
    calls,
    enrichers: {
      v1: async (website) => (calls.push(['v1', website]), { value: 'from-v1@x.com' }),
      v2: async (website) => (calls.push(['v2', website]), { value: 'from-v2@x.com' }),
    },
  }
}

test('V2 is the default when the variable is unset, empty or unrecognised', () => {
  for (const value of [undefined, null, '', ' ', 'v2', 'V2', 'latest', 'true', '1', 'legacy', 'v10', 'v1.5', 'off']) {
    assert.equal(selectEmailIntelligenceVersion(value), 'v2', String(value))
  }
})

test('only an explicit v1 selects V1 (case and surrounding whitespace ignored)', () => {
  for (const value of ['v1', 'V1', ' v1 ', 'v1\n', '\tV1']) {
    assert.equal(selectEmailIntelligenceVersion(value), 'v1', JSON.stringify(value))
  }
})

test('enrichEmail routes to exactly one implementation, chosen at call time', async () => {
  const { calls, enrichers } = spies()

  await withEnv(undefined, async () => assert.equal((await enrichEmail('a.com', enrichers)).value, 'from-v2@x.com'))
  await withEnv('v1', async () => assert.equal((await enrichEmail('b.com', enrichers)).value, 'from-v1@x.com'))
  await withEnv('v2', async () => assert.equal((await enrichEmail('c.com', enrichers)).value, 'from-v2@x.com'))
  await withEnv('garbage', async () => assert.equal((await enrichEmail('d.com', enrichers)).value, 'from-v2@x.com'))

  assert.deepEqual(calls, [['v2', 'a.com'], ['v1', 'b.com'], ['v2', 'c.com'], ['v2', 'd.com']])

  // Toggling between calls in one process takes effect immediately: nothing is cached.
  const toggle = spies()
  process.env.EMAIL_INTELLIGENCE_VERSION = 'v1'
  await enrichEmail('x.com', toggle.enrichers)
  process.env.EMAIL_INTELLIGENCE_VERSION = 'v2'
  await enrichEmail('x.com', toggle.enrichers)
  delete process.env.EMAIL_INTELLIGENCE_VERSION
  assert.deepEqual(toggle.calls.map(([version]) => version), ['v1', 'v2'])
})

test('V1 and V2 selection do not depend on each other', async () => {
  const { calls, enrichers } = spies()
  await withEnv('v1', () => enrichEmail('only-v1.com', enrichers))
  assert.deepEqual(calls.map(([version]) => version), ['v1'])
  calls.length = 0
  await withEnv(undefined, () => enrichEmail('only-v2.com', enrichers))
  assert.deepEqual(calls.map(([version]) => version), ['v2'])
})

test('both scraper entry points use the single switchable enrichEmail and nothing else', () => {
  for (const file of ENTRY_POINTS) {
    const source = read(file)
    // Either public function goes through the same single version switch (enrichEmail delegates to
    // enrichEmailWithInspection); neither names a version.
    assert.match(source, /import \{ (enrichEmail|enrichEmailWithInspection) \} from '@\/lib\/scraper\/email-enrichment'/, file)
    assert.match(source, /await (enrichEmail|enrichEmailWithInspection)\(lead\.website\)/, file)
    for (const forbidden of ['enrichEmailV1', 'enrichEmailV2', 'email-enrichment-v1', 'extractEmailCandidatesFromHtml', 'pickBestEmailCandidate', 'fetchHtml(', 'buildSecondaryPageUrls']) {
      assert.ok(!source.includes(forbidden), `${file} must not reference ${forbidden}`)
    }
  }
})

test('the version variable is read at runtime inside a function, never at module load or build time', () => {
  const source = read('lib/scraper/email-enrichment.ts')
  const reads = source.match(/process\.env\.EMAIL_INTELLIGENCE_VERSION/g) || []
  assert.equal(reads.length, 1)
  const line = source.split('\n').find((entry) => entry.includes('process.env.EMAIL_INTELLIGENCE_VERSION'))
  assert.ok(/^\s+return enrichers\[/.test(line), 'it must be read inside enrichEmail, not captured in a top-level constant')
  assert.ok(!/NEXT_PUBLIC_EMAIL_INTELLIGENCE/.test(source), 'must not be a build-time-inlined public variable')
})

test('the V1 implementation is still present and independent of V2', () => {
  const v1 = read('lib/scraper/email-enrichment-v1.ts')
  assert.match(v1, /export async function enrichEmailV1/)
  assert.ok(!v1.includes('email-intelligence'), 'V1 must not import V2 code')
  assert.ok(!v1.includes('safe-website-fetch'), 'V1 keeps its original transport')
})
